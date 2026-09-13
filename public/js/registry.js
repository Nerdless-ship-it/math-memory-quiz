// 科目注册表 —— 全套应用中「有哪些科目」的唯一真相源。
//
// 硬性约定（见 docs/ARCHITECTURE.md 第 3.1 节）：
//   新增科目 = 本文件加一条 + 加一个数据文件，不得新增代码。
//   任何地方都不得再硬编码科目 id 列表；QUIZ_TYPES、首页卡片、history tab、
//   科目页标题、看板分组全部从这张表派生。
//
// accent 取色遵循既有视觉语言：math 组沿用绿(#126b52)/蓝(#2457a6)，
// common 组每人一个可区分但同饱和度的色相，避免首页变成调色盘。

export const CATEGORIES = Object.freeze([
  { id: 'math', title: '速算', subtitle: '数字记忆与心算基本功' },
  { id: 'common', title: '考公常识', subtitle: '固定配对常识，双向回忆训练' },
  // 图形推理单列一组：它既不是「配对常识」（题面是图、选项是图），
  // 也不是速算，混进常识组会让人以为它也是文字题。
  { id: 'figure', title: '图形推理', subtitle: '看图作答，选项也是图' }
]);

export const SUBJECTS = Object.freeze([
  // ── 速算（数学）────────────────────────────────────────────────
  {
    id: 'percent',
    title: '百分数与分数',
    subtitle: '双向换算',
    category: 'math',
    accent: '#126b52',
    page: './percent.html',
    icon: '%',
    model: 'assoc',
    questionTypes: ['fill'],
    adapter: 'percent',
    tags: ['速算'],
    updatedAt: null,
    // 冻结的 e2e 测试（test/browser-smoke.mjs）断言首页恰好有 2 个 .test-choice
    // 并点击 #percent-choice。这两个旧标识只属于 percent/powers 两张卡，
    // 因此作为数据登记在这里，而不是在渲染代码里写 if (id === ...) 的硬编码判断。
    legacyClass: 'test-choice percent-choice',
    legacyId: 'percent-choice'
  },
  {
    id: 'powers',
    title: '平方与幂次',
    subtitle: '平方 · 立方 · 四次幂',
    category: 'math',
    accent: '#2457a6',
    page: './powers.html',
    icon: 'x²',
    model: 'assoc',
    questionTypes: ['fill'],
    adapter: 'powers',
    tags: ['速算'],
    updatedAt: null,
    legacyClass: 'test-choice powers-choice',
    legacyId: 'powers-choice'
  },

  // ── 考公常识 ────────────────────────────────────────────────────
  {
    id: 'tiangan-dizhi',
    title: '天干地支',
    subtitle: '天干 · 地支 · 六十甲子',
    category: 'common',
    accent: '#8a5a2b',
    page: './quiz.html?subject=tiangan-dizhi',
    icon: '干',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['天干', '地支', '甲子'],
    updatedAt: null
  },
  {
    id: 'shengxiao',
    title: '十二生肖',
    subtitle: '生肖 · 地支 · 排序',
    category: 'common',
    accent: '#b3452f',
    page: './quiz.html?subject=shengxiao',
    icon: '肖',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['生肖'],
    updatedAt: null
  },
  {
    id: 'jieqi',
    title: '二十四节气',
    subtitle: '节气 · 顺序 · 季节',
    category: 'common',
    accent: '#2f7d5c',
    page: './quiz.html?subject=jieqi',
    icon: '节',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['节气'],
    updatedAt: null
  },
  {
    id: 'chaodai',
    title: '历史朝代',
    subtitle: '朝代 · 开国君主 · 都城',
    category: 'common',
    accent: '#6b4a8f',
    page: './quiz.html?subject=chaodai',
    icon: '朝',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['朝代'],
    updatedAt: null
  },
  {
    id: 'huaxue',
    title: '化学元素',
    subtitle: '元素 · 符号 · 原子序数',
    category: 'common',
    accent: '#1f6f8b',
    page: './quiz.html?subject=huaxue',
    icon: '元',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['元素'],
    updatedAt: null
  },
  {
    id: 'lishi-changshi',
    title: '历史常识',
    subtitle: '人物 · 事件 · 典故',
    category: 'common',
    accent: '#9c6b1f',
    page: './quiz.html?subject=lishi-changshi',
    icon: '史',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['历史常识'],
    updatedAt: null
  },
  {
    id: 'falv-changshi',
    title: '法律常识',
    subtitle: '宪法 · 民法 · 刑法要点',
    category: 'common',
    accent: '#a83232',
    page: './quiz.html?subject=falv-changshi',
    icon: '法',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['法律常识'],
    updatedAt: null
  },
  {
    id: 'shizheng',
    title: '时政常识',
    subtitle: '制度 · 机构 · 政策要点',
    // 时政内容有时效性：updatedAt 必须维护，UI 会显式标注「更新于」，
    // 让内容年龄对用户可见，而不是被动地发现它过期了。
    // 本会话只收录可联网核实的稳定制度性事实，不收录易变的人事与具体数据。
    category: 'common',
    accent: '#456b3f',
    page: './quiz.html?subject=shizheng',
    icon: '政',
    model: 'assoc',
    // 常识科一律选择题（用户 2026-09 的要求）：`['choice']` 单一取值会让引擎
    // 对每一道题都出选择题（engine.js 的 pickQuestionType：只声明一种就用那一种）。
    questionTypes: ['choice'],
    adapter: 'generic',
    tags: ['时政常识'],
    updatedAt: '2026-09-12'
  },

  // ── 图形推理 ────────────────────────────────────────────────────
  // 题面与选项都是图，走 figure-choice 适配器（generic 的包装层）。
  // 每题只有一个正确方向（图→选），因此整体锁 forward：反向题（「选哪个展开图」）
  // 在数据上不成立，强行出会产生无解题目。
  {
    id: 'cube-net',
    title: '正方体展开图',
    subtitle: '展开图 → 折叠后的立体图',
    category: 'figure',
    accent: '#2f6f7f',
    page: './quiz.html?subject=cube-net',
    icon: '展',
    model: 'figure',
    questionTypes: ['choice'],
    adapter: 'figure-choice',
    tags: ['图形推理'],
    lockedDirection: 'forward',
    updatedAt: null,
    // 图形题：back 是选项标签 A/B/C/D，重复是内容特性而非数据错误。
    allowDuplicateBack: true,
    // 题目身份：题干展开图 + 四个选项组合（front/back 都是模板文案，不能用来区分题目）
    uniqueBy: 'choices',
    // 欢迎页演示：quiz-page.js 见到该声明就显示「看展开演示」按钮（数据驱动，非硬编码）
    demo: 'figure'
  },
  {
    id: 'cross-section',
    title: '立方体截面图',
    subtitle: '立体被平面所截 → 判断截面',
    category: 'figure',
    accent: '#7f4f8f',
    page: './quiz.html?subject=cross-section',
    icon: '截',
    model: 'figure',
    questionTypes: ['choice'],
    adapter: 'figure-choice',
    tags: ['图形推理'],
    lockedDirection: 'forward',
    updatedAt: null,
    // 图形题：题干文案固定（差异全在选项里）、back 是选项标签 A/B/C/D，
    // 两种重复都是内容特性而非数据错误。放行不等于不检查——
    // 测试会用 uniqueBy:'choices' 确认每条题目的选项组合互不相同。
    allowDuplicateFront: true,
    allowDuplicateBack: true,
    // 题干 24 条完全相同（差异全在选项里），题目身份用选项组合
    uniqueBy: 'choices',
    // 欢迎页演示：quiz-page.js 见到该声明就显示「看切割演示」按钮（数据驱动，非硬编码）
    demo: 'figure'
  },
  {
    id: 'three-views',
    title: '立体三视图',
    subtitle: '立体图形 → 主视图 / 俯视图 / 左视图',
    category: 'figure',
    accent: '#7f6f2f',
    page: './quiz.html?subject=three-views',
    icon: '视',
    model: 'figure',
    questionTypes: ['choice'],
    adapter: 'figure-choice',
    tags: ['图形推理'],
    lockedDirection: 'forward',
    updatedAt: null,
    // 与另外两个图形科目同理：题干文案只有几种（「该立体图形的主视图是」…），
    // 选项标签 A~D 也必然重复——重复是内容特性；题目身份落在**题干图形 + 选项组合**上。
    // 这里比另外两科多算题干：本库有两个立体的三视图恰好相同（选项图形一模一样），
    // 只按选项判重会把那两道不同的题误判成重复。
    allowDuplicateFront: true,
    allowDuplicateBack: true,
    uniqueBy: 'figure+choices',
    // 欢迎页演示：quiz-page.js 见到该声明就显示「自己搭立体图形」，
    // 打开一个可交互的搭建器（自己组合方块、实时看三个视图）——数据驱动，非硬编码
    demo: 'builder'
  }
]);

const BY_ID = new Map(SUBJECTS.map((subject) => [subject.id, subject]));

// ── 模块路径解析 ────────────────────────────────────────────────────
// 基准约定（务必遵守，混用基准是 404 的根因）：
//   **所有路径字符串一律以 public/js/ 为基准解析。**
//   原因：注册表本身位于 public/js/，而它的主要消费方
//   （adapters/*.js、quiz-page.js）也都在 public/js/ 之下或由那里发起 import。
//   所以 ../adapters/x.js → public/adapters/x.js？不是——是 public/js/../adapters
//   → public/adapters/… 不对，正确读法是：
//
//     registry.js 在 public/js/，'../' 从 public/js/ 上跳一级到 public/。
//     故 '../adapters/percent.js' → public/adapters/percent.js  ← 错！应该是 public/js/adapters/
//
// 上面这段推理本身就是踩过的坑，这里给出最终结论（已实测）：
//   - 适配器在 public/js/adapters/ → 相对 public/js/ 应写 './adapters/x.js'
//   - 题库在   public/subjects/    → 相对 public/js/ 应写 '../subjects/x.js'
// 调用方若自身不在 public/js/（如 quiz-page.js 在 public/js/ 下也算同层，
// import 是相对**模块自身 URL** 解析的），必须用 new URL(path, JS_BASE_URL) 显式归位。

/** public/js/ 的基准 URL —— 所有相对路径字符串都以此为基准。 */
export const JS_BASE_URL = new URL('./', import.meta.url);

const ADAPTER_PATHS = new Map([
  ['percent', './adapters/percent.js'],
  ['powers', './adapters/powers.js'],
  ['generic', './adapters/generic.js'],
  ['figure-choice', './adapters/figure-choice.js']
]);

/**
 * 标签维度说明：tags → 该维度在界面上显示的方向提示。
 *
 * 为什么必须有：shengxiao / jieqi / chaodai 三个科目里，同一段文字会同时出现在
 * 某条的 front 和另一条的 back（例如「秦」既是「开国君主」组的题目文本，又是
 * 「都城」组的答案）。若题面只显示这段文字，用户看到「秦」时无法判断该填君主
 * 还是都城——这对复习是致命的。因此按 tags 显示明确的维度提示。
 *
 * 这份表同时是 tags 白名单：注册表测试会校验每个条目的 tags 都在表内，
 * 防止数据里出现拼错的标签导致提示静默失效。
 */
export const DIMENSIONS = Object.freeze({
  'tiangan-dizhi': Object.freeze({
    天干: '天干 → 阴阳五行',
    地支: '地支 → 阴阳五行',
    时辰: '地支 → 十二时辰',
    时辰别称: '时辰别称 → 时辰',
    甲子: '干支纪年'
  }),
  shengxiao: Object.freeze({
    生肖地支: '生肖 → 地支',
    生肖排序: '生肖排序 → 生肖'
  }),
  jieqi: Object.freeze({
    节气顺序: '节气 → 顺序',
    节气含义: '含义 → 节气'
  }),
  chaodai: Object.freeze({
    开国君主: '朝代 → 开国君主',
    都城: '都城 → 朝代'
  }),
  huaxue: Object.freeze({
    元素名称: '元素名称 → 元素符号',
    原子序数: '元素名称 → 原子序数',
    符号释义: '元素符号 → 元素名称'
  }),
  'lishi-changshi': Object.freeze({
    著作: '著作 → 作者',
    文学: '文学常识',
    变法: '变法改革',
    典故: '成语典故 → 出处',
    事件: '历史事件',
    制度: '典章制度',
    人物: '历史人物'
  }),
  'falv-changshi': Object.freeze({
    宪法: '宪法',
    国家制度: '国家制度',
    国家机构: '国家机构',
    公民权利: '公民权利',
    民法: '民法',
    刑法: '刑法'
  }),
  shizheng: Object.freeze({
    会议制度: '会议制度',
    机构职能: '机构职能',
    国家战略: '国家战略',
    制度安排: '制度安排',
    五年规划: '五年规划',
    国家制度: '国家制度',
    党章要点: '党章要点'
  }),
  // 图形推理：题面与选项都是图，提示词只用来标注题型，不承载「方向」语义。
  'cube-net': Object.freeze({
    展开图折叠: '展开图 → 立体图'
  }),
  'cross-section': Object.freeze({
    截面图: '立体被截 → 截面形状'
  }),
  'three-views': Object.freeze({
    三视图: '立体 → 主视图 / 俯视图 / 左视图'
  })
});

/**
 * 取条目的维度提示。
 * 找不到科目配置或标签未登记时返回空串——调用方应降级为不显示提示，
 * 绝不因为缺配置而报错阻断答题。
 */
export function dimensionLabel(subjectId, tags) {
  const table = DIMENSIONS[subjectId];
  if (!table || !Array.isArray(tags)) return '';
  for (const tag of tags) {
    if (table[tag]) return table[tag];
  }
  return '';
}

/** 该科目是否登记了维度表（未登记则不做 tags 白名单校验）。 */
export function hasDimensionTable(subjectId) {
  return Object.prototype.hasOwnProperty.call(DIMENSIONS, subjectId);
}

/**
 * 方向锁：哪些标签维度的条目只在某一方向上成立。
 *
 * 背景：本模型的条目一律是 front = 提示、back = 答案。部分维度反过来问不成立：
 *   - chaodai「都城」组（front 咸阳 / back 秦）反向问「秦 → ？」有多个答案；
 *   - huaxue「符号释义」组（front H / back 氢）正向问「H → ？」反而是无解的，
 *     因为该维度的**答案**才是元素名，它必须反向出题（给背面的氢答正面的 H）。
 *
 * 因此锁是按「维度」而非按「科目」表达的：
 *   'forward'  —— 该维度只能正向出题（提示用 front，作答 back）
 *   'backward' —— 该维度只能反向出题（提示用 back，作答 front）
 * 未登记的维度默认双向自由。
 *
 * 这直接决定出题是否有意义，因此显式登记于此——宁可某个维度只单向考，
 * 也不出一个用户根本无法作答的题。
 */
export const LOCKED_DIRECTIONS = Object.freeze({
  // 这三科整体锁定：多个维度互有同名交叉（同一段文字既是某条的 front
  // 又是另一条的 back），反向题会产生歧义。
  shengxiao: 'forward',
  jieqi: 'forward',
  chaodai: 'forward'
});

/**
 * 按科目条目自身声明的方向锁（`subject.lockedDirection`）。
 * 图形推理两科走这条：把锁写在科目条目里，比在下表里再抄一遍难漏。
 */
const SUBJECT_LOCKED_DIRECTIONS = new Map(
  SUBJECTS.filter((subject) => subject.lockedDirection).map((subject) => [subject.id, subject.lockedDirection])
);

/**
 * 按维度覆盖的方向锁，优先于 LOCKED_DIRECTIONS。
 * 键形如 `${subjectId}:${tag}`。
 */
export const DIMENSION_LOCKS = Object.freeze({
  // 符号维度：数据写作 front='H' back='氢'，锁反向后出题是「提示元素名（back）、
  // 作答元素符号（front）」，与界面标注「反向 · 元素符号 → 元素名称」一致。
  'huaxue:符号释义': 'backward',
  // 元素名称维度同步锁反向。它与符号释义是同一配对（名称 ↔ 符号）的两组数据：
  // 若保持双向自由，其正向题「氢 → 选 H」会与符号释义的反向题逐字重复
  // （200 轮实测每轮平均 20.3 道重复题）。锁成镜像互补后每轮各问一次，互不重复。
  // 连带效果：原子序数维度（无锁）因反向槽位被占满而全部落到正向
  // （「氢的原子序数」→ 选数字），不会再出现「选出与「1」对应的一项」这类别扭反向题。
  'huaxue:元素名称': 'backward',
  // 时辰别称锁正向：反向题面会是「子时」这类时辰名，与时辰组的正向题面（front=子时）
  // 同屏同字而答案不同（一个答时间段、一个答别称），学生无法判断该答哪个维度。
  // 锁正向后别称组永远以「夜半」这类别称作题面，与「子时 → 23点至1点」互不干扰。
  'tiangan-dizhi:时辰别称': 'forward'
});

/** 取某个维度的方向锁；未登记返回 null 表示双向自由。 */
export function lockedDirection(subjectId, tags) {
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      const override = DIMENSION_LOCKS[`${subjectId}:${tag}`];
      if (override) return override;
    }
  }
  return LOCKED_DIRECTIONS[subjectId] ?? SUBJECT_LOCKED_DIRECTIONS.get(subjectId) ?? null;
}

const CONTENT_PATHS = new Map([
  ['tiangan-dizhi', '../subjects/tiangan-dizhi.item.js'],
  ['shengxiao', '../subjects/shengxiao.item.js'],
  ['jieqi', '../subjects/jieqi.item.js'],
  ['chaodai', '../subjects/chaodai.item.js'],
  ['huaxue', '../subjects/huaxue.item.js'],
  ['lishi-changshi', '../subjects/lishi-changshi.item.js'],
  ['falv-changshi', '../subjects/falv-changshi.item.js'],
  ['shizheng', '../subjects/shizheng.item.js'],
  ['cube-net', '../subjects/cube-net.item.js'],
  ['cross-section', '../subjects/cross-section.item.js'],
  ['three-views', '../subjects/three-views.item.js']
]);

/**
 * 把相对 public/js/ 的路径字符串解析成绝对 URL。
 * 消费方一律用本函数，不要自己拼基准——混用基准正是此前 404 的根因。
 */
export function resolveModuleUrl(path) {
  if (!path) return undefined;
  return new URL(path, JS_BASE_URL).href;
}

/** 解析科目的适配器模块绝对 URL；未知适配器返回 undefined。 */
export function adapterPath(subject) {
  return subject ? resolveModuleUrl(ADAPTER_PATHS.get(subject.adapter)) : undefined;
}

/**
 * 解析科目的内容模块绝对 URL。
 * percent / powers 的数据源是既有冻结文件，由各自适配器内置提供，故返回 undefined。
 */
export function contentPath(subject) {
  return subject ? resolveModuleUrl(CONTENT_PATHS.get(subject.id)) : undefined;
}

/** 按 id 取科目；未知 id 返回 undefined（调用方负责回退到首页）。 */
export function getSubject(id) {
  return BY_ID.get(id);
}

export function subjectsByCategory(category) {
  return SUBJECTS.filter((subject) => subject.category === category);
}

export function subjectIds() {
  return SUBJECTS.map((subject) => subject.id);
}
