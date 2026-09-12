// 通用适配器 —— 服务全部「纯内容」科目（考公常识 8 科）。
//
// 设计目标：新增一个常识科目 = 加一个数据文件 + 注册表加一条，**零新增代码**。
// 因此本适配器被打包进内容模块的匹配规则里，8 个科目共用同一份逻辑。
//
// 两个必须知道的接口事实：
//   1. `items()` 是同步的，但内容模块通过动态 import 加载，所以对外暴露的是
//      `async createAdapter(subject)` 异步工厂（契约 §3.3 把 items() 定义成同步，
//      这里按实测需要偏离，Lead 已确认）。
//   2. 适配器接口以 engine.js 的实际实现为准（view / correction / mistake /
//      perfectMessage），而非契约 §3.3 早期写的 correctionText。
//      engine.js 对缺失方法有默认兜底，但常识科需要自定义这几个方法才有好的题面。
//
// 本文件不得触碰 DOM，不得读写 localStorage（契约第 8 节第 6 条）。

import { contentPath, dimensionLabel, lockedDirection } from '../registry.js';

/**
 * 严格归一化：只消除「书写差异」，不消除「内容差异」。
 *   - 去掉全部空白
 *   - 去掉包裹性标点（书名号、引号、括号）与句末标点
 *   - 全角数字/字母转半角，字母转小写
 * ⚠️ 刻意不做的两件事（早期版本做错了，会误判）：
 *   1. 不剥离前导「第/是/为」。那会把「第三次」错判成「三次」。
 *   2. 不把所有标点统一替换成同一个点。那会让「立春。」与「立春」不相等。
 */
export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[《》〈〉「」『』“”‘’"'`（）()\[\]【】]/g, '')
    .replace(/[。．，、；：！？!?]$/g, '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\uFF21-\uFF3A\uFF41-\uFF5A]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/**
 * 宽松归一化：在严格归一化之上，额外容忍口语化前缀。
 * 仅在严格比较失败后作为第二档使用，避免误判「第三次」这类真实内容。
 */
export function normalizeLoose(value) {
  return normalizeText(value).replace(/^[第是为乃即]/, '');
}

/** 两个答案是否等价（先严格、后宽松）。 */
export function textEquals(left, right) {
  const strictLeft = normalizeText(left);
  const strictRight = normalizeText(right);
  if (strictLeft === strictRight) return true;
  if (!strictLeft || !strictRight) return false;
  return normalizeLoose(left) === normalizeLoose(right);
}

/** 题面与答案：正向用 front 提问、back 作答；反向反之。 */
function promptOf(item, ctx) {
  return ctx.direction === 'backward' ? item.back : item.front;
}

function answerOf(item, ctx) {
  return ctx.direction === 'backward' ? item.front : item.back;
}

/**
 * 通用适配器工厂。
 * @param {object} subject 注册表里的科目定义
 * @returns {Promise<object>} 适配器实例
 */
export async function createAdapter(subject) {
  const path = contentPath(subject);
  if (!path) {
    throw new Error(`科目 ${subject?.id} 没有登记内容模块路径（见 registry.js 的 CONTENT_PATHS）`);
  }

  let items = [];
  let loadError = null;
  try {
    const module = await import(/* @vite-ignore */ path);
    const raw = module.ITEMS;
    if (!Array.isArray(raw)) {
      throw new Error(`内容模块 ${path} 未导出 ITEMS 数组`);
    }
    // 方向锁在此处向引擎声明：引擎的 createQuiz 会保证受锁条目永远不出被锁死之外的方向。
    // 锁按「维度」解析（见 registry.js 的 LOCKED_DIRECTIONS / DIMENSION_LOCKS）：
    // chaodai 的「都城」组必须正向，「huaxue」的「符号释义」组必须反向。
    const lockOf = (item) => lockedDirection(subject.id, item?.tags);
    items = raw.map((item) => {
      const lock = lockOf(item);
      return lock ? { ...item, lockedDirections: [lock] } : item;
    });
  } catch (error) {
    // 内容缺失/损坏时不让整个应用崩掉：降级为空题库，由 UI 显示空状态。
    loadError = error;
    items = [];
  }

  const dimOf = (item) => dimensionLabel(subject.id, item?.tags);

  return {
    id: subject.adapter,
    subjectId: subject.id,
    items: () => items,
    loadError,

    isCorrect(item, ctx) {
      return textEquals(ctx.input, answerOf(item, ctx));
    },

    renderPrompt(item, ctx) {
      return { text: promptOf(item, ctx) };
    },

    /**
     * 引擎侧栏文案。
     * directionLabel 用 tags 派生的维度提示，这是必须的：
     * 「秦」「鼠」「惊蛰」这类文本在不同维度里既是题目又是答案，
     * 不给出「朝代 → 开国君主」「都城 → 朝代」这样的提示，用户无法判断该填什么。
     */
    view(item, ctx) {
      const dim = dimOf(item) || subject.title;
      const backward = ctx.direction === 'backward';
      return {
        directionLabel: backward ? `反向 · ${dim}` : dim,
        instruction: backward
          ? `请写出「${promptOf(item, ctx)}」对应的前一项`
          : `请写出「${promptOf(item, ctx)}」对应的答案`,
        topic: subject.title
      };
    },

    inputHints() {
      return {
        prefix: '',
        suffix: '',
        placeholder: '请输入答案',
        inputMode: 'text',
        label: '请输入答案',
        hint: '只需填写内容，标点与空格可省略'
      };
    },

    correction(item, ctx) {
      return {
        equation: `${promptOf(item, ctx)} = ${answerOf(item, ctx)}`,
        note: dimOf(item) || subject.title,
        userAnswer: String(ctx.input ?? '')
      };
    },

    mistake(item, ctx) {
      const backward = ctx.direction === 'backward';
      return {
        // id 的段数规则与 v1 保持一致，storage.js 的 parseMistakeId 只取前 3 段。
        id: [subject.id, backward ? 'backward' : 'forward', item.id].join(':'),
        question: `${promptOf(item, ctx)} = ?`,
        answer: answerOf(item, ctx)
      };
    },

    perfectMessage() {
      return {
        title: `${items.length} 组全部正确`,
        note: '保持这个速度，再测一次巩固记忆。'
      };
    }
  };
}

export default { createAdapter, normalizeText, normalizeLoose, textEquals };
