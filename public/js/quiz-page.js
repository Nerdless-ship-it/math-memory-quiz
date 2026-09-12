// 通用答题页控制器（public/quiz.html 专用）。
//
// 职责边界：
//   1. 从 ?subject=<id> 解析科目，未知 id / 缺参 → 回首页。
//   2. 从 registry.js 取科目定义，把页面外壳（标题、配色、文案）渲染成该科目的样子。
//   3. 动态 import 适配器（js/adapters/*.js）与引擎（js/engine.js），交给 createEngine 启动。
//
// 降级原则（契约要求：不许白屏、不许抛异常）：
//   registry / adapter / 题库 / engine 任何一环缺失或损坏，都渲染友好空状态，
//   并把技术原因写进 <body data-quiz-state> 与 data-empty-reason 便于排查，
//   控制台不打印任何 error。
//
// 本文件不写 localStorage、不读 localStorage（存储由引擎与 storage.js 负责）。

const HOME_URL = './index.html';
const ADAPTER_DIR = './adapters/';
const ENGINE_URL = './engine.js';
const REGISTRY_URL = './registry.js';
const STORAGE_URL = './storage.js';

// 选择题默认参数（与 engine.js / storage.js 的默认值保持一致）。
const DEFAULT_CHOICES_PER_QUESTION = 4;
const DEFAULT_CHOICE_RATIO = 0.5;

// 契约第 4 节要求的 elements id。
// 命名沿用既有 percent.html / powers.html：camelCase 键 ↔ kebab-case id，
// 三个「屏」在既有页面里带 -screen 后缀，这里同时兜底两种写法。
const ELEMENT_IDS = Object.freeze({
  welcome: ['welcome-screen', 'welcome'],
  quiz: ['quiz-screen', 'quiz'],
  result: ['result-screen', 'result'],
  testMeta: ['test-meta'],
  startButton: ['start-button'],
  restartButton: ['restart-button'],
  previousButton: ['previous-button'],
  nextButton: ['next-button'],
  nextButtonText: ['next-button-text'],
  answerInput: ['answer-input'],
  answerSuffix: ['answer-suffix'],
  answerLabel: ['answer-label'],
  inputHint: ['input-hint'],
  promptValue: ['prompt-value'],
  questionNumber: ['question-number'],
  directionLabel: ['direction-label'],
  questionInstruction: ['question-instruction'],
  progressFill: ['progress-fill'],
  headerProgress: ['header-progress'],
  headerTime: ['header-time'],
  scoreValue: ['score-value'],
  accuracyValue: ['accuracy-value'],
  correctValue: ['correct-value'],
  durationValue: ['duration-value'],
  comparisonLabel: ['comparison-label'],
  accuracyComparison: ['accuracy-comparison'],
  timeComparison: ['time-comparison'],
  correctionTitle: ['correction-title'],
  correctionList: ['correction-list'],
  // 选择题（契约第 5 节）：通用页有选项容器；引擎拿不到时会把这题降级为填空。
  choices: ['choice-list'],
  choiceBlock: ['choice-block'],
  // 可选（percent 专有 / 通用页增强），缺失时引擎自动跳过
  answerWrap: ['answer-wrap'],
  fractionNumerator: ['fraction-numerator'],
  equationOperator: ['equation-operator'],
  topicLabel: ['topic-label'],
  sidebarTip: ['sidebar-tip']
});

const EXTRA_IDS = Object.freeze([
  'subject-empty', 'subject-empty-icon', 'subject-empty-index', 'subject-empty-title',
  'subject-empty-description', 'subject-empty-retry',
  'subject-mark', 'subject-brand-title', 'resume-button', 'start-button-text', 'welcome-meta',
  'welcome-index', 'welcome-title', 'welcome-description',
  'subject-sheet-label', 'subject-sheet-index', 'subject-sheet-icon',
  'subject-sheet-title', 'subject-sheet-subtitle', 'subject-sheet-types', 'subject-sheet-count',
  'result-index', 'result-title', 'correction-title', 'mistakes-button', 'equation'
]);

function pickElement(...ids) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
}

function collectNodes() {
  const nodes = {};
  for (const [key, ids] of Object.entries(ELEMENT_IDS)) nodes[key] = pickElement(...ids);
  for (const id of EXTRA_IDS) nodes[id] = document.getElementById(id);
  return nodes;
}

/* ── 颜色工具：用科目的 accent 覆盖既有设计系统的 --green 系变量 ───────────── */

function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function mixHex(value, target, ratio) {
  const color = parseHexColor(value);
  const base = parseHexColor(target);
  if (!color || !base) return null;
  const mix = (a, b) => Math.round(a + (b - a) * ratio);
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(color.r, base.r))}${toHex(mix(color.g, base.g))}${toHex(mix(color.b, base.b))}`;
}

/** 把科目主色注入既有变量（styles.css 的 --green 系），而不是另起一套设计系统。 */
function applySubjectTheme(subject, nodes) {
  const accent = parseHexColor(subject?.accent) ? subject.accent : '#126b52';
  const root = document.documentElement;
  const dark = mixHex(accent, '#000000', 0.28);
  const mint = mixHex(accent, '#ffffff', 0.86);
  const soft = mixHex(accent, '#ffffff', 0.94);
  root.style.setProperty('--subject-accent', accent);
  root.style.setProperty('--green', accent);
  if (dark) root.style.setProperty('--green-dark', dark);
  if (mint) root.style.setProperty('--mint', mint);
  if (soft) root.style.setProperty('--soft', soft);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', accent);

  if (nodes['subject-sheet-icon']) nodes['subject-sheet-icon'].textContent = subject?.icon || '题';
}

/* ── 外壳渲染 ─────────────────────────────────────────────────────────── */

function describeTypes(types) {
  const labels = { fill: '填空', choice: '选择题' };
  const list = Array.isArray(types) ? types.filter((type) => labels[type]).map((type) => labels[type]) : [];
  return list.length ? list.join(' · ') : '填空题';
}

function renderSubjectChrome(subject, nodes, itemCount) {
  document.title = `${subject.title} · 记忆训练`;
  document.body.dataset.subject = subject.id;
  document.body.dataset.subjectCategory = subject.category ?? '';

  if (nodes['subject-mark']) nodes['subject-mark'].textContent = subject.icon || '题';
  if (nodes['subject-brand-title']) nodes['subject-brand-title'].textContent = subject.title;
  if (nodes['welcome-index']) nodes['welcome-index'].textContent = subject.subtitle || '科目训练';
  if (nodes['welcome-title']) nodes['welcome-title'].textContent = subject.title;
  if (nodes['welcome-description']) {
    const tags = Array.isArray(subject.tags) && subject.tags.length ? `涵盖${subject.tags.join(' · ')}。` : '';
    nodes['welcome-description'].textContent =
      `${tags}每组题目只出现一次，顺序与方向随机。完成后统一查看成绩与错题订正。`;
  }
  if (nodes['subject-sheet-label']) nodes['subject-sheet-label'].textContent = '科目信息';
  if (nodes['subject-sheet-index']) {
    nodes['subject-sheet-index'].textContent = subject.icon || '01';
  }
  if (nodes['subject-sheet-title']) nodes['subject-sheet-title'].textContent = subject.title;
  if (nodes['subject-sheet-subtitle']) nodes['subject-sheet-subtitle'].textContent = subject.subtitle || '';
  if (nodes['subject-sheet-types']) nodes['subject-sheet-types'].textContent = describeTypes(subject.questionTypes);
  if (nodes['subject-sheet-count']) {
    nodes['subject-sheet-count'].textContent = itemCount > 0 ? `${itemCount} 题` : '题量待定';
  }
  if (nodes['start-button-text']) nodes['start-button-text'].textContent = '开始测试';
  if (nodes['welcome-meta']) {
    const parts = [];
    if (subject.model === 'assoc') parts.push('双向关联出题');
    if (subject.updatedAt) parts.push(`内容更新于 ${subject.updatedAt}`);
    nodes['welcome-meta'].textContent = parts.join(' · ');
    nodes['welcome-meta'].hidden = parts.length === 0;
  }
  if (nodes['result-index']) nodes['result-index'].textContent = `${subject.title} · 测试完成`;
}

function showScreen(nodes, name) {
  const welcome = nodes.welcome;
  const quiz = nodes.quiz;
  const result = nodes.result;
  const empty = nodes['subject-empty'];
  if (welcome) welcome.hidden = name !== 'welcome';
  if (quiz) quiz.hidden = name !== 'quiz';
  if (result) result.hidden = name !== 'result';
  if (empty) empty.hidden = name !== 'empty';
  if (nodes.testMeta && name !== 'quiz') nodes.testMeta.hidden = true;
  document.body.dataset.screen = name;
}

function showEmptyState(nodes, { icon, index, title, description, reason, retryLabel }) {
  if (nodes['subject-empty-icon']) nodes['subject-empty-icon'].textContent = icon || '·';
  if (nodes['subject-empty-index']) nodes['subject-empty-index'].textContent = index || '科目训练';
  if (nodes['subject-empty-title']) nodes['subject-empty-title'].textContent = title;
  if (nodes['subject-empty-description']) nodes['subject-empty-description'].textContent = description;
  if (nodes['subject-empty-retry'] && retryLabel) nodes['subject-empty-retry'].textContent = retryLabel;
  document.body.dataset.quizState = 'empty';
  document.body.dataset.emptyReason = reason;
  showScreen(nodes, 'empty');
}

/* ── 适配器与引擎装载（全部动态 import + try/catch）────────────────────── */

async function instantiateAdapter(module, subject) {
  const namespace = module ?? {};
  const fromDefault = namespace.default ?? {};
  const factory = typeof namespace.createAdapter === 'function'
    ? namespace.createAdapter
    : typeof fromDefault.createAdapter === 'function'
      ? fromDefault.createAdapter
      : null;
  if (factory) {
    const adapter = await factory(subject);
    return adapter && typeof adapter.items === 'function' ? adapter : null;
  }
  if (typeof fromDefault.items === 'function') return fromDefault;
  if (typeof namespace.items === 'function') return namespace;
  return null;
}

/**
 * 按科目定义装载适配器。
 *
 * 候选顺序（第一个命中即用，happy path 不产生任何无用请求）：
 *   1. ./adapters/<subject.adapter>.js —— 与注册表同目录的约定，也是本地实际情况
 *   2. registry.adapterPath(subject) 以「适配器目录」为基准解析
 *      （registry.js 里该函数的注释就是这个基准，但从 quiz-page.js 直接 import 会解析成 /adapters/x.js）
 *   3. registry.adapterPath(subject) 原样解析（以本模块目录为基准）
 *   4. ./adapters/generic.js —— 兜底
 * 每个候选独立 try/catch，全失败返回 null，由调用方渲染空状态。
 */
async function loadAdapter(subject, registry) {
  const candidates = [];
  const adapterId = typeof subject.adapter === 'string' ? subject.adapter.trim() : '';
  if (adapterId) candidates.push(`${ADAPTER_DIR}${adapterId}.js`);

  let declared = null;
  try {
    const value = registry?.adapterPath?.(subject);
    if (typeof value === 'string' && value.trim()) declared = value.trim();
  } catch {
    declared = null;
  }
  if (declared) {
    try {
      candidates.push(new URL(declared, new URL(ADAPTER_DIR, import.meta.url)).href);
    } catch {
      // 非法 URL 时跳过这一档。
    }
    candidates.push(declared);
  }
  if (adapterId !== 'generic') candidates.push(`${ADAPTER_DIR}generic.js`);

  const failures = [];
  for (const path of new Set(candidates)) {
    try {
      const module = await import(/* @vite-ignore */ path);
      const adapter = await instantiateAdapter(module, subject);
      if (adapter) return { adapter, path, failures };
      failures.push(`${path}: 未导出 createAdapter() 或默认适配器对象`);
    } catch (error) {
      failures.push(`${path}: ${error?.message ?? error}`);
    }
  }
  return { adapter: null, path: null, failures };
}

/** 调用 adapter.items()，过滤掉结构不合法的条目；绝不抛错。 */
function resolveItems(adapter) {
  let raw = [];
  try {
    raw = adapter.items() ?? [];
  } catch (error) {
    return { items: [], error: `items() 抛错：${error?.message ?? error}` };
  }
  if (!Array.isArray(raw)) return { items: [], error: 'items() 未返回数组' };
  const items = raw.filter((item) => item
    && typeof item === 'object'
    && typeof item.front === 'string' && item.front.trim()
    && typeof item.back === 'string' && item.back.trim());
  return { items, error: items.length === raw.length ? null : `已忽略 ${raw.length - items.length} 条不完整题目` };
}

async function loadEngine() {
  try {
    const module = await import(/* @vite-ignore */ ENGINE_URL);
    const createEngine = typeof module.createEngine === 'function'
      ? module.createEngine
      : typeof module.default?.createEngine === 'function'
        ? module.default.createEngine
        : null;
    if (!createEngine) return { createEngine: null, collectElements: null, error: 'engine.js 未导出 createEngine' };
    return {
      createEngine,
      // 引擎自己导出 collectElements：优先用它，id 约定永远与引擎保持一致。
      collectElements: typeof module.collectElements === 'function' ? module.collectElements : null,
      error: null
    };
  } catch (error) {
    return { createEngine: null, collectElements: null, error: `engine.js 加载失败：${error?.message ?? error}` };
  }
}

/** 只读查询本科目的错题数量，用于决定「重练错题」入口是否出现；失败返回 null。 */
async function countMistakes(subjectId) {
  try {
    const storage = await import(/* @vite-ignore */ STORAGE_URL);
    const list = typeof storage.mistakesForSubject === 'function'
      ? storage.mistakesForSubject(subjectId)
      : typeof storage.readMistakes === 'function'
        ? storage.readMistakes()
        : null;
    if (!Array.isArray(list)) return null;
    const mine = list.filter((item) => !item?.subjectId || item.subjectId === subjectId);
    return mine.length;
  } catch {
    return null;
  }
}

/**
 * 读取选择题偏好。
 *
 * 只取 storage.js 的 prefs.choicesPerQuestion（默认 4）。**刻意不取 prefs.questionTypes**：
 * 它的默认值是 ['fill']，一旦用它覆盖科目声明的 ['fill','choice']，选择题会在无声无息中消失，
 * 而且不报任何错——这类「静默失效」正是本项目反复踩过的坑。
 *
 * 读不到偏好（storage 未就绪 / 数据损坏）时退回默认值，绝不影响答题。
 */
async function readChoicePrefs() {
  const fallback = { choicesPerQuestion: DEFAULT_CHOICES_PER_QUESTION, choiceRatio: DEFAULT_CHOICE_RATIO };
  try {
    const storage = await import(/* @vite-ignore */ STORAGE_URL);
    const profile = typeof storage.readProfile === 'function' ? storage.readProfile() : null;
    const count = Number(profile?.prefs?.choicesPerQuestion);
    if (Number.isInteger(count) && count >= 2 && count <= 8) {
      return { ...fallback, choicesPerQuestion: count };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/* ── 启动 ─────────────────────────────────────────────────────────────── */

function readSubjectParam() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return { id: '', mode: 'test' };
  }
  const id = (params.get('subject') ?? '').trim();
  const mode = params.get('mode') === 'mistakes' ? 'mistakes' : 'test';
  return { id, mode };
}

function goHome() {
  window.location.replace(HOME_URL);
}

async function loadRegistry() {
  try {
    return await import(/* @vite-ignore */ REGISTRY_URL);
  } catch {
    return null;
  }
}

async function main() {
  const nodes = collectNodes();
  const { id, mode } = readSubjectParam();

  // 1) 科目 id 解析：缺参或未知 id 一律回首页。
  if (!id) {
    goHome();
    return;
  }
  const registry = await loadRegistry();
  if (!registry || typeof registry.getSubject !== 'function') {
    showEmptyState(nodes, {
      icon: '·',
      title: '科目注册表还没就绪',
      description: '注册表暂时读不到，稍后重试即可；也可以先返回首页。',
      reason: 'registry-missing'
    });
    return;
  }
  const subject = registry.getSubject(id);
  if (!subject) {
    goHome();
    return;
  }

  applySubjectTheme(subject, nodes);
  renderSubjectChrome(subject, nodes, 0);
  document.body.dataset.quizState = 'loading';

  // 3) 装载适配器。图形题走 figure-choice（它是 generic 的包装层），
  //    其余科目仍走各自的适配器。两条路径的判分与订正语义一致。
  const { adapter, failures } = await loadAdapter(subject, registry);
  if (!adapter) {
    showEmptyState(nodes, {
      icon: subject.icon || '·',
      index: subject.subtitle || '科目训练',
      title: `${subject.title} 的答题组件还没就绪`,
      description: '这个科目的内容正在整理中，先练别的科目吧。',
      reason: `adapter-missing ${failures.join(' | ')}`
    });
    return;
  }

  const { items, error: itemsError } = resolveItems(adapter);
  if (!items.length) {
    const reason = adapter.loadError
      ? `content-missing ${adapter.loadError?.message ?? adapter.loadError}`
      : itemsError ?? 'items-empty';
    showEmptyState(nodes, {
      icon: subject.icon || '·',
      index: subject.subtitle || '科目训练',
      title: `${subject.title} 的题目正在整理中`,
      description: `这一科暂时还没有可练习的题目${mode === 'mistakes' ? '错题' : ''}，先去别的科目练一轮吧。`,
      reason
    });
    return;
  }

  renderSubjectChrome(subject, nodes, items.length);

  // 3) 装载引擎。
  const { createEngine, collectElements, error: engineError } = await loadEngine();
  if (!createEngine) {
    showEmptyState(nodes, {
      icon: subject.icon || '·',
      index: subject.subtitle || '科目训练',
      title: '答题引擎还没就绪',
      description: '题库已就绪，但答题引擎暂时加载不了。稍后重新打开这一页即可。',
      reason: engineError ?? 'engine-missing'
    });
    return;
  }

  // 4) 组装引擎需要的元素句柄：先用引擎自带的 collectElements（id 约定与引擎同源），
  //    再用本页的映射兜底，最后校验必需节点。
  let elements = {};
  if (collectElements) {
    try {
      elements = collectElements(document) ?? {};
    } catch {
      elements = {};
    }
  }
  const missing = [];
  for (const key of Object.keys(ELEMENT_IDS)) {
    if (!elements[key]) elements[key] = nodes[key] ?? null;
    if (!nodes[key]) nodes[key] = elements[key] ?? null;
    if (!elements[key]) missing.push(key);
  }
  const REQUIRED_KEYS = ['welcome', 'quiz', 'result', 'startButton', 'nextButton', 'answerInput', 'promptValue', 'questionNumber', 'correctionList'];
  const requiredMissing = missing.filter((key) => REQUIRED_KEYS.includes(key));
  if (requiredMissing.length) {
    showEmptyState(nodes, {
      icon: subject.icon || '·',
      index: subject.subtitle || '科目训练',
      title: '页面结构不完整',
      description: '答题页缺少必要的节点，暂时无法开始测试。',
      reason: `elements-missing ${requiredMissing.join(',')}`
    });
    return;
  }

  // 错题重练模式：把题库收窄到错题对应的那几条，再交给引擎。
  //
  // 这一步是必需的：引擎的 start() 一律走 adapter.items()，若原样传原适配器，
  // 「重练错题」会变成整卷重测——按钮就在撒谎（ui-dev 已就此预警）。
  // 这里用一层只读的适配器包装：只替换 items()，判题/题面/错题登记全部沿用原适配器，
  // 因此错题重练的作答体验与正常测试完全一致。
  let activeAdapter = adapter;
  if (mode === 'mistakes') {
    const focused = await buildMistakesAdapter(adapter, subject);
    if (!focused || focused.items().length === 0) {
      showEmptyState(nodes, {
        icon: subject.icon || '·',
        index: subject.subtitle || '错题重练',
        title: '没有待重练的错题',
        description: '这一科的错题已经全部清空。先去完整测试一轮，答错的题会自动收集到这里。',
        reason: 'no-mistakes'
      });
      return;
    }
    activeAdapter = focused;
  }

  let engine = null;
  const choicePrefs = await readChoicePrefs();
  try {
    engine = createEngine({
      adapter: activeAdapter,
      subject,
      elements,
      mode,
      questionTypes: Array.isArray(subject.questionTypes) && subject.questionTypes.length
        ? subject.questionTypes
        : ['fill'],
      // 选择题（契约第 5 节）：
      //   1. 选项数量取用户偏好（storage.js 的 prefs.choicesPerQuestion，默认 4）；
      //   2. 干扰项池一律用**完整题库**——错题重练时只有两三条错题，
      //      若从收窄后的池子取干扰项就永远凑不齐 4 个选项；
      //   3. 刻意不读 prefs.questionTypes：它的默认值是 ['fill']，
      //      用它覆盖科目声明的 ['fill','choice'] 会让选择题静默消失。
      choicesPerQuestion: choicePrefs.choicesPerQuestion,
      choiceRatio: choicePrefs.choiceRatio,
      choicePool: () => adapter.items(),
      onFinish() {
        showScreen(nodes, 'result');
        document.body.dataset.quizState = 'finished';
        refreshMistakesEntry();
      }
    });
  } catch (error) {
    showEmptyState(nodes, {
      icon: subject.icon || '·',
      index: subject.subtitle || '科目训练',
      title: '答题引擎启动失败',
      description: '这一科暂时打不开，请稍后重试或先练别的科目。',
      reason: `engine-init-failed ${error?.message ?? error}`
    });
    return;
  }
  if (!engine || typeof engine.start !== 'function') {
    showEmptyState(nodes, {
      icon: subject.icon || '·',
      index: subject.subtitle || '科目训练',
      title: '答题引擎启动失败',
      description: '这一科暂时打不开，请稍后重试或先练别的科目。',
      reason: 'engine-shape-invalid'
    });
    return;
  }

  // 5) 就绪：解锁开始按钮，按需暴露「继续上次测试」。
  document.body.dataset.quizState = 'ready';
  showScreen(nodes, 'welcome');
  const startButton = nodes.startButton;
  if (startButton) {
    startButton.disabled = false;
    startButton.addEventListener('click', () => {
      runEngine(engine, 'start', nodes);
    });
  }
  const resumeButton = nodes['resume-button'];
  if (resumeButton) {
    let hasSession = false;
    try {
      hasSession = typeof engine.hasSession === 'function' && engine.hasSession() === true;
    } catch {
      hasSession = false;
    }
    resumeButton.hidden = !hasSession;
    if (hasSession) {
      if (nodes['start-button-text']) nodes['start-button-text'].textContent = '重新开始';
      resumeButton.addEventListener('click', () => {
        runEngine(engine, 'resume', nodes);
      });
    }
  }
  const restartButton = nodes.restartButton;
  if (restartButton) {
    restartButton.addEventListener('click', () => {
      runEngine(engine, 'start', nodes);
    });
  }

  // 所有按钮监听都已挂上，此刻声明「真正可交互」。
  // 与 percent.html / powers.html 的 app.js 用同一个标记名，三种页面契约统一；
  // 外部（尤其自动化测试）据此判断可以安全点击，避免点在还没挂监听的按钮上。
  // 必须放在监听注册之后——提前设置就等于撒谎。
  document.body.dataset.engineReady = '1';

  const mistakesButton = nodes['mistakes-button'];
  if (mistakesButton) {
    mistakesButton.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('subject', subject.id);
      url.searchParams.set('mode', 'mistakes');
      window.location.assign(url.toString());
    });
  }

  async function refreshMistakesEntry() {
    if (!mistakesButton) return;
    const count = await countMistakes(subject.id);
    if (count === null || count === 0) {
      mistakesButton.hidden = true;
      return;
    }
    mistakesButton.hidden = false;
    mistakesButton.textContent = `重练错题 · ${count}`;
  }

  const emptyRetry = nodes['subject-empty-retry'];
  if (emptyRetry) emptyRetry.addEventListener('click', () => window.location.reload());

  window.addEventListener('pagehide', () => {
    try {
      engine.destroy?.();
    } catch {
      // 卸载阶段忽略；不能让 destroy 影响页面离开。
    }
  });

  // QA / 调试用句柄，只读快照。
  window.__quizPageState__ = {
    subject,
    adapterId: adapter.id ?? subject.adapter,
    itemCount: items.length,
    mode,
    choicesPerQuestion: choicePrefs.choicesPerQuestion,
    choiceRatio: choicePrefs.choiceRatio,
    hasChoiceContainer: Boolean(elements.choices)
  };

  refreshMistakesEntry();

  // 错题重练模式：直接进入答题屏。
  if (mode === 'mistakes') {
    runEngine(engine, 'start', nodes);
  }
}

/**
 * 构造「只练错题」的适配器视图。
 *
 * 引擎的 start() 一律取 adapter.items()，所以错题重练不能靠 mode 参数本身生效，
 * 必须把题库真的收窄。这里只替换 items()，其余方法（isCorrect / view / mistake /
 * correction）全部沿用原适配器，保证作答与判题行为与正常测试一致。
 *
 * 只按 itemId 收窄，不带方向过滤：同一道题在反向再错一次，值得换个方向再练一遍。
 *
 * @returns {{items: () => object[]}|null} 无错题或 storage 不可用时返回 null
 */
async function buildMistakesAdapter(adapter, subject, storage) {
  let store = storage;
  if (!store) {
    try {
      store = await import(/* @vite-ignore */ './storage.js');
    } catch {
      return null;
    }
  }
  if (typeof store.mistakesForSubject !== 'function') return null;

  let mistakes = [];
  try {
    mistakes = store.mistakesForSubject(subject.id) ?? [];
  } catch {
    return null;
  }
  const wanted = new Set(mistakes.map((mistake) => String(mistake?.itemId ?? '')).filter(Boolean));
  if (wanted.size === 0) return null;

  const all = typeof adapter.items === 'function' ? adapter.items() : [];
  // 错题表里可能有已经不在题库中的旧条目（题库更新过），这里自然过滤掉。
  const focused = all.filter((item) => wanted.has(String(item?.id ?? '')));
  if (focused.length === 0) return null;

  return Object.create(adapter, {
    items: { value: () => focused, enumerable: true }
  });
}

/**
 * 调引擎方法并让页面状态跟随引擎的 getState().screen。
 * 引擎内部报错不该把页面炸白，因此吞掉异常；引擎自己没切屏时这里补一刀，
 * 引擎明确停在 welcome（例如题库为空）时也不会被强行切到答题屏。
 */
function runEngine(engine, method, nodes) {
  try {
    engine[method]?.();
  } catch (error) {
    document.body.dataset.engineError = String(error?.message ?? error);
  }
  let state = null;
  try {
    state = engine.getState?.() ?? null;
  } catch {
    state = null;
  }
  const screen = state?.screen;
  if (screen === 'quiz' || screen === 'result') {
    showScreen(nodes, screen);
  } else if (screen === 'welcome') {
    showScreen(nodes, 'welcome');
  } else {
    // 引擎没有 getState 时退化成乐观切屏。
    showScreen(nodes, 'quiz');
  }
}

main().catch((error) => {
  // 顶层兜底：任何意外都退化成友好空状态，不产生未捕获异常。
  const nodes = collectNodes();
  showEmptyState(nodes, {
    icon: '·',
    title: '页面加载出错了',
    description: '请刷新重试，或先返回首页选择其他科目。',
    reason: `unhandled ${error?.message ?? error}`
  });
});
