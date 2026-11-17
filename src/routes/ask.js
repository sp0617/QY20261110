// 提问接口：校验参数 → 检索课程资料 → 调用大模型 → 保存问答记录

import { askLLM, getLLMConfig, LLMError } from '../services/llm.js';
import { retrieve } from '../services/retriever.js';
import { saveRecord } from '../record/qaRecord.js';

const MAX_QUESTION_LENGTH = 1000;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * 发送 JSON 响应
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {number} statusCode HTTP 状态码
 * @param {object} payload 响应内容
 */
function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * 读取并解析请求体，限制请求体大小
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @returns {Promise<string>} 请求体文本
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('请求体过大，请缩短问题内容');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 处理 POST /api/ask
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @param {import('node:http').ServerResponse} res 响应对象
 * @returns {Promise<void>}
 */
export async function handleAsk(req, res) {
  const startedAt = Date.now();

  try {
    const rawBody = await readBody(req);
    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      sendJson(res, 400, { error: '请求体必须是合法的 JSON' });
      return;
    }

    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) {
      sendJson(res, 400, { error: '请先输入问题再提问' });
      return;
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      sendJson(res, 400, { error: `问题过长，请控制在 ${MAX_QUESTION_LENGTH} 字以内` });
      return;
    }

    // 第一步：检索课程资料
    const sources = await retrieve(question);

    // 第二步：把资料与问题一起发给大模型（未配置 API Key 时自动走演示模式）
    const result = await askLLM({ question, sources });
    const durationMs = Date.now() - startedAt;

    // 第三步：保存问答记录；记录写入失败不应影响本次回答返回
    let record = null;
    let recordError = '';
    try {
      record = await saveRecord({
        question,
        answer: result.answer,
        sources,
        mode: result.mode,
        model: result.model,
        durationMs,
      });
    } catch (error) {
      recordError = error?.message ?? '未知错误';
      console.error(`[ask] 问答记录保存失败：${recordError}`);
    }

    sendJson(res, 200, {
      question,
      answer: result.answer,
      mode: result.mode,
      model: result.model,
      // 只向前端返回展示所需字段，完整资料片段保留在服务端
      sources: sources.map(({ id, title, score, excerpt }) => ({ id, title, score, excerpt })),
      recordId: record?.id ?? null,
      createdAt: record?.createdAt ?? null,
      durationMs,
      recordSaved: Boolean(record),
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const isKnownError = error instanceof LLMError || Number.isInteger(error?.status);
    const message = isKnownError
      ? error.message
      : '服务器处理提问时出现异常，请稍后重试';

    console.error(`[ask] 处理提问失败（${status}）：${error?.message ?? error}`);
    sendJson(res, status, {
      error: message,
      code: error instanceof LLMError ? error.code : 'INTERNAL_ERROR',
      mode: getLLMConfig().demo ? 'demo' : 'live',
    });
  }
}
