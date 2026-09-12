// 正方体展开图折叠 —— 考公「图形推理」的第一个图形科目。
//
// 题型：题干给一张展开图（figure.kind = figure:cube-net），选项给四个「折叠后的立体图」
//       （choiceFigures[].kind = figure:cube-fold）。
//
// ── spec 形状（契约 7.2 / 7.3；渲染层由 public/js/figure.js 实现）──────────
//   题干 figure: { kind: 'figure:cube-net', spec: { cells: [[col,row], ...] } }   // 恰好 6 格
//   选项 figure: { kind: 'figure:cube-fold', spec: { visible: ['front','top','right'], labels: [前,上,右] } }
//
//   · visible —— 固定三个槽位名 ['front', 'top', 'right']，顺序即「前 / 上 / 右」。
//     figure.js 的 renderCubeFold 会校验这三面在当前相机下确实可见，四条选项完全一致。
//   · labels  —— **与 visible 同序**：labels[i] 是贴在槽位 visible[i] 上的展开图格子编号
//     （'1'..'6'，字符串）。四个选项的 visible 相同、labels 不同，这就是本题型的全部差异。
//
//   ⚠️ 为什么身份要放在 labels 而不是塞进 visible：
//     renderCubeFold 把 visible 的每一项当**面名**查表（front/top/right/back/left/bottom），
//     塞格子编号会直接抛「未知面名」，而且槽位名对任何一张立体图都是同一组，
//     四个选项会长得一模一样。图形的几何内容必须落在**面的身份**上，
//     本期的身份就是展开图格子编号（7.3 已明确本期不表达面上的图案）。
//     渲染约定：visible[0] 写前面的可见面、visible[1] 写顶面、visible[2] 写右侧面。
//
// ── 格子编号必须与 figure.js 的行优先编号一致 ───────────────────────────
//   renderCubeNet 给格子标号的方式是「按行优先排序后 index + 1」，
//   **不是**按 spec.cells 数组下标。所以本文件每一张展开图的 cells
//   都已经预先按 (row, col) 排好序，两种编号因此完全相同。
//   改数据时务必保持这个顺序（test/net-fold.test.mjs 有断言把关）。
//
// ── 干扰项构造原则（每个干扰项都有明确且可验证的几何错误）────────────────
//   展开图折好后 6 个格子分成 3 组对面；**相对的两个面在立方体上永远不可能同时可见**。
//   于是每个干扰项都取「一组对面 + 任意第三个面」，并把对面摆在不同的槽位上：
//     · 干扰项① 让 前 / 上 互为对面
//     · 干扰项② 让 前 / 右 互为对面
//     · 干扰项③ 让 上 / 右 互为对面
//   学生用「对面法」即可排除，错误原因唯一且可复述——不是随便画四个图充数。
//
// ── 唯一答案性 ─────────────────────────────────────────────────────────
//   每条的四个选项都用 net-fold.js 的 validateNetOption(cells, spec) 逐个验证，
//   恰好 1 项返回 true；test/net-fold.test.mjs 对全量题库再跑一遍并打印每条的通过数。
//   除「含对面」外还有第二道判据兜底：三个可见面必须是右手系排列
//   （front × top = right），镜像排列折不出来。
//
// ── 数据质量 ───────────────────────────────────────────────────────────
//   · 28 条，覆盖合法展开图的全部 11 个等价类（每类 2~3 种旋转/翻折形态）；
//   · front 逐条不同（同科目内 front 必须唯一，见 test/subjects.test.mjs）；
//   · back 是正确选项的标签 A/B/C/D，28 条里 7/7/7/7 均匀且顺序打散。
//     ⚠️ 标签天然重复：注册表里本科目必须设 allowDuplicateBack: true，否则 subjects.test 会红。
//
// 展开图不是手抄的坐标表，而是用「滚动立方体」折叠算法从 35 种六格骨牌里筛出来的
// 11 个合法等价类的代表（任意旋转/翻折的等价形式都能通过判定）。

const NET_01 = [[0,0],[0,1],[1,1],[2,1],[3,1],[0,2]];
const NET_02 = [[0,0],[0,1],[0,2],[1,2],[1,3],[1,4]];
const NET_03 = [[0,0],[0,1],[1,1],[2,1],[1,2],[1,3]];
const NET_04 = [[0,0],[0,1],[1,1],[1,2],[2,2],[1,3]];
const NET_05 = [[0,0],[0,1],[1,1],[1,2],[1,3],[2,3]];
const NET_06 = [[0,0],[0,1],[1,1],[2,1],[3,1],[1,2]];
const NET_07 = [[0,0],[0,1],[1,1],[1,2],[2,2],[2,3]];
const NET_08 = [[0,0],[0,1],[1,1],[2,1],[3,1],[2,2]];
const NET_09 = [[0,0],[0,1],[1,1],[2,1],[3,1],[3,2]];
const NET_10 = [[1,0],[0,1],[1,1],[2,1],[1,2],[1,3]];
const NET_11 = [[1,0],[0,1],[1,1],[1,2],[2,2],[1,3]];
const NET_12 = [[3,0],[0,1],[1,1],[2,1],[3,1],[3,2]];
const NET_13 = [[2,0],[3,0],[4,0],[0,1],[1,1],[2,1]];
const NET_14 = [[2,0],[0,1],[1,1],[2,1],[2,2],[3,2]];
const NET_15 = [[2,0],[3,0],[0,1],[1,1],[2,1],[1,2]];
const NET_16 = [[2,0],[3,0],[0,1],[1,1],[2,1],[0,2]];
const NET_17 = [[2,0],[0,1],[1,1],[2,1],[3,1],[3,2]];
const NET_18 = [[2,0],[1,1],[2,1],[0,2],[1,2],[0,3]];
const NET_19 = [[1,0],[0,1],[1,1],[2,1],[3,1],[3,2]];
const NET_20 = [[3,0],[0,1],[1,1],[2,1],[3,1],[0,2]];
const NET_21 = [[2,0],[0,1],[1,1],[2,1],[3,1],[2,2]];
const NET_22 = [[2,0],[0,1],[1,1],[2,1],[3,1],[1,2]];
const NET_23 = [[1,0],[1,1],[1,2],[0,3],[1,3],[2,3]];
const NET_24 = [[1,0],[1,1],[0,2],[1,2],[0,3],[0,4]];
const NET_25 = [[1,0],[1,1],[0,2],[1,2],[2,2],[2,3]];
const NET_26 = [[2,0],[1,1],[2,1],[3,1],[0,2],[1,2]];
const NET_27 = [[2,0],[1,1],[2,1],[1,2],[0,3],[1,3]];
const NET_28 = [[1,0],[1,1],[1,2],[2,2],[0,3],[1,3]];

export const ITEMS = Object.freeze([
  {
    id: 'cubenet-01',
    front: '能由第 1 号展开图折成的立体图是',
    back: 'A',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_01 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '2', '3'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-02',
    front: '能由第 2 号展开图折成的立体图是',
    back: 'A',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_02 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '4', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-03',
    front: '能由第 3 号展开图折成的立体图是',
    back: 'C',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_03 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '5', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-04',
    front: '能由第 4 号展开图折成的立体图是',
    back: 'C',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_04 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '6'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-05',
    front: '能由第 5 号展开图折成的立体图是',
    back: 'B',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_05 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '1', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-06',
    front: '能由第 6 号展开图折成的立体图是',
    back: 'B',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_06 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '1'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-07',
    front: '能由第 7 号展开图折成的立体图是',
    back: 'B',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_07 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '4', '3'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '6'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-08',
    front: '能由第 8 号展开图折成的立体图是',
    back: 'A',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_08 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '6', '3'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-09',
    front: '能由第 9 号展开图折成的立体图是',
    back: 'B',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_09 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['3', '1', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-10',
    front: '能由第 10 号展开图折成的立体图是',
    back: 'C',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_10 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '5', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['3', '2', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '6'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-11',
    front: '能由第 11 号展开图折成的立体图是',
    back: 'B',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_11 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['3', '4', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-12',
    front: '能由第 12 号展开图折成的立体图是',
    back: 'D',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_12 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['3', '6', '4'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-13',
    front: '能由第 13 号展开图折成的立体图是',
    back: 'C',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_13 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '4', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['4', '1', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '6'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-14',
    front: '能由第 14 号展开图折成的立体图是',
    back: 'C',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_14 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['4', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '5', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-15',
    front: '能由第 15 号展开图折成的立体图是',
    back: 'C',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_15 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['4', '5', '1'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-16',
    front: '能由第 16 号展开图折成的立体图是',
    back: 'D',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_16 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['4', '6', '5'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-17',
    front: '能由第 17 号展开图折成的立体图是',
    back: 'C',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_17 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['5', '1', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-18',
    front: '能由第 18 号展开图折成的立体图是',
    back: 'B',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_18 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['5', '3', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '5', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '6'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-19',
    front: '能由第 19 号展开图折成的立体图是',
    back: 'B',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_19 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['5', '4', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-20',
    front: '能由第 20 号展开图折成的立体图是',
    back: 'A',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_20 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['5', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-21',
    front: '能由第 21 号展开图折成的立体图是',
    back: 'D',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_21 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['6', '2', '5'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-22',
    front: '能由第 22 号展开图折成的立体图是',
    back: 'D',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_22 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['6', '3', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-23',
    front: '能由第 23 号展开图折成的立体图是',
    back: 'A',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_23 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['6', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '4', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-24',
    front: '能由第 24 号展开图折成的立体图是',
    back: 'A',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_24 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['6', '5', '1'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '5'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-25',
    front: '能由第 25 号展开图折成的立体图是',
    back: 'D',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_25 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '2', '5'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-26',
    front: '能由第 26 号展开图折成的立体图是',
    back: 'D',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_26 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '4'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '4'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-27',
    front: '能由第 27 号展开图折成的立体图是',
    back: 'D',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_27 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '3', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '5', '2'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  },
  {
    id: 'cubenet-28',
    front: '能由第 28 号展开图折成的立体图是',
    back: 'A',
    tags: ['展开图折叠'],
    figure: { kind: 'figure:cube-net', spec: { cells: NET_28 } },
    choiceFigures: [
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '6', '5'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '3', '2'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['2', '4', '6'] } },
      { kind: 'figure:cube-fold', spec: { visible: ['front', 'top', 'right'], labels: ['1', '4', '5'] } },
    ],
    choiceTexts: ['A', 'B', 'C', 'D']
  }
]);
