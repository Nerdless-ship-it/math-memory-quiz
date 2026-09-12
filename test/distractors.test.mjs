// 选择题干扰项生成（public/js/distractors.js）的单元测试。
//
// 重点覆盖四类容易出错的地方：
//   1. 选项去重与「只能有一个正确答案」；
//   2. 池子不足时减量而不是重复填充；
//   3. 方向与取字段的绑定：正向从 back 取、反向从 front 取；
//   4. ⚠️ 维度交叉：同一段文字既可能是题面又是别的条目的答案
//      （chaodai「秦」、huaxue「氢」、shengxiao「鼠」、jieqi「惊蛰」），
//      干扰项绝不能等于题面。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_CHOICES_PER_QUESTION,
  MAX_CHOICES,
  MIN_CHOICES,
  buildChoices,
  choiceField,
  normalizeChoicesPerQuestion
} from '../public/js/distractors.js';
import { normalizeText } from '../public/js/adapters/generic.js';
import { SUBJECTS, contentPath } from '../public/js/registry.js';

/** 确定性随机源（与 test/engine.test.mjs 同款），保证选项顺序可复现。 */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const keys = (list) => list.map((text) => normalizeText(text));

const DEMO_ITEMS = [
  { id: 'd1', front: '甲', back: 'A', tags: ['组一'] },
  { id: 'd2', front: '乙', back: 'B', tags: ['组一'] },
  { id: 'd3', front: '丙', back: 'C', tags: ['组一'] },
  { id: 'd4', front: '丁', back: 'D', tags: ['组一'] }
];

// ── 基本形状 ─────────────────────────────────────────────────────────

test('buildChoices：返回 { choices, answerIndex }，answerIndex 指向正确答案', () => {
  const item = DEMO_ITEMS[0];
  const { choices, answerIndex } = buildChoices(item, 'forward', DEMO_ITEMS, {
    choicesPerQuestion: 4,
    random: seededRandom(1)
  });

  assert.ok(Array.isArray(choices), 'choices 必须是数组');
  assert.equal(choices.length, 4);
  assert.ok(Number.isInteger(answerIndex));
  assert.ok(answerIndex >= 0 && answerIndex < choices.length, 'answerIndex 必须落在数组内');
  assert.equal(choices[answerIndex], 'A', 'answerIndex 指向的必须是正确答案本身');
  assert.equal(choices.filter((choice) => normalizeText(choice) === 'a').length, 1,
    '正确答案在选项里必须只出现一次');
});

test('buildChoices：默认 4 个选项，且 choicesPerQuestion 被夹到 2..8', () => {
  assert.equal(DEFAULT_CHOICES_PER_QUESTION, 4);
  assert.equal(MIN_CHOICES, 2);
  assert.equal(MAX_CHOICES, 8);

  const big = buildChoices(DEMO_ITEMS[0], 'forward', DEMO_ITEMS, { random: seededRandom(2) });
  assert.equal(big.choices.length, 4, '不传 choicesPerQuestion 时默认 4 个');

  assert.equal(normalizeChoicesPerQuestion(0), MIN_CHOICES, '小于下限时抬到 2');
  assert.equal(normalizeChoicesPerQuestion(99), MAX_CHOICES, '超过上限时压到 8');
  assert.equal(normalizeChoicesPerQuestion(3), 3);
  assert.equal(normalizeChoicesPerQuestion('3'), 3, '字符串数字也应接受');
  assert.equal(normalizeChoicesPerQuestion('abc'), DEFAULT_CHOICES_PER_QUESTION, '非法值回退默认');
  assert.equal(normalizeChoicesPerQuestion(undefined), DEFAULT_CHOICES_PER_QUESTION);
});

test('buildChoices：没有答案（空串）时返回空选项集，交给调用方降级', () => {
  const { choices, answerIndex } = buildChoices({ id: 'x', front: '问题', back: '' }, 'forward', DEMO_ITEMS);
  assert.deepEqual(choices, []);
  assert.equal(answerIndex, -1);
});

// ── 去重：按 normalizeText 同义判断 ───────────────────────────────────

test('buildChoices：同义文本只出现一次（「1.7」与「1.7 」不是两个选项）', () => {
  const item = { id: 'n1', front: '百分数 12.5%', back: '1.7', tags: ['速算'] };
  const pool = [
    item,
    { id: 'n2', front: 'p2', back: '1.7 ', tags: ['速算'] },   // 与正确答案同义
    { id: 'n3', front: 'p3', back: '2.3', tags: ['速算'] },
    { id: 'n4', front: 'p4', back: ' 2.3 ', tags: ['速算'] },  // 与 n3 同义
    { id: 'n5', front: 'p5', back: '《3.5》', tags: ['速算'] },
    { id: 'n6', front: 'p6', back: '（3.5）', tags: ['速算'] }
  ];

  for (let seed = 0; seed < 30; seed += 1) {
    const { choices, answerIndex } = buildChoices(item, 'forward', pool, {
      choicesPerQuestion: 8,
      random: seededRandom(seed)
    });
    const normalized = keys(choices);
    assert.equal(new Set(normalized).size, normalized.length,
      `选项里出现了同义重复：${JSON.stringify(choices)}`);
    assert.equal(normalized.filter((key) => key === '1.7').length, 1, '正确答案只能出现一次');
    assert.equal(choices[answerIndex], '1.7');
    // 池子里一共只有 4 个互不相同的候选（1.7 / 2.3 / 3.5），去重后最多 4 个选项。
    assert.ok(choices.length <= 4, `去重后不该超过 4 个选项，实际 ${choices.length}`);
    assert.ok(!choices.includes('1.7 '), '与正确答案同义的写法不得作为干扰项');
  }
});

test('buildChoices：绝不把正确答案当干扰项', () => {
  const item = { id: 'k1', front: '甲', back: 'A', tags: ['组一'] };
  const pool = [
    item,
    { id: 'k2', front: '乙', back: 'a', tags: ['组一'] },   // 大小写不同但同义
    { id: 'k3', front: '丙', back: 'B', tags: ['组一'] }
  ];
  const { choices, answerIndex } = buildChoices(item, 'forward', pool, { random: seededRandom(5) });
  assert.deepEqual(keys(choices).filter((key) => key === 'a').length, 1);
  assert.equal(choices[answerIndex], 'A');
  assert.ok(!choices.includes('a'), '同义写法不得混进选项');
});

// ── 同 tags 优先 ─────────────────────────────────────────────────────

test('buildChoices：干扰项优先取同 tags 的条目', () => {
  const item = { id: 't1', front: '提示', back: '答案', tags: ['核心'] };
  const pool = [
    item,
    { id: 't2', front: 'x2', back: '同标签一', tags: ['核心'] },
    { id: 't3', front: 'x3', back: '同标签二', tags: ['核心'] },
    { id: 't4', front: 'x4', back: '同标签三', tags: ['核心'] },
    { id: 't5', front: 'x5', back: '别的标签', tags: ['边缘'] },
    { id: 't6', front: 'x6', back: '无标签' }
  ];

  for (let seed = 0; seed < 20; seed += 1) {
    const { choices } = buildChoices(item, 'forward', pool, { choicesPerQuestion: 4, random: seededRandom(seed) });
    const distractors = choices.filter((choice) => choice !== '答案');
    assert.equal(distractors.length, 3);
    for (const distractor of distractors) {
      assert.ok(['同标签一', '同标签二', '同标签三'].includes(distractor),
        `同 tags 池子够用时不得跨标签取干扰项，实际取到 ${distractor}`);
    }
  }
});

test('buildChoices：同 tags 不够时从全池补齐（不重复、不减量到 2）', () => {
  const item = { id: 'p1', front: '提示', back: '答案', tags: ['核心'] };
  const pool = [
    item,
    { id: 'p2', front: 'x2', back: '同标签一', tags: ['核心'] },
    { id: 'p3', front: 'x3', back: '别的标签', tags: ['边缘'] },
    { id: 'p4', front: 'x4', back: '另一个标签', tags: ['边缘二'] },
    { id: 'p5', front: 'x5', back: '无标签' }
  ];
  const { choices } = buildChoices(item, 'forward', pool, { choicesPerQuestion: 4, random: seededRandom(7) });
  assert.equal(choices.length, 4, '池子总量够时必须凑满 4 个（跨 tags 补齐）');
  assert.ok(choices.includes('同标签一'), '同标签条目必须优先入选');
  assert.equal(new Set(keys(choices)).size, 4);
});

test('buildChoices：条目没有 tags 时退化为全池', () => {
  const item = { id: 'g1', front: '提示', back: '答案' };
  const pool = [
    item,
    { id: 'g2', front: 'x2', back: '乙' },
    { id: 'g3', front: 'x3', back: '丙' },
    { id: 'g4', front: 'x4', back: '丁' }
  ];
  const { choices } = buildChoices(item, 'forward', pool, { choicesPerQuestion: 4, random: seededRandom(8) });
  assert.equal(choices.length, 4);
  assert.deepEqual(new Set(choices), new Set(['答案', '乙', '丙', '丁']));
});

// ── 池子不足：减量而不是重复填充 ──────────────────────────────────────

test('buildChoices：池子不足时减少选项数，绝不重复填充凑数', () => {
  const item = { id: 's1', front: '提示', back: '答案', tags: ['组一'] };

  const two = buildChoices(item, 'forward', [
    item,
    { id: 's2', front: 'x2', back: '唯一干扰项', tags: ['组一'] }
  ], { choicesPerQuestion: 4, random: seededRandom(9) });
  assert.equal(two.choices.length, 2, '只有 1 个干扰项时给 2 个选项');
  assert.equal(new Set(keys(two.choices)).size, 2, '不得用重复项凑满 4 个');
  assert.equal(two.choices[two.answerIndex], '答案');

  const one = buildChoices(item, 'forward', [item], { choicesPerQuestion: 4, random: seededRandom(9) });
  assert.deepEqual(one.choices, ['答案'], '没有干扰项时只剩正确答案本身');
  assert.equal(one.answerIndex, 0);

  const none = buildChoices(item, 'forward', [], { choicesPerQuestion: 4, random: seededRandom(9) });
  assert.deepEqual(none.choices, ['答案']);
  assert.equal(none.answerIndex, 0);
});

test('buildChoices：池子里的自己（同 id / 同对象）不能当干扰项来源', () => {
  const item = { id: 'self', front: '提示', back: '答案', tags: ['组一'] };
  const clone = { id: 'self', front: '提示', back: '答案', tags: ['组一'] };
  const { choices } = buildChoices(item, 'forward', [item, clone], { random: seededRandom(3) });
  assert.deepEqual(choices, ['答案'], '同 id 的自己必须被跳过');
});

// ── 随机源可注入 / 确定性 ────────────────────────────────────────────

test('buildChoices：同一 seed 结果完全一致，不同 seed 会产生不同排列', () => {
  const item = { id: 'r1', front: '提示', back: '答案', tags: ['组一'] };
  const pool = [
    item,
    { id: 'r2', front: 'x2', back: '乙', tags: ['组一'] },
    { id: 'r3', front: 'x3', back: '丙', tags: ['组一'] },
    { id: 'r4', front: 'x4', back: '丁', tags: ['组一'] },
    { id: 'r5', front: 'x5', back: '戊', tags: ['组一'] },
    { id: 'r6', front: 'x6', back: '己', tags: ['组一'] }
  ];

  const first = buildChoices(item, 'forward', pool, { random: seededRandom(42) });
  const second = buildChoices(item, 'forward', pool, { random: seededRandom(42) });
  assert.deepEqual(first, second, '同 seed 必须完全可复现（含 answerIndex）');

  const orders = new Set();
  for (let seed = 0; seed < 40; seed += 1) {
    const { choices, answerIndex } = buildChoices(item, 'forward', pool, { random: seededRandom(seed) });
    assert.equal(new Set(keys(choices)).size, choices.length);
    assert.equal(choices[answerIndex], '答案');
    orders.add(choices.join('|'));
  }
  assert.ok(orders.size > 5, `随机的意义在于选项顺序不固定，实际只有 ${orders.size} 种排列`);

  // random 非法时退回 Math.random，不得抛错。
  const fallback = buildChoices(item, 'forward', pool, { random: 'not-a-function' });
  assert.equal(fallback.choices.length, 4);
  assert.equal(fallback.choices[fallback.answerIndex], '答案');
});

test('buildChoices：pool 非法（null / 非数组）时不抛错', () => {
  const item = { id: 'z1', front: '提示', back: '答案' };
  for (const pool of [null, undefined, 'nope', 42, {}]) {
    const { choices, answerIndex } = buildChoices(item, 'forward', pool, { random: seededRandom(1) });
    assert.deepEqual(choices, ['答案']);
    assert.equal(answerIndex, 0);
  }
});

// ── 方向与取字段的绑定 ───────────────────────────────────────────────

test('buildChoices：正向从其它条目的 back 取干扰项，反向从 front 取', () => {
  const item = { id: 'dir1', front: '正面', back: '背面', tags: ['组一'] };
  const pool = [
    item,
    { id: 'dir2', front: '正面二', back: '背面二', tags: ['组一'] },
    { id: 'dir3', front: '正面三', back: '背面三', tags: ['组一'] },
    { id: 'dir4', front: '正面四', back: '背面四', tags: ['组一'] }
  ];

  const forward = buildChoices(item, 'forward', pool, { choicesPerQuestion: 4, random: seededRandom(11) });
  assert.equal(forward.choices[forward.answerIndex], '背面', '正向的正确答案是 back');
  assert.deepEqual(new Set(forward.choices), new Set(['背面', '背面二', '背面三', '背面四']),
    '正向干扰项必须全部来自其它条目的 back');
  for (const choice of forward.choices) {
    assert.ok(!choice.startsWith('正面'), `正向选项里出现了 front 文本：${choice}`);
  }

  const backward = buildChoices(item, 'backward', pool, { choicesPerQuestion: 4, random: seededRandom(11) });
  assert.equal(backward.choices[backward.answerIndex], '正面', '反向的正确答案是 front');
  assert.deepEqual(new Set(backward.choices), new Set(['正面', '正面二', '正面三', '正面四']),
    '反向干扰项必须全部来自其它条目的 front');
  for (const choice of backward.choices) {
    assert.ok(!choice.startsWith('背面'), `反向选项里出现了 back 文本：${choice}`);
  }

  assert.equal(choiceField('forward'), 'back');
  assert.equal(choiceField('backward'), 'front');
  assert.equal(choiceField('其他'), 'back', '未登记方向按正向处理');
});

// ── ⚠️ 维度交叉：干扰项不得等于题面 ──────────────────────────────────

test('维度交叉（chaodai）：「秦」不能既当题面又当选项', () => {
  // chaodai-04  front='秦'  back='秦始皇嬴政'  —— 正向题的题面是「秦」
  // chaodai-19  front='咸阳' back='秦'          —— 「秦」在这里是另一条的 back
  // 池子被收窄到这两条时，「秦」会成为唯一候选干扰项；
  // 它不等于正确答案，却与题面一字不差，必须被排除。
  const qin = { id: 'chaodai-04', front: '秦', back: '秦始皇嬴政', tags: ['开国君主'] };
  const xianyang = { id: 'chaodai-19', front: '咸阳', back: '秦', tags: ['都城'] };

  const narrowed = buildChoices(qin, 'forward', [qin, xianyang], {
    choicesPerQuestion: 4,
    random: seededRandom(13)
  });
  assert.ok(!narrowed.choices.includes('秦'), '与题面相同的「秦」不得作为干扰项');
  assert.deepEqual(narrowed.choices, ['秦始皇嬴政'], '没有合法干扰项时只剩正确答案（减量）');

  // 全池下也必须成立（同 tags 有 17 条时本就不会走到交叉项，这条是防回归）。
  const fullPool = [
    qin, xianyang,
    { id: 'chaodai-05', front: '西汉', back: '刘邦', tags: ['开国君主'] },
    { id: 'chaodai-06', front: '新', back: '王莽', tags: ['开国君主'] },
    { id: 'chaodai-07', front: '东汉', back: '刘秀', tags: ['开国君主'] }
  ];
  const full = buildChoices(qin, 'forward', fullPool, { choicesPerQuestion: 4, random: seededRandom(14) });
  assert.ok(!full.choices.includes('秦'));
  assert.equal(full.choices[full.answerIndex], '秦始皇嬴政');
});

test('维度交叉（huaxue）：符号与元素名互为答案，两个方向都不得混入题面', () => {
  // huaxue-01 front='氢' back='H'      —— 元素名称 → 元素符号
  // huaxue-47 front='H'  back='氢'     —— 符号释义（反向出题）
  const name = { id: 'huaxue-01', front: '氢', back: 'H', tags: ['元素名称'] };
  const symbol = { id: 'huaxue-47', front: 'H', back: '氢', tags: ['符号释义'] };

  // 正向问「氢 → ?」：候选 back 里有「氢」（来自 huaxue-47），与题面相同，必须排除。
  const forward = buildChoices(name, 'forward', [name, symbol], {
    choicesPerQuestion: 4,
    random: seededRandom(15)
  });
  assert.ok(!forward.choices.includes('氢'), '反向条目的 back「氢」与题面相同，不得作为干扰项');
  assert.deepEqual(forward.choices, ['H']);

  // 反向问「氢 → ?」（答案 H）：候选 front 里有「氢」（来自 huaxue-01），同样必须排除。
  const backward = buildChoices(symbol, 'backward', [name, symbol], {
    choicesPerQuestion: 4,
    random: seededRandom(15)
  });
  assert.ok(!backward.choices.includes('氢'));
  assert.deepEqual(backward.choices, ['H']);
});

test('维度交叉（全真实题库）：选项里既不会有重复项，也不会有等于题面的项', async () => {
  const choiceSubjects = SUBJECTS.filter((subject) => (subject.questionTypes ?? []).includes('choice'));
  assert.ok(choiceSubjects.length >= 8, `应有至少 8 个声明了 choice 的科目，实际 ${choiceSubjects.length}`);

  let crossingCases = 0;      // 池子里真的存在「与题面同文的候选」的次数
  let checkedItems = 0;
  let multiOptionItems = 0;

  for (const subject of choiceSubjects) {
    const module = await import(contentPath(subject));
    const pool = module.ITEMS;
    assert.ok(Array.isArray(pool) && pool.length >= 8, `${subject.id} 题库异常`);

    for (const item of pool) {
      for (const direction of ['forward', 'backward']) {
        const field = choiceField(direction);
        const prompt = direction === 'backward' ? item.back : item.front;
        const answer = direction === 'backward' ? item.front : item.back;
        const promptKey = normalizeText(prompt);
        const answerKey = normalizeText(answer);

        // 交叉判定：池子里是否有别的条目，其「同方向字段」与当前题面同文。
        const crossing = pool.some((candidate) => candidate !== item
          && typeof candidate[field] === 'string'
          && normalizeText(candidate[field]) === promptKey);
        if (crossing) crossingCases += 1;

        const { choices, answerIndex } = buildChoices(item, direction, pool, {
          choicesPerQuestion: 4,
          random: seededRandom(20260101 + checkedItems)
        });

        const label = `${subject.id}/${item.id}/${direction}`;
        assert.ok(choices.length >= 2, `${label} 至少应有 2 个选项（题库 ${pool.length} 条）`);
        assert.ok(choices.length <= 4, `${label} 选项数不得超过 choicesPerQuestion`);
        assert.equal(choices[answerIndex], answer, `${label} answerIndex 未指向正确答案`);

        const normalized = keys(choices);
        assert.equal(new Set(normalized).size, normalized.length, `${label} 选项出现同义重复`);
        assert.equal(normalized.filter((key) => key === answerKey).length, 1, `${label} 正确答案出现次数不为 1`);
        assert.ok(!normalized.includes(promptKey), `${label} 选项里出现了与题面相同的文本：${JSON.stringify(choices)}`);
        for (const key of normalized) {
          assert.notEqual(key, '', `${label} 选项里有空字符串`);
        }

        checkedItems += 1;
        if (choices.length > 2) multiOptionItems += 1;
      }
    }
  }

  // 这条断言的意义：证明「排除与题面同文的干扰项」不是纸上规则——
  // 真实题库里确实存在大量交叉条目（生肖、节气、朝代、化学元素四科都有）。
  assert.ok(crossingCases >= 8,
    `真实题库里应存在大量「题面即他人答案」的交叉条目，实际只统计到 ${crossingCases} 处`);
  assert.ok(multiOptionItems > checkedItems / 2,
    `绝大多数题目都应能凑出 3 个以上选项，实际 ${multiOptionItems}/${checkedItems}`);
});

// ── 纯函数约束 ───────────────────────────────────────────────────────

test('distractors.js 是纯函数模块：不引用 document / localStorage / window', async () => {
  const source = await readFile(new URL('../public/js/distractors.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of ['document', 'localStorage', 'window']) {
    assert.doesNotMatch(code, new RegExp(`\\b${forbidden}\\b`), `distractors.js 不得引用 ${forbidden}`);
  }
});
