# AI 答疑助手

一个使用**原生 Node.js**（零第三方依赖）实现的课程问答助手：先检索课程资料，再把资料和问题一起发给兼容 OpenAI 协议的大模型，最后保存问答记录。

## 功能特点

- 检索增强：按 Markdown 二级标题切分课程资料，使用中英文分词 + BM25 风格算法召回最相关资料。
- 大模型调用：兼容 `/chat/completions` 协议，配置从环境变量读取。
- 演示模式：未配置 `LLM_API_KEY` 时自动返回预设回答，检索、作答、记录流程完整可跑通。
- 稳定性：请求超时保护、网络/接口异常处理、空回答按失败处理、请求体大小限制。
- 问答记录：以 JSON Lines 追加写入 `data/qa-records.jsonl`，页面可查看并回放最近记录。
- 中文界面：原生 HTML/CSS/JS，响应式布局，支持快捷问题、引用来源与状态提示。

## 目录结构

```
ai-qa/
├─ src/
│  ├─ server.js              # 启动入口：HTTP 服务、静态资源、健康检查、记录接口
│  ├─ routes/
│  │  └─ ask.js              # POST /api/ask：参数校验 → 检索 → 调用模型 → 保存记录
│  ├─ services/
│  │  ├─ llm.js              # 兼容 OpenAI 协议的大模型调用、超时与演示模式
│  │  └─ retriever.js        # 课程资料读取、切分、BM25 风格检索
│  ├─ record/
│  │  └─ qaRecord.js         # 问答记录读写（JSONL）
│  └─ utils/
│     └─ text.js             # 文本归一化、中英文分词、摘要截取
├─ data/
│  └─ course-notes.md        # 课程资料（可自行替换或扩充）
├─ public/
│  ├─ index.html             # 前端页面
│  ├─ styles.css             # 页面样式
│  └─ app.js                 # 前端交互逻辑
├─ .env.example              # 环境变量示例
├─ package.json
└─ README.md
```

## 运行

要求 Node.js 20 及以上（推荐 22+）。

```powershell
# 1. 进入项目目录
cd ai-qa

# 2. 直接启动（演示模式，无需任何依赖）
npm start
```

打开 <http://127.0.0.1:3000> 即可提问。

也可以直接运行：

```powershell
node src/server.js
# 或开发模式（文件变更后自动重启）
node --watch src/server.js
```

## 配置真实大模型

支持任何兼容 OpenAI Chat Completions 协议的服务（OpenAI、DeepSeek、通义千问兼容接口、本地 Ollama 等）。

| 环境变量 | 是否必填 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `LLM_API_KEY` | 否 | 模型服务密钥；为空时进入演示模式 | 空 |
| `LLM_BASE_URL` | 否 | 接口根地址，不含 `/chat/completions` | `https://api.openai.com/v1` |
| `LLM_MODEL` | 否 | 模型名称 | `gpt-4o-mini` |
| `LLM_TIMEOUT_MS` | 否 | 调用超时时间（毫秒） | `30000` |
| `PORT` | 否 | 服务端口 | `3000` |
| `HOST` | 否 | 监听地址 | `127.0.0.1` |

PowerShell 示例：

```powershell
$env:LLM_API_KEY = "sk-你的密钥"
$env:LLM_BASE_URL = "https://api.openai.com/v1"
$env:LLM_MODEL = "gpt-4o-mini"
npm start
```

也可以基于 `.env.example` 创建 `.env`，再使用 Node.js 内置的 env-file 能力启动：

```powershell
Copy-Item .env.example .env
# 编辑 .env 填入密钥后：
node --env-file=.env src/server.js
```

> 注意：修改环境变量后需要重启服务。密钥只从服务端环境变量读取，不会下发到前端页面。

## 接口说明

### `POST /api/ask`

请求：

```json
{ "question": "什么是过拟合？如何避免？" }
```

成功响应（节选）：

```json
{
  "question": "什么是过拟合？如何避免？",
  "answer": "……",
  "mode": "demo",
  "model": "演示模式",
  "sources": [
    { "id": 2, "title": "二、过拟合、欠拟合与正则化", "score": 12.34, "excerpt": "……" }
  ],
  "recordId": "……",
  "createdAt": "2026-10-27T06:00:00.000Z",
  "durationMs": 12,
  "recordSaved": true
}
```

常见错误：

| 状态码 | 场景 |
| --- | --- |
| 400 | 问题为空、超过 1000 字、请求体不是合法 JSON |
| 413 | 请求体超过 64 KB |
| 502 | 模型接口返回错误、返回空内容、返回非 JSON |
| 504 | 调用大模型超时 |
| 500 | 服务器内部异常 |

### `GET /api/health`

返回运行模式（`demo` / `live`）、模型名称、超时时间与知识库片段数量。

### `GET /api/records?limit=20`

按时间倒序返回最近问答记录，`limit` 取值 1–100。

## 实现要点

1. **检索**：`src/services/retriever.js` 读取 `data/course-notes.md`，按 `##` 标题切片，中文按二元词组、英文按单词建立倒排词频，以 BM25 公式排序，并对标题命中加权。资料文件变化后按 mtime 自动重新加载。
2. **调用**：`src/services/llm.js` 组装中文系统提示与资料上下文，通过内置 `fetch` 调用 `${LLM_BASE_URL}/chat/completions`，使用 `AbortSignal.timeout()` 防止请求挂起；空内容抛出 `LLM_EMPTY` 错误。
3. **记录**：`src/record/qaRecord.js` 将问题、回答、引用标题与摘要、模式、模型、耗时追加写入 JSONL；并发写入通过队列串行化，避免行内容交错。
4. **演示模式**：没有 `LLM_API_KEY` 时，用预设模板结合检索结果生成回答，页面会显示“演示模式”提示。

## 自定义课程资料

编辑 `data/course-notes.md`，建议：

- 每个知识点使用一个 `##` 二级标题，标题写清楚关键词。
- 段落使用课程中的标准术语，便于关键词检索命中。
- 适当补充“常见问题”，覆盖学生高频提问。

保存后无需重启服务，下一次检索会自动加载新内容。若替换为其他课程资料，可同步调整前端欢迎语中的资料名称。

## 说明

- 问答记录默认保存在 `data/qa-records.jsonl`，已被 `.gitignore` 忽略；删除该文件即可清空记录。
- 回答由模型生成，可能存在错误，页面已提示用户核对原始资料。
- 本项目仅用于课程学习与本地演示，生产部署前请补充鉴权、限流、HTTPS 与日志脱敏等措施。
