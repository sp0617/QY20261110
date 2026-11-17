// 文本处理工具：中文按二元词组切分，英文按单词切分
// 仅使用 Node.js 内置能力，不依赖任何第三方分词库

// 常见中文虚词（整词过滤，不会拆开“目的”“模型”等专业词）
const CHINESE_STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '就', '都', '而', '等',
  '我', '你', '他', '她', '它', '们', '这', '那', '有', '没有', '吗', '呢',
  '啊', '吧', '呀', '什么', '怎么', '如何', '为什么', '哪些', '哪个', '哪里',
  '请', '问', '一下', '可以', '能', '会', '要', '对', '中', '上', '下', '也',
  '不', '很', '更', '最', '个', '些', '以及', '通过', '使用', '需要', '如果',
  '因为', '所以', '但是', '而且', '已经', '进行', '一个', '我们', '你们',
  '他们', '它们', '一种', '一些', '这个', '那个', '这样', '那样', '还有',
  '关于', '对于', '之间', '其中', '例如', '比如', '即', '则', '却', '并',
  '被', '把', '让', '给', '从', '到', '向', '于', '为', '以', '所', '其',
  // 问句中的通用词，避免“完整/详细”等词干扰检索排序
  '完整', '具体', '详细', '简单', '主要', '介绍', '解释', '说明', '怎么样',
  '时候', '工作',
]);

// 多字停用词：在切分前整体移除，避免“什么是”切出“么是”这类噪声词组
const MULTI_CHAR_STOP_WORDS = [...CHINESE_STOP_WORDS]
  .filter((word) => word.length > 1)
  .sort((a, b) => b.length - a.length);
const MULTI_STOP_PATTERN = new RegExp(
  MULTI_CHAR_STOP_WORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

// 句首句尾可安全修剪的虚词；不包含“上/下/中/不/有/能/要”等可能构成专业词的汉字
const BOUNDARY_PARTICLES = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '就', '都', '而', '等',
  '也', '吗', '呢', '啊', '吧', '呀',
]);

// 常见英文停用词
const ENGLISH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'as', 'by', 'from', 'at', 'we', 'you', 'they', 'i', 'he', 'she',
  'not', 'no', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'may', 'might', 'must', 'have', 'has', 'had', 'but', 'if', 'then', 'than',
  'so', 'such', 'what', 'which', 'who', 'how', 'why', 'when', 'where', 'the',
]);

/**
 * 文本归一化：转小写、全角字符转半角、压缩空白
 * @param {unknown} input 原始文本
 * @returns {string} 归一化后的文本
 */
export function normalizeText(input) {
  return String(input ?? '')
    .toLowerCase()
    // 全角标点、字母、数字转为半角
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 全角空格统一为半角
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 清理中文片段：移除多字停用词，并修剪首尾虚词
 * @param {string} segment 中文连续片段
 * @returns {string[]} 清理后的片段列表
 */
function cleanChineseSegment(segment) {
  return segment
    .replace(MULTI_STOP_PATTERN, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      let value = part;
      // 仅在保留至少一个字符的前提下修剪，避免把整个词清空
      while (value.length > 1 && BOUNDARY_PARTICLES.has(value[0])) {
        value = value.slice(1);
      }
      while (value.length > 1 && BOUNDARY_PARTICLES.has(value[value.length - 1])) {
        value = value.slice(0, -1);
      }
      return value;
    })
    .filter(Boolean);
}

/**
 * 分词：中文连续片段切为二元词组（单字段落保留单字），英文与数字按单词切分
 * 例如“什么是过拟合” -> ['过拟', '拟合']
 * @param {unknown} input 原始文本
 * @returns {string[]} 词项数组（可能包含重复项）
 */
export function tokenize(input) {
  const text = normalizeText(input);
  if (!text) return [];

  const tokens = [];
  // 同时匹配英文/数字片段与中文连续片段
  const segments = text.match(/[a-z0-9]+(?:[.+#_-][a-z0-9]+)*|[\u4e00-\u9fa5]+/g) ?? [];

  for (const segment of segments) {
    if (/^[a-z0-9]/.test(segment)) {
      // 英文或数字：过滤停用词与单字母
      if (segment.length >= 2 && !ENGLISH_STOP_WORDS.has(segment)) {
        tokens.push(segment);
      }
      continue;
    }

    // 中文：先清理停用词，再切为二元词组，避免单字带来大量噪声
    for (const part of cleanChineseSegment(segment)) {
      if (part.length === 1) {
        if (!CHINESE_STOP_WORDS.has(part)) tokens.push(part);
        continue;
      }
      for (let i = 0; i < part.length - 1; i += 1) {
        const bigram = part.slice(i, i + 2);
        if (!CHINESE_STOP_WORDS.has(bigram)) tokens.push(bigram);
      }
    }
  }

  return tokens;
}

/**
 * 统计词频
 * @param {string[]} tokens 词项数组
 * @returns {Map<string, number>} 词项 -> 出现次数
 */
export function countTerms(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * 按长度截断文本，超出时追加省略号
 * @param {string} text 原文
 * @param {number} maxLength 最大长度
 * @returns {string} 截断后的文本
 */
export function truncate(text, maxLength) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * 从资料正文中挑选与问题最相关的一段话，用于展示引用来源
 * @param {string} content 资料正文
 * @param {string} query 用户问题
 * @param {number} maxLength 摘要最大长度
 * @returns {string} 摘要文本
 */
export function buildExcerpt(content, query, maxLength = 160) {
  // 去掉 Markdown 标记，保留可读正文
  const plain = String(content ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (!plain) return '';

  // 按句号、问号、分号与换行切句
  const sentences = plain
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const queryTerms = new Set(tokenize(query));
  let bestSentence = sentences[0] ?? plain;
  let bestScore = -1;

  for (const sentence of sentences) {
    let score = 0;
    // 统计该句中命中问题的词项数量
    for (const term of tokenize(sentence)) {
      if (queryTerms.has(term)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  return truncate(bestSentence, maxLength);
}
