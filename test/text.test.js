import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExcerpt, countTerms, normalizeText, tokenize, truncate } from '../src/utils/text.js';

test('normalizeText 转小写、全角转半角并压缩空白', () => {
  assert.equal(normalizeText('  ＡＩ　答疑  助手 '), 'ai 答疑 助手');
});

test('normalizeText 处理空值', () => {
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});

test('tokenize 过滤中文停用词并按二元词组切分', () => {
  assert.deepEqual(tokenize('什么是过拟合'), ['过拟', '拟合']);
});

test('tokenize 保留英文术语并丢弃英文停用词', () => {
  assert.deepEqual(tokenize('RAG 的流程是什么'), ['rag', '流程']);
});

test('countTerms 统计词频', () => {
  const counts = countTerms(['a', 'b', 'a']);
  assert.equal(counts.get('a'), 2);
  assert.equal(counts.get('b'), 1);
});

test('truncate 超长时截断并追加省略号', () => {
  assert.equal(truncate('hello world', 20), 'hello world');
  assert.equal(truncate('abcdef', 4), 'abc…');
});

test('buildExcerpt 优先返回与问题最相关的句子', () => {
  const content = '这一句讨论无关内容。过拟合指模型记住了训练数据中的噪声。最后一句同样无关。';
  const excerpt = buildExcerpt(content, '什么是过拟合', 80);
  assert.ok(excerpt.includes('过拟合'));
});
