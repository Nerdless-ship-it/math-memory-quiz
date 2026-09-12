// powers 科目适配器 —— 把「常数 ↔ 幂值」题库翻译成引擎认识的条目，并保留 v1 判题行为。
//
// 契约（docs/ARCHITECTURE.md 3.3）：纯函数，不触碰 DOM，不读写 localStorage。
// 判题直接复用 powers-quiz.js 的冻结实现 isPowerCorrect（acceptedResults 任一命中即对，
// 容差 1e-7，兼容 `约` 前缀与 `≈ =`），绝不重写。
import { POWER_PAIRS } from '../powers-data.js';
import { correctionEquation, exponentSymbol, isPowerCorrect, powerExpression } from '../powers-quiz.js';

const SUBJECT_ID = 'powers';

// v1 时代的方向取值（错误集 id 形如 powers:base-to-result:square-17），冻结不可改。
const DIRECTION_TAG = Object.freeze({
  forward: 'base-to-result',
  backward: 'result-to-base'
});

const DIRECTION_LABEL = Object.freeze({
  forward: '由常数求幂值',
  backward: '由幂值找常数'
});

function isForward(ctx) {
  return ctx?.direction !== 'backward';
}

function tagOf(ctx) {
  return isForward(ctx) ? DIRECTION_TAG.forward : DIRECTION_TAG.backward;
}

/** 题干要求：平方 / 立方 / 四次幂 在正反向下的措辞不同（逐字沿用 v1）。 */
function instructionFor(pair, forward) {
  if (forward) {
    if (pair.exponent === 2) return '写出这个常数的平方数';
    if (pair.exponent === 3) return '写出这个常数的立方近似值';
    return '写出这个常数的四次幂近似值';
  }
  if (pair.exponent === 2) return '这个平方数对应哪个常数？';
  if (pair.exponent === 3) return '这个立方近似值对应哪个常数？';
  return '这个四次幂近似值对应哪个常数？';
}

export default {
  id: SUBJECT_ID,

  /** 引擎条目：front = `17²`，back = `289`，tags = [topic]（契约 3.4）。 */
  items() {
    return POWER_PAIRS.map((pair) => ({
      id: pair.id,
      front: `${pair.base}${exponentSymbol(pair.exponent)}`,
      back: pair.result,
      tags: [pair.topic],
      raw: pair
    }));
  },

  isCorrect(item, ctx) {
    return isPowerCorrect({
      ...item.raw,
      direction: tagOf(ctx),
      answer: ctx?.input ?? ''
    });
  },

  /** 题面：正向出幂表达式，反向出幂值。 */
  renderPrompt(item, ctx) {
    return { text: isForward(ctx) ? powerExpression(item.raw) : item.raw.result };
  },

  /** 侧栏、题干、等式运算符（≈ 表示近似值）。 */
  view(item, ctx) {
    const forward = isForward(ctx);
    const pair = item.raw;
    return {
      topic: pair.topic,
      directionLabel: forward ? DIRECTION_LABEL.forward : DIRECTION_LABEL.backward,
      instruction: instructionFor(pair, forward),
      operator: pair.approximate ? '≈' : '='
    };
  },

  /**
   * 反向题的目标是常数，但题面里已给出幂次，所以后缀用上标把「求几次方」显式写出来。
   * 正向题留空，提示只写「只需填写数字」，绝不泄露近似值。
   */
  inputHints(item, ctx) {
    const forward = isForward(ctx);
    return {
      prefix: '',
      suffix: forward ? '' : exponentSymbol(item.raw.exponent),
      placeholder: forward ? item.raw.result.replace(/\d/g, '·') : '0',
      inputMode: 'decimal',
      label: forward ? `请输入${item.raw.topic}结果` : '请输入对应常数',
      hint: '只需填写数字'
    };
  },

  /** 订正行：等式复用 powers-quiz.js 的 correctionEquation。 */
  correction(item, ctx) {
    const forward = isForward(ctx);
    return {
      equation: correctionEquation(item.raw),
      note: `${item.raw.topic} · ${forward ? DIRECTION_LABEL.forward : DIRECTION_LABEL.backward}`,
      userAnswer: ctx?.input ?? ''
    };
  },

  /** 错题条目：id 规则与 v1 完全一致。 */
  mistake(item, ctx) {
    const forward = isForward(ctx);
    const pair = item.raw;
    const operator = pair.approximate ? '≈' : '=';
    return {
      id: `${SUBJECT_ID}:${tagOf(ctx)}:${pair.id}`,
      question: forward
        ? `${powerExpression(pair)} ${operator} ?`
        : `${pair.result} ${operator} ?${exponentSymbol(pair.exponent)}`,
      answer: forward ? pair.result : pair.base
    };
  },

  /** 满分文案。 */
  perfectMessage() {
    return { title: '24 组平方与幂次全部正确', note: '保持这个速度，再测一次巩固记忆。' };
  }
};
