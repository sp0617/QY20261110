// 启动入口：创建原生 HTTP 服务，提供静态页面、提问接口、健康检查与问答记录接口
// 运行方式：node src/server.js（可配置 PORT / HOST 环境变量）

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAsk } from './routes/ask.js';
import { getLLMConfig } from './services/llm.js';
import { getNotesInfo } from './services/retriever.js';
import { readRecords } from './record/qaRecord.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(currentDir, '../public');
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 3000;
const HOST = (process.env.HOST ?? '127.0.0.1').trim() || '127.0.0.1';

// 静态资源类型映射，避免依赖第三方 mime 库
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * 发送 JSON 响应
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {number} statusCode HTTP 状态码
 * @param {object} payload 响应内容
 * @param {Record<string, string>} [extraHeaders] 额外响应头
 */
function sendJson(res, statusCode, payload, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

/**
 * 发送简单的 HTML 错误页
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {number} statusCode HTTP 状态码
 * @param {string} message 错误提示
 */
function sendHtmlError(res, statusCode, message) {
  if (res.writableEnded) return;
  const body = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${statusCode}</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; color: #1f2937;">
  <h1>${statusCode}</h1>
  <p>${message}</p>
  <p><a href="/">返回首页</a></p>
</body>
</html>`;
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 提供 public 目录下的静态文件，并做目录穿越防护
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {string} pathname 请求路径
 * @returns {Promise<void>}
 */
async function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendHtmlError(res, 400, '请求路径格式不正确');
    return;
  }

  if (decodedPath.includes('\0')) {
    sendHtmlError(res, 400, '请求路径格式不正确');
    return;
  }

  // 根路径返回首页
  if (decodedPath === '/' || decodedPath === '') decodedPath = '/index.html';

  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  // 只允许访问 public 目录内的文件
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendHtmlError(res, 403, '无权访问该路径');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      const indexStat = await stat(indexPath);
      if (!indexStat.isFile()) throw Object.assign(new Error('不是文件'), { code: 'ENOENT' });
      return await sendFile(req, res, indexPath);
    }
    if (!fileStat.isFile()) {
      sendHtmlError(res, 404, '未找到该资源');
      return;
    }
    return await sendFile(req, res, filePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      sendHtmlError(res, 404, '未找到该页面，请检查地址是否正确');
      return;
    }
    throw error;
  }
}

/**
 * 读取并返回单个文件
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {string} filePath 文件绝对路径
 * @returns {Promise<void>}
 */
async function sendFile(req, res, filePath) {
  const content = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'Content-Length': content.length,
    // 开发阶段不缓存，修改前端文件后刷新即可生效
    'Cache-Control': 'no-cache',
  });
  // HEAD 请求无需返回响应体
  res.end(req.method === 'HEAD' ? undefined : content);
}

/**
 * 处理 /api/health
 * @param {import('node:http').ServerResponse} res 响应对象
 */
async function handleHealth(res) {
  const config = getLLMConfig();
  let knowledgeBase = null;
  try {
    knowledgeBase = await getNotesInfo();
  } catch (error) {
    console.error(`[health] 读取课程资料失败：${error?.message ?? error}`);
  }

  sendJson(res, 200, {
    status: 'ok',
    mode: config.demo ? 'demo' : 'live',
    model: config.demo ? '演示模式' : config.model,
    timeoutMs: config.timeoutMs,
    knowledgeBase,
  });
}

/**
 * 处理 /api/records
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {URL} url 请求地址
 */
async function handleRecords(res, url) {
  try {
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20;
    const records = await readRecords({ limit });
    sendJson(res, 200, { count: records.length, records });
  } catch (error) {
    console.error(`[records] 读取问答记录失败：${error?.message ?? error}`);
    sendJson(res, 500, { error: '读取问答记录失败，请稍后重试' });
  }
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  let url;
  try {
    url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    sendJson(res, 400, { error: '请求地址格式不正确' });
    return;
  }

  const pathname = url.pathname;

  try {
    if (pathname === '/api/ask') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: '该接口仅支持 POST 请求' }, { Allow: 'POST' });
        return;
      }
      await handleAsk(req, res);
      return;
    }

    if (pathname === '/api/health') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: '该接口仅支持 GET 请求' }, { Allow: 'GET' });
        return;
      }
      await handleHealth(res);
      return;
    }

    if (pathname === '/api/records') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: '该接口仅支持 GET 请求' }, { Allow: 'GET' });
        return;
      }
      await handleRecords(res, url);
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: '接口不存在' });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: '不支持的请求方法' }, { Allow: 'GET, HEAD' });
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error(`[server] 请求处理异常（${method} ${pathname}）：${error?.stack ?? error}`);
    if (!res.headersSent) {
      sendJson(res, 500, { error: '服务器内部错误，请稍后重试' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// 限制读取请求体的最长时间，避免连接被长期占用
server.requestTimeout = 65_000;

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`启动失败：端口 ${PORT} 已被占用，可通过 PORT 环境变量更换端口`);
  } else {
    console.error(`服务发生错误：${error?.stack ?? error}`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  const config = getLLMConfig();
  console.log('AI 答疑助手已启动');
  console.log(`访问地址：http://${HOST}:${PORT}`);
  if (config.demo) {
    console.log('运行模式：演示模式（未配置 LLM_API_KEY，将返回预设回答）');
    console.log('如需调用真实大模型，请设置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 后重启');
  } else {
    console.log(`运行模式：在线模式（模型：${config.model}）`);
    console.log(`接口地址：${config.baseUrl}`);
    console.log(`超时时间：${Math.round(config.timeoutMs / 1000)} 秒`);
  }
});

// 优雅退出：收到中断信号后关闭服务
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n收到 ${signal} 信号，正在关闭服务…`);
    server.close(() => process.exit(0));
    // 兜底：3 秒内仍未关闭则强制退出
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

// 未捕获异常只记录日志，避免进程直接退出影响正在进行的请求
process.on('unhandledRejection', (reason) => {
  console.error(`[server] 未处理的 Promise 拒绝：${reason?.stack ?? reason}`);
});
