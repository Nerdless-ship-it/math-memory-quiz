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
import { formatDuration, shuffle } from './quiz.js';

/** 中途存档键（契约 3.5 冻结）。 */
export const SESSION_KEY = 'mq:session:v2';

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
  // 可选元素：页面没有时引擎自动跳过。
  answerWrap: '.answer-wrap',
  fractionNumerator: '#fraction-numerator',
  equationOperator: '#equation-operator',
  topicLabel: '#topic-label'
});

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
      savedAt: now()
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

  function renderQuestion() {
    const question = questions[currentIndex];
    if (!question) return;
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
    setText(elements.questionInstruction, view.instruction);
    setText(elements.promptValue, prompt.text);
    if (elements.promptValue && prompt.html) elements.promptValue.innerHTML = prompt.html;
    setText(elements.equationOperator, view.operator);
    if (elements.answerWrap && view.answerWrapClass !== undefined) {
      elements.answerWrap.classList.toggle('fraction-answer', Boolean(view.answerWrapClass));
    }
    // 分数题：固定的 1/ 前缀由适配器给出，用户只填分母，输入框初始为空。
    if (elements.fractionNumerator) {
      elements.fractionNumerator.textContent = prefix;
      elements.fractionNumerator.hidden = !prefix;
    }
    if (elements.answerInput) {
      elements.answerInput.value = displayValue(question.answer ?? '', prefix);
      elements.answerInput.placeholder = hints.placeholder ?? '';
      if (hints.inputMode) elements.answerInput.inputMode = hints.inputMode;
    }
    setText(elements.answerSuffix, hints.suffix ?? '');
    setText(elements.answerLabel, hints.label);
    setText(elements.inputHint, hints.hint);
    if (elements.previousButton) elements.previousButton.disabled = currentIndex === 0;
    if (elements.nextButton) elements.nextButton.disabled = (question.answer ?? '').trim() === '';
    setText(elements.nextButtonText, position === questions.length ? '交卷' : '下一题');

    if (typeof win.requestAnimationFrame === 'function' && elements.answerInput) {
      win.requestAnimationFrame(() => elements.answerInput.focus());
    }
  }

  // ── 答题流程 ──────────────────────────────────────────────────────
  /** input 事件里只更新内存与按钮状态：不做重排、不落盘，避免拖慢连续作答。 */
  function saveCurrentAnswer() {
    const question = questions[currentIndex];
    if (!question) return;
    question.answer = String(elements.answerInput?.value ?? '').trim();
    if (elements.nextButton) elements.nextButton.disabled = question.answer === '';
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
    const rebuilt = [];
    for (let index = 0; index < session.questionIds.length; index += 1) {
      const item = pool.get(session.questionIds[index]);
      if (!item) {
        // 题库变了，旧存档作废：清掉它重新开始，绝不用过期题序答题。
        clearStoredSession();
        return start();
      }
      rebuilt.push({
        ...item,
        direction: session.directions[index] === 'backward' ? 'backward' : 'forward',
        answer: String(session.answers[index] ?? '')
      });
    }

    questions = rebuilt;
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
      elements.correctionList.append(row);
    });
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
        answer: question.answer ?? ''
      }))
    };
  }

  bind();

  return { start, resume, hasSession: () => Boolean(readUsableSession()), destroy, getState };
}
