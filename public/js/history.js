// v1 兼容外观（契约 docs/ARCHITECTURE.md 第 3.7 节）。
//
// 本文件是 v1 对外的门面：导出签名与行为必须与重构前一致
// （test/history.test.mjs 直接依赖它们），内部全部转发到 storage.js，
// 并在出口处把 v2 的 subjectId 映射回 v1 的 quizType。
//
// 两个形状的边界（改代码前先记住）：
//   storage.js  —— v2 形状：records 含 subjectId，mistakes 含 subjectId / itemId / direction
//   本文件      —— v1 形状：records / mistakes 都含 quizType，mistakes 只有 6 个字段
//
// 新增导出 getRecords / getMistakes 返回 v2 形状，供新代码（看板、引擎）使用。

import {
  compareRecords,
  isKnownSubjectId,
  readMistakes as readStoredMistakes,
  readRecords,
  removeMistake as removeStoredMistake,
  saveMistakes as saveStoredMistakes,
  saveRecord
} from './storage.js';

export { compareRecords };

function assertQuizType(quizType) {
  if (!isKnownSubjectId(quizType)) throw new Error(`Unsupported quiz type: ${quizType}`);
}

/** v2 记录 → v1 记录外观（含 quizType）。 */
function toLegacyRecord(record) {
  return {
    id: record.id,
    quizType: record.subjectId,
    completedAt: record.completedAt,
    accuracy: record.accuracy,
    correct: record.correct,
    total: record.total,
    durationMs: record.durationMs
  };
}

/** v2 错题 → v1 错题外观（含 quizType，仅 v1 的 6 个字段）。 */
function toLegacyMistake(mistake) {
  return {
    id: mistake.id,
    quizType: mistake.subjectId,
    question: mistake.question,
    answer: mistake.answer,
    wrongCount: mistake.wrongCount,
    lastWrongAt: mistake.lastWrongAt
  };
}

/** v2 形状的成绩记录（含 subjectId），按 completedAt 升序。 */
export function getRecords(storage) {
  return readRecords(storage);
}

/** v2 形状的错题集（含 subjectId / itemId / direction），按 lastWrongAt 升序。 */
export function getMistakes(storage) {
  return readStoredMistakes(storage);
}

/** → v1 形状记录数组（含 quizType），按 completedAt 升序。 */
export function readHistory(storage) {
  return readRecords(storage).map(toLegacyRecord);
}

/** → 指定 quizType 的 v1 形状记录。 */
export function historyForType(quizType, storage) {
  return readHistory(storage).filter((record) => record.quizType === quizType);
}

/** → v1 形状错题数组（含 quizType），按 lastWrongAt 升序。 */
export function readMistakes(storage) {
  return readStoredMistakes(storage).map(toLegacyMistake);
}

/** → 指定 quizType 的 v1 形状错题。 */
export function mistakesForType(quizType, storage) {
  return readMistakes(storage).filter((mistake) => mistake.quizType === quizType);
}

/**
 * 保存错题；同 id 累加 wrongCount（语义与 v1 完全一致）。
 * → v1 形状的**全量**错题数组。
 */
export function saveMistakes(quizType, mistakes, storage) {
  assertQuizType(quizType);
  return saveStoredMistakes(quizType, mistakes, storage).map(toLegacyMistake);
}

/** 移除一道错题。→ v1 形状的全量错题数组。 */
export function removeMistake(id, storage) {
  return removeStoredMistake(id, storage).map(toLegacyMistake);
}

/**
 * 保存一次测试成绩。
 * → { record, previous }，两者都是 v1 形状（previous = 同 quizType 的上一条，没有则 null）。
 * 记录不合法时抛 'Invalid test result'。
 */
export function saveTestResult(quizType, metrics, storage) {
  assertQuizType(quizType);
  const { record, previous } = saveRecord({ ...(metrics ?? {}), subjectId: quizType }, storage);
  return { record: toLegacyRecord(record), previous: previous ? toLegacyRecord(previous) : null };
}

export function formatHistoryDate(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
}
