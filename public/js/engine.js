// 通用答题引擎 —— app.js / powers-app.js 曾经各自复制一份的 10 个函数，统一到这里。
//
// 设计目标（docs/ARCHITECTURE.md 第 1、4 节）：
//   科目 = 适配器（纯函数，见 js/adapters/*.js）+ 注册表一条配置；引擎不含任何科目知识。
//   新增科目零新增引擎代码：适配器提供题库与判分，引擎负责方向均衡、渲染、计时、
//   会话存档、交卷结算与订正渲染。
//
// 契约第 4 节的导出：createEngine(options) → { start, resume, hasSession, destroy, getState }。
//
// 适配器接口（契约 3.3 的必需项 + 引擎扩展项，全部为纯函数）：
//   id                                   适配器 id
//   items()                              → [{ id, front, back, tags, raw }]
//   isCorrect(item, ctx)                 → boolean，ctx = { direction:'forward'|'backward', input }
//   renderPrompt(item, ctx)              → { text } | { html }            契约 3.3
//   inputHints(item, ctx)                → { prefix, suffix, placeholder, inputMode, label, hint }
//   view(item, ctx)                      → { directionLabel, instruction, topic?, operator?, answerWrapClass? }
//   correction(item, ctx)                → { equation, note, userAnswer }   （取代契约 3.3 的 correctionText）
//   mistake(item, ctx)                   → { id, question, answer }         （写错题集用，id 规则与 v1 一致）
//   perfectMessage()                     → { title, note }                  （全对时的文案）
//
// 持久化端口 options.store（可选，用于集成 storage.js；不传则用下方默认端口）：
//   saveResult(subjectId, metrics)       → { record, previous } | null
//   compare(record, previous)            → 对比结果 | null
//   saveMistakes(subjectId, mistakes)    → 错题数组
//   readSession() / saveSession(s) / clearSession()
//   recordOutcomes(subjectId, outcomes, { mode })   掌握度（可选，storage.js 接入点）
//   touchStreak()                                   打卡（可选）
import { compareRecords, saveMistakes, saveTestResult } from './history.js';
import { buildChoices, MIN_CHOICES, normalizeChoicesPerQuestion } from './distractors.js';
import { renderFigure } from './figure.js';
import { formatDuration, shuffle } from './quiz.js';

/** 中途存档键（契约 3.5 冻结）。 */
export const SESSION_KEY = 'mq:session:v2';

/** 默认的选择题占比（科目同时声明 fill 与 choice 时，每题按此比例随机选题型）。 */
export const DEFAULT_CHOICE_RATIO = 0.5;

/** 课本题型取值（契约 3.1 的 questionTypes）。 */
export const FILL = 'fill';
export const CHOICE = 'choice';

/** 契约第 4 节要求的元素句柄：id 选择器 → options.elements 的键。 */
export const ELEMENT_IDS = Object.freeze({
  welcome: '#welcome-screen',
  quiz: '#quiz-screen',
  result: '#result-screen',
  testMeta: '#test-meta',
  startButton: '#start-button',
  restartButton: '#restart-button',
  previousButton: '#previous-button',
  nextButton: '#next-button',
  nextButtonText: '#next-button-text',
  answerInput: '#answer-input',
  answerSuffix: '#answer-suffix',
  answerLabel: '#answer-label',
  inputHint: '#input-hint',
  promptValue: '#prompt-value',
  questionNumber: '#question-number',
  directionLabel: '#direction-label',
  questionInstruction: '#question-instruction',
  progressFill: '#progress-fill',
  headerProgress: '#header-progress',
  headerTime: '#header-time',
  scoreValue: '#score-value',
  accuracyValue: '#accuracy-value',
  correctValue: '#correct-value',
  durationValue: '#duration-value',
  comparisonLabel: '#comparison-label',
  accuracyComparison: '#accuracy-comparison',
  timeComparison: '#time-comparison',
  correctionTitle: '#correction-title',
  correctionList: '#correction-list',
  // 选择题（契约第 5 节）：只有通用科目页 quiz.html 有这两个节点。
  // percent.html / powers.html 没有，因此 collectElements 会给出 null，
  // 引擎必须容忍缺失并把题目降级为填空——这两个页面的交互要逐字不变。
  choices: '#choice-list',
  choiceBlock: '#choice-block',
  // 题面容器：选择题时用它切到单列布局（把「= 输入框」那一列收掉）。
  equation: '#equation',
  // 侧栏提示：只有通用页有，且只在选择题时改写文案（填空恢复原文）。
  sidebarTip: '#sidebar-tip',
  // 可选元素：页面没有时引擎自动跳过。
  answerWrap: '.answer-wrap',
  fractionNumerator: '#fraction-numerator',
  equationOperator: '#equation-operator',
  topicLabel: '#topic-label'
});

/** 侧栏提示的默认文案（与 quiz.html 的静态文本一致，填空时用）。 */
const FILL_SIDEBAR_TIP = '输入答案后按回车，可直接进入下一题。';
const CHOICE_SIDEBAR_TIP = '点击选项作答，选中后点「下一题」继续。';
/** 选择题时输入框下方那行提示。刻意**不复用**侧栏文案，否则同屏出现两遍同一句话。 */
const CHOICE_HINT = '选项顺序每轮随机';
/**
 * 把「请写出…」改成「选出…」。
 * 适配器的 instruction 是按填空写的（如「请写出「元」对应的答案」），
 * 选择题里保留「请写出」是错的措辞。
 */
function toChoiceInstruction(text) {
  const source = String(text ?? '').trim();
  if (!source) return source;
  return source.replace(/^请?写出/, '选出');
}

/**
 * 长题面的字号分级。
 * 题面字号是 clamp(48px, 6vw, 76px)，只适合「12.5%」这类短题面；
 * 常识科的题面常是整句中文（最长 30+ 字），按 76px 排版会占满整屏、
 * 把选项挤出可视区，并且在 768–1024 的中间宽度会直接撑出横向滚动条。
 * 按字数分三档，实际字号由 quiz.css 的 .long-prompt / .very-long-prompt 控制。
 * 只作用于选择题（CSS 里限定 .choice-equation 之下），填空页不受影响。
 */
function promptLengthClass(text) {
  const length = String(text ?? '').replace(/\s+/g, '').length;
  if (length > 22) return 'very-long-prompt';
  if (length > 12) return 'long-prompt';
  return '';
}

/** 本题可能带过的字号类要先清掉，避免上一题的类残留。 */
function applyPromptLengthClass(element, text) {
  if (!element?.classList) return;
  element.classList.remove('long-prompt', 'very-long-prompt');
  const next = promptLengthClass(text);
  if (next) element.classList.add(next);
}

/** 按 ELEMENT_IDS 批量取 DOM 句柄；缺失的元素为 null（引擎容忍缺失）。 */
export function collectElements(root = globalThis.document) {
  const elements = {};
  if (!root || typeof root.querySelector !== 'function') return elements;
  for (const [key, selector] of Object.entries(ELEMENT_IDS)) {
    elements[key] = root.querySelector(selector) ?? null;
  }
  return elements;
}

/**
 * 一轮测试的题序与方向：条目全用一次，方向数量均衡（前半 forward、后半 backward 后洗牌）。
 * 与 quiz.js 的 createQuiz 是同一套算法，只是方向改用引擎中性取值 forward/backward。
 *
 * 方向锁（item.lockedDirections）：
 *   部分题库的条目只在一个方向上语义成立。最典型的是 chaodai 的「都城」组——
 *   数据里 front = 都城（咸阳）、back = 朝代（秦），正向问「咸阳 → ？秦」很有意义，
 *   反向问「秦 → ？咸阳」则几乎无法作答（同一朝代可有多个都城）。
 *   registry.js 的 lockedDirections 会把这类条目标上 lockedDirections: ['forward']，
 *   本函数保证它们永远不会被分配到被锁死之外的方向。
 *
 *   实现方式：先均衡分配方向，再把落错方向的受锁条目与反向位置（承接它的方向）的
 *   未锁条目对调。若受锁条目数超过反向槽位数，会把多余的受锁条目的方向纠正回锁定方向
 *   （此时方向不再严格均衡——宁可牺牲均衡，也不能出无解题）。
 */
export function createQuiz(items, random = Math.random) {
  const shuffled = shuffle(items, random);
  const total = shuffled.length;
  const midpoint = Math.floor(total / 2);
  const directions = shuffle([
    ...Array(midpoint).fill('forward'),
    ...Array(total - midpoint).fill('backward')
  ], random);

  // 该方向是否可以被受锁条目安全采用：只要存在受锁条目的方向不含 dir 就不安全。
  const canUseDirection = (dir) => shuffled.every((item, index) => (
    directions[index] !== dir
    || !Array.isArray(item?.lockedDirections)
    || item.lockedDirections.length === 0
    || item.lockedDirections.includes(dir)
  ));

  // 第一趟：把落错方向的受锁条目与持有它所需方向的未锁条目对调。
  for (let index = 0; index < total; index += 1) {
    const locked = shuffled[index]?.lockedDirections;
    if (!Array.isArray(locked) || locked.length === 0) continue;
    if (locked.includes(directions[index])) continue;

    const wanted = locked[0];
    const held = directions[index];
    let swapped = false;
    for (let other = 0; other < total; other += 1) {
      if (other === index) continue;
      if (directions[other] !== wanted) continue;
      const otherLocked = shuffled[other]?.lockedDirections;
      // 不要为了修一个锁而破坏另一个锁。
      if (Array.isArray(otherLocked) && otherLocked.length > 0) continue;
      directions[index] = wanted;
      directions[other] = held;
      swapped = true;
      break;
    }
    if (!swapped) directions[index] = wanted; // 槽位不够：宁可方向不均衡，也不出无解题
  }

  // 第二趟：第一趟的兜底纠错可能让方向偏向 forward，用未锁条目尽量拉回均衡。
  if (canUseDirection('backward')) {
    let forwardCount = directions.filter((dir) => dir === 'forward').length;
    let backwardCount = total - forwardCount;
    for (let index = 0; index < total && forwardCount > backwardCount; index += 1) {
      const locked = shuffled[index]?.lockedDirections;
      if (Array.isArray(locked) && locked.length > 0) continue;
      if (directions[index] !== 'forward') continue;
      directions[index] = 'backward';
      forwardCount -= 1;
      backwardCount += 1;
    }
  }

  return shuffled.map((item, index) => ({
    ...item,
    direction: directions[index],
    answer: ''
  }));
}

function pickStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readSessionValue(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const parsed = JSON.parse(storage.getItem(SESSION_KEY) ?? 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionValue(storage, session) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // 存档失败不能影响答题：用户仍在内存里继续这一轮。
  }
}

function clearSessionValue(storage) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // 忽略存储异常。
  }
}

/**
 * 默认持久化端口：成绩与错题走 history.js（v1 兼容外观，task-2 完成后内部转发到 storage.js），
 * 中途存档按契约 3.5 的 mq:session:v2 形状直接读写。
 */
function createDefaultStore(storage) {
  return {
    ...createStorageStore(),
    saveResult(subjectId, metrics) {
      // 第三个参数是 history.js 的后端注入点（默认走 globalThis.localStorage）。
      return saveTestResult(subjectId, metrics, storage ?? undefined);
    },
    compare(record, previous) {
      return compareRecords(record, previous);
    },
    saveMistakes(subjectId, mistakes) {
      return saveMistakes(subjectId, mistakes, storage ?? undefined);
    },
    readSession() {
      return readSessionValue(storage);
    },
    saveSession(session) {
      writeSessionValue(storage, session);
    },
    clearSession() {
      clearSessionValue(storage);
    }
  };
}

/**
 * 真实存储端口：把 storage.js 接到引擎的 store 端口上。
 *
 * 为什么需要它：`createDefaultStore` 只管成绩、错题与存档，不包含
 * recordOutcomes / touchStreak。若不接入这一层，单题掌握度、间隔重复、
 * 连续打卡会**静默失效**——没有报错，只是数据永远是空的，最难发现。
 *
 * 三个刻意的设计：
 *   1. 方法全部在 apply 阶段动态 import。引擎在 app.js / powers-app.js 里是
 *      同步创建的，模块顶层 await 会拖慢首屏，并可能让冻结 e2e 测试在
 *      「点开始按钮」时引擎还没就绪。
 *   2. 每个方法都自己 catch 且**永不 reject**。动态 import 一旦失败就没人接住，
 *      会变成 unhandled rejection，而冻结 e2e 断言 consoleErrors.length === 0。
 *   3. 每个方法都返回 Promise，引擎侧统一是 fire-and-forget，不需要额外改动。
 */
export function createStorageStore() {
  const load = () => import(/* @vite-ignore */ './storage.js').catch(() => null);
  return {
    async recordOutcomes(subjectId, outcomes, options) {
      const storage = await load();
      if (!storage) return undefined;
      try {
        const result = typeof storage.applyOutcomes === 'function'
          ? storage.applyOutcomes(subjectId, outcomes, options)
          : storage.applyMastery?.(subjectId, outcomes, options);
        // 错题重练模式下同一份 outcomes 还要维护 masteredCount，
        // 达到 MISTAKE_MASTERY_THRESHOLD 次连续答对就自动移出错题集（契约 4.4）。
        if (options?.mode === 'mistakes' && typeof storage.recordMistakeOutcome === 'function') {
          for (const outcome of outcomes ?? []) {
            const mistakeId = [subjectId, outcome.direction === 'backward' ? 'backward' : 'forward', outcome.itemId].join(':');
            try { storage.recordMistakeOutcome(mistakeId, Boolean(outcome.correct)); } catch {}
          }
        }
        return result;
      } catch {
        return undefined;
      }
    },
    async touchStreak() {
      const storage = await load();
      if (!storage?.touchStreak) return undefined;
      try { return storage.touchStreak(); } catch { return undefined; }
    }
  };
}

export function createEngine(options = {}) {
  const adapter = options.adapter;
  if (!adapter || typeof adapter.items !== 'function') {
    throw new TypeError('createEngine: options.adapter.items() 是必需的');
  }

  const subject = options.subject ?? { id: adapter.id };
  const subjectId = subject.id ?? adapter.id ?? 'unknown';
  const elements = options.elements ?? {};
  const mode = options.mode === 'mistakes' ? 'mistakes' : 'test';
  const questionTypes = [...(options.questionTypes ?? subject.questionTypes ?? ['fill'])];
  const restoreSession = options.restoreSession !== false;
  const onFinish = typeof options.onFinish === 'function' ? options.onFinish : null;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const win = options.window ?? globalThis.window ?? globalThis;
  const doc = options.document ?? globalThis.document ?? null;
  const storage = pickStorage(options.storage);
  const store = { ...createDefaultStore(storage), ...(options.store ?? {}) };

  // ── 选择题开关（契约第 5 节 + task-4）───────────────────────────────
  // 三个条件同时成立才会出选择题：
  //   1. 科目声明了 'choice'；
  //   2. 页面有选项容器（#choice-list）——percent.html / powers.html 没有；
  //   3. 有可用的 document.createElement（渲染选项按钮）。
  // 任何一条不满足都整体退化为填空：绝不抛错、绝不白屏。
  const choiceContainer = elements.choices ?? null;
  const choiceBlock = elements.choiceBlock ?? choiceContainer;
  const canRenderChoices = Boolean(choiceContainer)
    && Boolean(doc && typeof doc.createElement === 'function');
  const wantsChoice = questionTypes.includes(CHOICE);
  const wantsFill = questionTypes.includes(FILL) || !wantsChoice;
  const choiceRatio = normalizeRatio(options.choiceRatio);
  const choicesPerQuestion = normalizeChoicesPerQuestion(options.choicesPerQuestion);
  // 干扰项的「更大范围」池子：默认就是 adapter.items()；
  // 错题重练时调用方应传全库，避免只有 2 条错题导致选项凑不齐。
  const choicePoolOption = options.choicePool;

  let questions = [];
  let currentIndex = 0;
  let startedAt = 0;
  let elapsed = 0;
  let timerId = 0;
  let finished = false;
  let destroyed = false;

  /** 任何持久化失败都不允许打断答题流程。 */
  function attempt(task) {
    try {
      return task();
    } catch {
      return undefined;
    }
  }

  /** 选择题占比：0 = 全填空，1 = 全选择，越界或非法值回退默认。 */
  function normalizeRatio(value) {
    if (value === null || value === undefined || value === '') return DEFAULT_CHOICE_RATIO;
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_CHOICE_RATIO;
    return Math.min(1, Math.max(0, number));
  }

  /** 干扰项候选池：优先用调用方给的全库，拿不到才退回 adapter.items()。 */
  function choiceCandidatePool() {
    const source = typeof choicePoolOption === 'function' ? attempt(() => choicePoolOption()) : choicePoolOption;
    if (Array.isArray(source) && source.length > 0) return source;
    const own = attempt(() => adapter.items());
    return Array.isArray(own) ? own : [];
  }

  /**
   * 为一道题生成选项；选项不足 2 个（含异常）时返回 null，由调用方降级为填空。
   *
   * 两种来源，按优先级：
   *   1. **条目自带的选项**（`choiceTexts`）：图形题走这条。展开图/截面图的干扰项是
   *      几何上算出来的，必须由题库作者给出，绝不能用文本干扰项生成器替代——
   *      那会产出「一张图 vs 四个文字」这种荒谬的题。
   *   2. 兜底：`buildChoices` 从同科目同维度的其它条目抽文本干扰项（既有常识科走这条）。
   */
  function buildChoiceSet(question, pool) {
    const authored = attempt(() => authoredChoiceSet(question));
    if (authored) return authored;

    const built = attempt(() => buildChoices(question, question.direction, pool ?? choiceCandidatePool(), {
      choicesPerQuestion,
      random
    }));
    if (!built || !Array.isArray(built.choices)) return null;
    if (built.choices.length < MIN_CHOICES) return null;
    if (!Number.isInteger(built.answerIndex) || built.answerIndex < 0) return null;
    return { choices: built.choices, answerIndex: built.answerIndex };
  }

  /**
   * 条目自带选项：`choiceTexts` 是选项文字（判分与订正都用它），
   * `choiceFigures` 与之等长，用于渲染图形选项。
   *
   * 正确项通过 `back` 与 `choiceTexts` 比对确定；比对不中时返回 null 交由兜底逻辑处理，
   * 而不是猜一个下标——猜错会让学生即使选对也被判错。
   */
  function authoredChoiceSet(question) {
    const texts = question?.choiceTexts;
    if (!Array.isArray(texts) || texts.length < MIN_CHOICES) return null;
    const normalized = texts.map((text) => String(text ?? '').trim());
    if (normalized.some((text) => text === '')) return null;
    const answerText = String(question.back ?? '').trim();
    const answerIndex = normalized.indexOf(answerText);
    if (answerIndex < 0) return null;

    const figures = Array.isArray(question.choiceFigures) ? question.choiceFigures : [];
    // 图形数量不匹配时整体放弃自带选项，避免出现「有的选项有图、有的没有」的错位。
    if (figures.length > 0 && figures.length !== normalized.length) return null;

    return { choices: normalized, answerIndex };
  }

  /** 本轮每道题的题型：同时声明两种时按 choiceRatio 随机，只声明一种时就用那一种。 */
  function pickQuestionType() {
    // 科目没声明 choice（percent / powers）一律填空——这一条是冻结 e2e 的命门。
    if (!canRenderChoices || !wantsChoice) return FILL;
    if (!wantsFill) return CHOICE;
    return random() < choiceRatio ? CHOICE : FILL;
  }

  /**
   * 为一轮题目分配题型与选项。
   * 选题型失败（干扰项凑不齐）的题会退回填空——这比出一道只有一个选项的题好。
   */
  function assignTypes(list) {
    const pool = canRenderChoices ? choiceCandidatePool() : [];
    for (const question of list) {
      const type = pickQuestionType();
      question.type = type;
      question.choices = [];
      question.answerIndex = -1;
      if (type !== CHOICE) continue;
      const built = buildChoiceSet(question, pool);
      if (built) {
        question.choices = built.choices;
        question.answerIndex = built.answerIndex;
      } else {
        question.type = FILL;
      }
    }
  }

  /**
   * 取当前题的有效题型，并就地修复缺失的选项。
   *
   * 为什么需要「修复」：选项是随机的，不落进 storage.js 的 normalizeSession 契约里，
   * 存档若被 storage.js 归一化过（它只保留契约字段），choices 会丢，type 还在。
   * 此时按题重建选项，而不是把题目变成无法作答的空白。
   */
  function questionTypeOf(question) {
    if (!question) return FILL;
    if (question.type !== CHOICE || !canRenderChoices) {
      question.type = FILL;
      return FILL;
    }
    if (!Array.isArray(question.choices) || question.choices.length < MIN_CHOICES) {
      const built = buildChoiceSet(question);
      if (!built) {
        question.type = FILL;
        question.choices = [];
        question.answerIndex = -1;
        return FILL;
      }
      question.choices = built.choices;
      question.answerIndex = built.answerIndex;
    }
    return CHOICE;
  }

  function setText(element, text) {
    if (element && text !== undefined && text !== null) element.textContent = text;
  }

  function contextOf(question) {
    return { direction: question.direction, input: question.answer ?? '', mode, subjectId };
  }

  // ── 屏幕与计时 ────────────────────────────────────────────────────
  function switchScreen(active) {
    for (const screen of [elements.welcome, elements.quiz, elements.result]) {
      if (screen) screen.hidden = screen !== active;
    }
    if (elements.testMeta) elements.testMeta.hidden = active !== elements.quiz;
    if (typeof win.scrollTo === 'function') win.scrollTo({ top: 0, behavior: 'instant' });
  }

  function updateTimer() {
    setText(elements.headerTime, formatDuration(now() - startedAt));
  }

  function stopTimer() {
    if (timerId && typeof win.clearInterval === 'function') win.clearInterval(timerId);
    timerId = 0;
  }

  function startTimer() {
    stopTimer();
    setText(elements.headerTime, '00:00');
    if (typeof win.setInterval === 'function') timerId = win.setInterval(updateTimer, 250);
  }

  // ── 中途存档（契约 3.5 / 4.2 / 4.5）────────────────────────────────
  /**
   * 存档形状 = 契约 3.5 的 8 个字段 + 2 个**新增可缺省字段**（选择题用）：
   *   types:   ('fill'|'choice')[]  每道题的题型
   *   choices: string[][]           每道题的选项（填空题为空数组）
   *
   * 为什么是「新增可选」而不是改既有字段：storage.js 的 normalizeSession 会按契约
   * 白名单重建 session，**任何额外字段都会被丢掉**。所以读取端必须容忍这两个字段缺失
   * （见 resume() 的兜底），现有存档与现有字段语义一个都没变：
   *   丢了 types 就按随机重新分配题型；丢了 choices 就按题重建选项（questionTypeOf）。
   */
  function buildSession() {
    return {
      subjectId,
      mode,
      questionTypes,
      questionIds: questions.map((question, index) => question.id ?? String(index)),
      directions: questions.map((question) => question.direction),
      answers: questions.map((question) => question.answer ?? ''),
      currentIndex,
      startedAt,
      savedAt: now(),
      types: questions.map((question) => (question.type === CHOICE ? CHOICE : FILL)),
      choices: questions.map((question) => (Array.isArray(question.choices) ? [...question.choices] : []))
    };
  }

  function persistSession() {
    if (finished || destroyed || questions.length === 0) return;
    attempt(() => store.saveSession(buildSession()));
  }

  function clearStoredSession() {
    attempt(() => store.clearSession());
  }

  /** 只接受属于本页科目、本轮模式且结构完整的存档。 */
  function readUsableSession() {
    if (!restoreSession) return null;
    const session = attempt(() => store.readSession());
    if (!session || typeof session !== 'object') return null;
    if (session.subjectId !== subjectId || (session.mode ?? 'test') !== mode) return null;
    const { questionIds, directions, answers } = session;
    if (!Array.isArray(questionIds) || !Array.isArray(directions) || !Array.isArray(answers)) return null;
    if (questionIds.length === 0 || directions.length !== questionIds.length) return null;
    return session;
  }

  // ── 渲染 ─────────────────────────────────────────────────────────
  function displayValue(answer, prefix) {
    if (prefix && answer.startsWith(prefix)) return answer.slice(prefix.length);
    return answer;
  }

  /**
   * 渲染选项区。
   * - 选择题：把 options 渲染成按钮（点击即选中），并高亮已选项；
   * - 填空 / 页面没有选项容器：清空列表并隐藏整块。
   *
   * ⚠️ 填空时必须把选项**从 DOM 里移除**，不能只 hidden：
   * test/all-subjects-smoke.mjs 用 `document.querySelector('.choice-option')` 判断
   * 当前是不是选择题，hidden 的旧选项仍会被 querySelector 命中，从而点错东西。
   */
  function renderChoiceOptions(question, isChoice) {
    if (!choiceContainer) return null;
    choiceContainer.replaceChildren();
    if (choiceBlock) choiceBlock.hidden = !isChoice;
    if (!isChoice) return null;

    const choices = question.choices ?? [];
    const answer = String(question.answer ?? '').trim();
    const figures = Array.isArray(question.choiceFigures) ? question.choiceFigures : [];
    let selectedOption = null;
    choices.forEach((choice, index) => {
      const option = doc.createElement('button');
      option.type = 'button';
      option.className = 'choice-option';
      // 带图形的选项改成上下结构：图形在上、文字标签在下，纵向排列更好比对图形。
      const figure = figures[index];
      if (figure) {
        option.classList.add('choice-option--figure');
        try {
          const node = renderFigure(figure);
          node.classList.add('choice-option-figure');
          option.append(node);
        } catch (error) {
          // 图形渲染失败绝不留空白：降级为文字标签 + 一处可定位的错误标记，
          // 这样数据错误会立刻暴露，而不是变成一道没有图的图形题。
          const broken = doc.createElement('span');
          broken.className = 'choice-option-figure-broken';
          broken.textContent = '图形错误';
          if (broken.dataset) broken.dataset.figureError = String(error?.message ?? error);
          option.append(broken);
        }
      }
      if (option.dataset) option.dataset.choiceIndex = String(index);
      if (typeof option.setAttribute === 'function') {
        option.setAttribute('data-choice-index', String(index));
      }
      const selected = answer !== '' && answer === choice;
      if (selected) {
        option.classList.add('is-selected');
        if (typeof option.setAttribute === 'function') option.setAttribute('aria-pressed', 'true');
        selectedOption = option;
      }
      // 选项文字用子节点承载：字母标号是装饰，正文才是内容，便于 CSS 分开排版。
      const marker = doc.createElement('span');
      marker.className = 'choice-option-index';
      marker.textContent = String.fromCharCode(65 + index);
      const label = doc.createElement('span');
      label.className = 'choice-option-text';
      label.textContent = choice;
      // 图形选项且正文就是那个字母标号时（题库用 'A'/'B'/'C'/'D' 当判分标签），
      // 会渲染出「A ... A」两遍。此时隐藏重复的正文，只留标号。
      if (figure && label.textContent.trim() === marker.textContent) {
        label.className += ' choice-option-text--duplicate';
        if (label.setAttribute) label.setAttribute('aria-hidden', 'true');
      }
      option.append(marker, label);
      choiceContainer.append(option);
    });
    return selectedOption;
  }

  function renderQuestion() {
    const question = questions[currentIndex];
    if (!question) return;
    const type = questionTypeOf(question);
    const isChoice = type === CHOICE;
    const ctx = contextOf(question);
    const position = currentIndex + 1;
    const view = attempt(() => adapter.view(question, ctx)) ?? {};
    const prompt = attempt(() => adapter.renderPrompt(question, ctx)) ?? {};
    const hints = attempt(() => adapter.inputHints(question, ctx)) ?? {};
    const prefix = hints.prefix ?? '';

    setText(elements.questionNumber, String(position).padStart(2, '0'));
    setText(elements.headerProgress, `${position} / ${questions.length}`);
    if (elements.progressFill) elements.progressFill.style.width = `${(position / questions.length) * 100}%`;
    setText(elements.topicLabel, view.topic);
    setText(elements.directionLabel, view.directionLabel);
    // 题干要求按题型改写：适配器的 instruction 是按填空写的（「请写出「元」对应的答案」），
    // 选择题里保留「请写出」是错的措辞，改成「选出…」。
    setText(elements.questionInstruction, isChoice ? toChoiceInstruction(view.instruction) : view.instruction);
    setText(elements.promptValue, prompt.text);
    if (elements.promptValue && prompt.html) elements.promptValue.innerHTML = prompt.html;
    // 题干图形：适配器通过 renderPrompt 返回 { node } 时插到题面下方。
    // 图形题（figure-choice）走这条；文字题不返回 node，DOM 一个节点都不多。
    if (elements.promptValue) {
      const existing = elements.promptValue.parentElement?.querySelector?.('.prompt-figure');
      if (existing) existing.remove();
      if (prompt.node) {
        const holder = doc.createElement('div');
        holder.className = 'prompt-figure';
        holder.append(prompt.node);
        elements.promptValue.after(holder);
      }
    }
    // 长题面缩字号：只在选择题里生效，且必须在题面写入之后调用（要按实际文本算长度）。
    // 填空题（percent / powers）不调用，其题面样式与字号一字不变。
    if (isChoice) {
      applyPromptLengthClass(elements.promptValue, prompt.text);
    } else if (elements.promptValue?.classList) {
      elements.promptValue.classList.remove('long-prompt', 'very-long-prompt');
    }
    setText(elements.equationOperator, view.operator);
    if (elements.answerWrap && view.answerWrapClass !== undefined) {
      elements.answerWrap.classList.toggle('fraction-answer', Boolean(view.answerWrapClass));
    }
    // 分数题：固定的 1/ 前缀由适配器给出，用户只填分母，输入框初始为空。
    if (elements.fractionNumerator) {
      elements.fractionNumerator.textContent = prefix;
      elements.fractionNumerator.hidden = !prefix;
    }
    // 选择题：收起输入框与等号，题面切单列；填空：原样恢复。
    // 这一整块只在页面真的有选项容器时才执行，percent / powers 的 DOM 一个字都不碰。
    if (choiceContainer) {
      if (elements.answerWrap) elements.answerWrap.hidden = isChoice;
      if (elements.equationOperator) elements.equationOperator.hidden = isChoice;
      if (elements.equation?.classList) elements.equation.classList.toggle('choice-equation', isChoice);
      if (elements.answerInput) elements.answerInput.disabled = isChoice;
      // 侧栏提示跟着题型走：选择题里提示「按回车」会误导（那时根本没有输入框）。
      setText(elements.sidebarTip, isChoice ? CHOICE_SIDEBAR_TIP : FILL_SIDEBAR_TIP);
    }
    // 输入框下方那行提示：**必须无条件设置**。
    // 早先这行写在 `if (choiceContainer)` 里，而 percent.html / powers.html 没有选项容器，
    // 那两页的提示就会一直停留在上一题/静态 HTML 的文案上。
    // 选择题用与侧栏**不同**的文案，否则「点击选项作答…」会在同屏出现两遍。
    setText(elements.inputHint, isChoice ? CHOICE_HINT : (hints.hint ?? ''));
    const selectedOption = renderChoiceOptions(question, isChoice);
    if (elements.answerInput) {
      elements.answerInput.value = isChoice ? '' : displayValue(question.answer ?? '', prefix);
      elements.answerInput.placeholder = isChoice ? '' : (hints.placeholder ?? '');
      if (hints.inputMode) elements.answerInput.inputMode = hints.inputMode;
    }
    setText(elements.answerSuffix, isChoice ? '' : (hints.suffix ?? ''));
    setText(elements.answerLabel, isChoice ? '请选择正确选项' : hints.label);
    // 注意：inputHint 在选择题分支里已按题型设过（见上方 choiceContainer 块）。
    // 这里不要再设一遍——曾经这里写的是「点击一个选项作答，选中后点「下一题」继续」，
    // 与侧栏提示逐字重复，同屏出现两遍同一句话。
    if (elements.previousButton) elements.previousButton.disabled = currentIndex === 0;
    if (elements.nextButton) elements.nextButton.disabled = (question.answer ?? '').trim() === '';
    setText(elements.nextButtonText, position === questions.length ? '交卷' : '下一题');

    if (typeof win.requestAnimationFrame === 'function') {
      if (isChoice) {
        // 选项每次渲染都会重建，焦点必须跟着回到已选项上，否则键盘用户每选一次就丢焦点。
        win.requestAnimationFrame(() => (selectedOption ?? elements.choices)?.focus?.());
      } else if (elements.answerInput) {
        win.requestAnimationFrame(() => elements.answerInput.focus());
      }
    }
  }

  // ── 答题流程 ──────────────────────────────────────────────────────
  /**
   * input 事件里只更新内存与按钮状态：不做重排、不落盘，避免拖慢连续作答。
   *
   * ⚠️ 选择题必须在这里分叉：选择题的答案是「点了哪个选项」，不在输入框里。
   * 若不分支，切题冒泡上来的这次同步会把已选选项覆盖成空串，
   * 于是 goNext() 判定「没作答」直接返回，用户永远走不到下一题。
   */
  function saveCurrentAnswer() {
    const question = questions[currentIndex];
    if (!question) return;
    if (questionTypeOf(question) === CHOICE) {
      if (elements.nextButton) elements.nextButton.disabled = (question.answer ?? '').trim() === '';
      return;
    }
    question.answer = String(elements.answerInput?.value ?? '').trim();
    if (elements.nextButton) elements.nextButton.disabled = question.answer === '';
  }

  /** 从事件目标向上找 data-choice-index（点在选项内部的文字节点上也能命中）。 */
  function choiceIndexOf(node) {
    let current = node;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const raw = current.dataset?.choiceIndex ?? current.getAttribute?.('data-choice-index');
      if (raw !== null && raw !== undefined && raw !== '') {
        const index = Number(raw);
        if (Number.isInteger(index) && index >= 0) return index;
      }
      current = current.parentElement ?? null;
    }
    return -1;
  }

  /**
   * 点选项即作答：记录答案 → 落盘 → 重渲染（高亮选中项并解开「下一题」）。
   * 刻意**不自动跳题**：选中即跳会让用户来不及改，也让「上一题」形同虚设；
   * 与填空一致的节奏（选中 → 下一题）才能让两种题型混排时手感统一。
   */
  function selectChoice(index) {
    const question = questions[currentIndex];
    if (!question || questionTypeOf(question) !== CHOICE) return;
    const value = question.choices?.[index];
    if (typeof value !== 'string' || value === '') return;
    question.answer = value;
    persistSession();
    renderQuestion();
  }

  function onChoiceClick(event) {
    const index = choiceIndexOf(event?.target ?? null);
    if (index >= 0) selectChoice(index);
  }

  function goNext() {
    saveCurrentAnswer();
    if (!questions[currentIndex]?.answer) return;
    if (currentIndex === questions.length - 1) {
      finish();
      return;
    }
    currentIndex += 1;
    persistSession();
    renderQuestion();
  }

  function goPrevious() {
    saveCurrentAnswer();
    if (currentIndex === 0) return;
    currentIndex -= 1;
    persistSession();
    renderQuestion();
  }

  function start() {
    if (destroyed) return getState();
    const pool = adapter.items() ?? [];
    if (pool.length === 0) {
      switchScreen(elements.welcome);
      return getState();
    }
    clearStoredSession();
    questions = createQuiz(pool, random);
    assignTypes(questions);
    currentIndex = 0;
    startedAt = now();
    elapsed = 0;
    finished = false;
    startTimer();
    switchScreen(elements.quiz);
    renderQuestion();
    return getState();
  }

  function resume() {
    if (destroyed) return getState();
    const session = readUsableSession();
    if (!session) return start();

    const pool = new Map((adapter.items() ?? []).map((item, index) => [item.id ?? String(index), item]));
    // 选择题的可选字段：长度对得上才采信，否则下面统一重建（向后兼容的关键）。
    const storedTypes = Array.isArray(session.types) ? session.types : null;
    const storedChoices = Array.isArray(session.choices) ? session.choices : null;
    const rebuilt = [];
    for (let index = 0; index < session.questionIds.length; index += 1) {
      const item = pool.get(session.questionIds[index]);
      if (!item) {
        // 题库变了，旧存档作废：清掉它重新开始，绝不用过期题序答题。
        clearStoredSession();
        return start();
      }
      const stored = storedChoices?.[index];
      rebuilt.push({
        ...item,
        direction: session.directions[index] === 'backward' ? 'backward' : 'forward',
        answer: String(session.answers[index] ?? ''),
        // 缺 types 时留 undefined，交给下面的 assignTypes 重新分配。
        type: storedTypes ? (storedTypes[index] === CHOICE ? CHOICE : FILL) : undefined,
        choices: Array.isArray(stored) ? [...stored] : undefined
      });
    }

    questions = rebuilt;
    // 老存档（没有 types / choices）或存档被 storage.js 归一化过：按当前配置重新分配。
    // 重分配只决定「怎么问」，不动已作答内容，用户不会因此丢答案。
    const typesUsable = Array.isArray(storedTypes) && storedTypes.length === questions.length;
    const choicesUsable = Array.isArray(storedChoices) && storedChoices.length === questions.length;
    if (typesUsable && choicesUsable) {
      for (const question of questions) {
        if (question.type === undefined) question.type = FILL;
      }
    } else {
      assignTypes(questions);
    }
    currentIndex = Math.min(Math.max(0, Number(session.currentIndex) || 0), questions.length - 1);
    startedAt = Number(session.startedAt) || now();
    elapsed = 0;
    finished = false;
    startTimer();
    switchScreen(elements.quiz);
    renderQuestion();
    return getState();
  }

  // ── 交卷结算（契约 4.3 / 4.4）──────────────────────────────────────
  function mistakeEntry(question) {
    const ctx = contextOf(question);
    const described = attempt(() => adapter.mistake(question, ctx)) ?? {};
    const itemId = question.id ?? '';
    const id = described.id ?? [subjectId, question.direction, itemId].join(':');
    return {
      id,
      subjectId,
      itemId: itemId || id,
      direction: question.direction,
      question: described.question ?? question.front ?? '',
      answer: described.answer ?? question.back ?? ''
    };
  }

  function renderComparison(record, previous) {
    const comparison = attempt(() => store.compare(record, previous)) ?? null;
    if (elements.accuracyComparison) elements.accuracyComparison.className = '';
    if (elements.timeComparison) elements.timeComparison.className = '';
    if (!comparison) {
      setText(elements.comparisonLabel, '首次记录');
      setText(elements.accuracyComparison, '本次成绩已保存');
      setText(elements.timeComparison, '下次完成后即可对比');
      return;
    }

    setText(elements.comparisonLabel, '对比上一次');
    if (comparison.accuracyDelta === 0) {
      setText(elements.accuracyComparison, '正确率持平');
    } else {
      const sign = comparison.accuracyDelta > 0 ? '+' : '';
      setText(elements.accuracyComparison, `正确率 ${sign}${comparison.accuracyDelta}%`);
      if (elements.accuracyComparison) {
        elements.accuracyComparison.className = comparison.accuracyDelta > 0 ? 'positive' : 'negative';
      }
    }

    if (Math.abs(comparison.durationDeltaMs) < 1000) {
      setText(elements.timeComparison, '用时持平');
    } else {
      const faster = comparison.durationDeltaMs < 0;
      setText(elements.timeComparison, `用时${faster ? '快' : '慢'} ${formatDuration(Math.abs(comparison.durationDeltaMs))}`);
      if (elements.timeComparison) elements.timeComparison.className = faster ? 'positive' : 'negative';
    }
  }

  function renderCorrections(mistakes) {
    if (!elements.correctionList) return;
    elements.correctionList.replaceChildren();

    if (mistakes.length === 0) {
      setText(elements.correctionTitle, '全部答对');
      const perfect = attempt(() => adapter.perfectMessage()) ?? {};
      const empty = doc.createElement('div');
      empty.className = 'perfect-result';
      const title = doc.createElement('strong');
      title.textContent = perfect.title ?? '';
      const note = doc.createElement('span');
      note.textContent = perfect.note ?? '';
      empty.append(title, note);
      elements.correctionList.append(empty);
      return;
    }

    setText(elements.correctionTitle, `错题回顾 · ${mistakes.length} 题`);
    mistakes.forEach((question, index) => {
      const described = attempt(() => adapter.correction(question, contextOf(question))) ?? {};
      const row = doc.createElement('article');
      row.className = 'correction-row';

      const rowIndex = doc.createElement('span');
      rowIndex.className = 'correction-index';
      rowIndex.textContent = String(index + 1).padStart(2, '0');

      const equation = doc.createElement('div');
      equation.className = 'correction-equation';
      const correctAnswer = doc.createElement('strong');
      correctAnswer.textContent = described.equation ?? `${question.front} = ${question.back}`;
      const note = doc.createElement('span');
      note.textContent = described.note ?? '';
      equation.append(correctAnswer, note);

      const wrongAnswer = doc.createElement('div');
      wrongAnswer.className = 'wrong-answer';
      const wrongLabel = doc.createElement('span');
      wrongLabel.textContent = '你的答案';
      const wrongValue = doc.createElement('del');
      wrongValue.textContent = described.userAnswer ?? question.answer ?? '';
      wrongAnswer.append(wrongLabel, wrongValue);

      row.append(rowIndex, equation, wrongAnswer);

      // 图形题的订正行附一个「演示」按钮：静态图看不出「怎么折过来的 / 怎么切出来的」，
      // 而这恰恰是理解这两类题的关键。按需动态加载动画模块，文字题完全不加载。
      const demo = buildFigureDemo(question);
      if (demo) row.append(demo);

      elements.correctionList.append(row);
    });
  }

  /**
   * 为图形题生成「演示」按钮 + 动画挂载点。非图形题返回 null。
   *
   * 刻意做成**点击后才加载**：动画模块（fold-anim / fold-anim-view）有几十 KB 的
   * 几何与渲染代码，而订正页可能一次列出几十道题——全部预加载会拖慢交卷后的首屏。
   */
  function buildFigureDemo(question) {
    const kind = question?.figure?.kind;
    if (kind !== 'figure:cube-net' && kind !== 'figure:cross-section') return null;

    const wrap = doc.createElement('div');
    wrap.className = 'correction-figure';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'correction-demo';
    button.textContent = kind === 'figure:cube-net' ? '演示展开过程' : '演示切割过程';
    button.addEventListener('click', () => { toggleFigureDemo(wrap, question); });
    wrap.append(button);
    return wrap;
  }

  /** 懒加载并挂载动画；失败时在按钮旁给出原因，不静默。 */
  async function toggleFigureDemo(wrap, question) {
    const kind = question?.figure?.kind;
    if (wrap.dataset.demoMounted === '1') {
      wrap.dataset.demoMounted = '';
      wrap.querySelector('.fold-anim')?.remove();
      wrap.querySelector('.correction-demo').textContent = kind === 'figure:cube-net' ? '演示展开过程' : '演示切割过程';
      return;
    }
    try {
      const module = await import(/* @vite-ignore */ './fold-anim-view.js');
      const mount = module.mountFoldAnimation;
      if (typeof mount !== 'function') throw new Error('fold-anim-view 未导出 mountFoldAnimation');

      let options;
      if (kind === 'figure:cube-net') {
        const cells = question.figure?.spec?.cells;
        options = {
          labels: (cells ?? []).map((_, index) => String(index + 1)),
          note: '从立方体拆开、铺平成展开图（展开图始终正放；立方体可拖动转角度、点面换底）',
          duration: 2600
        };
        const handle = mount(wrap, cells, options);
        handle.play();
      } else {
        // 截面演示：扫动的平面 + 实时截面。用 fold-anim-view 的同一套 3D 投影渲染。
        const spec = question.figure?.spec ?? {};
        const handle = mountCrossSectionDemo(wrap, module, spec);
        handle?.play?.();
      }
      wrap.dataset.demoMounted = '1';
      wrap.querySelector('.correction-demo').textContent = '收起演示';
    } catch (error) {
      const note = doc.createElement('p');
      note.className = 'fold-anim-note';
      note.textContent = `演示加载失败：${error?.message ?? error}`;
      wrap.append(note);
    }
  }

  /** 截面演示：让平面沿法向扫过立方体，实时显示交线多边形。 */
  function mountCrossSectionDemo(wrap, module, spec) {
    const mount = module.mountCrossSectionAnimation;
    if (typeof mount !== 'function') return null;
    return mount(wrap, spec, { duration: 3000, note: '平面扫过立方体的过程，绿色多边形是截面' });
  }

  function finish() {
    if (finished || questions.length === 0) return getState();
    saveCurrentAnswer();
    finished = true;
    elapsed = Math.max(0, now() - startedAt);
    stopTimer();

    const results = questions.map((question) => ({
      ...question,
      correct: Boolean(attempt(() => adapter.isCorrect(question, contextOf(question))))
    }));
    const correctCount = results.filter((result) => result.correct).length;
    const mistakes = results.filter((result) => !result.correct);
    const accuracy = Math.round((correctCount / results.length) * 100);
    const metrics = { accuracy, correct: correctCount, total: results.length, durationMs: elapsed, mode };

    setText(elements.scoreValue, String(accuracy));
    setText(elements.accuracyValue, `${accuracy}%`);
    setText(elements.correctValue, `${correctCount} / ${results.length}`);
    setText(elements.durationValue, formatDuration(elapsed));

    const saved = attempt(() => store.saveResult(subjectId, metrics)) ?? { record: null, previous: null };
    // 错题重练模式不再往错题集里添错题：改由 recordOutcomes 维护 masteredCount（契约 4.4）。
    if (mode !== 'mistakes') {
      attempt(() => store.saveMistakes(subjectId, mistakes.map(mistakeEntry)));
    }
    attempt(() => store.recordOutcomes?.(
      subjectId,
      results.map((result) => ({ itemId: result.id, direction: result.direction, correct: result.correct })),
      { mode }
    ));
    attempt(() => store.touchStreak?.());
    clearStoredSession();

    renderComparison(saved.record ?? { accuracy, durationMs: elapsed }, saved.previous ?? null);
    renderCorrections(mistakes);
    switchScreen(elements.result);
    if (onFinish) attempt(() => onFinish({ record: saved.record, previous: saved.previous, results }));
    return getState();
  }

  // ── 事件绑定：全部句柄集中在这里，destroy() 一一解绑 ────────────────
  const listeners = [];
  function on(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  }

  function onKeydown(event) {
    if (event.key === 'Enter' && elements.nextButton && !elements.nextButton.disabled) goNext();
  }

  function onVisibilityChange() {
    if (!doc || doc.visibilityState === 'hidden') persistSession();
  }

  function bind() {
    on(elements.startButton, 'click', start);
    on(elements.restartButton, 'click', start);
    on(elements.answerInput, 'input', saveCurrentAnswer);
    on(elements.nextButton, 'click', goNext);
    on(elements.previousButton, 'click', goPrevious);
    on(elements.answerInput, 'keydown', onKeydown);
    // 选项用事件委托挂在容器上：选项每次渲染都重建，逐个绑定会泄漏监听。
    on(choiceContainer, 'click', onChoiceClick);
    on(win, 'beforeunload', persistSession);
    on(doc, 'visibilitychange', onVisibilityChange);
  }

  function destroy() {
    stopTimer();
    for (const [target, type, handler] of listeners.splice(0)) {
      target.removeEventListener?.(type, handler);
    }
    destroyed = true;
  }

  /** 只读调试快照：不含 DOM 引用，可安全 JSON.stringify。 */
  function getState() {
    const screen = elements.quiz && !elements.quiz.hidden
      ? 'quiz'
      : elements.result && !elements.result.hidden ? 'result' : 'welcome';
    return {
      subjectId,
      mode,
      questionTypes: [...questionTypes],
      choiceEnabled: canRenderChoices,
      screen,
      currentIndex,
      total: questions.length,
      startedAt,
      elapsed,
      finished,
      session: Boolean(readUsableSession()),
      questions: questions.map((question) => ({
        id: question.id,
        direction: question.direction,
        answer: question.answer ?? '',
        // 题型与选项**数量**（不暴露答案下标，避免调试快照泄露正确答案）。
        type: question.type === CHOICE ? CHOICE : FILL,
        choiceCount: Array.isArray(question.choices) ? question.choices.length : 0
      }))
    };
  }

  bind();

  return { start, resume, hasSession: () => Boolean(readUsableSession()), destroy, getState };
}
