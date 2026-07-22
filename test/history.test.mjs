import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecords, historyForType, readHistory, saveTestResult } from '../public/js/history.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('每次测试结果都会保存并按类型读取', () => {
  const storage = createStorage();
  saveTestResult('percent', { id: 'p1', completedAt: 1, accuracy: 90, correct: 27, total: 30, durationMs: 80_000 }, storage);
  saveTestResult('powers', { id: 'w1', completedAt: 2, accuracy: 96, correct: 23, total: 24, durationMs: 70_000 }, storage);
  saveTestResult('percent', { id: 'p2', completedAt: 3, accuracy: 97, correct: 29, total: 30, durationMs: 60_000 }, storage);
  assert.equal(readHistory(storage).length, 3);
  assert.deepEqual(historyForType('percent', storage).map(({ id }) => id), ['p1', 'p2']);
});

test('保存时返回同类型的上一次记录', () => {
  const storage = createStorage();
  const first = saveTestResult('percent', { id: 'p1', completedAt: 1, accuracy: 90, correct: 27, total: 30, durationMs: 80_000 }, storage);
  const second = saveTestResult('percent', { id: 'p2', completedAt: 2, accuracy: 97, correct: 29, total: 30, durationMs: 60_000 }, storage);
  assert.equal(first.previous, null);
  assert.equal(second.previous.id, 'p1');
  assert.deepEqual(compareRecords(second.record, second.previous), { accuracyDelta: 7, durationDeltaMs: -20_000 });
});

test('损坏或不合法的本地记录会被安全忽略', () => {
  const broken = createStorage({ 'math-memory-quiz-history:v1': '{broken' });
  assert.deepEqual(readHistory(broken), []);
  const invalid = createStorage({
    'math-memory-quiz-history:v1': JSON.stringify([{ id: 'x', quizType: 'other', completedAt: 1 }])
  });
  assert.deepEqual(readHistory(invalid), []);
});
