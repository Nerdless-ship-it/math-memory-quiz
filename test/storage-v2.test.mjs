// 存储层 v2 规格测试（契约 docs/ARCHITECTURE.md 第 3.5 / 3.6 / 7 节）。
//
// 覆盖：v1→v2 迁移无损 + 幂等、损坏数据不抛异常、导出/导入往返、
// applyMastery 升降级、dueItems 排序、session 存档、打卡跨日、导出旧键兼容。
//
// 注意：测试里的假 storage **只有 getItem / setItem**（与 test/history.test.mjs 一致），
// 并且用 Proxy 把 removeItem / clear / key / length 等访问直接变成异常，
// 用来证明存储层从未依赖这些方法。

import test from 'node:test';
import assert from 'node:assert/strict';

import { SUBJECTS } from '../public/js/registry.js';
import { saveTestResult } from '../public/js/history.js';
import {
  LEGACY_STORAGE_KEYS,
  MASTERY_MAX_LEVEL,
  MISTAKE_MASTERY_THRESHOLD,
  STORAGE_KEYS,
  applyMastery,
  applyOutcomes,
  clearMistakes,
  clearSession,
  compareRecords,
  dueItems,
  exportData,
  importData,
  localDateString,
  masteryFor,
  migrate,
  readMastery,
  readMistakes,
  readProfile,
  readRecords,
  readSession,
  recordMistakeOutcome,
  recordsForSubject,
  removeMistake,
  saveMistakes,
  savePrefs,
  saveRecord,
  saveSession,
  storageStats,
  touchStreak
} from '../public/js/storage.js';

const ALLOWED_METHODS = new Set(['getItem', 'setItem']);

/** 只允许 getItem / setItem 的假 storage；碰其它成员直接抛错。 */
function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const base = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
  return new Proxy(base, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !ALLOWED_METHODS.has(property)) {
        throw new Error(`storage 只允许使用 getItem/setItem，却被访问了 ${property}`);
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

function readKey(storage, key) {
  const raw = storage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

const V1_RECORDS = [
  {
    id: 'percent-1',
    quizType: 'percent',
    completedAt: 1_700_000_000_000,
    accuracy: 90,
    correct: 27,
    total: 30,
    durationMs: 120_000
  },
  {
    id: 'powers-1',
    quizType: 'powers',
    completedAt: 1_700_000_100_000,
    accuracy: 96,
    correct: 23,
    total: 24,
    durationMs: 90_000
  }
];

const V1_MISTAKES = [
  {
    id: 'percent:percent-to-fraction:12.5',
    quizType: 'percent',
    question: '12.5% = ?',
    answer: '1/8',
    wrongCount: 3,
    lastWrongAt: 1_700_000_200_000
  },
  {
    id: 'powers:result-to-base:square-17',
    quizType: 'powers',
    question: '289 是几的平方？',
    answer: '17',
    wrongCount: 1,
    lastWrongAt: 1_700_000_300_000
  }
];

test('v1 → v2 迁移无损：条数与字段逐条一致', () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.records]: JSON.stringify(V1_RECORDS),
    [LEGACY_STORAGE_KEYS.mistakes]: JSON.stringify(V1_MISTAKES)
  });

  const result = migrate(storage);
  assert.equal(result.migrated, true);
  assert.equal(result.records, 2);
  assert.equal(result.mistakes, 2);

  const records = readRecords(storage);
  assert.equal(records.length, 2);
  assert.deepEqual(records, [
    {
      id: 'percent-1',
      subjectId: 'percent',
      mode: 'test',
      completedAt: 1_700_000_000_000,
      accuracy: 90,
      correct: 27,
      total: 30,
      durationMs: 120_000
    },
    {
      id: 'powers-1',
      subjectId: 'powers',
      mode: 'test',
      completedAt: 1_700_000_100_000,
      accuracy: 96,
      correct: 23,
      total: 24,
      durationMs: 90_000
    }
  ]);

  const mistakes = readMistakes(storage);
  assert.equal(mistakes.length, 2);
  assert.deepEqual(mistakes[0], {
    id: 'percent:forward:12.5',
    subjectId: 'percent',
    itemId: '12.5',
    direction: 'forward',
    question: '12.5% = ?',
    answer: '1/8',
    wrongCount: 3,
    lastWrongAt: 1_700_000_200_000,
    masteredCount: 0
  });
  assert.equal(mistakes[1].subjectId, 'powers');
  assert.equal(mistakes[1].itemId, 'square-17');
  assert.equal(mistakes[1].direction, 'backward');
  assert.equal(mistakes[1].wrongCount, 1);
});

test('迁移幂等：重复执行不产生重复数据，且不删除 v1 旧键', () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.records]: JSON.stringify(V1_RECORDS),
    [LEGACY_STORAGE_KEYS.mistakes]: JSON.stringify(V1_MISTAKES)
  });

  migrate(storage);
  const first = { records: readRecords(storage), mistakes: readMistakes(storage) };

  const second = migrate(storage);
  assert.deepEqual(second, { migrated: false, records: 0, mistakes: 0 });
  assert.deepEqual(readRecords(storage), first.records);
  assert.deepEqual(readMistakes(storage), first.mistakes);
  assert.equal(readRecords(storage).length, 2);
  assert.equal(readMistakes(storage).length, 2);

  // v1 旧键必须原样保留（可回滚）
  assert.deepEqual(readKey(storage, LEGACY_STORAGE_KEYS.records), V1_RECORDS);
  assert.deepEqual(readKey(storage, LEGACY_STORAGE_KEYS.mistakes), V1_MISTAKES);
});

test('v2 键不存在时读取路径回退 v1 并惰性迁移（test/history.test.mjs 依赖）', () => {
  const storage = createStorage({ [LEGACY_STORAGE_KEYS.records]: JSON.stringify(V1_RECORDS) });

  assert.equal(storage.getItem(STORAGE_KEYS.records), null);
  assert.equal(readRecords(storage).length, 2);
  // 惰性迁移已经落地
  assert.equal(storage.getItem(STORAGE_KEYS.records) !== null, true);
  assert.equal(readRecords(storage).length, 2);
});

test('v2 已有记录时仍会并集补入 v1 里没见过的新记录（成绩永不隐藏旧数据）', () => {
  const storage = createStorage({
    [STORAGE_KEYS.records]: JSON.stringify([
      { id: 'v2-only', subjectId: 'percent', mode: 'test', completedAt: 300, accuracy: 80, correct: 24, total: 30, durationMs: 1000 }
    ]),
    [LEGACY_STORAGE_KEYS.records]: JSON.stringify(V1_RECORDS)
  });

  // 后注入的 v1 数据也必须出现（顺序无关），且不产生重复
  assert.deepEqual(readRecords(storage).map(({ id }) => id), ['v2-only', 'percent-1', 'powers-1']);
  assert.deepEqual(readRecords(storage).map(({ id }) => id), ['v2-only', 'percent-1', 'powers-1']);

  // 错题相反：v2 键存在即信任，避免「移除后立刻复活」
  const withMistakes = createStorage({
    [STORAGE_KEYS.mistakes]: JSON.stringify([
      { id: 'percent:forward:12.5', subjectId: 'percent', itemId: '12.5', direction: 'forward', question: '12.5% = ?', answer: '1/8', wrongCount: 1, lastWrongAt: 10 }
    ]),
    [LEGACY_STORAGE_KEYS.mistakes]: JSON.stringify(V1_MISTAKES)
  });
  assert.deepEqual(readMistakes(withMistakes).map(({ id }) => id), ['percent:forward:12.5']);
});

test('损坏的 JSON 被安全忽略，不抛异常、不阻断初始化', () => {
  const storage = createStorage({
    [STORAGE_KEYS.records]: '{broken',
    [STORAGE_KEYS.mastery]: 'not json',
    [STORAGE_KEYS.mistakes]: '"不是数组"',
    [STORAGE_KEYS.session]: '{broken',
    [STORAGE_KEYS.profile]: '{broken',
    [LEGACY_STORAGE_KEYS.records]: '{broken',
    [LEGACY_STORAGE_KEYS.mistakes]: '{broken'
  });

  assert.deepEqual(readRecords(storage), []);
  assert.deepEqual(readMastery(storage), {});
  assert.deepEqual(readMistakes(storage), []);
  assert.equal(readSession(storage), null);
  assert.deepEqual(readProfile(storage), {
    streakDays: 0,
    lastActiveDate: '',
    bestStreakDays: 0,
    prefs: { questionTypes: ['fill'], choicesPerQuestion: 4 }
  });
  assert.deepEqual(migrate(storage), { migrated: false, records: 0, mistakes: 0 });
  const stats = storageStats(storage);
  assert.deepEqual({ records: stats.records, mastery: stats.mastery, mistakes: stats.mistakes }, { records: 0, mastery: 0, mistakes: 0 });
  assert.equal(exportData(storage).version, 2);
});

test('不合法的记录/错题被过滤，不会污染统计', () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.records]: JSON.stringify([
      { id: 'x', quizType: 'other', completedAt: 1 },
      { id: 'y', quizType: 'percent', completedAt: 1, accuracy: 90, correct: 27, total: 30, durationMs: 1000 },
      { id: 'z', quizType: 'percent', completedAt: 2, accuracy: 90, correct: 99, total: 30, durationMs: 1000 }
    ]),
    [LEGACY_STORAGE_KEYS.mistakes]: JSON.stringify([
      { id: 'a', quizType: 'other', question: 'q', answer: 'a', wrongCount: 1, lastWrongAt: 1 },
      { id: 'b', quizType: 'percent', question: '', answer: 'a', wrongCount: 1, lastWrongAt: 1 }
    ])
  });

  const records = readRecords(storage);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'y');
  assert.deepEqual(readMistakes(storage), []);
});

test('v1 错题即使没有 quizType 字段也必须迁移（真实 v1 形状，曾静默全丢）', () => {
  // ⚠️ 这是一条回归测试，针对一个曾经静默丢光数据的严重缺陷：
  // 真实 v1 localStorage 里的错题对象**不含 quizType**，科目只存在于 id 前缀。
  // 早期实现要求 entry.quizType 属于已知科目，于是所有真实 v1 错题都返回 null
  // 被丢弃 —— 迁移「成功」但一条数据都没有，且不报错。
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.mistakes]: JSON.stringify([
      { id: 'percent:percent-to-fraction:12.5', question: '12.5% = ?', answer: '1/8', wrongCount: 2, lastWrongAt: 10 },
      { id: 'powers:base-to-result:square-17', question: '17² = ?', answer: '289', wrongCount: 1, lastWrongAt: 20 }
    ])
  });

  const migrated = readMistakes(storage);
  assert.equal(migrated.length, 2, '没有 quizType 的 v1 错题必须靠 id 前缀识别并迁移');
  assert.deepEqual(migrated.map(({ subjectId }) => subjectId).sort(), ['percent', 'powers']);
  assert.equal(migrated.find(({ subjectId }) => subjectId === 'percent').itemId, '12.5');
  assert.equal(migrated.find(({ subjectId }) => subjectId === 'percent').direction, 'forward');
  assert.equal(migrated.find(({ subjectId }) => subjectId === 'powers').direction, 'forward');
});

test('v2 错题为空数组时不得挡住 v1 错题迁移', () => {
  // 跑过任意一轮测试就会写出一个空的 mq:mistakes:v2（即使没有错题）。
  // 若「v2 键存在即信任」，旧用户的 v1 错题会从此永久不可见。
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.mistakes]: JSON.stringify([
      { id: 'percent:percent-to-fraction:12.5', question: '12.5% = ?', answer: '1/8', wrongCount: 1, lastWrongAt: 10 }
    ]),
    [STORAGE_KEYS.mistakes]: '[]'
  });
  assert.equal(readMistakes(storage).length, 1, '空 v2 数组必须回退到 v1');
});

test('非空 v2 错题仍然优先，移除过的错题不会从 v1 镜像复活', () => {
  // 与上一条相对：非空 v2 即信任，否则 removeMistake 的删除会被 v1 镜像撤销。
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.mistakes]: JSON.stringify([
      { id: 'percent:percent-to-fraction:12.5', question: '12.5% = ?', answer: '1/8', wrongCount: 1, lastWrongAt: 10 },
      { id: 'percent:percent-to-fraction:16.7', question: '16.7% = ?', answer: '1/6', wrongCount: 1, lastWrongAt: 11 }
    ]),
    [STORAGE_KEYS.mistakes]: JSON.stringify([{
      id: 'percent:forward:16.7', subjectId: 'percent', itemId: '16.7', direction: 'forward',
      question: '16.7% = ?', answer: '1/6', wrongCount: 1, lastWrongAt: 11, masteredCount: 0
    }])
  });
  const result = readMistakes(storage);
  assert.equal(result.length, 1, '非空 v2 即信任，不得把 v1 里已移除的 12.5 合并回来');
  assert.equal(result[0].itemId, '16.7');
});

test('成绩记录是单一数组：两个科目共处一数组且按 completedAt 升序', () => {
  const storage = createStorage();
  saveRecord({ id: 'p1', subjectId: 'percent', completedAt: 100, accuracy: 90, correct: 27, total: 30, durationMs: 80_000 }, storage);
  saveRecord({ id: 'w1', subjectId: 'powers', completedAt: 200, accuracy: 96, correct: 23, total: 24, durationMs: 70_000 }, storage);
  saveRecord({ id: 'p2', subjectId: 'percent', completedAt: 300, accuracy: 97, correct: 29, total: 30, durationMs: 60_000 }, storage);

  assert.deepEqual(readRecords(storage).map(({ id }) => id), ['p1', 'w1', 'p2']);
  assert.deepEqual(recordsForSubject('percent', storage).map(({ id }) => id), ['p1', 'p2']);
  assert.deepEqual(readKey(storage, STORAGE_KEYS.records).map(({ subjectId }) => subjectId), ['percent', 'powers', 'percent']);
});

test('saveRecord 返回同科目的上一条记录，compareRecords 给出差值', () => {
  const storage = createStorage();
  const first = saveRecord({ id: 'p1', subjectId: 'percent', completedAt: 1, accuracy: 90, correct: 27, total: 30, durationMs: 80_000 }, storage);
  assert.equal(first.previous, null);
  assert.equal(compareRecords(first.record, first.previous), null);

  saveRecord({ id: 'w1', subjectId: 'powers', completedAt: 2, accuracy: 50, correct: 12, total: 24, durationMs: 70_000 }, storage);
  const second = saveRecord({ id: 'p2', subjectId: 'percent', completedAt: 3, accuracy: 97, correct: 29, total: 30, durationMs: 60_000 }, storage);
  assert.equal(second.previous.id, 'p1');
  assert.deepEqual(compareRecords(second.record, second.previous), { accuracyDelta: 7, durationDeltaMs: -20_000 });
  assert.throws(() => saveRecord({ id: 'bad', subjectId: 'percent', completedAt: 4, accuracy: 10, correct: 5, total: 0, durationMs: 1 }, storage), /Invalid test result/);
});

test('数学两科的新成绩会追加到 v1 旧键（既有 e2e smoke 的硬要求）', () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.records]: JSON.stringify([V1_RECORDS[0]])
  });
  saveRecord({ id: 'p2', subjectId: 'percent', completedAt: 1_700_000_500_000, accuracy: 97, correct: 29, total: 30, durationMs: 60_000 }, storage);

  const legacy = readKey(storage, LEGACY_STORAGE_KEYS.records);
  assert.equal(legacy.length, 2);
  assert.deepEqual(legacy.map(({ quizType }) => quizType), ['percent', 'percent']);
  assert.deepEqual(legacy[1], {
    id: 'p2',
    quizType: 'percent',
    completedAt: 1_700_000_500_000,
    accuracy: 97,
    correct: 29,
    total: 30,
    durationMs: 60_000
  });
  // 再次保存同一条不会重复追加到旧键，也不会在 v2 里留下重复记录
  saveRecord({ id: 'p2', subjectId: 'percent', completedAt: 1_700_000_500_000, accuracy: 97, correct: 29, total: 30, durationMs: 60_000 }, storage);
  assert.equal(readKey(storage, LEGACY_STORAGE_KEYS.records).length, 2);
  assert.equal(readRecords(storage).length, 2);

  // v2 新增科目（非 v1 时代科目）不写旧键
  const newcomer = SUBJECTS.find(({ id }) => id !== 'percent' && id !== 'powers');
  if (newcomer) {
    saveRecord({ id: 'n1', subjectId: newcomer.id, completedAt: 1_700_000_600_000, accuracy: 80, correct: 8, total: 10, durationMs: 30_000 }, storage);
    assert.equal(readKey(storage, LEGACY_STORAGE_KEYS.records).length, 2);
    assert.equal(readRecords(storage).length, 3);
  }
});

test('错题集：反解 id、同 id 累加、兜底不丢数据、移除与清空', () => {
  const storage = createStorage();
  const saved = saveMistakes('percent', [{ id: 'percent:percent-to-fraction:12.5', question: '12.5% = ?', answer: '1/8' }], storage);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'percent:forward:12.5');
  assert.equal(saved[0].itemId, '12.5');
  assert.equal(saved[0].direction, 'forward');
  assert.equal(saved[0].wrongCount, 1);

  const again = saveMistakes('percent', [{ id: 'percent:percent-to-fraction:12.5', question: '12.5% = ?', answer: '1/8' }], storage);
  assert.equal(again.length, 1);
  assert.equal(again[0].wrongCount, 2);

  // 只有 { id, question, answer }（无 direction / itemId）也必须留下
  saveMistakes('powers', [{ id: 'powers:base:square-17', question: '17² = ?', answer: '289' }], storage);
  const powers = readMistakes(storage).filter(({ subjectId }) => subjectId === 'powers');
  assert.equal(powers.length, 1);
  assert.equal(powers[0].itemId, 'square-17');
  assert.equal(powers[0].direction, 'forward');

  // id 反解失败 → 用 id 本身兜底，绝不丢数据
  saveMistakes('powers', [{ id: 'weird-id', question: '奇怪题', answer: '答案' }], storage);
  const weird = readMistakes(storage).find(({ id }) => id === 'powers:forward:weird-id');
  assert.equal(Boolean(weird), true);
  assert.equal(weird.question, '奇怪题');

  assert.equal(removeMistake('percent:forward:12.5', storage).length, 2);
  assert.equal(readMistakes(storage).length, 2);
  assert.equal(clearMistakes('powers', storage).length, 0);
  assert.deepEqual(readKey(storage, STORAGE_KEYS.mistakes), []);
});

test('错题重练：连续答对 2 次自动移出，答错累加并清零进度', () => {
  const storage = createStorage();
  saveMistakes('percent', [{ id: 'percent:forward:12.5', question: '12.5% = ?', answer: '1/8' }], storage);

  let list = recordMistakeOutcome('percent:forward:12.5', true, storage);
  assert.equal(list.length, 1);
  assert.equal(list[0].masteredCount, 1);

  list = recordMistakeOutcome('percent:forward:12.5', false, storage);
  assert.equal(list.length, 1);
  assert.equal(list[0].masteredCount, 0);
  assert.equal(list[0].wrongCount, 2);

  recordMistakeOutcome('percent:forward:12.5', true, storage);
  list = recordMistakeOutcome('percent:forward:12.5', true, storage);
  assert.equal(list.length, 0);
  assert.equal(MISTAKE_MASTERY_THRESHOLD, 2);
});

test('掌握度：答对升级、答错归零、dueItems 按 dueAt 升序', () => {
  const storage = createStorage();
  const base = 1_700_000_000_000;

  let mastery = applyMastery('percent', [{ itemId: '12.5', correct: true, now: base }], storage);
  assert.equal(mastery['12.5'].level, 1);
  assert.equal(mastery['12.5'].dueAt, base + 10 * 60_000);
  assert.equal(mastery['12.5'].streak, 1);
  assert.equal(mastery['12.5'].correct, 1);

  mastery = applyMastery('percent', [{ itemId: '12.5', correct: true, now: base + 1 }], storage);
  assert.equal(mastery['12.5'].level, 2);
  assert.equal(mastery['12.5'].correct, 2);

  mastery = applyMastery('percent', [{ itemId: '12.5', correct: false, now: base + 2 }], storage);
  assert.equal(mastery['12.5'].level, 0);
  assert.equal(mastery['12.5'].streak, 0);
  assert.equal(mastery['12.5'].wrong, 1);
  assert.equal(mastery['12.5'].dueAt, base + 2);

  // 连续答对封顶
  for (let index = 0; index < 10; index += 1) {
    mastery = applyMastery('percent', [{ itemId: '12.5', correct: true, now: base + 10 + index }], storage);
  }
  assert.equal(mastery['12.5'].level, MASTERY_MAX_LEVEL);

  // 另一个科目互不干扰 + 到期排序（'3.5' 是刚升级的 level 1，'12.5' 是 level 5）
  applyMastery('powers', [{ itemId: 'square-17', correct: true, now: base + 1_000 }], storage);
  applyMastery('percent', [{ itemId: '3.5', correct: true, now: base + 500 }], storage);
  assert.deepEqual(Object.keys(masteryFor('percent', storage)).sort(), ['12.5', '3.5']);
  assert.deepEqual(dueItems('percent', storage, base + 599_999), []);
  assert.deepEqual(dueItems('percent', storage, base + 660_000), ['3.5']);
  assert.deepEqual(dueItems('percent', storage, base + 22 * 86_400_000), ['3.5', '12.5']);
  assert.deepEqual(dueItems('powers', storage, base + 660_000), ['square-17']);
  assert.deepEqual(dueItems('powers', storage, base + 100), []);
  assert.equal(readMastery(storage)['percent:12.5'].itemId, '12.5');
});

test('session 中途存档：保存 / 读取 / 清空（不依赖 removeItem）', () => {
  const storage = createStorage();
  assert.equal(readSession(storage), null);

  const saved = saveSession({
    subjectId: 'percent',
    mode: 'test',
    questionTypes: ['fill'],
    questionIds: ['12.5', '3.5'],
    directions: ['percent-to-fraction', 'fraction-to-percent'],
    answers: ['8'],
    currentIndex: 1,
    startedAt: 111,
    savedAt: 222
  }, storage);

  assert.deepEqual(saved.directions, ['forward', 'backward']);
  assert.deepEqual(saved.answers, ['8', '']);
  assert.equal(saved.currentIndex, 1);
  assert.deepEqual(readSession(storage), saved);

  assert.equal(clearSession(storage), null);
  assert.equal(readSession(storage), null);
  assert.equal(saveSession({ subjectId: 'percent', questionIds: [] }, storage), null);
});

test('打卡：跨日才 +1，断签从 1 重新开始，bestStreakDays 保留纪录', () => {
  const storage = createStorage();
  const today = localDateString();
  const yesterday = localDateString(new Date(Date.now() - 86_400_000));
  const longAgo = localDateString(new Date(Date.now() - 5 * 86_400_000));

  let profile = touchStreak(storage);
  assert.equal(profile.streakDays, 1);
  assert.equal(profile.lastActiveDate, today);
  assert.equal(profile.bestStreakDays, 1);

  // 同一天重复调用不增加
  assert.equal(touchStreak(storage).streakDays, 1);

  // 昨天打过卡 → 累加
  storage.setItem(STORAGE_KEYS.profile, JSON.stringify({ streakDays: 4, lastActiveDate: yesterday, bestStreakDays: 4, prefs: {} }));
  profile = touchStreak(storage);
  assert.equal(profile.streakDays, 5);
  assert.equal(profile.bestStreakDays, 5);
  assert.equal(profile.lastActiveDate, today);

  // 断签 → 从 1 开始，但历史最佳保留
  storage.setItem(STORAGE_KEYS.profile, JSON.stringify({ streakDays: 9, lastActiveDate: longAgo, bestStreakDays: 9, prefs: {} }));
  profile = touchStreak(storage);
  assert.equal(profile.streakDays, 1);
  assert.equal(profile.bestStreakDays, 9);
});

test('偏好：savePrefs 只覆盖显式字段并做合法性兜底', () => {
  const storage = createStorage();
  let profile = savePrefs({ choicesPerQuestion: 3 }, storage);
  assert.deepEqual(profile.prefs, { questionTypes: ['fill'], choicesPerQuestion: 3 });

  profile = savePrefs({ questionTypes: ['fill', 'choice'] }, storage);
  assert.deepEqual(profile.prefs, { questionTypes: ['fill', 'choice'], choicesPerQuestion: 3 });

  profile = savePrefs({ questionTypes: [], choicesPerQuestion: 1 }, storage);
  assert.deepEqual(profile.prefs, { questionTypes: ['fill'], choicesPerQuestion: 4 });
  assert.deepEqual(readProfile(storage).prefs.questionTypes, ['fill']);
});

test('导出 / 导入往返一致，merge 不重复', () => {
  const source = createStorage();
  saveRecord({ id: 'p1', subjectId: 'percent', completedAt: 100, accuracy: 90, correct: 27, total: 30, durationMs: 80_000 }, source);
  saveMistakes('percent', [{ id: 'percent:forward:12.5', question: '12.5% = ?', answer: '1/8' }], source);
  applyMastery('percent', [{ itemId: '12.5', correct: true, now: 1_700_000_000_000 }], source);
  touchStreak(source);
  savePrefs({ choicesPerQuestion: 3 }, source);

  const payload = exportData(source);
  assert.equal(payload.version, 2);
  assert.equal(typeof payload.exportedAt, 'number');

  const target = createStorage();
  const result = importData(payload, target, { mode: 'replace' });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'replace');

  const roundTrip = exportData(target);
  assert.deepEqual(roundTrip.records, payload.records);
  assert.deepEqual(roundTrip.mastery, payload.mastery);
  assert.deepEqual(roundTrip.mistakes, payload.mistakes);
  assert.deepEqual(roundTrip.profile, payload.profile);

  // merge 同一份数据不产生重复
  const merged = importData(payload, target, { mode: 'merge' });
  assert.equal(merged.ok, true);
  const afterMerge = exportData(target);
  assert.deepEqual(afterMerge.records, payload.records);
  assert.deepEqual(afterMerge.mistakes, payload.mistakes);
  assert.deepEqual(Object.keys(afterMerge.mastery), Object.keys(payload.mastery));

  // 非法载荷不写盘
  assert.equal(importData(null, target).ok, false);
  assert.equal(importData({ hello: 'world' }, target).ok, false);
});

test('引擎交卷路径：metrics 不带 completedAt / id 也能存成记录', () => {
  const storage = createStorage();
  // engine.js 的 store.saveResult → history.saveTestResult(subjectId, metrics)
  const metrics = { accuracy: 97, correct: 29, total: 30, durationMs: 60_000, mode: 'test' };
  const before = Date.now();
  const { record, previous } = saveTestResult('percent', metrics, storage);

  assert.equal(previous, null);
  assert.equal(record.quizType, 'percent');
  assert.equal(record.accuracy, 97);
  assert.equal(record.correct, 29);
  assert.equal(record.total, 30);
  assert.equal(record.durationMs, 60_000);
  assert.equal(record.id.length > 0, true);
  assert.equal(record.completedAt >= before && record.completedAt <= Date.now(), true);

  const stored = readRecords(storage);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].subjectId, 'percent');
  assert.equal(stored[0].mode, 'test');
  assert.equal(stored[0].id, record.id);

  // 第二次交卷能拿到上一条记录（结果页「对比上一次」依赖它）
  const second = saveTestResult('percent', { ...metrics, accuracy: 90 }, storage);
  assert.equal(second.previous.id, record.id);
  assert.deepEqual(compareRecords(second.record, second.previous), { accuracyDelta: -7, durationDeltaMs: 0 });
});

test('掌握度端口：第三参传 { mode } 也能落盘，错题重练模式不升级', () => {
  const storage = createStorage();
  const base = 1_700_000_000_000;

  // 引擎 recordOutcomes(subjectId, outcomes, { mode }) 直连 applyOutcomes
  const review = applyOutcomes('percent', [{ itemId: '12.5', direction: 'forward', correct: true, now: base }], { mode: 'mistakes', storage });
  assert.equal(review['12.5'].level, 0);
  assert.equal(review['12.5'].correct, 1);
  assert.equal(review['12.5'].wrong, 0);
  assert.equal(review['12.5'].dueAt, base);
  assert.equal(Object.keys(readMastery(storage)).length, 1);

  applyOutcomes('percent', [{ itemId: '12.5', correct: false, now: base + 1 }], { mode: 'mistakes', storage });
  assert.equal(readMastery(storage)['percent:12.5'].wrong, 1);
  assert.equal(readMastery(storage)['percent:12.5'].level, 0);

  // 正式模式（applyMastery 第三参是 options 而不是 storage）仍然升级
  const normal = applyMastery('percent', [{ itemId: '12.5', correct: true, now: base + 2 }], { mode: 'test', storage });
  assert.equal(normal['12.5'].level, 1);
  assert.equal(normal['12.5'].dueAt, base + 2 + 10 * 60_000);

  // 第三参是 storage 时行为不变
  const withStorage = applyMastery('powers', [{ itemId: 'square-17', correct: true, now: base + 3 }], storage);
  assert.equal(withStorage['square-17'].level, 1);
  assert.equal(Object.keys(readMastery(storage)).length, 2);
});

test('storageStats 统计条数与字节数近似值', () => {
  const storage = createStorage();
  assert.deepEqual(storageStats(storage), { records: 0, mastery: 0, mistakes: 0, bytes: 0 });

  saveRecord({ id: 'p1', subjectId: 'percent', completedAt: 100, accuracy: 90, correct: 27, total: 30, durationMs: 80_000 }, storage);
  saveMistakes('percent', [{ id: 'percent:forward:12.5', question: '12.5% = ?', answer: '1/8' }], storage);
  applyMastery('percent', [{ itemId: '12.5', correct: true }], storage);
  const stats = storageStats(storage);
  assert.equal(stats.records, 1);
  assert.equal(stats.mastery, 1);
  assert.equal(stats.mistakes, 1);
  assert.equal(stats.bytes > 0, true);
});

test('所有读写都只用 getItem / setItem（Proxy 假 storage 全程不报错）', () => {
  const storage = createStorage();
  assert.doesNotThrow(() => {
    readRecords(storage);
    readMastery(storage);
    readMistakes(storage);
    readSession(storage);
    readProfile(storage);
    storageStats(storage);
    exportData(storage);
    migrate(storage);
    saveRecord({ id: 'p1', subjectId: 'percent', completedAt: 100, accuracy: 90, correct: 27, total: 30, durationMs: 80_000 }, storage);
    saveMistakes('percent', [{ id: 'percent:forward:12.5', question: '12.5% = ?', answer: '1/8' }], storage);
    removeMistake('percent:forward:12.5', storage);
    clearMistakes('percent', storage);
    applyMastery('percent', [{ itemId: '12.5', correct: true }], storage);
    dueItems('percent', storage);
    saveSession({ subjectId: 'percent', questionIds: ['12.5'], directions: ['forward'], answers: [''], currentIndex: 0, startedAt: 1, savedAt: 1 }, storage);
    clearSession(storage);
    touchStreak(storage);
    savePrefs({ choicesPerQuestion: 4 }, storage);
  });
  // storage 未定义时也不能抛异常（Node / SSR 环境没有 localStorage）
  assert.doesNotThrow(() => {
    assert.deepEqual(readRecords(), []);
    assert.deepEqual(readMistakes(), []);
    assert.equal(readSession(), null);
    assert.equal(typeof readProfile().streakDays, 'number');
    assert.deepEqual(migrate(), { migrated: false, records: 0, mistakes: 0 });
  });
});
