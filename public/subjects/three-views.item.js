// 三视图 —— 考公「图形推理 · 视图类」题库（24 题，4 选 1）。
//
// 题型（两种都是真题里的常见形式）：
//   ① 给立体图，问「它的主视图 / 俯视图 / 左视图是哪个」——18 题（6 个立体 × 3 个方向）
//   ② 给三视图，问「对应的立体图形是哪个」——6 题
//
// ── 几何与方向约定（改数据前必读）────────────────────────────────────
//   全部由 public/js/three-views.js 算出来：单位立方体堆叠、中国第一角投影。
//   两条决定对错的规则（教材与制图资料的统一表述，见 three-views.js 顶部注释）：
//     · 俯视图的**下方**是物体的前方（上方是后方），左右与物体一致
//     · 左视图的**右方**是物体的前方（左方是后方），上下与物体一致
//   所以「左右镜像」是对错的分水岭：镜像后的图形一定不对，是本题型最主要的干扰项。
//
// ── 题型①的干扰项（每个都有明确且可复述的错误理由）────────────────────
//   按优先级依次尝试，取前 3 个与正确图形**互不相同**的：
//     1) 方向看错 —— 拿相邻方向的视图充数（问主视图却给左视图）
//     2) 左右镜像 —— 前后/左右搞反（本题型最经典的错法）
//     3) 上下镜像 —— 高低搞反
//     4) 少一个方块 —— 数漏一格
//     5) 多一个方块 —— 多数一格
//   立体左右对称时镜像会与正确图形重合，那种候选会被自动跳过（不靠人工挑数据）。
//   每题实际用了哪三个理由，导出在 DISTRACTOR_REASONS 里，测试逐条核对。
//
// ── 唯一答案性 ───────────────────────────────────────────────────
//   正确答案 = orthoView(cubes, view) 算出来的图形本身，因此必然正确；
//   错项由 viewKey() 保证与正确答案不同、且彼此不同（凑不出 3 个就在导入时抛错，
//   不留「选项里有重复图形」的隐患）。题型②同理：四个立体里恰好一个的三视图与题干一致。
//   test/three-views.test.mjs 用独立的手推黄金样例再验一遍方向约定。
//
// ── 为什么选项存「格子」而不是「立体」────────────────────────────────
//   题型①的错项是镜像 / 多一格 / 少一格这类形状，它们**不对应任何立体**，
//   只能以二维格子的形式表达（figure:view-cells）。格子是构建时由 three-views.js
//   生成的，不是手写坐标；题型②的选项是立体，仍然由 cubes 现场画。

import {
  orthoView,
  viewKey,
  viewsKey,
  mirrorHorizontally,
  mirrorVertically,
  withoutCell,
  withExtraCell,
  VIEWS,
  VIEW_LABELS
} from '../js/three-views.js';
import { SOLID_BY_ID, SOLID_SHAPES, solidViews, solidViewsKey, shapeKey } from '../js/solid-shapes.js';

// ── 立体库（单位立方体堆叠，坐标约定见 three-views.js）──────────────────
// 每个立体都刻意选成**不对称**：这样镜像后的图形与正确答案不同，干扰项才成立；
// 也确实存在部分视角下镜像与正确图形重合的情况（例如正对面看一个对称的立体），
// 那种候选由生成器自动跳过。
const SOLIDS = Object.freeze([
  {
    id: 'stair',
    // 三级台阶：左侧三级、右侧一级（主视图是最经典的阶梯形）
    cubes: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [0, 2, 0]]
  },
  {
    id: 'corner',
    // 角块：底面缺一格，前侧多一格，顶端再叠一格
    cubes: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]]
  },
  {
    id: 'plinth',
    // 竖直的十字形墙（5 格），正前方中央再贴一格：主视图是十字，俯视图是 T 形
    cubes: [[0, 1, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0], [2, 1, 0], [1, 1, 1]]
  },
  {
    id: 'ledge',
    // 后排两层、前排一层：俯视图是 2×2 实心（看不出高低），左视图出现缺口
    cubes: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0]]
  },
  {
    id: 'tower',
    // 三阶塔：左列一路升到三层，右列只留底层
    cubes: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [0, 2, 0]]
  },
  {
    id: 'slab',
    // 2×2 底座 + 左列第二层：三视图都不对称，镜像一定与正确答案不同
    cubes: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [0, 1, 1]]
  }
]);

const TAGS = Object.freeze(['三视图']);
const LABELS = Object.freeze(['A', 'B', 'C', 'D']);

const stemSolid = (cubes) => ({ kind: 'figure:block-solid', spec: { cubes } });
const stemThreeViews = (cubes) => ({ kind: 'figure:three-views', spec: { cubes } });
const cellsOption = (view) => ({
  kind: 'figure:view-cells',
  spec: { cols: view.cols, rows: view.rows, cells: view.cells }
});
const solidOption = (cubes) => ({ kind: 'figure:block-solid', spec: { cubes } });

/** 题型①的干扰项候选：按「错误理由」从常见到罕见排序。 */
function viewDistractors(cubes, view, correct) {
  const others = VIEWS.filter((v) => v !== view);
  const makers = [
    { reason: `方向看错：给成了${VIEW_LABELS[others[0]]}`, make: () => orthoView(cubes, others[0]) },
    { reason: `方向看错：给成了${VIEW_LABELS[others[1]]}`, make: () => orthoView(cubes, others[1]) },
    { reason: '左右镜像（前后/左右搞反）', make: () => mirrorHorizontally(correct) },
    { reason: '上下镜像（高低搞反）', make: () => mirrorVertically(correct) },
    { reason: '少画了一个方块', make: () => withoutCell(correct) },
    { reason: '多画了一个方块', make: () => withExtraCell(correct) }
  ];

  const picked = [];
  const seen = new Set([viewKey(correct)]);
  for (const maker of makers) {
    if (picked.length === 3) break;
    let candidate;
    try {
      candidate = maker.make();
    } catch {
      continue; // 候选不成立（例如视图只剩一格时不能再删）——跳过即可
    }
    const key = viewKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ reason: maker.reason, view: candidate });
  }
  if (picked.length < 3) {
    throw new Error(`three-views: 立体 ${JSON.stringify(cubes)} 的${VIEW_LABELS[view]}凑不出 3 个不同干扰项`);
  }
  return picked;
}

/** 立体的所有「有支撑」的空位（放在地面或叠在别的方块上）——加方块干扰项用。 */
function freeSupportedPositions(cubes, { width, height, depth }) {
  const occupied = new Set(cubes.map((c) => c.join(',')));
  const positions = [];
  for (let x = 0; x < width + 1; x += 1) {
    for (let y = 0; y < height + 1; y += 1) {
      for (let z = 0; z < depth + 1; z += 1) {
        if (occupied.has([x, y, z].join(','))) continue;
        const supported = y === 0 || occupied.has([x, y - 1, z].join(','));
        if (supported) positions.push([x, y, z]);
      }
    }
  }
  return positions;
}

/**
 * 题型②的立体干扰项：改动后的立体，其**三视图必须与题干不同**（否则它也是正确答案）。
 * 依次尝试：加一格 → 去一格 → 左右镜像 → 前后镜像，取前 3 个视图键互不相同的。
 */
function solidDistractors(cubes) {
  const targetKey = viewsKey(cubes);
  const bounds = {
    width: Math.max(...cubes.map((c) => c[0])) + 1,
    height: Math.max(...cubes.map((c) => c[1])) + 1,
    depth: Math.max(...cubes.map((c) => c[2])) + 1
  };
  const maxX = bounds.width - 1;
  const maxZ = bounds.depth - 1;

  const candidates = [];
  for (const pos of freeSupportedPositions(cubes, bounds)) {
    candidates.push({ reason: `在 (${pos.join(',')}) 多了一个方块`, cubes: [...cubes, pos] });
  }
  for (const cube of cubes) {
    const rest = cubes.filter((c) => c !== cube);
    if (rest.length > 0) candidates.push({ reason: `缺了 (${cube.join(',')}) 处的方块`, cubes: rest });
  }
  candidates.push({ reason: '左右镜像（前后方向相反）', cubes: cubes.map(([x, y, z]) => [maxX - x, y, z]) });
  candidates.push({ reason: '前后镜像（左右方向相反）', cubes: cubes.map(([x, y, z]) => [x, y, maxZ - z]) });

  const picked = [];
  const seen = new Set([targetKey]);
  for (const candidate of candidates) {
    if (picked.length === 3) break;
    const key = viewsKey(candidate.cubes);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
  }
  if (picked.length < 3) {
    throw new Error(`three-views: 立体 ${JSON.stringify(cubes)} 凑不出 3 个三视图不同的干扰项`);
  }
  return picked;
}

/** 把「正确答案 + 3 个干扰项」按指定的答案位置拼成四个选项。 */
function optionsWithAnswer(correctFigure, distractorFigures, answerIndex) {
  const figures = [];
  let cursor = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    figures.push(slot === answerIndex ? correctFigure : distractorFigures[cursor++]);
  }
  return figures;
}

const ITEMS = [];
const DISTRACTOR_REASONS = new Map();

// ── 题型①：给立体图，问某个视图 ────────────────────────────────────
SOLIDS.forEach((solid, solidIndex) => {
  VIEWS.forEach((view, viewIndex) => {
    const correct = orthoView(solid.cubes, view);
    const distractors = viewDistractors(solid.cubes, view, correct);
    const answerIndex = (solidIndex * VIEWS.length + viewIndex) % 4; // 答案在 A~D 间轮转
    const id = `three-views-${String(solidIndex * VIEWS.length + viewIndex + 1).padStart(2, '0')}`;
    ITEMS.push({
      id,
      front: `该立体图形的${VIEW_LABELS[view]}是`,
      back: LABELS[answerIndex],
      tags: TAGS,
      figure: stemSolid(solid.cubes),
      choiceFigures: optionsWithAnswer(
        cellsOption(correct),
        distractors.map((d) => cellsOption(d.view)),
        answerIndex
      ),
      choiceTexts: LABELS
    });
    DISTRACTOR_REASONS.set(id, distractors.map((d) => d.reason));
  });
});

// ── 题型②：给三视图，问对应的立体 ──────────────────────────────────
SOLIDS.forEach((solid, index) => {
  const distractors = solidDistractors(solid.cubes);
  const answerIndex = (index + 2) % 4; // 与题型①错开，答案分布更均匀
  const id = `three-views-${String(18 + index + 1).padStart(2, '0')}`;
  ITEMS.push({
    id,
    front: '下面的三视图所对应的立体图形是',
    back: LABELS[answerIndex],
    tags: TAGS,
    figure: stemThreeViews(solid.cubes),
    choiceFigures: optionsWithAnswer(
      solidOption(solid.cubes),
      distractors.map((d) => solidOption(d.cubes)),
      answerIndex
    ),
    choiceTexts: LABELS
  });
  DISTRACTOR_REASONS.set(id, distractors.map((d) => d.reason));
});

// ── 标准几何体（圆柱 / 圆锥 / 球 / 长方体 / 正三棱柱 / 正四棱锥）──────────
//
// 上面 24 题都是小方块堆叠（视图是方格）；这一组是曲面体与棱柱棱锥（视图是矩形/圆/
// 三角形/正多边形）——考公三视图题里这两类都常见。几何与画法在 public/js/solid-shapes.js。
//
// 干扰项（每个都有可复述的错误理由）：
//   ① 方向看错 —— 拿另一个方向的视图充数（圆柱问主视图却给俯视图的圆）
//   ② 长宽互换 —— 把矩形的长和宽对调（主视图与左视图的尺寸最容易搞混）
//   ③ 直径当成半径 —— 尺寸整体缩一半（圆柱的矩形画窄、圆锥的底画短）
//   ④ 边数看错 —— 棱柱的俯视图画成别的正多边形
//   ⑤ 漏画对角线 —— 四棱锥的俯视图少了那两条棱线
//   ⑥ 换成别的立体 —— 反向题的干扰项就是目录里别的几何体（它们的三视图不同）

/** 形状的可读尺寸（用于干扰项理由与调试）。 */
const shapeSize = (shape) => (shape.kind === 'rect' ? `${shape.width.toFixed(2)}×${shape.height.toFixed(2)}`
  : shape.kind === 'circle' ? `r=${shape.radius.toFixed(2)}`
    : shape.kind === 'ellipse' ? `椭圆 ${(2 * shape.rx).toFixed(2)}×${(2 * shape.ry).toFixed(2)}`
      : shape.kind === 'triangle' ? `底${shape.base.toFixed(2)}×高${shape.height.toFixed(2)}`
        : `正${shape.sides}边形`);

/**
 * 题型①（标准几何体）的干扰项候选。
 *
 * ⚠️ 不能用的干扰项：**等比缩放的同一个形状**。矩形 2×1.8 与 1×0.9 长宽比相同，
 * 圆 r=1 与 r=0.5 只差大小，等腰三角形的相似形也一样——选项里没有比例尺参照时，
 * 它们和正确答案在语义上是同一个图形，题目就会出现两个正确答案。
 * 所以干扰项必须**改变形状本身**：换一种形状、改长宽比、改边数、或漏画棱线。
 */
function shapeDistractors(solidId, view, correct, allViews) {
  const others = VIEWS.filter((name) => name !== view);
  const otherSolidViews = SOLID_SHAPES
    .filter((candidate) => candidate.id !== solidId)
    .flatMap((candidate) => Object.values(solidViews(candidate.id)));

  const makers = [
    { reason: `方向看错：给成了${VIEW_LABELS[others[0]]}`, make: () => allViews[others[0]] },
    { reason: `方向看错：给成了${VIEW_LABELS[others[1]]}`, make: () => allViews[others[1]] }
  ];

  if (correct.kind === 'rect') {
    makers.push({ reason: '长宽互换：把长和宽对调了', make: () => ({ ...correct, width: correct.height, height: correct.width }) });
    makers.push({ reason: '宽度看错：把直径当成了半径', make: () => ({ ...correct, width: correct.width / 2 }) });
    makers.push({ reason: '高度看错：高只有一半', make: () => ({ ...correct, height: correct.height / 2 }) });
  } else if (correct.kind === 'triangle') {
    makers.push({ reason: '底面看错：把底面直径当成了半径', make: () => ({ ...correct, base: correct.base / 2 }) });
    makers.push({ reason: '高度看错：高只有一半', make: () => ({ ...correct, height: correct.height / 2 }) });
  } else if (correct.kind === 'circle') {
    makers.push({
      reason: '把圆画成了椭圆（那是斜着看的样子，不是视图）',
      make: () => ({ kind: 'ellipse', rx: correct.radius, ry: correct.radius * 0.55 })
    });
  } else if (correct.kind === 'polygon') {
    makers.push({
      reason: '边数看错：画成了别的正多边形',
      make: () => ({ ...correct, sides: correct.sides === 3 ? 4 : 3, spokes: false })
    });
    makers.push({ reason: '漏画对角线（少了棱线）', make: () => (correct.spokes ? { ...correct, spokes: false } : null) });
  }

  // 兜底池：别的几何体的视图——形状种类不同，绝不会与正确答案混淆
  for (const shape of otherSolidViews) {
    makers.push({ reason: '形状认错：给成了别的几何体的视图', make: () => shape });
  }

  const picked = [];
  const seen = new Set([shapeKey(correct)]);
  for (const maker of makers) {
    if (picked.length === 3) break;
    const candidate = typeof maker.make === 'function' ? maker.make() : null;
    if (!candidate) continue;
    const key = shapeKey(candidate);
    if (seen.has(key)) continue;
    if (isSameShapeUpToScale(candidate, correct)) continue; // 等比缩放：语义上还是同一个图形
    seen.add(key);
    picked.push({ reason: `${maker.reason}（${shapeSize(candidate)}）`, shape: candidate });
  }
  if (picked.length < 3) {
    throw new Error(`three-views: ${solidId} 的${VIEW_LABELS[view]}凑不出 3 个不同干扰项`);
  }
  return picked;
}

/**
 * 两个图形是不是「只差大小」（等比缩放 ⇒ 语义上是同一个视图）。
 * 圆只有大小之分；矩形/等腰三角形看长宽比；正多边形看边数与有没有棱线。
 */
function isSameShapeUpToScale(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'circle') return true; // 圆 r=1 与 r=0.5 是同一个图形
  if (a.kind === 'rect') return Math.abs(a.width / a.height - b.width / b.height) < 1e-9;
  if (a.kind === 'triangle') return Math.abs(a.base / a.height - b.base / b.height) < 1e-9;
  if (a.kind === 'polygon') return a.sides === b.sides && Boolean(a.spokes) === Boolean(b.spokes);
  return false;
}

const solid3dOption = (solidId) => ({ kind: 'figure:solid-3d', spec: { solid: solidId } });
const shapeOption = (shape) => ({ kind: 'figure:view-shape', spec: { shape } });
const shapeStem = (solidId) => ({ kind: 'figure:shape-views', spec: { solid: solidId } });

/** 每个几何体问哪个视图（三个方向都覆盖到）。 */
const SHAPE_QUESTIONS = Object.freeze([
  { solid: 'cylinder', view: 'front' },
  { solid: 'cone', view: 'top' },
  { solid: 'sphere', view: 'left' },
  { solid: 'cuboid', view: 'front' },
  { solid: 'prism3', view: 'top' },
  { solid: 'pyramid4', view: 'left' }
]);

SHAPE_QUESTIONS.forEach((question, index) => {
  const shapeSolid = SOLID_BY_ID[question.solid];
  const views = solidViews(shapeSolid);
  const correct = views[question.view];
  const distractors = shapeDistractors(question.solid, question.view, correct, views);
  const answerIndex = (index + 1) % 4;
  const id = `three-views-${String(25 + index).padStart(2, '0')}`;
  ITEMS.push({
    id,
    front: `${shapeSolid.name}的${VIEW_LABELS[question.view]}是`,
    back: LABELS[answerIndex],
    tags: TAGS,
    figure: solid3dOption(question.solid),
    choiceFigures: optionsWithAnswer(
      shapeOption(correct),
      distractors.map((d) => shapeOption(d.shape)),
      answerIndex
    ),
    choiceTexts: LABELS
  });
  DISTRACTOR_REASONS.set(id, distractors.map((d) => d.reason));
});

// 题型②（标准几何体）：题干给三视图，选项给四个立体——恰好一个的三视图与题干一致
SHAPE_QUESTIONS.forEach((question, index) => {
  const stemKey = solidViewsKey(question.solid);
  const distractors = SOLID_SHAPES
    .filter((candidate) => candidate.id !== question.solid && solidViewsKey(candidate.id) !== stemKey)
    .slice(0, 3)
    .map((candidate) => ({ reason: `三视图不符（${candidate.name}）`, solid: candidate.id }));
  if (distractors.length < 3) {
    throw new Error(`three-views: ${question.solid} 凑不出 3 个三视图不同的干扰立体`);
  }
  const answerIndex = (index + 3) % 4;
  const id = `three-views-${String(31 + index).padStart(2, '0')}`;
  ITEMS.push({
    id,
    front: '下面的三视图所对应的立体图形是',
    back: LABELS[answerIndex],
    tags: TAGS,
    figure: shapeStem(question.solid),
    choiceFigures: optionsWithAnswer(
      solid3dOption(question.solid),
      distractors.map((d) => solid3dOption(d.solid)),
      answerIndex
    ),
    choiceTexts: LABELS
  });
  DISTRACTOR_REASONS.set(id, distractors.map((d) => d.reason));
});

// 构建期自检：题目数量与 id 唯一性（数据出错时在导入阶段就抛错，不留给运行时）
const EXPECTED_ITEMS = SOLIDS.length * (VIEWS.length + 1) + SHAPE_QUESTIONS.length * 2;
if (ITEMS.length !== EXPECTED_ITEMS) {
  throw new Error(`three-views: 期望 ${EXPECTED_ITEMS} 题，实际 ${ITEMS.length} 题`);
}
if (new Set(ITEMS.map((item) => item.id)).size !== ITEMS.length) {
  throw new Error('three-views: 题目 id 有重复');
}

export { ITEMS, DISTRACTOR_REASONS, SOLIDS, SHAPE_QUESTIONS };
