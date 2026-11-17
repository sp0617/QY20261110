// 前端交互逻辑：原生 JavaScript，无任何第三方依赖
// 负责发送提问、展示回答与引用资料、加载最近问答记录

const DEFAULT_HINT = 'Enter 发送 · Shift + Enter 换行 · 回答基于课程资料生成，请自行核对';

const chat = document.getElementById('chat');
const welcome = document.getElementById('welcome');
const composer = document.getElementById('composer');
const questionInput = document.getElementById('question');
const sendBtn = document.getElementById('sendBtn');
const composerHint = document.getElementById('composerHint');
const statusBox = document.getElementById('status');
const statusText = document.getElementById('statusText');
const demoBanner = document.getElementById('demoBanner');
const recordsBox = document.getElementById('records');
const refreshRecordsBtn = document.getElementById('refreshRecords');

let sending = false;

/** 滚动聊天区到底部 */
function scrollToBottom() {
  // 等浏览器完成布局后再滚动，保证新消息可见
  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}

/** 更新输入区提示文字 */
function setHint(text, isWarning = false) {
  composerHint.textContent = text;
  composerHint.classList.toggle('is-warning', isWarning);
}

/** 隐藏欢迎区（首次提问后不再显示） */
function hideWelcome() {
  if (welcome) welcome.hidden = true;
}

/** 格式化时间 */
function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 拼接运行信息，例如“演示模式 · 耗时 120 ms · 引用资料 2 条” */
function buildMetaText(payload) {
  const parts = [];
  parts.push(payload.mode === 'demo' ? '演示模式' : `模型：${payload.model || '未知'}`);

  const duration = Number(payload.durationMs);
  if (Number.isFinite(duration) && duration >= 0) {
    parts.push(`耗时 ${Math.round(duration)} ms`);
  }

  const count = Array.isArray(payload.sources) ? payload.sources.length : 0;
  parts.push(count > 0 ? `引用资料 ${count} 条` : '未检索到相关资料');

  if (payload.createdAt) parts.push(formatTime(payload.createdAt));
  return parts.join(' · ');
}

/**
 * 渲染引用资料列表
 * @param {HTMLElement} container 消息主体容器
 * @param {{ title?: string, excerpt?: string }[]} sources 资料列表
 */
function renderSources(container, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return;

  const box = document.createElement('div');
  box.className = 'sources';

  const title = document.createElement('div');
  title.className = 'sources-title';
  title.textContent = `引用课程资料（${sources.length} 条）`;
  box.appendChild(title);

  for (const source of sources) {
    const details = document.createElement('details');
    details.className = 'source';

    const summary = document.createElement('summary');
    summary.textContent = source.title || '课程资料';

    const excerpt = document.createElement('p');
    excerpt.textContent = source.excerpt || '暂无摘要';

    details.append(summary, excerpt);
    box.appendChild(details);
  }

  container.appendChild(box);
}

/**
 * 渲染运行信息标签
 * @param {HTMLElement} container 消息主体容器
 * @param {object} payload 回答数据
 */
function renderMeta(container, payload) {
  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const tag = document.createElement('span');
  tag.className = `meta-tag${payload.mode === 'demo' ? ' is-demo' : ''}`;
  tag.textContent = payload.mode === 'demo' ? '演示' : '在线';
  meta.appendChild(tag);

  const text = document.createElement('span');
  text.textContent = buildMetaText(payload);
  meta.appendChild(text);

  container.appendChild(meta);
}

/** 添加用户消息 */
function appendUserMessage(text) {
  const message = document.createElement('div');
  message.className = 'message message-user';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  message.appendChild(bubble);
  chat.appendChild(message);
  scrollToBottom();
}

/**
 * 添加机器人消息
 * @param {{ answer?: string, mode?: string, model?: string, sources?: object[], durationMs?: number, createdAt?: string }} payload 回答数据
 * @param {{ isError?: boolean, label?: string }} options 展示选项
 */
function appendBotMessage(payload, { isError = false, label = '' } = {}) {
  const message = document.createElement('div');
  message.className = `message message-bot${isError ? ' is-error' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = 'AI';

  const main = document.createElement('div');
  main.className = 'message-main';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = payload.answer || '';

  main.appendChild(bubble);

  if (!isError) {
    renderSources(main, payload.sources);
    renderMeta(main, payload);
  } else {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = label || '请求未完成';
    main.appendChild(meta);
  }

  message.append(avatar, main);
  chat.appendChild(message);
  scrollToBottom();
  return message;
}

/** 添加“思考中”占位消息，返回可替换的消息主体 */
function appendLoadingMessage() {
  const message = document.createElement('div');
  message.className = 'message message-bot';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = 'AI';

  const main = document.createElement('div');
  main.className = 'message-main';

  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-loading';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-label', '正在检索课程资料并生成回答');

  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    bubble.appendChild(dot);
  }

  const text = document.createElement('span');
  text.className = 'loading-text';
  text.textContent = '正在检索资料并生成回答…';
  bubble.appendChild(text);

  main.appendChild(bubble);
  message.append(avatar, main);
  chat.appendChild(message);
  scrollToBottom();

  return { message, main };
}

/** 健康检查：展示在线/演示/离线状态 */
async function loadHealth() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    statusBox.classList.remove('is-live', 'is-demo', 'is-offline');

    if (data.mode === 'demo') {
      statusBox.classList.add('is-demo');
      statusText.textContent = '演示模式 · 未配置密钥';
      statusBox.title = '未配置 LLM_API_KEY，返回预设回答';
      demoBanner.hidden = false;
    } else {
      statusBox.classList.add('is-live');
      statusText.textContent = `在线 · ${data.model || '大模型已就绪'}`;
      statusBox.title = `大模型接口已配置，超时 ${Math.round((data.timeoutMs || 0) / 1000)} 秒`;
      demoBanner.hidden = true;
    }
  } catch (error) {
    console.error('健康检查失败：', error);
    statusBox.classList.remove('is-live', 'is-demo');
    statusBox.classList.add('is-offline');
    statusText.textContent = '服务状态未知';
    statusBox.title = '无法连接服务，请确认 Node.js 服务已启动';
  }
}

/** 渲染最近问答记录 */
function renderRecords(records) {
  recordsBox.replaceChildren();

  if (!Array.isArray(records) || records.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'records-empty';
    empty.textContent = '还没有问答记录，提出第一个问题试试吧。';
    recordsBox.appendChild(empty);
    return;
  }

  for (const record of records) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'record-item';
    item.title = '点击查看这条问答';

    const question = document.createElement('div');
    question.className = 'record-question';
    question.textContent = record.question || '（无问题内容）';

    const meta = document.createElement('div');
    meta.className = 'record-meta';

    const tag = document.createElement('span');
    tag.className = `record-tag${record.mode === 'demo' ? ' is-demo' : ''}`;
    tag.textContent = record.mode === 'demo' ? '演示' : '在线';

    const time = document.createElement('span');
    time.textContent = formatTime(record.createdAt);

    meta.append(tag, time);
    item.append(question, meta);

    // 点击历史记录时，在聊天区回放该问答
    item.addEventListener('click', () => {
      if (sending) return;
      hideWelcome();
      appendUserMessage(record.question || '');
      appendBotMessage({
        answer: record.answer || '（记录中没有回答内容）',
        mode: record.mode,
        model: record.model,
        sources: record.sources,
        durationMs: record.durationMs,
        createdAt: record.createdAt,
      });
    });

    recordsBox.appendChild(item);
  }
}

/** 加载最近问答记录 */
async function loadRecords() {
  try {
    const response = await fetch('/api/records?limit=12', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    renderRecords(data.records);
  } catch (error) {
    console.error('读取问答记录失败：', error);
    recordsBox.replaceChildren();
    const message = document.createElement('p');
    message.className = 'records-error';
    message.textContent = '读取问答记录失败，请点击“刷新”重试。';
    recordsBox.appendChild(message);
  }
}

/**
 * 提交问题：调用 /api/ask，展示回答并刷新记录
 * @param {string} rawQuestion 用户问题
 */
async function submitQuestion(rawQuestion) {
  if (sending) return;

  const question = String(rawQuestion ?? '').trim();
  if (!question) {
    setHint('请先输入问题再发送。', true);
    questionInput.focus();
    return;
  }
  if (question.length > 1000) {
    setHint('问题过长，请控制在 1000 字以内。', true);
    return;
  }

  sending = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '思考中…';
  questionInput.disabled = true;
  setHint(DEFAULT_HINT);

  hideWelcome();
  appendUserMessage(question);
  questionInput.value = '';
  questionInput.style.height = '';

  const loading = appendLoadingMessage();

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ question }),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(data?.error || `请求失败（HTTP ${response.status}）`);
    }
    if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
      throw new Error('服务返回的回答为空，请稍后重试');
    }

    // 用正式回答替换“思考中”占位消息
    loading.message.remove();
    appendBotMessage(data);
    loadRecords();
  } catch (error) {
    loading.message.remove();
    console.error('提问失败：', error);
    appendBotMessage(
      {
        answer: `抱歉，回答失败：${error?.message || '网络异常，请稍后重试'}\n\n请稍后重试。如果问题持续出现，请查看服务端日志，确认大模型配置与网络是否正常。`,
      },
      { isError: true, label: '请求未完成' },
    );
    setHint('这次回答失败了，请稍后重试。', true);
  } finally {
    sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';
    questionInput.disabled = false;
    questionInput.focus();
  }
}

// 快捷问题
document.getElementById('suggestions')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-question]');
  if (!button) return;
  submitQuestion(button.dataset.question || '');
});

// 表单提交
composer.addEventListener('submit', (event) => {
  event.preventDefault();
  submitQuestion(questionInput.value);
});

// Enter 发送，Shift + Enter 换行；兼容中文输入法的组合输入状态
questionInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  composer.requestSubmit();
});

// 输入时自动调整文本框高度
questionInput.addEventListener('input', () => {
  questionInput.style.height = 'auto';
  questionInput.style.height = `${Math.min(questionInput.scrollHeight, 140)}px`;
  if (composerHint.classList.contains('is-warning')) setHint(DEFAULT_HINT);
});

// 刷新问答记录
refreshRecordsBtn.addEventListener('click', async () => {
  refreshRecordsBtn.disabled = true;
  refreshRecordsBtn.textContent = '刷新中…';
  await loadRecords();
  refreshRecordsBtn.disabled = false;
  refreshRecordsBtn.textContent = '刷新';
});

// 初始化
loadHealth();
loadRecords();
questionInput.focus();
