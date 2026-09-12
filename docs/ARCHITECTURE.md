# 速算与常识训练 · 架构契约 v2

> 本文档是并行开发的**唯一接口真相**。任何成员在写代码前必须以本文档为准；
> 需要变更契约时先提出来，由 Lead 更新本文档并通知全体，**不允许各自臆造字段**。

## 0. 背景与目标

项目原本是「速算训练」，含两个各自完整复制的题型（`percent` / `powers`）。
本次升级目标：**改造成面向考公常识复习的多科目记忆训练平台**，并补齐
打卡 / 趋势 / 单题掌握度 / 间隔重复 / 错题重练 / 导入导出 / 中途存档。

**硬约束**

| 约束 | 说明 |
|---|---|
| 零依赖 | 不引入任何 npm 包、不使用打包器。原生 ES module，浏览器直接跑。 |
| 零构建 | `public/` 目录即产物，可直接被 Cloudflare Workers assets / GitHub Pages 托管。 |
| 现有测试不可修改 | `test/*.test.mjs`、`test/*-smoke.mjs` 是回归安全网，**一行都不许改**，必须全绿。 |
| 现有 v1 数据不丢 | 用户 localStorage 里已有的成绩与错题必须无损迁移到 v2。 |

---

## 1. 核心抽象

所有科目（数学 + 考公常识）都是同一个数据形态：**一个条目池，每条含双向关联**。

```
条目 (item)  { id, front, back, tags? }
```

- `front` → `back` 为 `forward` 方向，`back` → `front` 为 `backward` 方向。
- 由引擎对每个条目随机（且数量均衡地）决定方向，科目作者不需要管方向。

**统一模型的收益**：任何新科目 = 一份数据文件 + 一条注册表配置，**零新增代码**。
打卡、趋势、掌握度、间隔重复、错题重练、导入导出全部在引擎/存储层一次实现，所有科目自动获得。

---

## 2. 目录结构（目标态）

```
public/
├── index.html                  首页：科目网格 + 看板 + 错题集
├── quiz.html                   通用测试页（新科目统一入口，?subject=<id> 选科目）
├── percent.html                保留：数学科目专用页（回归安全网依赖其存在）
├── powers.html                 保留：数学科目专用页
├── styles.css                  共享基础样式（保留）
├── home.css                    首页样式（重构）
├── quiz.css                    通用测试页样式
├── js/
│   ├── engine.js               ★ 通用答题引擎（替换重复的 app.js / powers-app.js）
│   ├── quiz.js                 保留：共享工具 + 数学判题（导出签名冻结）
│   ├── powers-quiz.js          保留：幂次判题（导出签名冻结）
│   ├── data.js                 保留：数学题库源（结构冻结）
│   ├── powers-data.js          保留：幂次题库源（结构冻结）
│   ├── adapters/
│   │   ├── percent.js          percent 科目适配器
│   │   └── powers.js           powers 科目适配器
│   ├── registry.js             ★ 科目注册表（唯一的题型真相源）
│   ├── storage.js              ★ 存储层 v2（取代 history.js 的内部实现）
│   ├── history.js              保留：兼容外观，转发到 storage.js
│   ├── mastery.js              ★ 掌握度 + 间隔重复调度
│   ├── distractors.js          ★ 选择题干扰项生成
│   ├── quiz-page.js            通用测试页控制器
│   ├── home.js                 首页控制器（重构：注册表驱动）
│   └── app.js / powers-app.js  改造为「引擎 + 适配器」的薄封装
└── subjects/                   ★ 考公常识题库（每科一个数据文件）
    ├── tiangan-dizhi.js
    ├── shengxiao.js
    ├── jieqi.js
    ├── chaodai.js
    ├── huaxue.js
    ├── lishi-changshi.js
    ├── falv-changshi.js
    └── shizheng.js
```

`★` = 新增。

---

## 3. 数据契约

### 3.1 科目定义（`registry.js`）

```js
export const SUBJECTS = Object.freeze([
  {
    id: 'percent',                    // 稳定唯一 id，用于 storage 键与注册表查找
    title: '百分数与分数',
    subtitle: '双向换算',
    category: 'math',                 // 'math' | 'common'（首页分组）
    accent: '#126b52',                // 主色，用于卡片与页头
    page: './percent.html',           // 该科目的答题页
    icon: '%',                        // 卡片角标（纯文本，2 字符内）
    model: 'assoc',                   // 'assoc' = 双向关联模型
    questionTypes: ['fill'],          // 'fill' 填空 | 'choice' 选择题
    adapter: 'percent',               // 适配器 id，见 3.3
    source: '../public/js/data.js',   // 仅作注释用，实际由 adapter 提供 items
    tags: ['速算'],                    // 用于看板分组统计
    updatedAt: null                   // 有时效性的科目（如时政）填 'YYYY-MM-DD'
  },
  // ...
]);
```

**唯一真相**：`QUIZ_TYPES`、首页卡片、history tab、科目页标题全部从这张表派生。
新增科目**只改这一个文件 + 加一个数据文件**。任何地方再出现硬编码的科目 id 列表都算违规。

### 3.2 题库（`subjects/*.js`）

```js
export const ITEMS = Object.freeze([
  { id: 'tiangan-01', front: '甲', back: '阳木', tags: ['天干'] },
  // ...
]);
```

**数据质量硬性要求**（有对应自动化测试把关，见第 7 节）

1. `id` 全局唯一，**且在同一科目内唯一**。
2. `front` 在同科目内不重复；`back` 在同科目内不重复。
   （若某科天然存在重复 back，必须显式在科目配置里标 `allowDuplicateBack: true` 并说明理由。）
3. `front` / `back` 均为非空字符串，已 `trim`，不含首尾空格。
4. 每个科目**至少 8 条**，否则不足以支撑一轮完整测试。
5. 时效性科目（`updatedAt` 非 null）每日一题都必须在 `front` 或 `back` 里可被识别，
   且 `updatedAt` 必须是合法 `YYYY-MM-DD`。

### 3.3 适配器（`js/adapters/*.js`）

适配器负责「把科目特有数据翻译成引擎认识的条目」以及「判分」。
**它不得触碰 DOM，不得读写 localStorage**——纯函数，可单测。

```js
export default {
  id: 'percent',

  // 必须：返回引擎用的条目数组
  items() { /* [{ id, front, back, tags }] */ },

  // 必须：判分。返回 boolean
  // ctx = { direction: 'forward'|'backward', input: string }
  isCorrect(item, ctx) { /* ... */ },

  // 可选：自定义题面渲染（默认渲染 front 文本）
  // 返回 { text, html } 之一；返回 null 表示用默认渲染
  renderPrompt(item, ctx) { /* ... */ },

  // 可选：自定义答案输入框的前后缀与提示
  inputHints(item, ctx) {
    return { prefix: '', suffix: '%', placeholder: '0', label: '请输入对应百分数', hint: '只需填写数字' };
  },

  // 可选：订正行里显示的等式文本
  correctionText(item, ctx) { /* ...' */ }
};
```

### 3.4 数学科目的既有数据结构（冻结，不得改动）

| 文件 | 导出 | 结构 |
|---|---|---|
| `js/data.js` | `PAIRS` | `{ percent: string, fraction: string }[]`，30 条 |
| `js/powers-data.js` | `POWER_PAIRS` | `{ id, base, exponent, result, acceptedResults[], topic, approximate }[]`，24 条 |

适配器负责把它们映射成统一 `item`：
- percent：`front = percent + '%'`，`back = fraction`（`item.raw` 保留原始对象供判分用）
- powers：`front = \`${base}${上标}\``，`back = result`，`tags = [topic]`

### 3.5 存储 v2（`js/storage.js`）

```js
// 本地存储键
const KEYS = {
  records:  'mq:records:v2',     // 成绩记录（数组）
  mastery:  'mq:mastery:v2',     // 单题掌握度（对象，key = `${subjectId}:${itemId}`）
  mistakes: 'mq:mistakes:v2',    // 错题集（数组）
  session:  'mq:session:v2',     // 进行中的测试（单个对象或 null）
  profile:  'mq:profile:v2'      // 打卡与偏好
};

// v1 旧键（迁移来源，只读）
const LEGACY = {
  records:  'math-memory-quiz-history:v1',
  mistakes: 'math-memory-quiz-mistakes:v1'
};
```

**成绩记录**

```js
{
  id: string,                // 唯一
  subjectId: string,         // 取代 v1 的 quizType
  mode: 'test' | 'mistakes', // 完整测试 / 错题重练
  completedAt: number,       // epoch ms
  accuracy: number,          // 0-100 整数
  correct: number,
  total: number,
  durationMs: number
}
```

**单题掌握度**（间隔重复的基础）

```js
{
  subjectId: string,
  itemId: string,
  level: number,        // 0 = 新题/未掌握，最大 MASTERY_MAX_LEVEL
  correct: number,      // 累计答对次数
  wrong: number,        // 累计答错次数
  streak: number,       // 当前连续答对次数（答错归零）
  lastSeenAt: number,
  dueAt: number         // 下次应复习时间 epoch ms，0 表示立即
}
```

`MASTERY_MAX_LEVEL = 5`，间隔阶梯（毫秒）：
`LEVEL_INTERVALS = [0, 10min, 1day, 3day, 7day, 21day]`，索引即 level。
答对：`level = min(level+1, MAX)`；答错：`level = 0`（回到今日）。`dueAt = now + LEVEL_INTERVALS[level]`。

**错题集**（沿用 v1 语义 + 新增字段）

```js
{
  id: string,            // `${subjectId}:${direction}:${itemId}` —— 与 v1 的 id 规则对齐
  subjectId: string,
  itemId: string,
  direction: 'forward' | 'backward',
  question: string,      // 展示用题面
  answer: string,        // 展示用正确答案
  wrongCount: number,    // 累计错次
  lastWrongAt: number,
  masteredCount: number  // 错题重练中连续答对次数，达到 2 即自动移出
}
```

**进行中的测试（中途存档）**

```js
{
  subjectId: string,
  mode: 'test' | 'mistakes',
  questionTypes: string[],      // 本轮启用的题型
  questionIds: string[],        // 冻结的题序（itemId）
  directions: ('forward'|'backward')[],
  answers: string[],            // 已作答内容，未答为空串
  currentIndex: number,
  startedAt: number,
  savedAt: number
}
```

**打卡与偏好**

```js
{
  streakDays: number,
  lastActiveDate: string,   // 'YYYY-MM-DD'（本地时区）
  bestStreakDays: number,
  prefs: { questionTypes: ['fill'], choicesPerQuestion: 4 }
}
```

### 3.6 存储 API（`js/storage.js` 必须导出）

```js
// 记录
export function readRecords(storage?)                 // → Record[]，按 completedAt 升序
export function recordsForSubject(subjectId, storage?) // → Record[]
export function saveRecord(record, storage?)           // → { record, previous }
export function compareRecords(current, previous)      // → { accuracyDelta, durationDeltaMs } | null

// 掌握度
export function readMastery(storage?)                              // → { [key]: Mastery }
export function masteryFor(subjectId, storage?)                    // → { [itemId]: Mastery }
export function applyMastery(subjectId, outcomes, storage?)        // → 更新后的掌握度对象
export function dueItems(subjectId, storage?, now?)                // → itemId[]，按 dueAt 升序

// 错题集
export function readMistakes(storage?)
export function mistakesForSubject(subjectId, storage?)
export function saveMistakes(subjectId, mistakes, storage?)        // 语义同 v1：同 id 累加 wrongCount
export function removeMistake(id, storage?)
export function clearMistakes(subjectId, storage?)

// 中途存档
export function readSession(storage?)                 // → Session | null
export function saveSession(session, storage?)
export function clearSession(storage?)

// 打卡
export function readProfile(storage?)
export function touchStreak(storage?)                 // → 更新后的 profile（跨日才 +1）
export function savePrefs(prefs, storage?)

// 迁移与数据管理
export function migrate(storage?)                     // → { migrated: boolean, records: number, mistakes: number }
export function exportData(storage?)                  // → { version: 2, exportedAt, records, mastery, mistakes, profile }
export function importData(payload, storage?, options?) // options: { mode: 'merge'|'replace' }
export function storageStats(storage?)                // → { records, mastery, mistakes, bytes }
```

**迁移规则（v1 → v2）**

- `math-memory-quiz-history:v1` 中 `quizType: 'percent'` → `subjectId: 'percent'`，
  `quizType: 'powers'` → `subjectId: 'powers'`，其余字段照抄，`mode: 'test'`。
- `math-memory-quiz-mistakes:v1` 同理映射 `subjectId`；`itemId` 从 v1 的 `id` 反解
  （v1 id 形如 `percent:percent-to-fraction:12.5` 或 `powers:base-to-result:square-17`），
  反解失败时 `itemId` 置为该条 `id` 本身（保证不丢数据、不阻断迁移）。
- v1 的 `direction` 取值 `percent-to-fraction` / `fraction-to-percent` /
  `base-to-result` / `result-to-base` 映射到 `forward` / `backward`：
  - `percent-to-fraction` → `forward`，`fraction-to-percent` → `backward`
  - `base-to-result` → `forward`，`result-to-base` → `backward`
- 迁移**幂等**：重复执行不产生重复数据。迁移完成后写入 v2 键，**但保留 v1 键不删除**
  （可回滚；用户手动「清空数据」时才清）。
- 迁移失败（JSON 损坏）时，忽略损坏数据并照常初始化 v2，**不得抛异常阻断应用启动**。

### 3.7 `history.js` 兼容外观（硬要求）

以下导出**必须继续存在且行为不变**，因为 `test/history.test.mjs` 依赖它们：

```js
readHistory(storage)            // → v1 形状的记录数组（含 quizType 字段），按 completedAt 升序
historyForType(quizType, storage)
readMistakes(storage)           // → v1 形状的错题数组（含 quizType 字段）
mistakesForType(quizType, storage)
saveMistakes(quizType, mistakes, storage)   // 返回 v1 形状数组；同 id 累加 wrongCount
removeMistake(id, storage)      // 返回 v1 形状数组
saveTestResult(quizType, metrics, storage)  // → { record, previous }，record 含 quizType
compareRecords(current, previous)
formatHistoryDate(timestamp)
```

实现方式：`history.js` 内部调用 `storage.js`，对外**把 `subjectId` 映射回 `quizType`**。

**同时**，`history.js` 必须新增导出 `getRecords`，返回 v2 形状（含 `subjectId`）。
> 原因：`test/history.test.mjs` 里 `readHistory(storage).length === 3` 与
> `historyForType('percent', storage)` 要求 percent 和 powers 的记录**同时**存在于同一数组。
> 测试还会用 v1 键 `math-memory-quiz-history:v1` 直接注入数据，因此 `readHistory`
> **必须能读取 v1 键**（迁移逻辑要兼容读旧键，不能只读 v2）。

### 3.8 判题契约（冻结）

数学两科的判题逻辑**必须保持现有行为**，因为 smoke 测试依赖它：

- percent `forward`（百分数→分数）：用户只填分母，判定 `1/<分母>` == `item.fraction`，
  通过 `normalizeFraction` 归一化（全角／÷、、空格、。．）。
- percent `backward`（分数→百分数）：数值比较，容差 `1e-6`。
- powers `forward`：`acceptedResults` 任一命中即对（容差 `1e-7`），兼容 `约` 前缀与 `≈ =`。
- powers `backward`：数值等于 `base`。

---

## 4. 引擎契约（`js/engine.js`）

```js
export function createEngine(options)
```

`options`：

| 字段 | 必需 | 说明 |
|---|---|---|
| `adapter` | ✔ | 3.3 的适配器对象 |
| `subject` | ✔ | 注册表里的科目定义 |
| `elements` | ✔ | DOM 元素句柄（见下） |
| `mode` | ✖ | `'test'`（默认）或 `'mistakes'` |
| `questionTypes` | ✖ | 默认取 `subject.questionTypes` |
| `restoreSession` | ✖ | 布尔，默认 `true`。是否尝试恢复未完成的测试 |
| `onFinish` | ✖ | `({ record, previous, results }) => void` |

`elements` 必须包含的 id（两个既有 HTML 已满足）：

```
welcome, quiz, result, testMeta, startButton, restartButton,
previousButton, nextButton, nextButtonText, answerInput,
answerSuffix, answerLabel, inputHint, promptValue, questionNumber,
directionLabel, questionInstruction, progressFill, headerProgress,
headerTime, scoreValue, accuracyValue, correctValue, durationValue,
comparisonLabel, accuracyComparison, timeComparison,
correctionTitle, correctionList
```

可选（percent 专有，缺失时引擎自动跳过）：
`answerWrap`, `fractionNumerator`, `equationOperator`, `topicLabel`

返回的引擎对象：

```js
{
  start(),            // 开始新一轮（清空存档）
  resume(),           // 恢复存档；无存档时等价于 start()
  hasSession(),       // → boolean
  destroy(),          // 解绑事件监听与定时器（离开页面时调用）
  getState()          // → 只读调试快照
}
```

**引擎行为要求**

1. 事件监听与定时器必须由 `destroy()` 可逆释放，不得泄漏。
2. 每次作答后写入 session 存档（节流：`input` 时更新内存，切题/交卷时落盘）。
3. 交卷时：保存 record、更新 mastery、写错题集、touchStreak、清 session、渲染订正。
4. `mode === 'mistakes'` 时：题目来源为错题集（`questionIds`），答对累计 `masteredCount`，
   达到 2 次自动移出错题集；此时不写 mastery 的 level 提升（只记正确/错误计数）。
5. 页面离开（`beforeunload` / `visibilitychange`）时落盘 session。

---

## 5. 选择题模式（`js/distractors.js`）

```js
export function buildChoices(item, direction, pool, options)
// → { choices: string[], answerIndex: number }
```

规则：

1. 干扰项从**同科目同 tags 的池子**里取（`tags` 全空的科目则从全池取），保证难度同构。
2. 取 `choicesPerQuestion - 1` 个干扰项，去重，且不得等于正确答案。
3. 干扰项不足时（池子太小）从更大范围补齐；仍不足则减题量，**绝不重复填充**。
4. 用 Fisher-Yates 洗牌（复用 `quiz.js` 的 `shuffle`），`answerIndex` 为正确项洗后下标。
5. 用可注入的 `random` 参数以便单测确定性。

---

## 6. UI 契约

- 首页（`index.html`）：科目卡片**由注册表渲染**（不再手写卡片），
  分「速算」与「考公常识」两组；保留历史成绩与错题集区块及其 id。
- 通用答题页（`quiz.html`）：通过 `?subject=<id>` 加载科目，未知 id → 回首页。
- 看板新增区块 id：`#dashboard-streak`、`#dashboard-trend`、`#dashboard-weak`
  （连续打卡天数 / 正确率趋势折线 / 各科弱项分布）。
- 趋势图用**内联 SVG 手绘**，不引入图表库。
- 所有新增区块在 390px 宽度下不得横向溢出（有测试把关）。
- 时政科目卡片必须显示 `更新于 YYYY-MM-DD`。

---

## 7. 验收标准

**必须全绿（不可修改现有测试）**

```powershell
npm test                     # 15/15
npm run test:browser         # percent 端到端
npm run test:powers-browser  # powers 端到端
```

**新增测试（`test/` 下，命名 `*.test.mjs` 会被 `npm test` 自动纳入）**

1. `registry.test.mjs`：每个科目 id 唯一、必填字段齐全、`page` 指向真实存在的文件、
   `questionTypes` 合法、`updatedAt` 格式合法。
2. `subjects.test.mjs`：遍历全部科目，校验 3.2 的 5 条数据质量硬性要求。
3. `storage-v2.test.mjs`：v1→v2 迁移正确且幂等、不丢数据、损坏数据不抛异常；
   导出/导入往返一致；`dueItems` 按 `dueAt` 升序；`applyMastery` 的升降级规则。
4. `engine.test.mjs`：`createQuiz` 方向均衡、`buildChoices` 干扰项去重且不含正确答案、
   池子不足时不重复填充。
5. `mastery.test.mjs`：level 上限、答错归零、间隔阶梯数值。

**人工验收（Lead 执行）**

- 用**真实 v1 数据**注入 localStorage，启动应用，确认历史成绩与错题集原样出现（迁移无损）。
- 浏览器实跑每个科目至少一轮，确认无 console error。
- 390px / 1440px 两个宽度下确认无横向溢出。

---

## 8. 禁止事项

1. ❌ 修改 `test/` 下任何既有文件。
2. ❌ 改 `js/data.js` / `js/powers-data.js` 的结构或数值。
3. ❌ 在 `history.js` 里改动第 3.7 节列出的导出签名。
4. ❌ 引入 npm 依赖、打包器、CDN 外链。
5. ❌ 任何地方硬编码科目 id 列表（必须走 `registry.js`）。
6. ❌ 在适配器里操作 DOM 或 localStorage。
7. ❌ 删除或改写用户的 v1 localStorage 数据（迁移是只读 + 新增，不删旧键）。
