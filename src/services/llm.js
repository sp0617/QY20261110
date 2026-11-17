// 大模型调用服务：兼容 OpenAI Chat Completions 协议
// 配置全部来自环境变量：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
// 未配置 LLM_API_KEY 时自动进入演示模式，返回预设回答，保证完整流程可运行

import { truncate } from '../utils/text.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ANSWER_TOKENS = 900;
// 单条资料送入提示词的最大字符数，控制上下文长度与调用成本
const MAX_SOURCE_CHARS = 1200;

/**
 * 大模型调用错误：携带 HTTP 状态码与错误码，便于接口层统一处理
 */
export class LLMError extends Error {
  /**
   * @param {string} message 错误提示（中文）
   * @param {{ status?: number, code?: string, cause?: unknown }} options 错误选项
   */
  constructor(message, { status = 502, code = 'LLM_ERROR', cause } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * 读取大模型配置
 * @returns {{ apiKey: string, baseUrl: string, model: string, timeoutMs: number, demo: boolean }} 配置对象
 */
export function getLLMConfig() {
  const apiKey = (process.env.LLM_API_KEY ?? '').trim();
  const baseUrl = (process.env.LLM_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
  const model = (process.env.LLM_MODEL ?? '').trim() || DEFAULT_MODEL;
  const parsedTimeout = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? '', 10);

  return {
    apiKey,
    // 去掉末尾斜杠，避免拼接出双斜杠
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS,
    demo: !apiKey,
  };
}

/**
 * 拼接发送给大模型的提示词：系统指令 + 课程资料 + 用户问题
 * @param {string} question 用户问题
 * @param {{ title: string, excerpt: string, content?: string }[]} sources 检索到的资料
 * @returns {{ role: 'system' | 'user', content: string }[]} 消息列表
 */
function buildMessages(question, sources) {
  const systemPrompt = [
    '你是一名耐心的课程答疑助手，只回答与课程学习相关的问题。',
    '请严格依据下面提供的课程资料作答，不要编造资料中不存在的事实。',
    '如果资料不足以回答，请明确说明“课程资料中未找到相关内容”，并给出合理的学习建议。',
    '回答使用中文，条理清晰，必要时分点说明，并在引用资料时标注对应的资料标题。',
  ].join('\n');

  const materialBlock = sources.length
    ? sources
        .map((source, index) => {
          // 优先使用完整片段作为上下文；限制单条长度，避免提示词过长
          const body = truncate(source.content || source.excerpt || '', MAX_SOURCE_CHARS);
          return `【资料 ${index + 1}】${source.title}\n${body}`;
        })
        .join('\n\n')
    : '（本次没有检索到相关课程资料）';

  const userPrompt = [
    '以下是检索到的课程资料：',
    materialBlock,
    '',
    `学生的问题：${question}`,
    '',
    '请结合以上资料回答，并在开头用一句话直接回应问题。',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * 生成演示模式下的预设回答（不会真正调用大模型）
 * @param {string} question 用户问题
 * @param {{ title: string, excerpt: string, content?: string }[]} sources 检索到的资料
 * @returns {string} 预设回答文本
 */
function buildDemoAnswer(question, sources) {
  const lines = [
    '这是演示模式的预设回答：当前没有配置 LLM_API_KEY，系统未真正调用大模型。',
    '',
  ];

  if (sources.length === 0) {
    lines.push(
      `关于「${truncate(question, 60)}」，课程资料中没有检索到直接相关的内容。`,
      '你可以换一种问法，或先在 data/course-notes.md 中补充对应章节。',
      '配置 LLM_API_KEY 后，系统会把资料和问题一起交给大模型生成回答。',
    );
    return lines.join('\n');
  }

  lines.push(`关于「${truncate(question, 60)}」，课程资料中最相关的内容如下：`);
  sources.forEach((source, index) => {
    lines.push('', `${index + 1}. 《${source.title}》`, `   ${source.excerpt}`);
  });
  lines.push('', '以上内容摘自课程资料。配置 LLM_API_KEY 后，系统会调用大模型生成更完整的解答。');
  return lines.join('\n');
}

/**
 * 向大模型提问，带超时保护、异常处理与空内容校验
 * @param {{ question: string, sources?: { title: string, excerpt: string }[] }} payload 提问参数
 * @returns {Promise<{ answer: string, mode: 'demo' | 'live', model: string, usage: object | null }>} 回答结果
 */
export async function askLLM({ question, sources = [] }) {
  const config = getLLMConfig();

  // 未配置 API Key：进入演示模式，保证“检索 → 作答 → 记录”流程可跑通
  if (config.demo) {
    return {
      answer: buildDemoAnswer(question, sources),
      mode: 'demo',
      model: '演示模式',
      usage: null,
    };
  }

  const requestBody = {
    model: config.model,
    messages: buildMessages(question, sources),
    temperature: 0.3,
    max_tokens: MAX_ANSWER_TOKENS,
    stream: false,
  };

  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      // 使用内置的超时信号，防止请求长期挂起
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new LLMError(
        `调用大模型超时（已超过 ${Math.round(config.timeoutMs / 1000)} 秒），请稍后重试`,
        { status: 504, code: 'LLM_TIMEOUT', cause: error },
      );
    }
    throw new LLMError('无法连接大模型服务，请检查 LLM_BASE_URL 配置与网络状况', {
      status: 502,
      code: 'LLM_NETWORK',
      cause: error,
    });
  }

  if (!response.ok) {
    // 读取错误详情时限制长度，避免把大段响应直接返回给前端
    let detail = '';
    try {
      detail = truncate(await response.text(), 300);
    } catch {
      detail = '';
    }
    const suffix = detail ? `：${detail}` : '';
    throw new LLMError(`大模型接口返回错误（HTTP ${response.status}）${suffix}`, {
      status: 502,
      code: 'LLM_HTTP_ERROR',
    });
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new LLMError('大模型返回的内容不是合法 JSON，无法解析回答', {
      status: 502,
      code: 'LLM_BAD_JSON',
      cause: error,
    });
  }

  const content = data?.choices?.[0]?.message?.content;
  const answer = typeof content === 'string' ? content.trim() : '';

  // 空回答视为调用失败，避免把空白结果当作成功写入问答记录
  if (!answer) {
    throw new LLMError('大模型返回内容为空，已按调用失败处理', {
      status: 502,
      code: 'LLM_EMPTY',
    });
  }

  return {
    answer,
    mode: 'live',
    model: typeof data?.model === 'string' && data.model ? data.model : config.model,
    usage: data?.usage ?? null,
  };
}
