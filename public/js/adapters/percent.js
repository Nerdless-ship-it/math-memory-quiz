// percent 科目适配器 —— 把「百分数 ↔ 分数」题库翻译成引擎认识的条目，并保留 v1 判题行为。
//
// 契约（docs/ARCHITECTURE.md 3.3）：纯函数，不触碰 DOM，不读写 localStorage。
// 判题直接复用 quiz.js 的冻结实现，绝不重写：
//   forward ：用户只填分母，quiz.js 的 isCorrect 用 fractionFromDenominator 归一化后
//             比较 1/<分母> 与 item.fraction，因此 ctx.input 传「用户原样输入」即可。
//   backward：数值比较，容差 1e-6（由 quiz.js 保证）。
import { PAIRS } from '../data.js';
import { fractionFromDenominator, isCorrect } from '../quiz.js';

const SUBJECT_ID = 'percent';

// v1 时代的方向取值（错误集 id 形如 percent:percent-to-fraction:12.5），冻结不可改，
// 否则旧用户 localStorage 里的错题无法与新存档对上。
const DIRECTION_TAG = Object.freeze({
  forward: 'percent-to-fraction',
  backward: 'fraction-to-percent'
});

const DIRECTION_LABEL = Object.freeze({
  forward: '百分数转分数',
  backward: '分数转百分数'
});

function isForward(ctx) {
  return ctx?.direction !== 'backward';
}

function tagOf(ctx) {
  return isForward(ctx) ? DIRECTION_TAG.forward : DIRECTION_TAG.backward;
}

/** 输入框前后缀与提示：分数题有固定 `1/` 前缀，用户只填分母。 */
function hintsFor(forward) {
  if (forward) {
    return {
      prefix: '1/',
      suffix: '',
      placeholder: '…',
      inputMode: 'decimal',
      label: '请输入对应分数的分母',
      hint: '只填写分母'
    };
  }
  return {
    prefix: '',
    suffix: '%',
    placeholder: '0',
    inputMode: 'decimal',
    label: '请输入对应百分数',
    hint: '只需填写数字，百分号可省略'
  };
}

export default {
  id: SUBJECT_ID,

  /** 引擎条目：front = `12.5%`，back = `1/8`，raw 保留原始 pair 供判分使用（契约 3.4）。 */
  items() {
    return PAIRS.map((pair) => ({
      id: pair.percent,
      front: `${pair.percent}%`,
      back: pair.fraction,
      tags: ['速算'],
      raw: pair
    }));
  },

  isCorrect(item, ctx) {
    return isCorrect({
      direction: tagOf(ctx),
      answer: ctx?.input ?? '',
      percent: item.raw.percent,
      fraction: item.raw.fraction
    });
  },

  /** 题面：正向出百分数，反向出分数。 */
  renderPrompt(item, ctx) {
    return { text: isForward(ctx) ? `${item.raw.percent}%` : item.raw.fraction };
  },

  /** 侧栏与题干文案、答案框变体（分数题需要 `fraction-answer` 固定 1/ 前缀）。 */
  view(item, ctx) {
    const forward = isForward(ctx);
    return {
      directionLabel: forward ? DIRECTION_LABEL.forward : DIRECTION_LABEL.backward,
      instruction: forward ? '写出对应的分数' : '写出对应的百分数',
      answerWrapClass: forward
    };
  },

  inputHints(item, ctx) {
    return hintsFor(isForward(ctx));
  },

  /** 订正行：等式、方向说明、用户原答案。 */
  correction(item, ctx) {
    const forward = isForward(ctx);
    const { percent, fraction } = item.raw;
    const input = ctx?.input ?? '';
    return {
      equation: forward ? `${percent}% = ${fraction}` : `${fraction} = ${percent}%`,
      note: forward ? DIRECTION_LABEL.forward : DIRECTION_LABEL.backward,
      // 分数题把用户填的分母还原成完整分数展示；百分数题补回百分号。
      userAnswer: forward ? fractionFromDenominator(input) : `${input.replace(/[％%]/g, '')}%`
    };
  },

  /** 错题条目：id 规则与 v1 完全一致，保证旧错题集可复用。 */
  mistake(item, ctx) {
    const forward = isForward(ctx);
    const { percent, fraction } = item.raw;
    return {
      id: `${SUBJECT_ID}:${tagOf(ctx)}:${percent}`,
      question: forward ? `${percent}% = ?` : `${fraction} = ?%`,
      answer: forward ? fraction : `${percent}%`
    };
  },

  /** 满分文案。 */
  perfectMessage() {
    return { title: '30 组换算全部正确', note: '保持这个速度，再测一次巩固记忆。' };
  }
};
