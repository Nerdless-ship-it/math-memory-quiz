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

### 3.0 模块路径基准（踩过坑，务必先读）

**所有路径字符串一律以 `public/js/` 为基准解析**，并用 `registry.js` 的
`resolveModuleUrl(path)` 转成绝对 URL 后再 `import()`。

```
适配器在 public/js/adapters/  →  './adapters/percent.js'
题库在   public/subjects/     →  '../subjects/jieqi.item.js'
```

历史教训：`registry.contentPath()` 早期返回相对字符串，被 `js/adapters/generic.js`
消费后解析成 `/js/subjects/x.item.js` → **404**，8 个常识科目全部打不开。
现在 `contentPath()` / `adapterPath()` 一律返回**绝对 URL**，消费方不得自己拼基准。

### 3.0.1 维度交叉与方向锁（出题正确性的核心）

统一模型里 `front` 是提示、`back` 是答案。但一个科目内**多个维度会互有同名交叉**：

```
chaodai 的「开国君主」组  front='秦'  back='秦始皇嬴政'
chaodai 的「都城」组      front='咸阳' back='秦'
```

于是「秦」既是某条的题目文本，又是另一条的答案。由此产生两个必须显式处理的后果：

1. **题面歧义**：用户看到「秦」不知道要填君主还是都城。⇒ 必须显示 `tags` 派生的
   维度提示（`registry.js` 的 `DIMENSIONS`），例如「朝代 → 开国君主」「都城 → 朝代」。
   `DIMENSIONS` 同时是 tags 白名单，打错的标签会让提示静默失效，故有测试校验。

2. **反向题无解**：`都城` 组反向问「秦 → ？」有多个正确答案；`huaxue` 的
   `符号释义` 组（`front='H' back='氢'`）正向问「H → ？」更是完全无解。
   ⇒ 用方向锁表达（`registry.js` 的 `LOCKED_DIRECTIONS` 与 `DIMENSION_LOCKS`）：

   | 锁值 | 含义 | 例子 |
   |---|---|---|
   | `'forward'` | 只能正向出题（提示 front，作答 back） | `chaodai` 的「都城」组 |
   | `'backward'` | 只能反向出题（提示 back，作答 front） | `huaxue` 的「符号释义」组 |
   | 未登记 | 双向自由 | `lishi-changshi` |

   `engine.js` 的 `createQuiz` 保证受锁条目的方向落在锁定值内；若受锁条目超过
   反向槽位数，会牺牲方向均衡也不出无解题（`test/engine.test.mjs` 已覆盖）。

**副作用（取舍，已知并接受）**：`shengxiao` / `jieqi` / `chaodai` 三科整体锁为
`forward`，因此这三科没有反向题。这是为消除歧义付出的代价。若要恢复双向，
需要为这些科目补写语义明确的反向条目（例如把「生肖排序第一位」写成可由生肖反查的形式）。

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
  savedAt: number,
  // ── 以下两个字段为选择题模式新增，**可缺省**（旧存档没有它们也合法）──
  types: ('' | 'fill' | 'choice')[],  // 每题题型；空串表示「未分配」，由引擎重新决定
  choices: string[][]                 // 每题选项（填空题为 []），读回时保持原顺序
}
```

> ⚠️ **`normalizeSession` 是严格白名单**：没列进去的字段会被静默丢弃。这不是理论风险——
> 选择题模式新增 `types` / `choices` 时若忘了同步白名单，存档「写入成功、读回成功」，
> 但题型与选项全部消失，刷新后选择题静默退化成填空题，**且没有任何报错**。
> 加字段时务必同步 `storage.js` 的 `normalizeSession`，并补一条回归测试
> （见 `test/storage-v2.test.mjs` 的「session 必须是严格白名单」）。
>
> 引擎读取时用「长度与题量对得上且值合法」判断能否采信；不采信时只重新分配「怎么问」，
> **不动 `answers` / `directions` / `currentIndex`**，用户不会丢答案。

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

### 3.7.1 两条实测得出的硬规则（不写进契约就会被人「优化」掉）

**规则 A：`saveRecord` 必须对数学两科双写 v1 键。**
`test/browser-smoke.mjs` 与 `test/powers-browser-smoke.mjs` 断言
`JSON.parse(localStorage.getItem('math-memory-quiz-history:v1')).filter(r => r.quizType === 'x').length === 2`。
只写 `mq:records:v2` 会让这两条 e2e 立刻变红。实现为**只追加、按 id 去重、不删除、不改写**，
符合第 8.7 节「不删旧键」。非数学科目不写旧键，避免把新格式灌进旧键。

**规则 A2：v1 错题对象没有 `quizType` 字段，科目只存在于 id 前缀。**
> ⚠️ 这是本项目发生过的最严重的一次静默数据丢失：`legacyMistakeToMistake` 早期直接读
> `entry.quizType` 并要求它属于已知科目，于是**所有真实 v1 错题都返回 null 被丢弃**
> ——迁移"成功"、无异常、无日志，但老用户升级后错题集全空。而 92 个单元测试全绿，
> 因为它们喂的是 `history.js` 输出的 v1 外观（那种形状**才有** `quizType`），
> 与真实 localStorage 形状不同。

真实形状对照：

```js
// history.js 输出的 v1 外观（有 quizType）—— 单元测试用的是这种
{ id: 'percent:forward:12.5', quizType: 'percent', question, answer, wrongCount, lastWrongAt }

// 真实 v1 localStorage（没有 quizType）—— 用户升级时实际读到的
{ id: 'percent:percent-to-fraction:12.5', question, answer, wrongCount, lastWrongAt }
```

因此 `subjectId` 只能来自两处：**显式 `quizType` 字段**，或**可解析的 id 前缀**
（`parseMistakeId`）。不得把「id 无法解析」的条目也硬套一个科目，那属于脏数据，
应被过滤（`test/storage-v2.test.mjs` 有对应断言）。
回归测试：`test/storage-v2.test.mjs` 中「v1 错题即使没有 quizType 字段也必须迁移」。

**规则 B：records 读路径用并集，mistakes 读路径用「非空 v2 即信任」。**
两者方向不同，且都是必需的：
- records 没有任何删除 API，并集（v2 ∪ v1，按 id 去重）不会复活已删数据，
  还能兼容「先跑一轮、之后再注入 v1」这种验收顺序。
- mistakes 有 `removeMistake` / `clearMistakes`，若对**非空** v2 做并集，
  刚移除的错题会立刻从 v1 镜像复活。
- 但 **v2 为空数组时必须回退 v1**：用户只要跑过任意一轮测试（哪怕一题没错）
  就会写出一个空的 `mq:mistakes:v2`，若此时「存在即信任」，旧用户的 v1 错题
  会从此永久不可见。所以判据是「非空」而不是「存在」。

**规则 C：「清空数据」必须用 `clearAllData`。**
它同时清 v1 两键与 v2 五键。只清 v2 的话，v1 镜像会在下次读取时被重新迁回。

### 3.7.2 掌握度与打卡的接线（最易静默失效的地方）

`engine.js` 的 `createDefaultStore` 覆盖成绩 / 错题 / 存档三个端口，而
**掌握度与打卡走 `store.recordOutcomes` / `store.touchStreak`**。
引擎默认已通过 `createStorageStore()` 接上 `storage.js`；若这两条链路断开，
**不会报任何错**，只是 `mq:mastery:v2` 与打卡天数永远是空的——这是本项目最难发现的一类 bug。

`createStorageStore()` 的三个刻意设计，改动前请先读懂：

1. 方法体内**动态** `import('./storage.js')`。引擎在 `app.js` / `powers-app.js` 里是
   同步创建的，模块顶层 await 会拖慢首屏，并可能让冻结 e2e 在点「开始测试」时引擎尚未就绪。
2. 每个方法都自行 catch 且**永不 reject**。动态 import 失败若无人接住会变成
   unhandled rejection，而冻结 e2e 断言 `consoleErrors.length === 0`。
3. `mode === 'mistakes'` 时，同一份 outcomes 还要调用 `recordMistakeOutcome`
   维护 `masteredCount`，连续 `MISTAKE_MASTERY_THRESHOLD`（2）次答对自动移出错题集。

### 3.7.3 错题重练必须真的收窄题库

`engine.start()` 一律取 `adapter.items()`，因此光传 `mode: 'mistakes'` 不会改变题量——
「重练错题」会退化成整卷重测（按钮在撒谎）。实现见 `quiz-page.js` 的
`buildMistakesAdapter()`：用 `Object.create(adapter, { items })` 只替换 `items()`，
其余判题/题面/错题登记方法全部沿用原适配器，保证作答体验一致。

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

`options`：`{ choicesPerQuestion = 4, random = Math.random, prompt?, answer? }`。
`choices` 已乱序（Fisher-Yates，复用 `quiz.js` 的 `shuffle`），**恰好一个**元素等于正确答案，
`answerIndex` 指向它。答案为空串时返回 `{ choices: [], answerIndex: -1 }`。

规则：

1. 干扰项从**同科目同 tags** 的池子里取（`tags` 全空则从全池取），保证难度同构。
2. **按方向取对应字段**：`forward` 只从其它条目的 `back` 取，`backward` 只从 `front` 取。
3. 用 `adapters/generic.js` 的 `normalizeText` 去重（`'1.7'` 与 `'1.7 '` 视为同一项）。
4. 干扰项**不得等于正确答案**，也**不得等于题面**——后者是第 3.0.1 节维度交叉的必然要求：
   真实题库 552 个「科目×条目×方向」组合里有 **150 个**存在与题面同文的候选
   （生肖 12 / 节气 16 / 朝代 18 / 化学 104）。只排除「等于答案」会让用户看到
   「秦 → ？」，而选项里赫然写着一个「秦」，逻辑上自相矛盾。
5. 池子不足时从更大范围补齐；仍不足则**减少选项数**（夹在 2..8），绝不重复填充凑数。
6. 纯函数，不碰 DOM、不读写 localStorage；`random` 可注入以便确定性测试。

**引擎接入**（`engine.js`）：科目 `questionTypes` 同时含 `fill` 与 `choice` 时，
按 `choiceRatio`（默认 0.5）逐题随机选题型；选项凑不齐 2 个时该题**退回填空**。
选项容器 `#choice-list` 取自 `ELEMENT_IDS`，**缺失时整条选择题路径关闭**并退回填空——
`percent.html` / `powers.html` 没有这个节点，因此两科的交互一字未变。

判分**不新造逻辑**：交卷时仍走 `adapter.isCorrect(question, { direction, input: question.answer })`，
所以统计、错题集、订正、掌握度、打卡全部与填空共用同一条路径。

---

## 6. 就绪契约（`body[data-engine-ready="1"]`）

三种答题页（`percent.html` / `powers.html` / `quiz.html`）都在**所有按钮监听挂好之后**
设置 `document.body.dataset.engineReady = '1'`。

为什么必须统一：`percent.html` / `powers.html` 的开始按钮在**静态 HTML 里就是 enabled**，
而点击监听要等 deferred module 执行完才挂上。两者之间存在一个「点了没反应」的窗口，
外部（尤其自动化测试）只判断「按钮存在且未 disabled」就会点空，**且控制台没有任何报错**。
实测该窗口造成过 12 轮里 5 次偶发失败，且能在改前基线上复现。

因此：判定页面可交互请**以这个标记为准**（可配合 `disabled` 状态做二重保险）。

---

## 7. 图形题：图形题干 + 图形选项

### 7.1 为什么要单独一个题型

考公「图形推理」里的**正方体展开图折叠**与**截面图**是「图形题干 + 图形选项」，
而现有 `'choice'` 题型的选项是**从其它条目的答案文本生成的**——图形选项无处安放。
因此新增一个题型 `'figure-choice'`，**不改动**已被测试覆盖的 `'choice'` 通路。

### 7.2 Item 扩展（可缺省，不影响任何既有科目）

```js
{
  id, front, back, tags,          // 既有字段，保持不变
  figure: {                       // 可选：题干图形
    kind: 'cube-net' | 'cross-section' | 'custom',
    spec: object                  // 交给 figure.js 渲染
  },
  choiceFigures: [                // 可选：图形选项（与 choices 一一对应）
    { kind, spec } | null         // null 表示该项是纯文本
  ],
  choiceTexts: string[]           // 与 choiceFigures 等长的文字标签（可为 ''）
}
```

**硬性约定**：

1. `figure` 缺失时该条目退化为普通文字题，行为与今天完全一致。
2. `choiceFigures` 与 `choiceTexts` 必须等长；`kind` 必须在 `figure.js` 的白名单里。
3. **所有图形由代码计算生成**（内联 SVG），不得手写坐标、不得外链图片、
   不得引入任何依赖——这是零依赖 + 静态托管约束的必然要求，也是几何正确性的唯一保证。
4. 渲染产物必须携带 `role="img"` 与 `aria-label`（无障碍，且便于测试定位）。

### 7.3 `figure.js` 契约（**spec 形状由本节锁定，两方不得各自发明**）

```js
export function renderFigure(figure, options)  // → SVGElement（内联 <svg>）
export function figureAriaLabel(figure)        // → string
export const FIGURE_KINDS                       // → Set<string> 白名单
```

支持的 `figure.kind` 与 `spec`：

> **命名空间约定（重要）**：图形类型的取值一律带前缀，形如 `figure:<name>`。
> 原因是科目 id 与图形类型会重名（例如都有 `cube-net`），若不区分，
> 架构测试「渲染代码不得硬编码科目 id」会把图形类型名误判成硬编码的科目 id
> ——那是**假阳性**，但放宽规则又会掩盖真问题。加前缀后两个命名空间互不干扰，
> 规则可以保持严格。

```js
// ① 正方体展开图（题干用）
{ kind: 'figure:cube-net', spec: { cells: [[col, row], ...] } }   // 恰好 6 格

// ② 折叠后的立体图（选项用）
{ kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'] } }
//   visible 是「从观察方向能看到的三个面」的固定三元组，用于区分四个选项的朝向组合。
//   渲染时三个可见面填不同灰阶，并在面内标注 前/上/右 以便辨认。
//   ⚠️ 本期**不表达「面上有图案」**——图案朝向涉及折叠旋转矩阵，风险高、收益低。
//      选项之间的几何差异靠「哪三个面可见」表达，这与真题的「相邻/相对关系」考法一致。

// ③ 立方体截面（题干用：立体被一刀切）
{ kind: 'figure:cross-section', spec: { planeNormal: [a, b, c], d: number } }

// ④ 截面形状（选项用：只画截面本身，正视图）
{ kind: 'figure:section-shape', spec: { planeNormal: [a, b, c], d: number } }

// ⑤ 自定义（逃生口，仅用于确实无法参数化的图）
{ kind: 'figure:custom', spec: { svg: '<svg …>…</svg>' } }

// ⑥ 小立方体堆叠的立体图（三视图题的题干用）
{ kind: 'figure:block-solid', spec: { cubes: [[x, y, z], ...] } }

// ⑦ 单个视图（主视图 / 俯视图 / 左视图的二维方格）
{ kind: 'figure:view-cells', spec: { cols: number, rows: number, cells: [[col, row], ...] } }
//   ⚠️ 这里存的是**二维格子**而不是立体：三视图题的错项是「左右镜像 / 多一格 / 少一格」
//      这类形状，它们不对应任何立体，只能以格子表达。格子由 three-views.js 生成，
//      不是手写坐标（手写就会出现「视图和立体对不上」——而这正是本题型要考的东西）。

// ⑧ 三视图组合（给三视图选立体那一类题的题干）
{ kind: 'figure:three-views', spec: { cubes: [[x, y, z], ...] } }
//   画标准布局：主视图左上、左视图右上、俯视图在主视图正下方，并标注三个小标题。
//   布局本身就是知识点（长对正、高平齐、宽相等），所以间距也保持对齐关系。

// ⑨ 标准几何体的立体图（圆柱 / 圆锥 / 球 / 长方体 / 正棱柱 / 正棱锥）
{ kind: 'figure:solid-3d', spec: { solid: 'cylinder' } }

// ⑩ 视图形状（矩形 / 圆 / 等腰三角形 / 正多边形；椭圆只作为干扰项出现）
{ kind: 'figure:view-shape', spec: { shape: { kind: 'rect', width: 2, height: 1.8 } } }

// ⑪ 标准几何体的三视图组合
{ kind: 'figure:shape-views', spec: { solid: 'cone' } }
```

**标准几何体的视图规则**（`solid-shapes.js`，教材结论）：

| 几何体 | 主视图 | 俯视图 | 左视图 |
| --- | --- | --- | --- |
| 圆柱 | 矩形 2r×h | 圆 r | 矩形 2r×h |
| 圆锥 | 等腰三角形 2r×h | 圆 r | 等腰三角形 |
| 球 | 圆 r | 圆 r | 圆 r |
| 长方体 | 矩形 w×h | 矩形 w×d | 矩形 d×h |
| 正三棱柱（一条棱朝前） | 矩形 √3r×h | 正三角形 | 矩形 1.5r×h |
| 正四棱锥 | 等腰三角形 √2r×h | 正方形＋对角线 | 等腰三角形 |

三条投影关系对所有几何体都成立，且由测试逐条断言：**长对正**（主视图宽＝俯视图宽）、
**高平齐**（主视图高＝左视图高）、**宽相等**（左视图宽＝俯视图高）。

⚠️ **干扰项不得是「等比缩放的同一个形状」**：矩形 2×1.8 与 1×0.9 长宽比相同、
圆 r=1 与 r=0.5 只差大小——选项里没有比例尺参照时，它们在语义上仍是正确答案，
会让一道题出现两个正确选项。所以干扰项只能**改变形状本身**：换一种形状、改长宽比、
改边数、或漏画棱线。`test/solid-shapes.test.mjs` 有一条断言专门守这个。

**三视图的方向约定**（`three-views.js`，中国第一角投影，与教材一致）：

- 主视图：右 = 物体右，上 = 物体上
- 俯视图：右 = 物体右，**下 = 物体前**（离主视图越远越靠前）
- 左视图：上 = 物体上，**右 = 物体前**

这两条加粗规则是本题型对错的根据，也是最经典的错项来源（左右镜像）。
约定由 `test/three-views.test.mjs` 里**手推的黄金样例**守住——期望网格是按教材一行行
推出来的，不是从实现里抄的，改动取行/取列方式一定变红。

**渲染层硬约束**：

1. 所有图形**由 geometry.js 计算后生成内联 SVG**；不得手写坐标、不得外链图片、不得引入依赖。
2. 每个 `<svg>` 必须带 `role="img"` 与 `aria-label`（无障碍 + 便于测试定位）。
3. 未知 `kind` **必须抛错**，不得静默渲染成空白——静默空白是图形题最危险的失败模式。
4. 固定 `viewBox`，`width: 100%` + `max-width`，保证 390 / 891 / 1440 三档都不横向溢出。
5. 只画可见棱（消隐），被遮挡的棱用虚线，避免学生误读结构。

### 7.3.1 `solid-builder.js` 契约（三视图搭建器：交互工具，不是题库）

欢迎页的演示按钮分两类，由注册表的 `demo` 字段决定（渲染/控制代码不得出现科目 id）：

| `demo` | 出现什么 | 模块 |
| --- | --- | --- |
| `'figure'` | 「看展开演示 / 看切割演示」：翻看题库图形并播放动画 | `fold-anim-view.js` |
| `'builder'` | 「自己搭立体图形」：可交互的搭建器 | `solid-builder.js` |

```js
export function mountSolidBuilder(container, options)  // → { setCubes, getCubes, setTab, setMode, clear, view, root, destroy }
export function renderSolidScene(cubes, { yaw, pitch, … })  // → SVGElement（每个可见面带命中信息）
export function renderGridView(view, { cell, pad })         // → SVGElement（主/俯/左视图都是它）
export function orbit(point, yawDeg, pitchDeg)              // 相机旋转（世界坐标 → 相机坐标）
export function addCube / removeCube / neighborAcross       // 纯函数，越界与重复都是空操作
export const MAX_SIZE = 4                                   // 4×4×4 上限：场景范围固定，加方块时画面不跳
```

三条设计约束：

1. **几何全部复用 `three-views.js`**（同一套坐标与方向约定），搭建器只管画与交互——
   否则「题目里的视图」和「搭建器里的视图」会各算一套，迟早不一致。
2. **不复用 `fold-anim-view.js` 的相机**：那套是为折叠动画的纸面坐标（y 向下、z 离纸向上）
   写的，直接借用会把 y/z 搞反；`orbit()` 用自己的基，并有单测断言 0/0 是恒等变换、旋转保长。
3. **转动观察方向不改变三个视图**（视图由立体本身决定）。这条是搭建器的教学核心，
   由 `test/solid-builder.test.mjs` 断言：拖动前后三个视图的渲染签名必须逐字相同。

### 7.4 `geometry.js` 契约（纯函数，可单测；不得触碰 DOM）

```js
// 立方体截面：平面 ∩ 实心立方体 → 凸多边形顶点（3D），按极角排序
export function cubeSection(planeNormal, d)          // → [[x,y,z], ...]
export function sectionSideCount(planeNormal, d)     // → number
export function sectionName(planeNormal, d)          // → '三角形' | '四边形' | '五边形' | '六边形' | null

// 等距投影与消隐（供渲染层复用）
export function project(point3d)                     // → { x, y }（屏幕坐标）
export function cubeFaces()                          // → 每个面的顶点索引与法向

// 正方体展开图：网格坐标 → 折叠后的六个面朝向
// ⚠️ 参数一律是 `cells`（`[[col,row], ...]` 坐标数组本身），不要包一层 { cells }；
//    figure.js 渲染前会取 figure.spec.cells 再传进来。
export function foldNet(cells)                       // → 6 个面的朝向映射
export function oppositePairs(cells)                 // → [[faceA, faceB], ...] 三组对面
export function isAdjacentInNet(cells, a, b)         // → boolean
export function relativeFaces(cells)                 // → 面之间的相对关系（供干扰项判定）
export function isOppositeInCube(a, b)               // → boolean
export function isValidNet(cells)                    // → boolean，是否合法展开图（11 种之一）
export function validateNetOption(cells, option)     // → boolean，该立体图能否由该展开图折成
```

**已验证的几何事实（可作断言）**：

- 立方体截面只可能是 **3～6 边**形；**不存在七边形**——这正是真题最常见的陷阱选项，
  程序可自动生成。
- 平面与立方体求交：逐条棱求交点、去重、按平面内极角排序即可稳定得到凸多边形。
- **中空立方体（只有 12 条棱）的截面不属于本模型**：平面与「棱」相交得到的是离散点，
  不是平面区域，无法用 `cubeSection` 生成。此类题目**本期不做**。

### 7.5 判分与订正

- 判分仍走 `adapter.isCorrect(item, ctx)`，**图形选项不改变判分语义**：选中项的文本标签参与比对。
- 每个图形选项必须同时有 `choiceTexts` 文字标签（如 `A / B / C / D` 或形状名），
  既用于判分，也用于**订正行的文字回显**——否则错题集里只剩一张图，无法复习。

### 7.6 测试要求

1. `geometry.test.mjs`：截面边数/形状名、七边形不可能性、展开图折叠的对面关系与
   邻接关系、投影确定性。
2. `figure.test.mjs`：白名单校验、未知 kind 必须抛错而不是静默空白、
   SVG 必须带 `role="img"` 与 `aria-label`。
3. 真实浏览器：图形题在 **390 / 891 / 1440** 三档宽度都不横向溢出
   （891 = 用户实际窗口宽度，见 7.1 节相邻的中间宽度教训）。

---

## 8. UI 契约

- 首页（`index.html`）：科目卡片**由注册表渲染**（不再手写卡片），
  分「速算」与「考公常识」两组；保留历史成绩与错题集区块及其 id。
- 通用答题页（`quiz.html`）：通过 `?subject=<id>` 加载科目，未知 id → 回首页。
- 看板新增区块 id：`#dashboard-streak`、`#dashboard-trend`、`#dashboard-weak`
  （连续打卡天数 / 正确率趋势折线 / 各科弱项分布）。
- 趋势图用**内联 SVG 手绘**，不引入图表库。
- 所有新增区块在 390px 宽度下不得横向溢出（有测试把关）。
- 时政科目卡片必须显示 `更新于 YYYY-MM-DD`。

### 7.1 长题面必须能换行（踩过的坑，务必保留）

`styles.css` 给 `.prompt-value` 设了 `white-space: nowrap`，字号是
`clamp(48px, 6vw, 76px)`。这对数学科的「12.5%」「17²」完全没问题，
但常识科的题面是**整句中文**（最长 42 字，如刑法的八种犯罪列举），于是：

| 窗口宽度 | 溢出 |
|---|---|
| 900px | **624px** |
| 880px | **773px** |
| 768 / 820px | 0（字号已降到 52px 下限，侥幸不溢出） |

**这正是为什么只查 390px 和 1440px 永远发现不了它**——故障只发生在
768–1024 这个中间区间。修法（`quiz.css`）：

```css
.equation.choice-equation { grid-template-columns: minmax(0, 100%); }
.choice-equation .prompt-value {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.18;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden;
}
.choice-equation .prompt-value.long-prompt { font-size: clamp(26px, 3.6vw, 44px); }
.choice-equation .prompt-value.very-long-prompt { font-size: clamp(20px, 2.8vw, 34px); }
```

字号分档由 `engine.js` 的 `promptLengthClass()` 按字数打 class
（>12 字 `long-prompt`，>22 字 `very-long-prompt`），**只作用于选择题**，
数学科的题面仍是 `nowrap` 单行，交互一字不变。

**测试要求**：溢出检查必须覆盖中间宽度，并且不能只量「第一题」——
第一题的题面往往很短。`qa-output/overflow-audit.mjs` 现在会把题面**替换成极端长文本**
（26/42/43 字）做压力测试，这样布局上限不依赖随机抽到哪道题；
`qa-output/midwidth-sweep-audit.mjs` 则穷举 12 档宽度 × 全部 276 道常识题。

---

## 9. 验收标准

**必须全绿（不可修改现有测试）**

```powershell
npm test                     # 123 项：既有 15 + 引擎 + 存储 + 掌握度 + 注册表 + 题库质量
                             #         + 架构不变量 + 选择题干扰项
npm run test:browser         # percent 端到端（升级前冻结用例）
npm run test:powers-browser  # powers 端到端（升级前冻结用例）
npm run test:all-subjects    # 全部 10 个科目端到端 + 首页看板 + 响应式溢出
```

**新增测试（`test/` 下，命名 `*.test.mjs` 会被 `npm test` 自动纳入）**

1. `registry.test.mjs`：每个科目 id 唯一、必填字段齐全、`page` 指向真实存在的文件、
   `questionTypes` 合法、`updatedAt` 格式合法。
2. `subjects.test.mjs`：遍历全部科目，校验 3.2 的 5 条数据质量硬性要求，
   并打印「内容完整性报告」。
3. `storage-v2.test.mjs`：v1→v2 迁移正确且幂等、不丢数据、损坏数据不抛异常；
   导出/导入往返一致；`dueItems` 按 `dueAt` 升序；`applyMastery` 的升降级规则。
4. `mastery.test.mjs`：level 上限、答错归零、间隔阶梯数值。
5. `engine.test.mjs`：方向均衡、**方向锁（受锁条目永不落到被禁止方向）**、
   适配器判分边界、存档与结算。
6. `all-subjects-smoke.mjs`：真实浏览器遍历 10 个科目的答题页，校验首页注册表驱动、
   看板三区块、未知科目回退、390px 无横向溢出、零 console error。

**已知的测试盲区（不要以为有覆盖）**

- `test/subjects.test.mjs` 的 5 条规则**只能校验结构一致性，无法校验事实正确性**。
  法律常识与时政常识由 AI 生成，虽已尽力核实，仍可能有事实错误；
  数据里也标注了来源与不确定条目。**内容准确性需要人工抽查**。
- `qa-output/` 下的验收脚本（`mistakes-mode-check.mjs`、`mastery-e2e-check.mjs`）
  是 Lead 的一次性验证，不在 `npm test` 里，且 `qa-output/` 已被 gitignore。

**人工验收（Lead 执行）**

- 用**真实 v1 数据**注入 localStorage，启动应用，确认历史成绩与错题集原样出现（迁移无损）。
- 浏览器实跑每个科目至少一轮，确认无 console error。
- 390px / 1440px 两个宽度下确认无横向溢出。

---

## 10. 禁止事项

1. ❌ 修改 `test/` 下任何既有文件。
2. ❌ 改 `js/data.js` / `js/powers-data.js` 的结构或数值。
3. ❌ 在 `history.js` 里改动第 3.7 节列出的导出签名。
4. ❌ 引入 npm 依赖、打包器、CDN 外链。
5. ❌ 任何地方硬编码科目 id 列表（必须走 `registry.js`）。
6. ❌ 在适配器里操作 DOM 或 localStorage。
7. ❌ 删除或改写用户的 v1 localStorage 数据（迁移是只读 + 新增，不删旧键）。
