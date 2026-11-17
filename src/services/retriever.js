// 课程资料检索服务：读取 Markdown 资料，按标题切分，使用 BM25 风格算法排序
// 纯 Node.js 实现，适合中小规模课程资料的关键词检索

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExcerpt, countTerms, tokenize } from '../utils/text.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// 课程资料固定放在项目根目录的 data 目录下
const NOTES_PATH = path.resolve(currentDir, '../../data/course-notes.md');
const NOTES_RELATIVE_PATH = 'data/course-notes.md';

const DEFAULT_TOP_K = 3;
// BM25 参数：控制词频饱和与文档长度惩罚
const BM25_K1 = 1.5;
const BM25_B = 0.75;
// 标题命中时给予额外加权
const TITLE_BOOST = 1.2;

// 资料缓存：mtime 变化时自动重新加载，方便修改资料后无需重启
let cache = null;

/**
 * 判断段落是否有实际内容（忽略空行与 Markdown 分隔线）
 * @param {{ title: string, lines: string[] }} chunk 待检查的段落
 * @returns {boolean} 是否有内容
 */
function hasContent(chunk) {
  return chunk.lines.some((line) => line.trim() && !/^-{3,}$/.test(line.trim()));
}

/**
 * 把 Markdown 按二级标题切分为多个片段
 * @param {string} markdown Markdown 原文
 * @returns {{ title: string, content: string }[]} 片段列表
 */
function splitMarkdown(markdown) {
  const chunks = [];
  // 文档开头部分先作为一个片段，标题取一级标题
  let current = { title: '课程资料', lines: [] };
  let inCodeFence = false;

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();

    // 代码块内的 # 不作为标题处理
    if (/^\s*```/.test(line)) inCodeFence = !inCodeFence;

    if (!inCodeFence) {
      const h1Match = /^#\s+(.+)$/.exec(line);
      // 文档主标题用于开头片段
      if (h1Match && current.lines.every((item) => !item.trim())) {
        current.title = h1Match[1].trim();
        continue;
      }

      const h2Match = /^##\s+(.+)$/.exec(line);
      if (h2Match) {
        if (hasContent(current)) chunks.push(current);
        current = { title: h2Match[1].trim(), lines: [] };
        continue;
      }
    }

    current.lines.push(line);
  }

  if (hasContent(current)) chunks.push(current);

  return chunks.map((chunk, index) => ({
    id: index + 1,
    title: chunk.title,
    content: chunk.lines.join('\n').trim(),
  }));
}

/**
 * 构建检索索引：词频、文档频率、平均文档长度
 * @param {{ id: number, title: string, content: string }[]} chunks 资料片段
 */
function buildIndex(chunks) {
  const documents = chunks.map((chunk) => {
    const contentTerms = tokenize(chunk.content);
    const titleTerms = tokenize(chunk.title);
    return {
      id: chunk.id,
      title: chunk.title,
      content: chunk.content,
      tf: countTerms(contentTerms),
      titleTerms: new Set(titleTerms),
      length: contentTerms.length,
    };
  });

  const documentFrequency = new Map();
  for (const doc of documents) {
    for (const term of doc.tf.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const totalLength = documents.reduce((sum, doc) => sum + doc.length, 0);

  return {
    documents,
    documentFrequency,
    averageLength: documents.length > 0 ? totalLength / documents.length : 0,
  };
}

/**
 * 加载并缓存课程资料索引，资料文件更新后自动重新读取
 * @returns {Promise<ReturnType<typeof buildIndex>>} 索引数据
 */
async function loadIndex() {
  const fileStat = await stat(NOTES_PATH);
  if (cache && cache.mtimeMs === fileStat.mtimeMs) {
    return cache.index;
  }

  const markdown = await readFile(NOTES_PATH, 'utf8');
  const chunks = splitMarkdown(markdown);
  const index = buildIndex(chunks);
  cache = { mtimeMs: fileStat.mtimeMs, index };
  return index;
}

/**
 * 计算 BM25 相关度得分
 * @param {object} doc 文档
 * @param {string[]} queryTerms 查询词项（已去重）
 * @param {Map<string, number>} docFrequency 文档频率表
 * @param {number} averageLength 平均文档长度
 * @param {number} totalDocuments 文档总数
 * @returns {number} 相关度得分
 */
function scoreDocument(doc, queryTerms, docFrequency, averageLength, totalDocuments) {
  let score = 0;
  const lengthRatio = averageLength > 0 ? doc.length / averageLength : 0;

  for (const term of queryTerms) {
    const frequency = doc.tf.get(term) ?? 0;
    const documentCount = docFrequency.get(term) ?? 0;
    if (frequency === 0 && documentCount === 0) continue;

    // 逆文档频率：越少见的词权重越高
    const idf = Math.log(1 + (totalDocuments - documentCount + 0.5) / (documentCount + 0.5));

    if (frequency > 0) {
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio);
      score += idf * ((frequency * (BM25_K1 + 1)) / denominator);
    }

    // 标题中出现关键词时额外加分
    if (doc.titleTerms.has(term)) score += idf * TITLE_BOOST;
  }

  return score;
}

/**
 * 检索与问题最相关的课程资料片段
 * @param {string} query 用户问题
 * @param {{ topK?: number }} options 检索选项
 * @returns {Promise<{ id: number, title: string, score: number, excerpt: string }[]>} 相关资料
 */
export async function retrieve(query, { topK = DEFAULT_TOP_K } = {}) {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const { documents, documentFrequency, averageLength } = await loadIndex();
  if (documents.length === 0) return [];

  const ranked = documents
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      score: scoreDocument(doc, queryTerms, documentFrequency, averageLength, documents.length),
    }))
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return ranked.map((doc) => ({
    id: doc.id,
    title: doc.title,
    score: Number(doc.score.toFixed(3)),
    // content 供大模型阅读完整片段；excerpt 用于前端展示与问答记录
    content: doc.content,
    excerpt: buildExcerpt(doc.content, query),
  }));
}

/**
 * 获取资料库基本信息，用于健康检查与页面展示
 * @returns {Promise<{ file: string, chunks: number }>} 资料文件与片段数量
 */
export async function getNotesInfo() {
  const { documents } = await loadIndex();
  return { file: NOTES_RELATIVE_PATH, chunks: documents.length };
}
