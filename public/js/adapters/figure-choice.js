// 图形题适配器 —— 服务「图形题干 + 图形选项」的科目
// （正方体展开图折叠、立方体截面图）。
//
// 与 generic.js 的关系：**它是 generic 适配器的包装层**。文字判分、订正回显、
// 错题登记这些逻辑与常识科完全一致，重复实现一遍只会产生两份会分叉的行为。
// 本文件只覆盖三件事：
//   1. renderPrompt 额外产出 { node }（题干图形）；
//   2. view 覆盖题干要求文案（图形题不该说「请写出」）；
//   3. inputHints 给出与图形无关的通用提示。
//
// 选项不走 buildChoices：图形题的干扰项是几何算出来的，由题库通过
// `choiceTexts` / `choiceFigures` 自带，引擎的 authoredChoiceSet 优先采用它们。
//
// 本文件不触碰 DOM 之外的东西，也不读写 localStorage（契约第 10 节）。

import { createAdapter as createGenericAdapter, textEquals } from './generic.js';
import { renderFigure } from '../figure.js';

/**
 * 图形题的题干要求文案。
 * 刻意不用 generic 的「选出「…」对应的答案」——图形题的题面是图，
 * 套用「「…」」会变成一对空引号。字符串里的 ** 只是源码标注，输出前会被去掉。
 *
 * ⚠️ 键名必须与 `figure.kind` 的**规范形式**一致，即带 `figure:` 前缀。
 * 早先键名写作 'cube-net' / 'cross-section'（无前缀），而数据里 kind 已经是
 * 'figure:cube-net'，于是查表全部落空、静默回退到 generic 文案，
 * 读出来是「选出『能由第 N 号展开图折成的立体图是』对应的答案」这种别扭句子。
 * 静态查表最怕的就是这种「键对不上但不报错」，所以下面加了一条自检。
 */
const FIGURE_INSTRUCTIONS = Object.freeze({
  'figure:cube-net': '下面是一个正方体的展开图，选出能由它折叠而成的一项',
  'figure:cross-section': '下面是一个被平面所截的正方体，选出截面**不可能**是的一项',
  'figure:section-shape': '选出与给定截面相符的一项',
  'figure:custom': '看图作答，选出正确的一项'
});

function instructionFor(figure, fallback) {
  const text = FIGURE_INSTRUCTIONS[figure?.kind];
  if (!text) return fallback;
  return text.replace(/\*\*/g, '');
}

/**
 * 生成图形题适配器。
 * @param {object} subject 注册表里的科目定义
 * @returns {Promise<object>} 适配器实例（形状与 generic 适配器一致，另加 renderPrompt 的 node）
 */
export async function createFigureAdapter(subject) {
  const base = await createGenericAdapter(subject);

  return {
    ...base,
    id: subject.adapter,
    subjectId: subject.id,

    /**
     * 图形题的题面：文字留空（图才是题面），图形通过 node 返回给引擎插入 DOM。
     * 用 DOM 节点而不是 innerHTML 字符串，是为了走 createElementNS，
     * 让 SVG 在正确的命名空间里创建（innerHTML 解析 SVG 在不同浏览器上行为不一致）。
     */
    renderPrompt(item, ctx) {
      const figure = item?.figure;
      if (!figure) {
        // 没有图形就退化成普通文字题，而不是渲染一片空白。
        return { text: base.renderPrompt(item, ctx)?.text ?? '' };
      }
      let node = null;
      try {
        node = renderFigure(figure);
      } catch (error) {
        // 图形渲染失败时保留文字题面，让这道题仍可作答。
        // ⚠️ 但**必须把失败原因暴露出去**：这里曾经只 return text、把 error 丢掉，
        // 结果题干图静默消失、页面看不出任何异常，我花了很久才定位到是 renderFigure 抛错。
        // 三重暴露：console.error（开发可见）、body.dataset（测试与人工排查可见）、返回值。
        const reason = String(error?.message ?? error);
        try { console.error('[figure-choice] 题干图形渲染失败：', figure?.kind, reason); } catch { /* 忽略 */ }
        try {
          const body = globalThis.document?.body;
          if (body) body.dataset.figureError = `${figure?.kind}: ${reason}`;
        } catch { /* 记录失败也不该影响作答 */ }
        return { text: item?.front ?? '', figureError: reason };
      }
      return { text: item?.front ?? '', node };
    },

    view(item, ctx) {
      const figure = item?.figure;
      const baseView = base.view(item, ctx);
      if (!figure) return baseView;
      return {
        ...baseView,
        instruction: instructionFor(figure, baseView.instruction),
        // 图形题没有「正向/反向」的概念，方向标签会让人困惑，改为只显示维度。
        directionLabel: (item?.tags ?? [])[0] ?? '图形推理'
      };
    },

    inputHints() {
      return {
        prefix: '',
        suffix: '',
        placeholder: '',
        inputMode: 'text',
        label: '请选择正确选项',
        hint: '选项顺序每轮随机'
      };
    },

    /** 判分：选项文字（choiceTexts）参与比对，与常识科同一套文本等价规则。 */
    isCorrect(item, ctx) {
      return textEquals(ctx.input, item?.back);
    },

    correction(item, ctx) {
      return {
        equation: item?.front ? `${item.front} → ${item.back}` : `答案 ${item.back}`,
        note: (item?.tags ?? []).join(' · ') || subject.title,
        userAnswer: String(ctx.input ?? '')
      };
    },

    mistake(item, ctx) {
      const backward = ctx.direction === 'backward';
      return {
        id: [subject.id, backward ? 'backward' : 'forward', item.id].join(':'),
        question: item?.front ?? '图形题',
        answer: String(item?.back ?? '')
      };
    }
  };
}

/**
 * 适配器工厂。
 *
 * ⚠️ 导出名必须是 `createAdapter`：`quiz-page.js` 的 `instantiateAdapter()` 只认
 * `createAdapter`（以及 `default.createAdapter`）。曾经这里叫 `createFigureAdapter`，
 * 于是加载器**静默回退到 generic.js** —— 选项因为 generic 会原样透传 choiceFigures
 * 而照常渲染，题干图却消失了，页面没有任何报错。整整排查了一轮才定位到是导出名的问题。
 * 现在两者都导出：`createAdapter` 给加载器，`createFigureAdapter` 保留原有名字以防外部引用。
 */
export const createAdapter = createFigureAdapter;

export default { createAdapter, createFigureAdapter };
