// 引擎与适配器的单元测试。
//
// 覆盖三件事：
//   1. createQuiz 的方向均衡（契约 7.4）。
//   2. 两个适配器的判分边界 —— 必须与 quiz.js / powers-quiz.js 的冻结实现逐字一致。
//   3. createEngine 的交互契约：渲染、回车进下一题、按钮禁用、会话存档节流、交卷结算、destroy 解绑。
// 浏览器端 DOM 行为由 test/browser-smoke.mjs 与 test/powers-browser-smoke.mjs 负责（本文件不替代它们）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import percentAdapter from '../public/js/adapters/percent.js';
import powersAdapter from '../public/js/adapters/powers.js';
import { PAIRS } from '../public/js/data.js';
import { POWER_PAIRS } from '../public/js/powers-data.js';
import { ELEMENT_IDS, SESSION_KEY, collectElements, createEngine, createQuiz } from '../public/js/engine.js';
import { historyForType, mistakesForType } from '../public/js/history.js';
import { isCorrect as judgePercent } from '../public/js/quiz.js';
import { isPowerCorrect } from '../public/js/powers-quiz.js';

const LEGACY_HISTORY_KEY = 'math-memory-quiz-history:v1';
const LEGACY_MISTAKES_KEY = 'math-memory-quiz-mistakes:v1';

// ── 测试替身 ──────────────────────────────────────────────────────────
/** 确定性随机源，避免测试因 Math.random 抖动。 */
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

/** 极简 DOM 替身：只实现引擎真正用到的那几个成员。 */
function createStubElement() {
  const handlers = new Map();
  const classes = new Set();
  const element = {
    textContent: '',
    innerHTML: '',
    hidden: false,
    value: '',
    placeholder: '',
    inputMode: '',
    disabled: false,
    className: '',
    style: {},
    children: [],
    focused: 0,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      }
    },
    append(...nodes) {
      element.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      element.children = [...nodes];
    },
    addEventListener(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      handlers.set(type, (handlers.get(type) ?? []).filter((item) => item !== handler));
    },
    emit(type, event = {}) {
      for (const handler of [...(handlers.get(type) ?? [])]) handler(event);
    },
    listenerCount(type) {
      return (handlers.get(type) ?? []).length;
    },
    focus() {
      element.focused += 1;
    }
  };
  return element;
}

function createStubDom() {
  const elements = {};
  for (const key of Object.keys(ELEMENT_IDS)) elements[key] = createStubElement();
  elements.quiz.hidden = true;
  elements.result.hidden = true;
  elements.testMeta.hidden = true;
  const document = createStubElement();
  document.visibilityState = 'visible';
  document.createElement = () => createStubElement();
  return { elements, document };
}

function createStubWindow() {
  const window = createStubElement();
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  window.scrollTo = () => {};
  return window;
}

function createFakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

const DEMO_ITEMS = [
  { id: 'a', front: 'A', back: '1', tags: ['demo'], raw: { front: 'A', back: '1' } },
  { id: 'b', front: 'B', back: '2', tags: ['demo'], raw: { front: 'B', back: '2' } },
  { id: 'c', front: 'C', back: '3', tags: ['demo'], raw: { front: 'C', back: '3' } },
  { id: 'd', front: 'D', back: '4', tags: ['demo'], raw: { front: 'D', back: '4' } }
];

/** 与真实适配器同接口的演示适配器：证明「新科目 = 适配器 + 注册表一条」，引擎零改动。 */
const demoAdapter = {
  id: 'demo',
  items: () => DEMO_ITEMS,
  isCorrect: (item, ctx) => (ctx.direction === 'forward' ? item.raw.back : item.raw.front) === ctx.input,
  renderPrompt: (item, ctx) => ({ text: ctx.direction === 'forward' ? item.front : item.back }),
  view: (item, ctx) => ({
    directionLabel: ctx.direction === 'forward' ? '正向' : '反向',
    instruction: '请作答',
    answerWrapClass: ctx.direction === 'forward'
  }),
  inputHints: (item, ctx) => (ctx.direction === 'forward'
    ? { prefix: '1/', suffix: '', placeholder: '…', inputMode: 'decimal', label: '分母', hint: '只填分母' }
    : { prefix: '', suffix: '%', placeholder: '0', inputMode: 'decimal', label: '百分数', hint: '只填数字' }),
  correction: (item, ctx) => ({ equation: `${item.front} = ${item.back}`, note: '演示', userAnswer: ctx.input }),
  mistake: (item) => ({ id: `demo:${item.id}`, question: item.front, answer: item.back }),
  perfectMessage: () => ({ title: '全部正确', note: '再来一轮' })
};

function demoEngine(overrides = {}) {
  const dom = createStubDom();
  const storage = overrides.storage ?? createFakeStorage();
  const window = createStubWindow();
  let clock = 1_000_000;
  const calls = [];
  const store = overrides.store ?? {
    saveResult: (subjectId, metrics) => {
      calls.push({ name: 'saveResult', subjectId, metrics });
      return { record: { id: 'record-1', ...metrics }, previous: { accuracy: 50, durationMs: 30_000 } };
    },
    compare: () => ({ accuracyDelta: 25, durationDeltaMs: -2000 }),
    saveMistakes: (subjectId, mistakes) => {
      calls.push({ name: 'saveMistakes', subjectId, mistakes });
      return mistakes;
    },
    readSession: () => JSON.parse(storage.getItem(SESSION_KEY) ?? 'null'),
    saveSession: (session) => storage.setItem(SESSION_KEY, JSON.stringify(session)),
    clearSession: () => storage.removeItem(SESSION_KEY),
    recordOutcomes: (subjectId, outcomes, meta) => {
      calls.push({ name: 'recordOutcomes', subjectId, outcomes, meta });
    },
    touchStreak: () => {
      calls.push({ name: 'touchStreak' });
    }
  };
  const engine = createEngine({
    adapter: demoAdapter,
    subject: { id: 'demo', questionTypes: ['fill'] },
    elements: dom.elements,
    document: dom.document,
    window,
    storage,
    random: seededRandom(overrides.seed ?? 3),
    now: () => clock,
    store
  });
  return {
    engine,
    ...dom,
    window,
    storage,
    calls,
    tick: (milliseconds) => {
      clock += milliseconds;
    }
  };
}

function expectedInput(question) {
  return question.direction === 'forward' ? question.raw.back : question.raw.front;
}

/** getState() 只给出精简快照（id/direction/answer），这里按 id 取回完整演示条目。 */
function demoQuestion(engine) {
  const state = engine.getState();
  const current = state.questions[state.currentIndex];
  const item = DEMO_ITEMS.find((candidate) => candidate.id === current.id);
  return { ...item, direction: current.direction, answer: current.answer };
}

// ── createQuiz ────────────────────────────────────────────────────────
test('createQuiz：每个条目只出现一次，两个方向数量均衡', () => {
  const questions = createQuiz(PAIRS.map((pair, index) => ({ id: `p${index}`, front: pair.percent })), seededRandom(42));
  assert.equal(questions.length, 30);
  assert.equal(new Set(questions.map((question) => question.id)).size, 30);
  assert.equal(questions.filter((question) => question.direction === 'forward').length, 15);
  assert.equal(questions.filter((question) => question.direction === 'backward').length, 15);
  assert.ok(questions.every((question) => question.answer === ''), '新题目的答案必须是空串');
});

test('createQuiz：奇数题量时下半取多，且多轮随机下依然均衡', () => {
  const odd = createQuiz([{ id: '1' }, { id: '2' }, { id: '3' }], seededRandom(7));
  assert.equal(odd.filter((question) => question.direction === 'forward').length, 1);
  assert.equal(odd.filter((question) => question.direction === 'backward').length, 2);

  for (let round = 0; round < 20; round += 1) {
    const questions = createQuiz(POWER_PAIRS, Math.random);
    assert.equal(questions.filter((question) => question.direction === 'forward').length, 12);
    assert.equal(questions.filter((question) => question.direction === 'backward').length, 12);
  }
});

// ── createQuiz 方向锁 ─────────────────────────────────────────────────
// 部分题目的条目只在一个方向上语义成立（chaodai 的「都城」组正向、
// huaxue 的「符号释义」组反向）。出成另一个方向就是用户无法作答的无解题。
test('createQuiz：受锁条目永不落到被禁止的方向上', () => {
  const locked = Array.from({ length: 10 }, (_, index) => ({
    id: `locked-${index}`,
    lockedDirections: ['forward']
  }));
  const free = Array.from({ length: 10 }, (_, index) => ({ id: `free-${index}` }));
  const items = [...locked, ...free];
  const random = seededRandom(99);

  for (let round = 0; round < 200; round += 1) {
    const questions = createQuiz(items, random);
    assert.equal(questions.length, 20);
    for (const question of questions) {
      if (question.id.startsWith('locked-')) {
        assert.equal(
          question.direction,
          'forward',
          `受锁条目 ${question.id} 被出成了 ${question.direction}`
        );
      }
    }
  }
});

test('createQuiz：反向锁与混合锁都成立，且腾出的槽位仍被利用', () => {
  const items = [
    { id: 'a', lockedDirections: ['backward'] },
    { id: 'b', lockedDirections: ['forward'] },
    { id: 'c' },
    { id: 'd' },
    { id: 'e' },
    { id: 'f' },
  ];
  const random = seededRandom(1234);
  for (let round = 0; round < 100; round += 1) {
    const questions = createQuiz(items, random);
    const byId = new Map(questions.map((question) => [question.id, question.direction]));
    assert.equal(byId.get('a'), 'backward', '反向锁条目必须是 backward');
    assert.equal(byId.get('b'), 'forward', '正向锁条目必须是 forward');
    // 未锁条目的方向仍应两种都有，说明锁没有把方向分布压成单一侧。
    const freeDirections = new Set([byId.get('c'), byId.get('d'), byId.get('e'), byId.get('f')]);
    assert.ok(freeDirections.size >= 1, '未锁条目应至少有一个方向');
    assert.equal(questions.length, 6);
  }
});

test('createQuiz：全部条目受锁时不会死循环，且方向按锁定值给出', () => {
  const allForward = Array.from({ length: 7 }, (_, index) => ({
    id: `f-${index}`,
    lockedDirections: ['forward']
  }));
  const questions = createQuiz(allForward, seededRandom(3));
  assert.equal(questions.length, 7);
  assert.ok(questions.every((question) => question.direction === 'forward'));
});

test('createQuiz：无锁条目时行为不变（既有方向均衡仍然成立）', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: `n-${index}` }));
  const questions = createQuiz(items, seededRandom(11));
  assert.equal(questions.filter((question) => question.direction === 'forward').length, 6);
  assert.equal(questions.filter((question) => question.direction === 'backward').length, 6);
});

// ── percent 适配器 ────────────────────────────────────────────────────
test('percent 适配器：条目映射与契约 3.4 一致', () => {
  const items = percentAdapter.items();
  assert.equal(items.length, 30);
  assert.equal(new Set(items.map((item) => item.id)).size, 30);
  assert.equal(items[0].id, PAIRS[0].percent);
  assert.equal(items[0].front, `${PAIRS[0].percent}%`);
  assert.equal(items[0].back, PAIRS[0].fraction);
  assert.equal(items[0].raw, PAIRS[0], 'raw 必须保留原始 pair 供判分使用');
});

test('percent 适配器：正向只填分母也判对，且与 quiz.js 冻结实现完全一致', () => {
  const item = percentAdapter.items().find((candidate) => candidate.id === '12.5');
  assert.ok(item);
  for (const input of ['8', '1/8', ' 8 ']) {
    assert.equal(percentAdapter.isCorrect(item, { direction: 'forward', input }), true, `input=${input}`);
  }
  for (const input of ['8.3', '9', '', '0', 'abc']) {
    assert.equal(percentAdapter.isCorrect(item, { direction: 'forward', input }), false, `input=${input}`);
  }
  // 逐字复用 quiz.js：任何输入都必须得到同一个结论。
  for (const input of ['8', '1/8', '8.3', '', ' 8 ']) {
    assert.equal(
      percentAdapter.isCorrect(item, { direction: 'forward', input }),
      judgePercent({ direction: 'percent-to-fraction', answer: input, percent: '12.5', fraction: '1/8' })
    );
  }
});

test('percent 适配器：反向为数值比较，容差 1e-6', () => {
  const item = percentAdapter.items().find((candidate) => candidate.id === '12.5');
  assert.equal(percentAdapter.isCorrect(item, { direction: 'backward', input: '12.5' }), true);
  assert.equal(percentAdapter.isCorrect(item, { direction: 'backward', input: '12.5%' }), true, '百分号可省略');
  assert.equal(percentAdapter.isCorrect(item, { direction: 'backward', input: '12.5000005' }), true, '容差内判对');
  assert.equal(percentAdapter.isCorrect(item, { direction: 'backward', input: '12.500002' }), false, '超出 1e-6 判错');
  assert.equal(percentAdapter.isCorrect(item, { direction: 'backward', input: '13' }), false);
  assert.equal(percentAdapter.isCorrect(item, { direction: 'backward', input: '' }), false);
});

test('percent 适配器：分数题固定 1/ 前缀，百分数题 % 后缀', () => {
  const item = percentAdapter.items().find((candidate) => candidate.id === '12.5');
  const forward = percentAdapter.inputHints(item, { direction: 'forward' });
  assert.deepEqual(
    { prefix: forward.prefix, suffix: forward.suffix, placeholder: forward.placeholder, hint: forward.hint },
    { prefix: '1/', suffix: '', placeholder: '…', hint: '只填写分母' }
  );
  assert.equal(forward.label, '请输入对应分数的分母');

  const backward = percentAdapter.inputHints(item, { direction: 'backward' });
  assert.deepEqual(
    { prefix: backward.prefix, suffix: backward.suffix, placeholder: backward.placeholder },
    { prefix: '', suffix: '%', placeholder: '0' }
  );
  assert.equal(backward.hint, '只需填写数字，百分号可省略');

  assert.equal(percentAdapter.renderPrompt(item, { direction: 'forward' }).text, '12.5%');
  assert.equal(percentAdapter.renderPrompt(item, { direction: 'backward' }).text, '1/8');
  assert.equal(percentAdapter.view(item, { direction: 'forward' }).directionLabel, '百分数转分数');
  assert.equal(percentAdapter.view(item, { direction: 'forward' }).instruction, '写出对应的分数');
  assert.equal(percentAdapter.view(item, { direction: 'forward' }).answerWrapClass, true);
  assert.equal(percentAdapter.view(item, { direction: 'backward' }).directionLabel, '分数转百分数');
  assert.equal(percentAdapter.view(item, { direction: 'backward' }).instruction, '写出对应的百分数');
  assert.equal(percentAdapter.view(item, { direction: 'backward' }).answerWrapClass, false);
});

test('percent 适配器：订正文本与错题 id 保持 v1 形状', () => {
  const item = percentAdapter.items().find((candidate) => candidate.id === '12.5');
  const forward = percentAdapter.correction(item, { direction: 'forward', input: '8' });
  assert.equal(forward.equation, '12.5% = 1/8');
  assert.equal(forward.note, '百分数转分数');
  assert.equal(forward.userAnswer, '1/8', '用户只填了分母，订正行要还原成完整分数');

  const backward = percentAdapter.correction(item, { direction: 'backward', input: '12.5' });
  assert.equal(backward.equation, '1/8 = 12.5%');
  assert.equal(backward.userAnswer, '12.5%');

  assert.deepEqual(percentAdapter.mistake(item, { direction: 'forward' }), {
    id: 'percent:percent-to-fraction:12.5',
    question: '12.5% = ?',
    answer: '1/8'
  });
  assert.deepEqual(percentAdapter.mistake(item, { direction: 'backward' }), {
    id: 'percent:fraction-to-percent:12.5',
    question: '1/8 = ?%',
    answer: '12.5%'
  });
  assert.equal(percentAdapter.perfectMessage().title, '30 组换算全部正确');
});

// ── powers 适配器 ─────────────────────────────────────────────────────
test('powers 适配器：条目映射与契约 3.4 一致', () => {
  const items = powersAdapter.items();
  assert.equal(items.length, 24);
  assert.equal(new Set(items.map((item) => item.id)).size, 24);
  const square = items.find((item) => item.id === 'square-17');
  assert.equal(square.front, '17²');
  assert.equal(square.back, '289');
  assert.deepEqual(square.tags, ['平方数']);
  assert.equal(square.raw, POWER_PAIRS.find((pair) => pair.id === 'square-17'));
});

test('powers 适配器：正向接受近似值与精确值，且与 isPowerCorrect 完全一致', () => {
  const items = powersAdapter.items();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const input of ['289', ' 289 ']) {
    assert.equal(powersAdapter.isCorrect(byId.get('square-17'), { direction: 'forward', input }), true, `input=${input}`);
  }
  assert.equal(powersAdapter.isCorrect(byId.get('square-17'), { direction: 'forward', input: '290' }), false);
  assert.equal(powersAdapter.isCorrect(byId.get('square-17'), { direction: 'forward', input: '' }), false);

  const cube = byId.get('cube-1.3');
  for (const input of ['2.2', '2.197', '约2.2', '≈2.197', '=2.2']) {
    assert.equal(powersAdapter.isCorrect(cube, { direction: 'forward', input }), true, `input=${input}`);
  }
  assert.equal(powersAdapter.isCorrect(cube, { direction: 'forward', input: '2.3' }), false);

  const fourth = byId.get('fourth-1.2');
  assert.equal(powersAdapter.isCorrect(fourth, { direction: 'forward', input: '2' }), true);
  assert.equal(powersAdapter.isCorrect(fourth, { direction: 'forward', input: '2.0736' }), true);

  for (const input of ['2.2', '2.197', '约2.2', '2.3', '']) {
    assert.equal(
      powersAdapter.isCorrect(cube, { direction: 'forward', input }),
      isPowerCorrect({ ...cube.raw, direction: 'base-to-result', answer: input })
    );
  }
});

test('powers 适配器：反向只接受对应常数，容差 1e-7', () => {
  const byId = new Map(powersAdapter.items().map((item) => [item.id, item]));
  const square = byId.get('square-17');
  assert.equal(powersAdapter.isCorrect(square, { direction: 'backward', input: '17' }), true);
  assert.equal(powersAdapter.isCorrect(square, { direction: 'backward', input: '18' }), false);

  const cube = byId.get('cube-1.2');
  assert.equal(powersAdapter.isCorrect(cube, { direction: 'backward', input: '1.2' }), true);
  assert.equal(powersAdapter.isCorrect(cube, { direction: 'backward', input: '1.20000005' }), true, '容差内判对');
  assert.equal(powersAdapter.isCorrect(cube, { direction: 'backward', input: '1.2000005' }), false, '超出 1e-7 判错');
  assert.equal(powersAdapter.isCorrect(cube, { direction: 'backward', input: '1.3' }), false);
});

test('powers 适配器：题干措辞、≈/= 运算符与上标后缀', () => {
  const byId = new Map(powersAdapter.items().map((item) => [item.id, item]));
  const square = byId.get('square-17');
  const cube = byId.get('cube-1.3');
  const fourth = byId.get('fourth-1.4');

  assert.equal(powersAdapter.view(square, { direction: 'forward' }).instruction, '写出这个常数的平方数');
  assert.equal(powersAdapter.view(cube, { direction: 'forward' }).instruction, '写出这个常数的立方近似值');
  assert.equal(powersAdapter.view(fourth, { direction: 'forward' }).instruction, '写出这个常数的四次幂近似值');
  assert.equal(powersAdapter.view(square, { direction: 'backward' }).instruction, '这个平方数对应哪个常数？');
  assert.equal(powersAdapter.view(cube, { direction: 'backward' }).instruction, '这个立方近似值对应哪个常数？');
  assert.equal(powersAdapter.view(fourth, { direction: 'backward' }).instruction, '这个四次幂近似值对应哪个常数？');

  assert.equal(powersAdapter.view(square, { direction: 'forward' }).operator, '=');
  assert.equal(powersAdapter.view(cube, { direction: 'forward' }).operator, '≈');
  assert.equal(powersAdapter.view(square, { direction: 'forward' }).directionLabel, '由常数求幂值');
  assert.equal(powersAdapter.view(square, { direction: 'backward' }).directionLabel, '由幂值找常数');
  assert.equal(powersAdapter.view(cube, { direction: 'forward' }).topic, '立方数');

  const forward = powersAdapter.inputHints(square, { direction: 'forward' });
  assert.equal(forward.prefix, '');
  assert.equal(forward.suffix, '', '正向题不得泄露幂次结果');
  assert.equal(forward.placeholder, '···');
  assert.equal(forward.hint, '只需填写数字');
  assert.equal(forward.label, '请输入平方数结果');

  const backward = powersAdapter.inputHints(square, { direction: 'backward' });
  assert.equal(backward.suffix, '²');
  assert.equal(backward.placeholder, '0');
  assert.equal(backward.label, '请输入对应常数');
  assert.equal(powersAdapter.inputHints(cube, { direction: 'backward' }).suffix, '³');
  assert.equal(powersAdapter.inputHints(fourth, { direction: 'backward' }).suffix, '⁴');

  assert.equal(powersAdapter.renderPrompt(square, { direction: 'forward' }).text, '17²');
  assert.equal(powersAdapter.renderPrompt(square, { direction: 'backward' }).text, '289');
});

test('powers 适配器：订正等式与错题 id 保持 v1 形状', () => {
  const byId = new Map(powersAdapter.items().map((item) => [item.id, item]));
  const cube = byId.get('cube-1.3');
  const forward = powersAdapter.correction(cube, { direction: 'forward', input: '2.5' });
  assert.equal(forward.equation, '1.3³ ≈ 2.2');
  assert.equal(forward.note, '立方数 · 由常数求幂值');
  assert.equal(forward.userAnswer, '2.5');
  assert.equal(powersAdapter.correction(cube, { direction: 'backward', input: '1.4' }).note, '立方数 · 由幂值找常数');

  assert.deepEqual(powersAdapter.mistake(cube, { direction: 'forward' }), {
    id: 'powers:base-to-result:cube-1.3',
    question: '1.3³ ≈ ?',
    answer: '2.2'
  });
  assert.deepEqual(powersAdapter.mistake(cube, { direction: 'backward' }), {
    id: 'powers:result-to-base:cube-1.3',
    question: '2.2 ≈ ?³',
    answer: '1.3'
  });
  assert.equal(powersAdapter.perfectMessage().title, '24 组平方与幂次全部正确');
});

test('两个适配器都是纯函数：源码不引用 document / localStorage / window', async () => {
  for (const file of ['percent.js', 'powers.js']) {
    const source = await readFile(new URL(`../public/js/adapters/${file}`, import.meta.url), 'utf8');
    const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of ['document', 'localStorage', 'window']) {
      assert.doesNotMatch(code, new RegExp(`\\b${forbidden}\\b`), `${file} 不得引用 ${forbidden}`);
    }
  }
});

// ── engine 装配 ───────────────────────────────────────────────────────
test('collectElements 容忍页面缺失元素，未知根节点返回空对象', () => {
  const input = createStubElement();
  const elements = collectElements({ querySelector: (selector) => (selector === '#answer-input' ? input : null) });
  assert.equal(elements.answerInput, input);
  assert.equal(elements.quiz, null, '页面没有的元素必须是 null 而不是 undefined');
  assert.equal(Object.keys(elements).length, Object.keys(ELEMENT_IDS).length);
  assert.deepEqual(collectElements(null), {});
  assert.equal(SESSION_KEY, 'mq:session:v2');
});

test('createEngine 缺少 adapter 时立刻抛错', () => {
  assert.throws(() => createEngine({}), /adapter/);
});

// ── engine 主流程 ─────────────────────────────────────────────────────
test('createEngine：渲染、输入同步按钮状态、回车进下一题、切题才落盘', () => {
  const context = demoEngine();
  const { engine, elements, storage, window } = context;
  engine.start();

  assert.equal(engine.getState().total, 4);
  assert.equal(elements.quiz.hidden, false);
  assert.equal(elements.welcome.hidden, true);
  assert.equal(elements.testMeta.hidden, false);
  assert.equal(elements.questionNumber.textContent, '01');
  assert.equal(elements.headerProgress.textContent, '1 / 4');
  assert.equal(elements.progressFill.style.width, '25%');
  assert.equal(elements.previousButton.disabled, true, '第一题的上一题按钮必须禁用');
  assert.equal(elements.nextButton.disabled, true, '答案为空时下一题按钮必须禁用');
  assert.equal(elements.nextButtonText.textContent, '下一题');
  assert.equal(elements.headerTime.textContent, '00:00');

  const first = engine.getState().questions[0];
  if (first.direction === 'forward') {
    assert.equal(elements.fractionNumerator.textContent, '1/');
    assert.equal(elements.fractionNumerator.hidden, false);
    assert.equal(elements.answerInput.value, '', '分数题输入框初始为空（1/ 是独立前缀）');
  } else {
    assert.equal(elements.answerSuffix.textContent, '%');
  }

  // input 事件必须同步更新内存状态与按钮（smoke 用合成事件驱动）。
  elements.answerInput.value = 'x';
  elements.answerInput.emit('input');
  assert.equal(elements.nextButton.disabled, false);
  assert.equal(storage.getItem(SESSION_KEY), null, 'input 阶段不落盘');

  // 空答案按回车不得前进。
  elements.answerInput.value = '';
  elements.answerInput.emit('input');
  assert.equal(elements.nextButton.disabled, true);
  elements.answerInput.emit('keydown', { key: 'Enter' });
  assert.equal(engine.getState().currentIndex, 0);

  // 有答案按回车前进，并在切题时写会话存档。
  elements.answerInput.value = 'x';
  elements.answerInput.emit('input');
  elements.answerInput.emit('keydown', { key: 'Enter' });
  assert.equal(engine.getState().currentIndex, 1);
  assert.equal(elements.questionNumber.textContent, '02');
  assert.equal(elements.previousButton.disabled, false);

  const session = JSON.parse(storage.getItem(SESSION_KEY));
  assert.equal(session.subjectId, 'demo');
  assert.equal(session.mode, 'test');
  assert.deepEqual(session.questionTypes, ['fill']);
  assert.equal(session.currentIndex, 1);
  assert.deepEqual(session.questionIds, engine.getState().questions.map((question) => question.id));
  assert.deepEqual(session.directions, engine.getState().questions.map((question) => question.direction));
  assert.deepEqual(session.answers, ['x', '', '', '']);
  assert.equal(typeof session.startedAt, 'number');
  assert.equal(typeof session.savedAt, 'number');

  // 页面离开时落盘（visibilitychange → hidden）。
  context.document.visibilityState = 'hidden';
  context.document.emit('visibilitychange');
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).currentIndex, 1);
  window.emit('beforeunload');
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).currentIndex, 1);

  // 上一题回填答案。
  elements.previousButton.emit('click');
  assert.equal(engine.getState().currentIndex, 0);
  assert.equal(elements.previousButton.disabled, true);
  assert.equal(elements.answerInput.value, 'x');

  // destroy 之后所有监听与定时器都必须失效。
  engine.destroy();
  assert.equal(elements.nextButton.listenerCount('click'), 0);
  assert.equal(elements.answerInput.listenerCount('input'), 0);
  assert.equal(elements.answerInput.listenerCount('keydown'), 0);
  assert.equal(window.listenerCount('beforeunload'), 0);
  elements.answerInput.value = 'y';
  elements.answerInput.emit('input');
  elements.nextButton.emit('click');
  assert.equal(engine.getState().currentIndex, 0, 'destroy 后不得再响应交互');
});

test('createEngine：交卷结算写入记录/错题/掌握度并渲染订正', () => {
  const context = demoEngine();
  const { engine, elements, storage, calls, tick } = context;
  engine.start();

  const total = engine.getState().total;
  for (let index = 0; index < total; index += 1) {
    const answer = index === 0 ? '错误答案' : expectedInput(demoQuestion(engine));
    if (index === total - 1) assert.equal(elements.nextButtonText.textContent, '交卷');
    elements.answerInput.value = answer;
    elements.answerInput.emit('input');
    tick(1000);
    elements.nextButton.emit('click');
  }

  assert.equal(elements.result.hidden, false);
  assert.equal(elements.quiz.hidden, true);
  assert.equal(elements.testMeta.hidden, true);
  assert.equal(elements.scoreValue.textContent, '75');
  assert.equal(elements.accuracyValue.textContent, '75%');
  assert.equal(elements.correctValue.textContent, '3 / 4');
  assert.equal(elements.durationValue.textContent, '00:04');
  assert.equal(elements.comparisonLabel.textContent, '对比上一次');
  assert.equal(elements.accuracyComparison.textContent, '正确率 +25%');
  assert.equal(elements.timeComparison.textContent, '用时快 00:02');

  const wrongQuestion = engine.getState().questions[0];
  const wrongItem = DEMO_ITEMS.find((item) => item.id === wrongQuestion.id);
  assert.equal(elements.correctionTitle.textContent, '错题回顾 · 1 题');
  assert.equal(elements.correctionList.children.length, 1);
  const row = elements.correctionList.children[0];
  assert.equal(row.className, 'correction-row');
  assert.equal(row.children.length, 3);
  assert.equal(row.children[0].className, 'correction-index');
  assert.equal(row.children[0].textContent, '01');
  assert.equal(row.children[1].className, 'correction-equation');
  assert.equal(row.children[1].children[0].textContent, `${wrongItem.front} = ${wrongItem.back}`);
  assert.equal(row.children[1].children[1].textContent, '演示');
  assert.equal(row.children[2].className, 'wrong-answer');
  assert.equal(row.children[2].children[0].textContent, '你的答案');
  assert.equal(row.children[2].children[1].textContent, '错误答案');

  const result = calls.find((call) => call.name === 'saveResult');
  assert.equal(result.subjectId, 'demo');
  assert.deepEqual(
    { accuracy: result.metrics.accuracy, correct: result.metrics.correct, total: result.metrics.total, mode: result.metrics.mode },
    { accuracy: 75, correct: 3, total: 4, mode: 'test' }
  );

  const mistakes = calls.find((call) => call.name === 'saveMistakes');
  assert.equal(mistakes.subjectId, 'demo');
  assert.equal(mistakes.mistakes.length, 1);
  assert.equal(mistakes.mistakes[0].id, `demo:${engine.getState().questions[0].id}`);
  assert.equal(mistakes.mistakes[0].subjectId, 'demo');
  assert.equal(mistakes.mistakes[0].itemId, engine.getState().questions[0].id);
  assert.equal(mistakes.mistakes[0].direction, engine.getState().questions[0].direction);
  assert.equal(mistakes.mistakes[0].question, wrongItem.front);
  assert.equal(mistakes.mistakes[0].answer, wrongItem.back);

  const outcomes = calls.find((call) => call.name === 'recordOutcomes');
  assert.equal(outcomes.outcomes.length, 4);
  assert.equal(outcomes.outcomes.filter((outcome) => outcome.correct).length, 3);
  assert.equal(outcomes.meta.mode, 'test');
  assert.ok(calls.some((call) => call.name === 'touchStreak'), '交卷必须打卡');
  assert.equal(storage.getItem(SESSION_KEY), null, '交卷后必须清空存档');
  assert.equal(engine.getState().session, false);
  assert.equal(engine.getState().finished, true);
});

test('createEngine：全对时渲染满分文案，错题集写入空数组', () => {
  const context = demoEngine();
  const { engine, elements, calls } = context;
  engine.start();
  for (let index = 0; index < 4; index += 1) {
    elements.answerInput.value = expectedInput(demoQuestion(engine));
    elements.answerInput.emit('input');
    elements.nextButton.emit('click');
  }
  assert.equal(elements.scoreValue.textContent, '100');
  assert.equal(elements.correctValue.textContent, '4 / 4');
  assert.equal(elements.correctionTitle.textContent, '全部答对');
  assert.equal(elements.correctionList.children.length, 1);
  const perfect = elements.correctionList.children[0];
  assert.equal(perfect.className, 'perfect-result');
  assert.equal(perfect.children[0].textContent, '全部正确');
  assert.equal(perfect.children[1].textContent, '再来一轮');
  assert.deepEqual(calls.find((call) => call.name === 'saveMistakes').mistakes, []);
});

test('createEngine：错题重练模式(mode=mistakes)不写错题集，只交回结果', () => {
  const storage = createFakeStorage();
  const dom = createStubDom();
  const outcomes = [];
  const finished = [];
  const engine = createEngine({
    adapter: demoAdapter,
    subject: { id: 'demo', questionTypes: ['fill'] },
    elements: dom.elements,
    document: dom.document,
    window: createStubWindow(),
    storage,
    mode: 'mistakes',
    random: seededRandom(9),
    now: () => 1_000_000,
    store: {
      readSession: () => null,
      saveSession: () => {},
      clearSession: () => {},
      saveResult: (subjectId, metrics) => ({ record: { id: 'record-mistakes', ...metrics }, previous: null }),
      compare: () => null,
      saveMistakes: () => {
        throw new Error('错题重练模式不得往错题集里添错题');
      },
      recordOutcomes: (subjectId, list, meta) => outcomes.push({ subjectId, list, meta })
    },
    onFinish: (payload) => finished.push(payload)
  });

  assert.equal(engine.getState().mode, 'mistakes');
  engine.start();
  for (let index = 0; index < 4; index += 1) {
    dom.elements.answerInput.value = expectedInput(demoQuestion(engine));
    dom.elements.answerInput.emit('input');
    dom.elements.nextButton.emit('click');
  }

  assert.equal(dom.elements.correctionTitle.textContent, '全部答对');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].meta.mode, 'mistakes');
  assert.equal(outcomes[0].list.length, 4);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].results.length, 4);
  assert.equal(finished[0].record.total, 4);
  assert.equal(finished[0].record.mode, 'mistakes');
  assert.equal(storage.getItem(SESSION_KEY), null);
});

test('createEngine：session 存档可恢复，题库变化时作废重来', () => {
  const storage = createFakeStorage({
    [SESSION_KEY]: JSON.stringify({
      subjectId: 'demo',
      mode: 'test',
      questionTypes: ['fill'],
      questionIds: DEMO_ITEMS.map((item) => item.id),
      directions: ['forward', 'backward', 'forward', 'backward'],
      answers: ['1', 'B', '', ''],
      currentIndex: 2,
      startedAt: 1_000_000,
      savedAt: 1_000_500
    })
  });
  const dom = createStubDom();
  const engine = createEngine({
    adapter: demoAdapter,
    subject: { id: 'demo', questionTypes: ['fill'] },
    elements: dom.elements,
    document: dom.document,
    window: createStubWindow(),
    storage,
    random: seededRandom(2),
    now: () => 1_002_000
  });

  assert.equal(engine.hasSession(), true);
  assert.equal(engine.getState().screen, 'welcome', 'createEngine 本身不得自动跳屏');
  engine.resume();
  const state = engine.getState();
  assert.equal(state.total, 4);
  assert.equal(state.currentIndex, 2);
  assert.deepEqual(state.questions.map((question) => question.direction), ['forward', 'backward', 'forward', 'backward']);
  assert.equal(state.questions[0].answer, '1');
  assert.equal(state.questions[1].answer, 'B');
  assert.equal(dom.elements.quiz.hidden, false);
  assert.equal(dom.elements.questionNumber.textContent, '03');

  // 不属于本页科目 / 本轮模式的存档必须被忽略。
  storage.setItem(SESSION_KEY, JSON.stringify({ subjectId: 'other', mode: 'test', questionIds: ['a'], directions: ['forward'], answers: [''], currentIndex: 0 }));
  assert.equal(engine.hasSession(), false);
  engine.resume();
  assert.equal(engine.getState().currentIndex, 0);
  assert.equal(engine.getState().total, 4);

  // questionIds 与当前题库对不上 → 作废存档后重新开始。
  storage.setItem(SESSION_KEY, JSON.stringify({
    subjectId: 'demo',
    mode: 'test',
    questionIds: ['ghost-a', 'ghost-b'],
    directions: ['forward', 'backward'],
    answers: ['', ''],
    currentIndex: 1,
    startedAt: 1_000_000,
    savedAt: 1_000_500
  }));
  const second = createEngine({
    adapter: demoAdapter,
    subject: { id: 'demo', questionTypes: ['fill'] },
    elements: dom.elements,
    document: dom.document,
    window: createStubWindow(),
    storage,
    random: seededRandom(2),
    now: () => 1_002_000
  });
  second.resume();
  assert.equal(second.getState().currentIndex, 0);
  assert.equal(second.getState().total, 4);
  assert.equal(storage.getItem(SESSION_KEY), null);

  // restoreSession: false 时完全不读存档。
  storage.setItem(SESSION_KEY, JSON.stringify({
    subjectId: 'demo',
    mode: 'test',
    questionIds: DEMO_ITEMS.map((item) => item.id),
    directions: ['forward', 'backward', 'forward', 'backward'],
    answers: ['', '', '', ''],
    currentIndex: 1,
    startedAt: 1_000_000,
    savedAt: 1_000_500
  }));
  const third = createEngine({
    adapter: demoAdapter,
    subject: { id: 'demo', questionTypes: ['fill'] },
    elements: dom.elements,
    document: dom.document,
    window: createStubWindow(),
    storage,
    restoreSession: false,
    random: seededRandom(2),
    now: () => 1_002_000
  });
  assert.equal(third.hasSession(), false);
});

test('默认持久化端口：percent 端到端仍写 v1 兼容键，且空题库不炸', () => {
  const storage = createFakeStorage();
  const dom = createStubDom();
  let clock = 1_000_000;
  const engine = createEngine({
    adapter: percentAdapter,
    subject: { id: 'percent', questionTypes: ['fill'] },
    elements: dom.elements,
    document: dom.document,
    window: createStubWindow(),
    storage,
    random: seededRandom(11),
    now: () => clock
  });

  engine.start();
  assert.equal(engine.getState().total, 30);
  const percentById = new Map(percentAdapter.items().map((item) => [item.id, item]));
  for (let index = 0; index < 30; index += 1) {
    const current = engine.getState().questions[engine.getState().currentIndex];
    const question = { ...percentById.get(current.id), direction: current.direction };
    // 与浏览器 smoke 完全一致的作答方式：分数题只填分母。
    const input = question.direction === 'forward' ? question.raw.fraction.slice(2) : question.raw.percent;
    assert.equal(percentAdapter.isCorrect(question, { direction: question.direction, input }), true);
    dom.elements.answerInput.value = input;
    dom.elements.answerInput.emit('input');
    clock += 1000;
    dom.elements.nextButton.emit('click');
  }

  assert.equal(dom.elements.scoreValue.textContent, '100');
  assert.equal(dom.elements.correctValue.textContent, '30 / 30');
  assert.equal(dom.elements.correctionTitle.textContent, '全部答对');
  assert.equal(dom.elements.comparisonLabel.textContent, '首次记录');
  assert.equal(storage.getItem(SESSION_KEY), null);

  const history = JSON.parse(storage.getItem(LEGACY_HISTORY_KEY));
  assert.equal(history.length, 1);
  assert.equal(history[0].quizType, 'percent');
  assert.equal(history[0].accuracy, 100);
  assert.equal(history[0].correct, 30);
  assert.equal(history[0].total, 30);
  // 通过 v1 兼容外观再确认一次（history.js 的冻结签名）。
  assert.equal(historyForType('percent', storage).length, 1);
  assert.equal(mistakesForType('percent', storage).length, 0, '全对时不得写入错题');
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_MISTAKES_KEY) ?? '[]'), []);

  // 空题库：留在欢迎页，不抛异常。
  const empty = createStubDom();
  const emptyEngine = createEngine({
    adapter: { id: 'empty', items: () => [], isCorrect: () => true },
    subject: { id: 'empty' },
    elements: empty.elements,
    document: empty.document,
    window: createStubWindow(),
    storage: createFakeStorage()
  });
  emptyEngine.start();
  assert.equal(emptyEngine.getState().total, 0);
  assert.equal(empty.elements.welcome.hidden, false);
  assert.equal(empty.elements.quiz.hidden, true);
});

// ══════════════════════════════════════════════════════════════════════
// 选择题模式（task-4 / 契约第 5 节）
//
// 这一节用一套更完整的 DOM 替身：选择题要往 #choice-list 里 createElement + append，
// 还要读 dataset.choiceIndex 识别点中的是哪一项，因此替身必须带 dataset /
// setAttribute / parentElement（真实 DOM 天然具备，上面的极简替身没有）。
// ══════════════════════════════════════════════════════════════════════

/** 带 dataset / 属性 / 父子关系的元素替身。 */
function createChoiceElement() {
  const element = createStubElement();
  element.dataset = {};
  element.attributes = {};
  element.setAttribute = (name, value) => { element.attributes[name] = String(value); };
  element.getAttribute = (name) => (
    Object.prototype.hasOwnProperty.call(element.attributes, name) ? element.attributes[name] : null
  );
  element.parentElement = null;
  const baseAppend = element.append;
  element.append = (...nodes) => {
    baseAppend(...nodes);
    for (const node of nodes) if (node && typeof node === 'object') node.parentElement = element;
  };
  const baseReplace = element.replaceChildren;
  element.replaceChildren = (...nodes) => {
    for (const node of element.children) if (node && typeof node === 'object') node.parentElement = null;
    baseReplace(...nodes);
    for (const node of nodes) if (node && typeof node === 'object') node.parentElement = element;
  };
  return element;
}

function createChoiceDom() {
  const elements = {};
  for (const key of Object.keys(ELEMENT_IDS)) elements[key] = createChoiceElement();
  elements.quiz.hidden = true;
  elements.result.hidden = true;
  elements.testMeta.hidden = true;
  const document = createChoiceElement();
  document.visibilityState = 'visible';
  document.createElement = () => createChoiceElement();
  return { elements, document };
}

/** 造一个 N 条的演示题库（front = 词N，back = 数N，同一 tags）。 */
function makeDemoItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    front: `词${index}`,
    back: `数${index}`,
    tags: ['批量'],
    raw: { front: `词${index}`, back: `数${index}` }
  }));
}

/** 与 demoAdapter 同构、但题库可换的适配器。 */
function adapterOf(items) {
  return { ...demoAdapter, items: () => items };
}

function choiceEngine(overrides = {}) {
  const dom = overrides.dom ?? createChoiceDom();
  const storage = overrides.storage ?? createFakeStorage();
  const window = createStubWindow();
  let clock = 1_000_000;
  const calls = [];
  const adapter = overrides.adapter ?? demoAdapter;
  const questionTypes = overrides.questionTypes ?? ['fill', 'choice'];
  const elements = overrides.elements ?? dom.elements;
  const engine = createEngine({
    adapter,
    subject: { id: overrides.subjectId ?? 'demo', questionTypes },
    elements,
    document: dom.document,
    window,
    storage,
    mode: overrides.mode,
    questionTypes,
    choiceRatio: overrides.choiceRatio ?? 1,
    choicesPerQuestion: overrides.choicesPerQuestion ?? 4,
    random: seededRandom(overrides.seed ?? 3),
    now: () => clock,
    store: overrides.store ?? {
      saveResult: (subjectId, metrics) => {
        calls.push({ name: 'saveResult', subjectId, metrics });
        return { record: { id: 'record-choice', ...metrics }, previous: null };
      },
      compare: () => null,
      saveMistakes: (subjectId, mistakes) => {
        calls.push({ name: 'saveMistakes', subjectId, mistakes });
        return mistakes;
      },
      readSession: () => JSON.parse(storage.getItem(SESSION_KEY) ?? 'null'),
      saveSession: (session) => storage.setItem(SESSION_KEY, JSON.stringify(session)),
      clearSession: () => storage.removeItem(SESSION_KEY),
      recordOutcomes: (subjectId, outcomes) => calls.push({ name: 'recordOutcomes', subjectId, outcomes }),
      touchStreak: () => calls.push({ name: 'touchStreak' })
    }
  });
  return {
    engine,
    elements: dom.elements,
    document: dom.document,
    window,
    storage,
    calls,
    adapter,
    tick: (milliseconds) => { clock += milliseconds; }
  };
}

/** 选项文案（不含字母标号那一层）。 */
function optionTexts(choices) {
  return choices.children.map((option) => option.children[1]?.textContent ?? '');
}

/** 在选项上派发一次点击（真实页面里事件从按钮冒泡到容器）。 */
function clickOption(choices, index) {
  const option = choices.children[index];
  assert.ok(option, `第 ${index} 个选项不存在（共 ${choices.children.length} 个）`);
  choices.emit('click', { target: option });
  return option;
}

test('createEngine：choice 题型点选项即作答、正确判分、走完可交卷', () => {
  const context = choiceEngine({ seed: 21 });
  const { engine, elements } = context;
  engine.start();

  assert.equal(engine.getState().total, 4);
  assert.equal(engine.getState().choiceEnabled, true, '页面有选项容器且科目声明 choice');
  assert.ok(engine.getState().questions.every((question) => question.type === 'choice'),
    'choiceRatio = 1 时全部题目都应是选择题');
  assert.equal(engine.getState().questions[0].choiceCount, 4);

  // 选择题渲染：选项区可见、输入框与等号收起、题面切单列。
  assert.equal(elements.choiceBlock.hidden, false);
  assert.equal(elements.choices.children.length, 4);
  assert.equal(elements.choices.children[0].className, 'choice-option');
  assert.equal(elements.choices.children[0].dataset.choiceIndex, '0');
  assert.equal(elements.choices.children[3].dataset.choiceIndex, '3');
  assert.equal(elements.choices.children[0].children[0].textContent, 'A');
  assert.equal(elements.answerInput.disabled, true, '选择题不该还能打字');
  assert.equal(elements.answerWrap.hidden, true);
  assert.equal(elements.equationOperator.hidden, true);
  assert.equal(elements.equation.classList.contains('choice-equation'), true);
  assert.equal(elements.nextButton.disabled, true, '未选选项时下一题必须禁用');
  assert.equal(elements.sidebarTip.textContent, '点击选项作答，选中后点「下一题」继续。',
    '选择题的侧栏提示不得再让用户「输入答案后按回车」');

  const total = engine.getState().total;
  const picks = [];
  for (let index = 0; index < total; index += 1) {
    const question = engine.getState().questions[index];
    const texts = optionTexts(elements.choices);
    assert.equal(texts.length, 4);
    assert.equal(new Set(texts).size, 4, '选项不得重复');
    const item = DEMO_ITEMS.find((candidate) => candidate.id === question.id);
    const expected = question.direction === 'forward' ? item.back : item.front;
    const prompt = question.direction === 'forward' ? item.front : item.back;
    assert.ok(!texts.includes(prompt), `选项里不得出现题面：${prompt}`);

    // 第 0 题故意选错，其余选对：验证判分走的是适配器，而不是「点了就算对」。
    const correctIndex = texts.indexOf(expected);
    const pickIndex = index === 0 ? (correctIndex + 1) % texts.length : correctIndex;
    picks.push(texts[pickIndex]);
    if (index === total - 1) assert.equal(elements.nextButtonText.textContent, '交卷');
    clickOption(elements.choices, pickIndex);

    assert.equal(elements.nextButton.disabled, false, '选中后必须解开下一题');
    assert.equal(engine.getState().questions[index].answer, texts[pickIndex]);
    // 重渲染后选中项必须带 is-selected（用户能看到自己选了什么）。
    assert.equal(elements.choices.children[pickIndex].classList.contains('is-selected'), true);

    // 切题时引擎会同步一次输入框：选择题必须无视它，否则已选答案会被清空。
    elements.answerInput.value = 'zzz';
    elements.nextButton.emit('click');
    assert.equal(engine.getState().questions[index].answer, texts[pickIndex],
      '输入框内容不得覆盖已选选项');
  }

  assert.equal(elements.result.hidden, false);
  assert.equal(elements.scoreValue.textContent, '75');
  assert.equal(elements.accuracyValue.textContent, '75%');
  assert.equal(elements.correctValue.textContent, '3 / 4');
  assert.equal(elements.correctionTitle.textContent, '错题回顾 · 1 题');
  assert.equal(elements.correctionList.children.length, 1);
  assert.equal(elements.correctionList.children[0].children[2].children[1].textContent, picks[0],
    '订正行里的「你的答案」应显示用户选中的那个选项');
  assert.equal(context.calls.find((call) => call.name === 'saveMistakes').mistakes.length, 1);
  assert.equal(context.calls.find((call) => call.name === 'recordOutcomes').outcomes.length, 4);
  assert.equal(engine.getState().session, false, '交卷后存档必须清空');
});

test('createEngine：选项容器缺失（percent / powers 那种页面）时题目降级为填空', () => {
  const dom = createStubDom();
  dom.elements.choices = null;
  dom.elements.choiceBlock = null;
  const context = choiceEngine({
    dom,
    elements: dom.elements,
    questionTypes: ['fill', 'choice'],
    choiceRatio: 1,
    seed: 22
  });
  const { engine, elements } = context;

  assert.equal(engine.getState().choiceEnabled, false, '缺少选项容器时选择题必须整体关闭');
  engine.start();
  assert.equal(engine.getState().total, 4);
  assert.ok(engine.getState().questions.every((question) => question.type === 'fill'),
    '没有选项容器时不得出选择题');
  assert.ok(engine.getState().questions.every((question) => question.choiceCount === 0));

  // 走的是填空路径：输入框可用、答案从输入框读取。
  assert.equal(elements.answerInput.disabled, false);
  assert.equal(elements.answerInput.hidden, false);
  // 没有选项容器时不碰侧栏（percent / powers 的 DOM 一个字都不改）。
  assert.notEqual(elements.sidebarTip.textContent, '点击选项作答，选中后点「下一题」继续。',
    '缺容器时不得把侧栏提示改成选择题文案');
  const expected = expectedInput(demoQuestion(engine));
  elements.answerInput.value = expected;
  elements.answerInput.emit('input');
  assert.equal(elements.nextButton.disabled, false);
  elements.nextButton.emit('click');
  assert.equal(engine.getState().currentIndex, 1, '降级后的填空必须能正常推进');
  assert.equal(engine.getState().questions[0].answer, expected);
});

test('createEngine：选项凑不齐 2 个时该题退回填空（不出只有一个选项的题）', () => {
  const solo = [{ id: 'only', front: '唯一', back: '答案', tags: ['单'], raw: { front: '唯一', back: '答案' } }];
  const context = choiceEngine({ adapter: adapterOf(solo), seed: 23 });
  const { engine, elements } = context;

  engine.start();
  assert.equal(engine.getState().total, 1);
  assert.equal(engine.getState().questions[0].type, 'fill', '池子只有 1 条时必须降级为填空');
  assert.equal(engine.getState().questions[0].choiceCount, 0);
  assert.equal(elements.choices.children.length, 0);
  assert.equal(elements.choiceBlock.hidden, true);
  assert.equal(elements.answerInput.disabled, false);
});

test('createEngine：存档恢复后题型与已选选项都还在，且选项顺序不变', () => {
  const storage = createFakeStorage();
  const first = choiceEngine({ storage, seed: 24 });
  first.engine.start();
  assert.equal(first.engine.getState().total, 4);

  const optionTextsBefore = optionTexts(first.elements.choices);
  assert.equal(optionTextsBefore.length, 4);
  // 第 0 题选中第 2 个选项，然后进入第 1 题（切题时才落盘）。
  const picked = optionTextsBefore[1];
  clickOption(first.elements.choices, 1);
  first.elements.nextButton.emit('click');
  assert.equal(first.engine.getState().currentIndex, 1);

  const session = JSON.parse(storage.getItem(SESSION_KEY));
  assert.equal(session.types[0], 'choice', '存档必须记下每题的题型');
  assert.equal(session.types.length, 4);
  assert.equal(session.answers[0], picked, '存档必须记下已选选项');
  assert.deepEqual(session.choices[0], optionTextsBefore, '存档必须记下选项，刷新后顺序不变');

  // 新引擎（模拟刷新页面）+ 同一份存档 → 恢复。
  const second = choiceEngine({ storage, seed: 999 });
  assert.equal(second.engine.hasSession(), true);
  second.engine.resume();
  const state = second.engine.getState();
  assert.equal(state.total, 4);
  assert.equal(state.currentIndex, 1);
  assert.equal(state.questions[0].type, 'choice', '恢复后题型必须还是选择题');
  assert.equal(state.questions[1].type, 'choice');
  assert.equal(state.questions[0].answer, picked, '恢复后已选选项必须还在');
  assert.deepEqual(state.questions.map((question) => question.direction),
    first.engine.getState().questions.map((question) => question.direction));
  // 恢复后落在第 1 题：它的选项必须与存档里第 1 题完全一致（顺序也不变）。
  assert.deepEqual(optionTexts(second.elements.choices), session.choices[1],
    '恢复后当前题的选项应与存档一致（顺序也不变）');
  // 回退到第 0 题：选项仍应一致，且已选项必须保持高亮（答案没丢）。
  second.elements.previousButton.emit('click');
  assert.equal(second.engine.getState().currentIndex, 0);
  assert.deepEqual(optionTexts(second.elements.choices), optionTextsBefore,
    '恢复后回退到已作答的题，选项应与当时一致');
  assert.equal(second.elements.choices.children[1].classList.contains('is-selected'), true,
    '恢复后已选中的选项必须仍然高亮');

  // 老存档（没有 types / choices 两个新增字段）也必须能恢复：只重排题型，不丢答案。
  const legacy = JSON.parse(storage.getItem(SESSION_KEY));
  delete legacy.types;
  delete legacy.choices;
  legacy.currentIndex = 2;
  storage.setItem(SESSION_KEY, JSON.stringify(legacy));
  const third = choiceEngine({ storage, seed: 25 });
  assert.equal(third.engine.hasSession(), true);
  third.engine.resume();
  const legacyState = third.engine.getState();
  assert.equal(legacyState.total, 4);
  assert.equal(legacyState.currentIndex, 2, '老存档必须按存档里的进度恢复');
  assert.equal(legacyState.questions[0].answer, picked, '缺字段的老存档不得丢答案');
  assert.ok(['fill', 'choice'].includes(legacyState.questions[2].type));
  // 题型与选项 DOM 必须自洽：选择题 4 个选项，填空 0 个。
  assert.equal(third.elements.choices.children.length,
    legacyState.questions[2].type === 'choice' ? 4 : 0,
    '恢复后选项 DOM 必须与该题的题型一致');
});

test('createEngine：choiceRatio 控制题型混合比例（0 = 全填空，1 = 全选择）', () => {
  const allFill = choiceEngine({ questionTypes: ['fill', 'choice'], choiceRatio: 0, seed: 31 });
  allFill.engine.start();
  assert.ok(allFill.engine.getState().questions.every((question) => question.type === 'fill'));
  assert.equal(allFill.elements.choices.children.length, 0, '填空题不得残留选项 DOM');
  assert.equal(allFill.elements.choiceBlock.hidden, true);

  const allChoice = choiceEngine({ questionTypes: ['fill', 'choice'], choiceRatio: 1, seed: 31 });
  allChoice.engine.start();
  assert.ok(allChoice.engine.getState().questions.every((question) => question.type === 'choice'));

  // 默认 0.5：大题库下两种题型都出现，且都不缺席。
  const mixed = choiceEngine({
    adapter: adapterOf(makeDemoItems(30)),
    questionTypes: ['fill', 'choice'],
    choiceRatio: 0.5,
    seed: 32
  });
  mixed.engine.start();
  const types = mixed.engine.getState().questions.map((question) => question.type);
  const choiceCount = types.filter((type) => type === 'choice').length;
  assert.equal(types.length, 30);
  assert.ok(choiceCount > 0 && choiceCount < 30, `默认比例应混合两种题型，实际选择题 ${choiceCount}/30`);

  // 科目只声明 fill（percent / powers）时，即使页面有选项容器也绝不出选择题。
  const fillOnly = choiceEngine({ questionTypes: ['fill'], choiceRatio: 1, seed: 33 });
  fillOnly.engine.start();
  assert.ok(fillOnly.engine.getState().questions.every((question) => question.type === 'fill'),
    'questionTypes 不含 choice 时必须全是填空');
  assert.equal(fillOnly.elements.choices.children.length, 0);
  assert.equal(fillOnly.elements.answerInput.disabled, false);
});

