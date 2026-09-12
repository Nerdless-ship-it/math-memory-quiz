// 掌握度与间隔重复调度规格测试（契约 docs/ARCHITECTURE.md 第 3.5 / 7 节）。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS,
  LEVEL_INTERVALS,
  MASTERY_MAX_LEVEL,
  MINUTE_MS,
  applyOutcome,
  clampLevel,
  compareDue,
  countOutcome,
  createMastery,
  dueAtForLevel,
  intervalForLevel,
  isDue,
  masteryKey,
  normalizeMastery,
  parseMasteryKey
} from '../public/js/mastery.js';

test('间隔阶梯与最大等级与契约数值完全一致', () => {
  assert.equal(MASTERY_MAX_LEVEL, 5);
  assert.deepEqual(LEVEL_INTERVALS, [
    0,
    10 * MINUTE_MS,
    DAY_MS,
    3 * DAY_MS,
    7 * DAY_MS,
    21 * DAY_MS
  ]);
  assert.deepEqual([...LEVEL_INTERVALS], [0, 600_000, 86_400_000, 259_200_000, 604_800_000, 1_814_400_000]);
  assert.equal(intervalForLevel(0), 0);
  assert.equal(intervalForLevel(3), 3 * DAY_MS);
  assert.equal(intervalForLevel(99), 21 * DAY_MS);
  assert.equal(intervalForLevel(-1), 0);
});

test('clampLevel 把任意输入夹到 [0, 5]', () => {
  assert.equal(clampLevel(undefined), 0);
  assert.equal(clampLevel('3'), 3);
  assert.equal(clampLevel(3.9), 3);
  assert.equal(clampLevel(-4), 0);
  assert.equal(clampLevel(100), MASTERY_MAX_LEVEL);
  assert.equal(clampLevel(Number.NaN), 0);
});

test('新建掌握度：level 0 且立即到期', () => {
  const mastery = createMastery('percent', '12.5', 1_700_000_000_000);
  assert.deepEqual(mastery, {
    subjectId: 'percent',
    itemId: '12.5',
    level: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    lastSeenAt: 1_700_000_000_000,
    dueAt: 1_700_000_000_000
  });
  assert.equal(isDue(mastery, 1_700_000_000_000), true);
});

test('答对升级（封顶 5）、答错归零、streak 与累计次数', () => {
  const base = 1_700_000_000_000;
  let mastery = createMastery('percent', '12.5', base);

  for (let step = 1; step <= MASTERY_MAX_LEVEL; step += 1) {
    mastery = applyOutcome(mastery, true, base + step);
    assert.equal(mastery.level, step);
    assert.equal(mastery.correct, step);
    assert.equal(mastery.streak, step);
    assert.equal(mastery.wrong, 0);
    assert.equal(mastery.lastSeenAt, base + step);
    assert.equal(mastery.dueAt, base + step + intervalForLevel(step));
  }

  // 已封顶再答对仍是 5
  mastery = applyOutcome(mastery, true, base + 100);
  assert.equal(mastery.level, MASTERY_MAX_LEVEL);
  assert.equal(mastery.dueAt, base + 100 + 21 * DAY_MS);

  // 答错 → 归零、streak 归零、当场到期
  mastery = applyOutcome(mastery, false, base + 200);
  assert.equal(mastery.level, 0);
  assert.equal(mastery.streak, 0);
  assert.equal(mastery.wrong, 1);
  assert.equal(mastery.correct, MASTERY_MAX_LEVEL + 1);
  assert.equal(mastery.dueAt, base + 200);

  // 不修改入参
  const original = createMastery('percent', '12.5', base);
  applyOutcome(original, true, base + 1);
  assert.equal(original.level, 0);
  assert.equal(original.correct, 0);
});

test('countOutcome：只记计数，不动 level 与 dueAt（错题重练模式）', () => {
  const base = 1_700_000_000_000;
  let mastery = applyOutcome(createMastery('percent', '12.5', base), true, base + 1);
  assert.equal(mastery.level, 1);

  const counted = countOutcome(mastery, true, base + 2);
  assert.equal(counted.level, 1);
  assert.equal(counted.dueAt, mastery.dueAt);
  assert.equal(counted.correct, mastery.correct + 1);
  assert.equal(counted.streak, mastery.streak + 1);
  assert.equal(counted.lastSeenAt, base + 2);

  const wrong = countOutcome(counted, false, base + 3);
  assert.equal(wrong.level, 1);
  assert.equal(wrong.wrong, 1);
  assert.equal(wrong.streak, 0);

  const fresh = countOutcome(undefined, true, base + 4);
  assert.equal(fresh.level, 0);
  assert.equal(fresh.correct, 1);
  assert.equal(fresh.dueAt, base + 4);
});

test('dueAtForLevel 使用 now + LEVEL_INTERVALS[level]', () => {
  assert.equal(dueAtForLevel(0, 1000), 1000);
  assert.equal(dueAtForLevel(1, 1000), 1000 + 10 * MINUTE_MS);
  assert.equal(dueAtForLevel(5, 1000), 1000 + 21 * DAY_MS);
});

test('掌握度键：subjectId 在第一个冒号处切分，itemId 可含冒号', () => {
  assert.equal(masteryKey('percent', '12.5'), 'percent:12.5');
  assert.deepEqual(parseMasteryKey('percent:12.5'), { subjectId: 'percent', itemId: '12.5' });
  assert.deepEqual(parseMasteryKey('chaodai:item:with:colons'), { subjectId: 'chaodai', itemId: 'item:with:colons' });
  assert.equal(parseMasteryKey('nocolon'), null);
  assert.equal(parseMasteryKey(':empty'), null);
  assert.equal(parseMasteryKey('trailing:'), null);
  assert.equal(parseMasteryKey(undefined), null);
});

test('normalizeMastery 容错：缺字段补默认值，非法入参返回 null', () => {
  assert.equal(normalizeMastery(undefined, 'percent', '12.5'), null);
  assert.equal(normalizeMastery({ level: 1 }, 'percent', ''), null);

  const normalized = normalizeMastery({ level: 3, correct: '2', wrong: -5, streak: 1.9 }, 'percent', '12.5', 5_000);
  assert.equal(normalized.level, 3);
  assert.equal(normalized.correct, 2);
  assert.equal(normalized.wrong, 0);
  assert.equal(normalized.streak, 1);
  assert.equal(normalized.lastSeenAt, 5_000);
  assert.equal(normalized.dueAt, 5_000 + 3 * DAY_MS);

  const outOfRange = normalizeMastery({ level: 42, dueAt: 0 }, 'percent', '12.5', 5_000);
  assert.equal(outOfRange.level, MASTERY_MAX_LEVEL);
  assert.equal(outOfRange.dueAt, 0);
  assert.equal(isDue(outOfRange, 5_000), true);
});

test('isDue 与 compareDue：按 dueAt 升序、同级按 itemId', () => {
  const early = createMastery('percent', 'a', 0);
  const late = createMastery('percent', 'b', 100);
  assert.equal(isDue(early, 0), true);
  assert.equal(isDue(late, 50), false);
  assert.equal(isDue(late, 100), true);
  assert.equal(isDue(null, 100), false);

  const list = [late, early].sort(compareDue);
  assert.deepEqual(list.map(({ itemId }) => itemId), ['a', 'b']);
  const tie = [createMastery('percent', 'b', 0), createMastery('percent', 'a', 0)].sort(compareDue);
  assert.deepEqual(tie.map(({ itemId }) => itemId), ['a', 'b']);
});
