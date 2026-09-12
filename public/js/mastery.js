// 单题掌握度 + 间隔重复调度（契约 docs/ARCHITECTURE.md 第 3.5 节）。
//
// 本模块是**纯函数**模块：不触碰 DOM，也不读写 localStorage / sessionStorage。
// 持久化一律由 storage.js 负责；本模块只回答「答对/答错之后这条记录该长什么样」。
//
// 规则（契约原文）：
//   MASTERY_MAX_LEVEL = 5
//   LEVEL_INTERVALS = [0, 10min, 1day, 3day, 7day, 21day]，索引即 level
//   答对：level = min(level + 1, MASTERY_MAX_LEVEL)
//   答错：level = 0（回到今日）
//   dueAt = now + LEVEL_INTERVALS[level]

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** 掌握度最高等级。 */
export const MASTERY_MAX_LEVEL = 5;

/** 索引即 level 的间隔阶梯（毫秒）。level 0 → 立即可复习。 */
export const LEVEL_INTERVALS = Object.freeze([
  0,                 // level 0：新题 / 答错后回到今日
  10 * MINUTE_MS,    // level 1：10 分钟
  DAY_MS,            // level 2：1 天
  3 * DAY_MS,        // level 3：3 天
  7 * DAY_MS,        // level 4：7 天
  21 * DAY_MS        // level 5：21 天
]);

/** 错题重练中连续答对达到该次数即自动移出错题集（契约 3.5 / 引擎第 4 节）。 */
export const MISTAKE_MASTERY_THRESHOLD = 2;

function toFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** 把任意输入夹到 [0, MASTERY_MAX_LEVEL] 的整数。 */
export function clampLevel(level) {
  const number = Math.floor(Number(level));
  if (!Number.isFinite(number) || number < 0) return 0;
  return number > MASTERY_MAX_LEVEL ? MASTERY_MAX_LEVEL : number;
}

/** level → 间隔毫秒。 */
export function intervalForLevel(level) {
  return LEVEL_INTERVALS[clampLevel(level)];
}

/** level + 基准时刻 → 下次应复习时间（epoch ms）。 */
export function dueAtForLevel(level, now = Date.now()) {
  const at = toFinite(now);
  return (at === null ? Date.now() : at) + intervalForLevel(level);
}

/** 掌握度在存储里的键：`${subjectId}:${itemId}`。 */
export function masteryKey(subjectId, itemId) {
  return `${String(subjectId ?? '')}:${String(itemId ?? '')}`;
}

/**
 * 反向解析掌握度键。
 * subjectId 本身不含 ':'，itemId 可能含 ':'，所以只从第一个 ':' 处切分。
 * → { subjectId, itemId } | null
 */
export function parseMasteryKey(key) {
  const text = String(key ?? '');
  const index = text.indexOf(':');
  if (index <= 0 || index >= text.length - 1) return null;
  return { subjectId: text.slice(0, index), itemId: text.slice(index + 1) };
}

/** 新建一条掌握度记录（新题，level 0，立即到期）。 */
export function createMastery(subjectId, itemId, now = Date.now()) {
  const at = toFinite(now);
  const stamp = at === null ? Date.now() : at;
  return {
    subjectId: String(subjectId ?? ''),
    itemId: String(itemId ?? ''),
    level: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    lastSeenAt: stamp,
    dueAt: stamp
  };
}

/**
 * 归一化一条掌握度记录；输入是纯对象即可（不要求完整），缺失字段用安全默认值补齐。
 * 不会因为字段缺失而丢弃记录 —— 丢弃一律交给调用方按 id 决定。
 * → Mastery | null（只有 subjectId / itemId 都为空时才返回 null）
 */
export function normalizeMastery(raw, subjectId, itemId, fallbackNow = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const owner = String(subjectId ?? raw.subjectId ?? '');
  const item = String(itemId ?? raw.itemId ?? '');
  if (!owner || !item) return null;

  const at = toFinite(fallbackNow);
  const now = at === null ? Date.now() : at;
  const level = clampLevel(raw.level);
  const lastSeenAt = toFinite(raw.lastSeenAt) ?? now;
  const rawDueAt = raw.dueAt === null || raw.dueAt === undefined ? null : toFinite(raw.dueAt);
  return {
    subjectId: owner,
    itemId: item,
    level,
    correct: toInteger(raw.correct),
    wrong: toInteger(raw.wrong),
    streak: toInteger(raw.streak),
    lastSeenAt,
    dueAt: rawDueAt === null ? lastSeenAt + intervalForLevel(level) : rawDueAt
  };
}

/**
 * 应用一次作答结果，返回新的掌握度记录（不修改入参）。
 * correct = true → level 升级（封顶 MASTERY_MAX_LEVEL）；false → level 归零。
 * 连续答对 streak 累加，答错归零；correct / wrong 为累计次数。
 * → Mastery
 */
export function applyOutcome(mastery, correct, now = Date.now()) {
  const at = toFinite(now);
  const stamp = at === null ? Date.now() : at;
  const base = mastery && typeof mastery === 'object' && !Array.isArray(mastery) ? mastery : null;
  const passed = correct === true;
  const level = passed ? Math.min(clampLevel(base?.level) + 1, MASTERY_MAX_LEVEL) : 0;
  return {
    subjectId: String(base?.subjectId ?? ''),
    itemId: String(base?.itemId ?? ''),
    level,
    correct: toInteger(base?.correct) + (passed ? 1 : 0),
    wrong: toInteger(base?.wrong) + (passed ? 0 : 1),
    streak: passed ? toInteger(base?.streak) + 1 : 0,
    lastSeenAt: stamp,
    dueAt: stamp + intervalForLevel(level)
  };
}

/**
 * 只记正确 / 错误计数，**不改动 level 与 dueAt**（错题重练模式用，契约第 4 节第 4 条：
 * 「此时不写 mastery 的 level 提升，只记正确/错误计数」）。
 * → Mastery
 */
export function countOutcome(mastery, correct, now = Date.now()) {
  const at = toFinite(now);
  const stamp = at === null ? Date.now() : at;
  const base = mastery && typeof mastery === 'object' && !Array.isArray(mastery) ? mastery : null;
  const passed = correct === true;
  return {
    subjectId: String(base?.subjectId ?? ''),
    itemId: String(base?.itemId ?? ''),
    level: clampLevel(base?.level),
    correct: toInteger(base?.correct) + (passed ? 1 : 0),
    wrong: toInteger(base?.wrong) + (passed ? 0 : 1),
    streak: passed ? toInteger(base?.streak) + 1 : 0,
    lastSeenAt: stamp,
    dueAt: toFinite(base?.dueAt) ?? stamp
  };
}

/** 该条是否已到期（dueAt <= now）。 */
export function isDue(mastery, now = Date.now()) {
  if (!mastery || typeof mastery !== 'object') return false;
  const at = toFinite(now);
  const stamp = at === null ? Date.now() : at;
  return (toFinite(mastery.dueAt) ?? 0) <= stamp;
}

/** 到期排序：dueAt 升序，其次 itemId 字典序（保证结果稳定可测）。 */
export function compareDue(left, right) {
  const leftDue = toFinite(left?.dueAt) ?? 0;
  const rightDue = toFinite(right?.dueAt) ?? 0;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return String(left?.itemId ?? '').localeCompare(String(right?.itemId ?? ''));
}
