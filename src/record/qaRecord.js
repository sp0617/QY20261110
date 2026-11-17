// 问答记录读写：以 JSON Lines 格式追加保存，便于查看与后续分析
// 文件位置：data/qa-records.jsonl（首次写入时自动创建）

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const RECORD_DIR = path.resolve(currentDir, '../../data');
const RECORD_FILE = path.join(RECORD_DIR, 'qa-records.jsonl');

// 写入队列：并发提问时串行追加，避免多行记录交错
let writeQueue = Promise.resolve();

/**
 * 保存一条问答记录
 * @param {{
 *   question: string,
 *   answer: string,
 *   sources?: { title: string, excerpt: string }[],
 *   mode: string,
 *   model: string,
 *   durationMs: number
 * }} payload 记录内容
 * @returns {Promise<object>} 已保存的记录
 */
export async function saveRecord(payload) {
  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    mode: payload.mode,
    model: payload.model,
    question: payload.question,
    answer: payload.answer,
    sources: (payload.sources ?? []).map((source) => ({
      title: source.title,
      excerpt: source.excerpt,
    })),
    durationMs: payload.durationMs,
  };

  const line = `${JSON.stringify(record)}\n`;

  const writeTask = writeQueue.then(async () => {
    await mkdir(RECORD_DIR, { recursive: true });
    await appendFile(RECORD_FILE, line, 'utf8');
  });

  // 即使本次写入失败，也保证后续写入不被阻塞
  writeQueue = writeTask.catch(() => {});
  await writeTask;

  return record;
}

/**
 * 读取最近的问答记录（按时间倒序）
 * @param {{ limit?: number }} options 读取选项
 * @returns {Promise<object[]>} 记录列表
 */
export async function readRecords({ limit = 20 } = {}) {
  let content;
  try {
    content = await readFile(RECORD_FILE, 'utf8');
  } catch (error) {
    // 文件尚未创建时视为没有记录
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
  const records = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // 跳过损坏的行，不影响其他正常记录
    }
  }

  return records.slice(-safeLimit).reverse();
}
