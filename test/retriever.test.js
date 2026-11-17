import test from 'node:test';
import assert from 'node:assert/strict';
import { getNotesInfo, retrieve } from '../src/services/retriever.js';

test('getNotesInfo 返回课程资料信息', async () => {
  const info = await getNotesInfo();
  assert.equal(info.file, 'data/course-notes.md');
  assert.ok(info.chunks > 0);
});

test('retrieve 能把过拟合问题定位到对应章节', async () => {
  const results = await retrieve('过拟合怎么缓解');
  assert.ok(results.length > 0);
  assert.match(results[0].title, /过拟合/);
  assert.ok(results[0].excerpt.length > 0);
});

test('retrieve 能召回 RAG 流程相关章节', async () => {
  const results = await retrieve('RAG 的完整流程');
  assert.ok(results.some((item) => /RAG/.test(item.title)));
});

test('retrieve 对空白问题返回空数组', async () => {
  assert.deepEqual(await retrieve('   '), []);
});
