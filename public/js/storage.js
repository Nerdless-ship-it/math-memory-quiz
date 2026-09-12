// 存储层 v2（契约 docs/ARCHITECTURE.md 第 3.5 / 3.6 节）。
//
// 设计要点（踩过的坑都写在这里，改代码前先读）：
//
// 1) records 是**单一数组 + subjectId 字段**，绝不按科目分键存储。
//    理由：test/history.test.mjs 断言 readHistory(storage).length === 3，
//    而其中同时含 percent 与 powers 的记录。
//
// 2) 读路径永远兼容 v1 旧键：
//    - records：v2 ∪ v1 按 id 求并集，凡是 v2 还没有的旧记录都会被补进 v2（惰性迁移）。
//      成绩没有删除 API，并集不会复活已删数据，所以可以无条件并集。
//    - mistakes：v2 键存在即信任；只有 v2 键不存在/损坏时才回退 v1 并惰性迁移。
//      错题有 removeMistake / clearMistakes，并集会让刚移除的错题立刻回来。
//    理由：test/history.test.mjs 直接把数据写进 'math-memory-quiz-history:v1' 再调 readHistory；
//    test/browser-smoke.mjs 与 test/powers-browser-smoke.mjs 同样如此。
//
// 3) saveRecord 会把数学两科（v1 时代存在的科目）的新成绩**追加**一份到 v1 键。
//    理由：两个既有端到端 smoke 直接断言
//      JSON.parse(localStorage.getItem('math-memory-quiz-history:v1')).filter(r => r.quizType === 'x').length === 2
//    只写 v2 会让它们变红。这是「只追加、不删除、不改写历史条目」，符合契约第 8 节第 7 条。
//    非数学科目（v2 新增的考公常识）不写 v1 键，避免把新数据灌进旧格式。
//
// 4) 迁移幂等：v2 已有的 id 不会被重复写入；第二次 migrate() 返回 migrated: false。
//    v1 旧键**永不删除**（可回滚），只有用户显式「清空数据」调用 clearAllData 时才清。
//
// 5) 任何 JSON 损坏都被安全忽略，读写都包在 try/catch 里，绝不抛异常阻断应用启动。
//
// 6) 外部可注入假 storage（测试用 Map 模拟，只有 getItem / setItem）。
//    因此本文件**从不调用** removeItem / clear / key / length，只使用 getItem + setItem。

import * as registry from './registry.js';
import {
  DAY_MS,
  MASTERY_MAX_LEVEL,
  MISTAKE_MASTERY_THRESHOLD,
  LEVEL_INTERVALS,
  applyOutcome,
  compareDue,
  countOutcome,
  createMastery,
  intervalForLevel,
  masteryKey,
  normalizeMastery,
  parseMasteryKey
} from './mastery.js';

export { MASTERY_MAX_LEVEL, LEVEL_INTERVALS, MISTAKE_MASTERY_THRESHOLD, masteryKey, parseMasteryKey, intervalForLevel };

/** v2 本地存储键（契约 3.5）。 */
export const STORAGE_KEYS = Object.freeze({
  records: 'mq:records:v2',
  mastery: 'mq:mastery:v2',
  mistakes: 'mq:mistakes:v2',
  session: 'mq:session:v2',
  profile: 'mq:profile:v2'
});

/** v1 旧键（迁移来源，只读 + 追加，永不删除）。 */
export const LEGACY_STORAGE_KEYS = Object.freeze({
  records: 'math-memory-quiz-history:v1',
  mistakes: 'math-memory-quiz-mistakes:v1'
});

/** v1 存储格式出现过的 quizType（这是「旧格式取值」，不是科目清单）。 */
export const LEGACY_QUIZ_TYPES = Object.freeze(['percent', 'powers']);

/** 默认偏好（契约 3.5）。 */
export const DEFAULT_PREFS = Object.freeze({ questionTypes: Object.freeze(['fill']), choicesPerQuestion: 4 });

// ── 基础工具 ────────────────────────────────────────────────────────────

/** 取存储后端：显式传入优先，其次 globalThis.localStorage，都没有则 undefined。 */
export function getStorage(storage) {
  if (storage) return storage;
  try {
    const scope = globalThis;
    // 只有存在 DOM 全局时才去碰 localStorage：Node 里访问 globalThis.localStorage
    // 会打印「localStorage is not available because --localstorage-file was not provided」
    // 的实验性警告，污染 npm test 输出。
    if (typeof scope.window === 'undefined' && typeof scope.document === 'undefined') return undefined;
    const local = scope.localStorage;
    return local === undefined || local === null ? undefined : local;
  } catch {
    return undefined;
  }
}

function readRawValue(target, key) {
  if (!target || typeof target.getItem !== 'function') return undefined;
  try {
    const value = target.getItem(key);
    if (value === undefined || value === null) return undefined;
    return typeof value === 'string' ? value : String(value);
  } catch {
    return undefined;
  }
}

function parseJSON(value) {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** 读取 JSON 数组；键不存在、损坏或不是数组时返回 undefined（= 可以走 v1 回退）。 */
function readArrayValue(target, key) {
  const parsed = parseJSON(readRawValue(target, key));
  return Array.isArray(parsed) ? parsed : undefined;
}

/** 读取 JSON 对象；键不存在、损坏或不是对象时返回 undefined。 */
function readObjectValue(target, key) {
  const parsed = parseJSON(readRawValue(target, key));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
}

function writeValue(target, key, payload) {
  if (!target || typeof target.setItem !== 'function') return false;
  try {
    target.setItem(key, payload);
    return true;
  } catch {
    // 存储不可用或已满：调用方仍能拿到内存里的结果。
    return false;
  }
}

function writeArrayValue(target, key, list) {
  return writeValue(target, key, JSON.stringify(list));
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toCount(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (entry === null || entry === undefined ? '' : String(entry)));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQuestionTypes(value) {
  return toStringArray(value).map((entry) => entry.trim()).filter(Boolean);
}

// ── 科目 id 认知 ────────────────────────────────────────────────────────

/**
 * 已知科目 id = registry.SUBJECTS（唯一真相源）+ v1 旧格式取值。
 * 注册表不可用（缺少导出）时退回 v1 取值，绝不抛异常。
 */
export function knownSubjectIds() {
  const ids = new Set();
  try {
    if (typeof registry.subjectIds === 'function') {
      for (const id of registry.subjectIds()) if (id) ids.add(String(id));
    } else if (Array.isArray(registry.SUBJECTS)) {
      for (const subject of registry.SUBJECTS) if (subject?.id) ids.add(String(subject.id));
    }
  } catch {
    // 注册表异常时继续使用 v1 取值。
  }
  for (const id of LEGACY_QUIZ_TYPES) ids.add(id);
  return ids;
}

/** 该 id 是否是已知科目（含 v1 旧格式取值）。 */
export function isKnownSubjectId(subjectId) {
  const text = subjectId === null || subjectId === undefined ? '' : String(subjectId);
  return text !== '' && knownSubjectIds().has(text);
}

// ── 成绩记录 ────────────────────────────────────────────────────────────

/** 校验并归一化 v2 成绩记录；不合法返回 null。 */
export function normalizeRecord(record) {
  if (!isPlainObject(record)) return null;
  const id = String(record.id ?? '');
  const subjectId = String(record.subjectId ?? '');
  if (!id || !subjectId) return null;
  const completedAt = toFiniteNumber(record.completedAt);
  const accuracy = toFiniteNumber(record.accuracy);
  const correct = toFiniteNumber(record.correct);
  const total = toFiniteNumber(record.total);
  const durationMs = toFiniteNumber(record.durationMs);
  if ([completedAt, accuracy, correct, total, durationMs].some((value) => value === null)) return null;
  if (total <= 0 || correct < 0 || correct > total) return null;
  if (accuracy < 0 || accuracy > 100 || durationMs < 0) return null;
  return {
    id,
    subjectId,
    mode: record.mode === 'mistakes' ? 'mistakes' : 'test',
    completedAt,
    accuracy,
    correct,
    total,
    durationMs
  };
}

/** v1 记录 → v2 记录（quizType → subjectId，补 mode:'test'）。不合法返回 null。 */
export function legacyRecordToRecord(record) {
  if (!isPlainObject(record)) return null;
  const quizType = String(record.quizType ?? '');
  if (!isKnownSubjectId(quizType)) return null;
  return normalizeRecord({ ...record, subjectId: quizType, mode: 'test' });
}

/** v2 记录 → v1 记录外观（subjectId → quizType）。 */
export function recordToLegacyRecord(record) {
  return {
    id: String(record?.id ?? ''),
    quizType: String(record?.subjectId ?? ''),
    completedAt: Number(record?.completedAt),
    accuracy: Number(record?.accuracy),
    correct: Number(record?.correct),
    total: Number(record?.total),
    durationMs: Number(record?.durationMs)
  };
}

function sortByCompletedAt(records) {
  return [...records].sort((left, right) => left.completedAt - right.completedAt);
}

/** v2 键里的合法记录；键不存在/损坏时返回 undefined。 */
function readV2Records(target) {
  const raw = readArrayValue(target, STORAGE_KEYS.records);
  if (raw === undefined) return undefined;
  return raw.map(normalizeRecord).filter(Boolean);
}

/** v1 键里的合法记录（已映射成 v2 形状）。 */
function readLegacyRecords(target) {
  const raw = readArrayValue(target, LEGACY_STORAGE_KEYS.records);
  if (raw === undefined) return [];
  return raw.map(legacyRecordToRecord).filter(Boolean);
}

/**
 * 按 id 求并集（保留先出现者）。→ { list, added }
 * 用于把 v1 旧数据补进 v2，同时保证重复执行不产生重复条目。
 */
function unionById(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));
  let added = 0;
  for (const item of incoming) {
    if (byId.has(item.id)) continue;
    byId.set(item.id, item);
    added += 1;
  }
  return { list: [...byId.values()], added };
}

/**
 * 读取记录集合。
 * 规则：v2 ∪ v1 并集 —— 旧键里凡是 v2 还没有的记录都会被补进 v2（惰性迁移）。
 * 为什么成绩用并集、错题不用：成绩没有删除 API，并集不会「复活」被删的数据；
 * 错题有 removeMistake / clearMistakes，并集会让刚移除的错题立刻回来。
 */
function loadRecords(target) {
  const current = readV2Records(target) ?? [];
  const legacy = readLegacyRecords(target);
  if (!legacy.length) return current;
  const { list, added } = unionById(current, legacy);
  if (added > 0) writeArrayValue(target, STORAGE_KEYS.records, sortByCompletedAt(list));
  return list;
}

/** 按 id 合并记录到 v2（返回新增条数）；没有新增则不写盘 —— 这是幂等的关键。 */
function mergeRecords(target, incoming) {
  const current = readV2Records(target) ?? [];
  const { list, added } = unionById(current, incoming);
  if (added > 0) writeArrayValue(target, STORAGE_KEYS.records, sortByCompletedAt(list));
  return added;
}

/**
 * 把一条 v2 成绩追加一份 v1 外观到旧键（仅 v1 时代存在的科目）。
 * 只追加、不删除、不改写既有条目；损坏的旧键不会被阻断（写不进去就算了）。
 */
function appendLegacyRecord(target, record) {
  if (!LEGACY_QUIZ_TYPES.includes(record.subjectId)) return false;
  const raw = readArrayValue(target, LEGACY_STORAGE_KEYS.records) ?? [];
  const legacy = recordToLegacyRecord(record);
  if (raw.some((item) => isPlainObject(item) && String(item.id ?? '') === legacy.id)) return false;
  const next = [...raw, legacy].sort((left, right) => Number(left?.completedAt ?? 0) - Number(right?.completedAt ?? 0));
  return writeArrayValue(target, LEGACY_STORAGE_KEYS.records, next);
}

/** → Record[]，按 completedAt 升序（v2 形状，含 subjectId）。 */
export function readRecords(storage) {
  return sortByCompletedAt(loadRecords(getStorage(storage)));
}

/** → Record[]，指定科目的记录，按 completedAt 升序。 */
export function recordsForSubject(subjectId, storage) {
  const owner = subjectId === null || subjectId === undefined ? '' : String(subjectId);
  return readRecords(storage).filter((record) => record.subjectId === owner);
}

/**
 * 保存一条成绩记录。
 * record：{ id?, subjectId, mode?, completedAt, accuracy, correct, total, durationMs }
 * → { record: Record, previous: Record | null }（previous = 同科目上一条记录）
 * 记录不合法时抛 'Invalid test result'（保留 v1 行为）。
 */
export function saveRecord(record, storage) {
  const target = getStorage(storage);
  if (!isPlainObject(record)) throw new Error('Invalid test result');
  // completedAt / id 允许缺省：引擎交卷时只给 metrics（accuracy/correct/total/durationMs）。
  const completedAt = toFiniteNumber(record.completedAt) ?? Date.now();
  const id = String(record.id ?? '') || `${completedAt}-${Math.random().toString(36).slice(2, 10)}`;
  const normalized = normalizeRecord({ ...record, id, completedAt });
  if (!normalized) throw new Error('Invalid test result');

  const existing = loadRecords(target);
  const previous = [...existing].reverse().find((item) => item.subjectId === normalized.subjectId) ?? null;
  // 同一 id 重复保存（例如重复提交）覆盖旧条目，不产生重复记录。
  writeArrayValue(target, STORAGE_KEYS.records, sortByCompletedAt([...existing.filter((item) => item.id !== normalized.id), normalized]));
  appendLegacyRecord(target, normalized);
  return { record: normalized, previous };
}

/** 两次成绩的差值；previous 为空返回 null。 */
export function compareRecords(current, previous) {
  if (!previous) return null;
  return {
    accuracyDelta: current.accuracy - previous.accuracy,
    durationDeltaMs: current.durationMs - previous.durationMs
  };
}

// ── 错题集 ──────────────────────────────────────────────────────────────

const DIRECTION_MAP = Object.freeze({
  'percent-to-fraction': 'forward',
  'fraction-to-percent': 'backward',
  'base-to-result': 'forward',
  'result-to-base': 'backward',
  forward: 'forward',
  backward: 'backward'
});

/**
 * 方向归一化：v1 的四种取值映射到 forward / backward。
 * 识别不了的一律按 forward 处理 —— 绝不因为方向古怪而丢数据。
 */
export function normalizeDirection(direction) {
  const text = String(direction ?? '').trim();
  if (DIRECTION_MAP[text]) return DIRECTION_MAP[text];
  const lower = text.toLowerCase();
  if (lower.includes('backward') || lower.startsWith('result-to') || lower.startsWith('fraction-to') || lower.endsWith('-to-front')) {
    return 'backward';
  }
  return 'forward';
}

/**
 * 从 v1 风格的 id 反解字段：'percent:percent-to-fraction:12.5'
 * → { subjectId: 'percent', direction: 'percent-to-fraction', itemId: '12.5' }
 * 反解失败时各字段为空串（调用方负责兜底）。
 */
export function parseMistakeId(id) {
  const parts = String(id ?? '').split(':');
  if (parts.length < 3) return { subjectId: '', direction: '', itemId: '' };
  return { subjectId: parts[0], direction: parts[1], itemId: parts.slice(2).join(':') };
}

/**
 * 校验并归一化 v2 错题。
 * 入参允许只有 { id, question, answer }：itemId / direction 从 id 反解，
 * 反解失败用 id 本身兜底，绝不因此丢数据。
 * → Mistake | null（subjectId / question / answer 任一为空才返回 null）
 */
export function normalizeMistake(entry, subjectId, fallbackNow = Date.now()) {
  if (!isPlainObject(entry)) return null;
  const rawId = String(entry.id ?? '');
  const parsed = parseMistakeId(rawId);
  const owner = String(subjectId ?? entry.subjectId ?? '').trim() || parsed.subjectId;
  const itemId = String(entry.itemId ?? '').trim() || parsed.itemId || rawId || String(entry.question ?? '');
  const question = String(entry.question ?? '');
  const answer = String(entry.answer ?? '');
  if (!owner || !itemId || !question || !answer) return null;
  const direction = normalizeDirection(entry.direction ?? parsed.direction);
  const at = toFiniteNumber(fallbackNow);
  const now = at === null ? Date.now() : at;
  return {
    id: `${owner}:${direction}:${itemId}`,
    subjectId: owner,
    itemId,
    direction,
    question,
    answer,
    wrongCount: toCount(entry.wrongCount, 1),
    lastWrongAt: toFiniteNumber(entry.lastWrongAt) ?? now,
    masteredCount: toCount(entry.masteredCount, 0)
  };
}

/** v1 错题 → v2 错题（quizType → subjectId，方向重映射，itemId 从 id 反解）。 */
export function legacyMistakeToMistake(entry, fallbackNow = Date.now()) {
  if (!isPlainObject(entry)) return null;
  const quizType = String(entry.quizType ?? '');
  if (!isKnownSubjectId(quizType)) return null;
  return normalizeMistake(entry, quizType, fallbackNow);
}

/** v2 错题 → v1 错题外观（含 quizType；字段与 v1 完全一致）。 */
export function mistakeToLegacyMistake(mistake) {
  return {
    id: String(mistake?.id ?? ''),
    quizType: String(mistake?.subjectId ?? ''),
    question: String(mistake?.question ?? ''),
    answer: String(mistake?.answer ?? ''),
    wrongCount: Number(mistake?.wrongCount),
    lastWrongAt: Number(mistake?.lastWrongAt)
  };
}

function sortByLastWrongAt(mistakes) {
  return [...mistakes].sort((left, right) => left.lastWrongAt - right.lastWrongAt);
}

function readV2Mistakes(target) {
  const raw = readArrayValue(target, STORAGE_KEYS.mistakes);
  if (raw === undefined) return undefined;
  return raw.map((entry) => normalizeMistake(entry)).filter(Boolean);
}

function readLegacyMistakes(target) {
  const raw = readArrayValue(target, LEGACY_STORAGE_KEYS.mistakes);
  if (raw === undefined) return [];
  return raw.map((entry) => legacyMistakeToMistake(entry)).filter(Boolean);
}

function loadMistakes(target) {
  const current = readV2Mistakes(target);
  if (current !== undefined) return current;
  const legacy = readLegacyMistakes(target);
  if (legacy.length) mergeMistakes(target, legacy);
  return legacy;
}

/** 按 id 合并错题到 v2（返回新增条数）；没有新增不写盘。 */
function mergeMistakes(target, incoming) {
  const current = readV2Mistakes(target) ?? [];
  const { list, added } = unionById(current, incoming);
  if (added > 0) writeArrayValue(target, STORAGE_KEYS.mistakes, sortByLastWrongAt(list));
  return added;
}

/** → Mistake[]（v2 形状，含 subjectId / itemId / direction），按 lastWrongAt 升序。 */
export function readMistakes(storage) {
  return sortByLastWrongAt(loadMistakes(getStorage(storage)));
}

/** → Mistake[]，指定科目的错题。 */
export function mistakesForSubject(subjectId, storage) {
  const owner = subjectId === null || subjectId === undefined ? '' : String(subjectId);
  return readMistakes(storage).filter((mistake) => mistake.subjectId === owner);
}

/**
 * 保存错题（语义同 v1）：同 id 累加 wrongCount，lastWrongAt 更新为现在，masteredCount 归零。
 * mistakes 每项可为 { id, question, answer } 或完整 v2 形状。
 * → Mistake[]（全量 v2 错题）
 */
export function saveMistakes(subjectId, mistakes, storage) {
  const target = getStorage(storage);
  const owner = subjectId === null || subjectId === undefined ? '' : String(subjectId);
  if (!owner) throw new Error('Unsupported subject: (empty)');
  const list = Array.isArray(mistakes) ? mistakes : mistakes ? [mistakes] : [];
  const existing = loadMistakes(target);
  const byId = new Map(existing.map((mistake) => [mistake.id, mistake]));
  const now = Date.now();

  for (const entry of list) {
    const current = normalizeMistake(entry, owner, now);
    if (!current) continue;
    const previous = byId.get(current.id);
    byId.set(current.id, previous
      ? { ...previous, ...current, wrongCount: previous.wrongCount + 1, lastWrongAt: now, masteredCount: 0 }
      : { ...current, wrongCount: 1, lastWrongAt: now, masteredCount: 0 });
  }

  const saved = sortByLastWrongAt([...byId.values()]);
  writeArrayValue(target, STORAGE_KEYS.mistakes, saved);
  return saved;
}

/** 移除一道错题。→ Mistake[]（全量 v2 错题） */
export function removeMistake(id, storage) {
  const target = getStorage(storage);
  const key = String(id ?? '');
  const next = loadMistakes(target).filter((mistake) => mistake.id !== key);
  writeArrayValue(target, STORAGE_KEYS.mistakes, next);
  return next;
}

/**
 * 清空错题：给了 subjectId 只清该科目，否则清空全部。
 * → Mistake[]（清空后的全量 v2 错题）
 */
export function clearMistakes(subjectId, storage) {
  const target = getStorage(storage);
  const owner = subjectId === null || subjectId === undefined ? '' : String(subjectId);
  const next = owner ? loadMistakes(target).filter((mistake) => mistake.subjectId !== owner) : [];
  writeArrayValue(target, STORAGE_KEYS.mistakes, next);
  return next;
}

/**
 * 错题重练结果登记（契约第 4 节第 4 条）：
 * 答错 → wrongCount + 1、masteredCount 归零；
 * 答对 → masteredCount + 1，达到 MISTAKE_MASTERY_THRESHOLD(2) 自动移出错题集。
 * → Mistake[]（全量 v2 错题）
 */
export function recordMistakeOutcome(id, correct, storage) {
  const target = getStorage(storage);
  const key = String(id ?? '');
  const now = Date.now();
  const next = [];
  for (const mistake of loadMistakes(target)) {
    if (mistake.id !== key) {
      next.push(mistake);
      continue;
    }
    if (correct !== true) {
      next.push({ ...mistake, wrongCount: mistake.wrongCount + 1, masteredCount: 0, lastWrongAt: now });
      continue;
    }
    const masteredCount = mistake.masteredCount + 1;
    if (masteredCount >= MISTAKE_MASTERY_THRESHOLD) continue;
    next.push({ ...mistake, masteredCount });
  }
  const saved = sortByLastWrongAt(next);
  writeArrayValue(target, STORAGE_KEYS.mistakes, saved);
  return saved;
}

// ── 掌握度 ──────────────────────────────────────────────────────────────

/** → { [`${subjectId}:${itemId}`]: Mastery } */
export function readMastery(storage) {
  const raw = readObjectValue(getStorage(storage), STORAGE_KEYS.mastery) ?? {};
  const result = {};
  const now = Date.now();
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parseMasteryKey(key);
    if (!parsed) continue;
    const normalized = normalizeMastery(value, parsed.subjectId, parsed.itemId, now);
    if (normalized) result[key] = normalized;
  }
  return result;
}

/** → { [itemId]: Mastery }，指定科目。 */
export function masteryFor(subjectId, storage) {
  const owner = subjectId === null || subjectId === undefined ? '' : String(subjectId);
  const prefix = `${owner}:`;
  const result = {};
  for (const [key, value] of Object.entries(readMastery(storage))) {
    if (!key.startsWith(prefix)) continue;
    result[value.itemId] = value;
  }
  return result;
}

/**
 * 归一化 outcomes：
 *   [{ itemId, correct: boolean }] 或 [[itemId, boolean]]；也可传单个对象。
 * 只有带明确 itemId + 布尔正确性的项才会被应用。
 * direction 字段会被忽略（掌握度按 itemId 维度记录，见契约 3.5）。
 */
function normalizeOutcomes(outcomes) {
  if (!outcomes) return [];
  const list = Array.isArray(outcomes) ? outcomes : [outcomes];
  const result = [];
  for (const entry of list) {
    if (Array.isArray(entry)) {
      const itemId = String(entry[0] ?? '');
      if (!itemId || typeof entry[1] !== 'boolean') continue;
      const at = toFiniteNumber(entry[2]);
      result.push({ itemId, correct: entry[1], now: at });
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const itemId = String(entry.itemId ?? entry.id ?? entry.questionId ?? '');
    if (!itemId) continue;
    const correct = typeof entry.correct === 'boolean'
      ? entry.correct
      : typeof entry.isCorrect === 'boolean'
        ? entry.isCorrect
        : typeof entry.ok === 'boolean'
          ? entry.ok
          : null;
    if (correct === null) continue;
    result.push({ itemId, correct, now: toFiniteNumber(entry.now ?? entry.at ?? entry.lastSeenAt) });
  }
  return result;
}

/**
 * 第三个参数既可以是 storage 后端，也可以是 options：
 *   引擎的 recordOutcomes 端口会传 { mode }，而不是存储对象。
 *   → options 形态：{ storage?, mode? }
 */
function resolveStorageArg(candidate, options) {
  if (candidate && typeof candidate === 'object'
    && typeof candidate.getItem !== 'function' && typeof candidate.setItem !== 'function') {
    return { target: getStorage(candidate.storage), options: candidate };
  }
  return { target: getStorage(candidate), options };
}

function applyOutcomesInternal(subjectId, outcomes, target, options) {
  const owner = subjectId === null || subjectId === undefined ? '' : String(subjectId);
  if (!owner) return {};
  const reviewMode = options?.mode === 'mistakes';
  const all = readMastery(target);
  const now = Date.now();
  for (const outcome of normalizeOutcomes(outcomes)) {
    const at = outcome.now === null ? now : outcome.now;
    const key = masteryKey(owner, outcome.itemId);
    const current = all[key] ?? createMastery(owner, outcome.itemId, at);
    all[key] = reviewMode
      ? countOutcome(current, outcome.correct, at)
      : applyOutcome(current, outcome.correct, at);
  }
  writeValue(target, STORAGE_KEYS.mastery, JSON.stringify(all));
  return masteryFor(owner, target);
}

/**
 * 应用一批作答结果，写回掌握度。
 * outcomes：见 normalizeOutcomes。
 * 第三参：storage 后端，或 { storage?, mode? }（mode === 'mistakes' 时按契约 4.4 只记计数、不升级）。
 * → { [itemId]: Mastery }，该科目更新后的掌握度（全量）。
 */
export function applyMastery(subjectId, outcomes, storage, options) {
  const resolved = resolveStorageArg(storage, options);
  return applyOutcomesInternal(subjectId, outcomes, resolved.target, resolved.options);
}

/**
 * 引擎 recordOutcomes 端口的直连版本（可直接接线，无需再包一层）：
 *   createEngine({ store: { recordOutcomes: applyOutcomes, touchStreak, ... } })
 * options：{ mode, storage? }。
 * → { [itemId]: Mastery }
 */
export function applyOutcomes(subjectId, outcomes, options) {
  return applyOutcomesInternal(subjectId, outcomes, getStorage(options?.storage), options);
}

/** → itemId[]，已到期（dueAt <= now）的题目，按 dueAt 升序。 */
export function dueItems(subjectId, storage, now = Date.now()) {
  const at = toFiniteNumber(now);
  const stamp = at === null ? Date.now() : at;
  return Object.values(masteryFor(subjectId, storage))
    .filter((mastery) => mastery.dueAt <= stamp)
    .sort(compareDue)
    .map((mastery) => mastery.itemId);
}

// ── 中途存档 ────────────────────────────────────────────────────────────

/** 校验并归一化 session；questionIds 为空视为非法（返回 null）。 */
export function normalizeSession(session, now = Date.now()) {
  if (!isPlainObject(session)) return null;
  const subjectId = String(session.subjectId ?? '');
  const questionIds = toStringArray(session.questionIds);
  if (!subjectId || !questionIds.length) return null;
  const directions = toStringArray(session.directions);
  const answers = toStringArray(session.answers);
  const index = toFiniteNumber(session.currentIndex);
  const startedAt = toFiniteNumber(session.startedAt);
  const at = toFiniteNumber(now);
  const stamp = at === null ? Date.now() : at;
  const currentIndex = index === null ? 0 : Math.min(Math.max(Math.floor(index), 0), questionIds.length - 1);
  return {
    subjectId,
    mode: session.mode === 'mistakes' ? 'mistakes' : 'test',
    questionTypes: normalizeQuestionTypes(session.questionTypes),
    questionIds: [...questionIds],
    directions: questionIds.map((_, position) => normalizeDirection(directions[position])),
    answers: questionIds.map((_, position) => answers[position] ?? ''),
    currentIndex,
    startedAt: startedAt === null ? stamp : startedAt,
    savedAt: toFiniteNumber(session.savedAt) ?? stamp
  };
}

/** → Session | null */
export function readSession(storage) {
  const raw = readObjectValue(getStorage(storage), STORAGE_KEYS.session);
  if (raw === undefined) return null;
  return normalizeSession(raw);
}

/** 保存存档；session 为空则等价于 clearSession。→ Session | null */
export function saveSession(session, storage) {
  const target = getStorage(storage);
  if (session === null || session === undefined) {
    clearSession(target);
    return null;
  }
  const normalized = normalizeSession(session);
  if (!normalized) return null;
  writeValue(target, STORAGE_KEYS.session, JSON.stringify(normalized));
  return normalized;
}

/**
 * 清空存档。→ null
 * 注意：只用 setItem 写空串，绝不调用 storage.removeItem（测试用的假 storage 没有这个方法）。
 */
export function clearSession(storage) {
  writeValue(getStorage(storage), STORAGE_KEYS.session, '');
  return null;
}

// ── 打卡与偏好 ──────────────────────────────────────────────────────────

/** 'YYYY-MM-DD'（本地时区）。 */
export function localDateString(date = new Date()) {
  const time = date instanceof Date ? date : new Date(date);
  const stamp = Number.isFinite(time.getTime()) ? time : new Date();
  const year = stamp.getFullYear();
  const month = String(stamp.getMonth() + 1).padStart(2, '0');
  const day = String(stamp.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePrefs(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const questionTypes = normalizeQuestionTypes(source.questionTypes);
  const choices = toFiniteNumber(source.choicesPerQuestion);
  return {
    questionTypes: questionTypes.length ? questionTypes : [...DEFAULT_PREFS.questionTypes],
    choicesPerQuestion: choices !== null && Number.isInteger(choices) && choices >= 2
      ? choices
      : DEFAULT_PREFS.choicesPerQuestion
  };
}

/** 默认 profile（字段与契约 3.5 一致）。 */
export function defaultProfile() {
  return {
    streakDays: 0,
    lastActiveDate: '',
    bestStreakDays: 0,
    prefs: { questionTypes: [...DEFAULT_PREFS.questionTypes], choicesPerQuestion: DEFAULT_PREFS.choicesPerQuestion }
  };
}

/** → Profile（字段缺失/损坏时用默认值补齐，绝不返回 null） */
export function readProfile(storage) {
  const raw = readObjectValue(getStorage(storage), STORAGE_KEYS.profile) ?? {};
  const lastActiveDate = String(raw.lastActiveDate ?? '');
  return {
    streakDays: toCount(raw.streakDays, 0),
    lastActiveDate: /^\d{4}-\d{2}-\d{2}$/.test(lastActiveDate) ? lastActiveDate : '',
    bestStreakDays: toCount(raw.bestStreakDays, 0),
    prefs: normalizePrefs(raw.prefs)
  };
}

/**
 * 打卡：跨日才 +1（同一自然日重复调用不增加）；
 * 与上次打卡日期相邻（昨天）则累加，否则从 1 重新开始；同步维护 bestStreakDays。
 * → Profile（更新后的）
 */
export function touchStreak(storage) {
  const target = getStorage(storage);
  const profile = readProfile(target);
  const today = localDateString();
  if (profile.lastActiveDate === today) return profile;
  const yesterday = localDateString(new Date(Date.now() - DAY_MS));
  const streakDays = profile.lastActiveDate === yesterday ? profile.streakDays + 1 : 1;
  const next = {
    ...profile,
    streakDays,
    lastActiveDate: today,
    bestStreakDays: Math.max(profile.bestStreakDays, streakDays)
  };
  writeValue(target, STORAGE_KEYS.profile, JSON.stringify(next));
  return next;
}

/** 合并偏好（只覆盖显式给出的字段）。→ Profile（更新后的） */
export function savePrefs(prefs, storage) {
  const target = getStorage(storage);
  const profile = readProfile(target);
  const next = { ...profile, prefs: normalizePrefs({ ...profile.prefs, ...(isPlainObject(prefs) ? prefs : {}) }) };
  writeValue(target, STORAGE_KEYS.profile, JSON.stringify(next));
  return next;
}

// ── 迁移与数据管理 ──────────────────────────────────────────────────────

/**
 * v1 → v2 迁移：把旧键里的成绩与错题映射进 v2。
 * 幂等（按 id 去重）、不删旧键、损坏数据静默忽略、永不抛异常。
 * → { migrated: boolean, records: number, mistakes: number }
 *   records / mistakes = 本次**新增**的条数（第二次运行为 0，migrated 为 false）。
 */
export function migrate(storage) {
  const target = getStorage(storage);
  const result = { migrated: false, records: 0, mistakes: 0 };
  if (!target) return result;
  try {
    const records = readLegacyRecords(target);
    if (records.length) {
      const added = mergeRecords(target, records);
      if (added > 0) {
        result.migrated = true;
        result.records = added;
      }
    }
    const mistakes = readLegacyMistakes(target);
    if (mistakes.length) {
      const added = mergeMistakes(target, mistakes);
      if (added > 0) {
        result.migrated = true;
        result.mistakes = added;
      }
    }
  } catch {
    // 迁移失败绝不能阻断应用启动。
  }
  return result;
}

/** → { version: 2, exportedAt, records, mastery, mistakes, profile } */
export function exportData(storage) {
  const target = getStorage(storage);
  return {
    version: 2,
    exportedAt: Date.now(),
    records: readRecords(target),
    mastery: readMastery(target),
    mistakes: readMistakes(target),
    profile: readProfile(target)
  };
}

function normalizeMasteryMap(raw) {
  const result = {};
  if (!isPlainObject(raw)) return result;
  const now = Date.now();
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parseMasteryKey(key);
    if (!parsed) continue;
    const normalized = normalizeMastery(value, parsed.subjectId, parsed.itemId, now);
    if (normalized) result[key] = normalized;
  }
  return result;
}

/**
 * 导入数据。
 * payload：exportData 的产物（{ version, records, mastery, mistakes, profile }）。
 * options：{ mode: 'merge' | 'replace' }，默认 merge。
 * → { ok, mode, records, mastery, mistakes, profile }（前三个是导入后存储里的条数，profile 表示是否写入）
 */
export function importData(payload, storage, options) {
  const target = getStorage(storage);
  const mode = options?.mode === 'replace' ? 'replace' : 'merge';
  const empty = { ok: false, mode, records: 0, mastery: 0, mistakes: 0, profile: false };
  if (!isPlainObject(payload)) return empty;
  const hasAny = ['records', 'mastery', 'mistakes', 'profile'].some((key) => key in payload);
  if (!hasAny) return empty;

  const incomingRecords = (Array.isArray(payload.records) ? payload.records : []).map(normalizeRecord).filter(Boolean);
  const incomingMistakes = (Array.isArray(payload.mistakes) ? payload.mistakes : []).map((entry) => normalizeMistake(entry)).filter(Boolean);
  const incomingMastery = normalizeMasteryMap(payload.mastery);
  const incomingProfile = isPlainObject(payload.profile) ? payload.profile : null;

  if (mode === 'replace') {
    writeArrayValue(target, STORAGE_KEYS.records, sortByCompletedAt(incomingRecords));
    writeArrayValue(target, STORAGE_KEYS.mistakes, sortByLastWrongAt(incomingMistakes));
    writeValue(target, STORAGE_KEYS.mastery, JSON.stringify(incomingMastery));
    if (incomingProfile) {
      const merged = {
        streakDays: toCount(incomingProfile.streakDays, 0),
        bestStreakDays: toCount(incomingProfile.bestStreakDays, 0),
        lastActiveDate: /^\d{4}-\d{2}-\d{2}$/.test(String(incomingProfile.lastActiveDate ?? ''))
          ? String(incomingProfile.lastActiveDate)
          : '',
        prefs: normalizePrefs(incomingProfile.prefs)
      };
      writeValue(target, STORAGE_KEYS.profile, JSON.stringify(merged));
    }
  } else {
    if (incomingRecords.length) mergeRecords(target, incomingRecords);
    if (incomingMistakes.length) mergeMistakes(target, incomingMistakes);
    if (Object.keys(incomingMastery).length) {
      const current = readMastery(target);
      for (const [key, value] of Object.entries(incomingMastery)) {
        const existing = current[key];
        if (!existing || value.lastSeenAt >= existing.lastSeenAt) current[key] = value;
      }
      writeValue(target, STORAGE_KEYS.mastery, JSON.stringify(current));
    }
    if (incomingProfile) {
      const profile = readProfile(target);
      const merged = {
        streakDays: Math.max(profile.streakDays, toCount(incomingProfile.streakDays, 0)),
        bestStreakDays: Math.max(profile.bestStreakDays, toCount(incomingProfile.bestStreakDays, 0)),
        lastActiveDate: String(incomingProfile.lastActiveDate ?? '') > profile.lastActiveDate
          ? String(incomingProfile.lastActiveDate ?? '')
          : profile.lastActiveDate,
        prefs: normalizePrefs({ ...profile.prefs, ...(isPlainObject(incomingProfile.prefs) ? incomingProfile.prefs : {}) })
      };
      writeValue(target, STORAGE_KEYS.profile, JSON.stringify(merged));
    }
  }

  return {
    ok: true,
    mode,
    records: readRecords(target).length,
    mastery: Object.keys(readMastery(target)).length,
    mistakes: readMistakes(target).length,
    profile: Boolean(incomingProfile)
  };
}

/** → { records, mastery, mistakes, bytes }（bytes = 5 个 v2 键的 UTF-16 字节数近似值） */
export function storageStats(storage) {
  const target = getStorage(storage);
  let bytes = 0;
  for (const key of Object.values(STORAGE_KEYS)) {
    const raw = readRawValue(target, key);
    if (typeof raw === 'string') bytes += raw.length * 2;
  }
  return {
    records: readRecords(target).length,
    mastery: Object.keys(readMastery(target)).length,
    mistakes: readMistakes(target).length,
    bytes
  };
}

/**
 * 清空全部本地数据（v2 五个键 + v1 两个旧键）。
 * 只在用户显式点击「清空数据」时调用 —— 契约 3.6 规定 v1 旧键仅在此场景下清除。
 * → true
 */
export function clearAllData(storage) {
  const target = getStorage(storage);
  for (const key of Object.values(STORAGE_KEYS)) writeValue(target, key, '');
  writeArrayValue(target, LEGACY_STORAGE_KEYS.records, []);
  writeArrayValue(target, LEGACY_STORAGE_KEYS.mistakes, []);
  return true;
}
