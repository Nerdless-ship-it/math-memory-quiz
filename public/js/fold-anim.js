// 折叠动画：把展开图从「摊平」动到「折成立方体」。
//
// ── 折叠模型：真铰链（v2，重写了 v1 的起止插值）────────────────────────
// v1 对每格的「中心 + 法向」在起止状态间插值，中段六个面各飘各的：
// 共享边对不上、面内朝向随机，看起来是六块瓷砖在漂移而不是折叠
// （用户实测反馈「看着不像是折叠」）。
//
// v2 把折叠建模为它本来的样子——**绕共享边的铰链旋转**：
//   1. 以 cells[0] 为根（与 net-fold 的 analyze 同一起点，它折成 bottom 面）；
//   2. 对网格做 BFS 得到折叠树，每条树边是一个铰链：
//      绕两格共享的那条边、向纸面上方（+z）折 90°、按层级错峰；
//   3. 每格的世界变换 = 父变换 ∘ 自身铰链。于是**任意 t 下，
//      树上相邻两格的共享边严格重合**，每格恒为单位正方形（刚体）；
//   4. t=1 时铰链链的落点与 net-fold 的 FACE_OFFSET 逐面吻合（有测试断言）——
//      折叠树只是同一个滚动立方体事实的运动学表达。
//
// 中段因此是真正的折叠运动。注意一个真实的物理现象：深处格的 z 高度
// 会先冲过终值再落回（末页绕铰链划过弧线、最后扣在顶面上），
// 所以「各格 z 之和单调不减」在真折叠里**不成立**，测试改为断言
// 共享边连续与刚体性。
//
// 坐标约定与 net-fold 完全一致：纸面 x=col、y=row（向下）、z=离纸向上；
// 竖直方向由渲染层的投影决定屏幕朝向（fold-anim-view 会翻转 y，
// 让 t=0 的摊平图与题干图的行序一致——1 号格在左上）。

import { foldNet, VISIBLE_SLOTS } from './net-fold.js';

/** 面名 → 外法向（右手系 front × top = right）。仅用于着色法向的端点插值。 */
const FACE_NORMAL = Object.freeze({
  front: [0, 1, 0],
  back: [0, -1, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0]
});

/** 面名 → 该面中心在单位立方体（棱长 1、中心在原点）里的位置。 */
const FACE_OFFSET = Object.freeze({
  front: [0, 0.5, 0],
  back: [0, -0.5, 0],
  top: [0, 0, 0.5],
  bottom: [0, 0, -0.5],
  right: [0.5, 0, 0],
  left: [-0.5, 0, 0]
});

const CELL = 1; // 格子边长（同时也是立方体棱长）

// ── 逐帧复用：展开图分析只跟 cells 和「底面（折叠树根）」有关，与进度 t 无关 ──
// 每帧都要 foldNet（滚动立方体求面）+ BFS 建折叠树，而一次播放约 150 帧，
// 同一份展开图会被重算 150 次。按 (cells 引用, root) 缓存一格：题面数据是冻结的常量、
// 引用稳定，命中即复用；换了一组数组或换了底面就自然失效（不按内容比较，避免每帧深比较）。
// ⚠️ 因此调用方不得原地修改传入的 cells。
let cachedKey = null; // { cells, root }
let cachedAnalysis = null;

/** 底面下标归一化：非法值回退 0（历史行为 = cells[0] 为底）。 */
function normalizeRoot(cells, root) {
  const r = Math.trunc(Number(root));
  return Number.isInteger(r) && r >= 0 && r < cells.length ? r : 0;
}

function analyze(cells, root = 0) {
  const rootIndex = normalizeRoot(cells, root);
  if (cachedKey?.cells === cells && cachedKey.root === rootIndex && cachedAnalysis) return cachedAnalysis;
  const folded = foldNet(cells);
  const analysis = { folded, tree: null, orient: IDENTITY_M };
  if (folded.ok) {
    const tree = buildFoldTree(cells, rootIndex);
    if (tree) {
      analysis.tree = tree;
      if (rootIndex !== 0) {
        // 换底后立方体在世界里的朝向跟着变（新底面朝下）。orient = 把
        // 「根 0 姿态」旋到「根 rootIndex 姿态」的旋转，供着色法向与换底补间使用。
        const basePose = computeFrame(cells, buildFoldTree(cells, 0), folded, 0, 1, 0, IDENTITY_M);
        const pose = computeFrame(cells, tree, folded, rootIndex, 1, 0, IDENTITY_M);
        analysis.orient = rotationFromPoses(
          basePose.cells.map((c) => c.center),
          pose.cells.map((c) => c.center)
        ) ?? IDENTITY_M;
      }
    }
  }
  cachedKey = { cells, root: rootIndex };
  cachedAnalysis = analysis;
  return analysis;
}

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * 向量插值。
 *
 * ⚠️ 参数顺序刻意是 (from, to, t)，**不是** (from, t, to) ——
 * 第一版写成后者，调用处按 (a, b, t) 传，`t[0]` 取到 undefined，
 * 中间帧的法向全变成 NaN。端点帧是对的，所以只看首尾完全看不出来；
 * 是 test/fold-anim.test.mjs 里「法向必须归一化」的断言把它抓出来的。
 * 保持「两个向量相邻、比例放最后」的顺序，降低再次写错的可能。
 */
function lerpVec(from, to, t) {
  const k = Number.isFinite(t) ? t : 0;
  return [lerp(from[0], to[0], k), lerp(from[1], to[1], k), lerp(from[2], to[2], k)];
}

function slerpDir(a, b, t) {
  // 面法向只在少数几个正交方向间过渡，归一化线性插值即可，数值稳定且无需处理反平行。
  const v = lerpVec(a, b, t);
  const len = Math.hypot(v[0], v[1], v[2]);
  // 退化保护：从未归一化的输入或极端插值也不可能除零
  if (!(len > 1e-9)) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// ── 仿射小工具：3×3 旋转 + 平移，足够表达铰链链 ───────────────────────
const IDENTITY_M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}
function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
function mulMat(A, B) {
  return A.map((row) => B[0].map((_, j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
}
function mulVec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}
function addVec(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subVec(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

/**
 * 子格相对父格的铰链：绕两格共享边、满角 ±90°（向 +z 折起）。
 * 返回 { axis, sign, q }；q 是枢轴点（共享边上取子格中心对应的那点）。
 * 四个方向的符号都由「(指向子格的单位向量) 旋转后必须变成 +z」唯一确定，
 * 由测试的共享边连续与终态断言兜底，写错任何一个符号都过不了。
 */
function hingeFor(parentCell, childCell) {
  const dc = childCell[0] - parentCell[0];
  const dr = childCell[1] - parentCell[1];
  if (dc === 1) return { axis: 'y', sign: -1, q: [parentCell[0] + 1, childCell[1] + 0.5, 0] };
  if (dc === -1) return { axis: 'y', sign: 1, q: [parentCell[0], childCell[1] + 0.5, 0] };
  if (dr === 1) return { axis: 'x', sign: 1, q: [childCell[0] + 0.5, parentCell[1] + 1, 0] };
  if (dr === -1) return { axis: 'x', sign: -1, q: [childCell[0] + 0.5, parentCell[1], 0] };
  return null; // 非相邻：合法展开图的折叠树里不会出现
}

/** 局部（格内）四个角，逆时针序，z=0。 */
function localCorners(cell) {
  const [c, r] = cell;
  return [[c, r, 0], [c + 1, r, 0], [c + 1, r + 1, 0], [c, r + 1, 0]];
}

/**
 * 折叠树 + 每格铰链。rootIndex 指定底面（默认 0 = cells[0]，历史行为）：
 * 底面在折叠中保持不动，其余格绕铰链围上来——「以这面为底」就是换根。
 * 返回 null（非法）或
 * { order: [cellKey… BFS 序], info: Map(key → { cell, parent, hinge, depth, corners }) }
 */
function buildFoldTree(cells, rootIndex = 0) {
  const keyOf = ([c, r]) => `${c},${r}`;
  const indexByKey = new Map(cells.map((cell, i) => [keyOf(cell), i]));
  const info = new Map();
  const root = cells[rootIndex] ?? cells[0];
  info.set(keyOf(root), { cell: root, cellIndex: indexByKey.get(keyOf(root)) ?? 0, parent: null, hinge: null, depth: 0, corners: localCorners(root) });
  const queue = [root];
  while (queue.length) {
    const cell = queue.shift();
    const { depth } = info.get(keyOf(cell));
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [cell[0] + dc, cell[1] + dr];
      const nk = keyOf(next);
      const childIndex = indexByKey.get(nk);
      if (childIndex === undefined || info.has(nk)) continue;
      const hinge = hingeFor(cell, next);
      if (!hinge) return null;
      // ⚠️ cell 必须存 cells 里的原引用、cellIndex 存原下标：
      // BFS 里现拼的 next 数组只是坐标副本，按引用/下标回查题面时都不能用它们。
      info.set(nk, {
        cell: cells[childIndex], cellIndex: childIndex,
        parent: cell, hinge, depth: depth + 1, corners: localCorners(cells[childIndex])
      });
      queue.push(next);
    }
  }
  if (info.size !== 6) return null; // 不连通
  // BFS 序保证父格先于子格出现，帧计算可以复用父变换
  const order = [...info.keys()].sort((a, b) => info.get(a).depth - info.get(b).depth);
  return { order, info };
}

/**
 * 计算折叠动画在进度 t ∈ [0,1] 时的每一格状态。
 *
 * @param {Array<[number, number]>} cells 展开图网格坐标
 * @param {number} t 进度；0 = 完全摊平，1 = 已折成立方体
 * @param {object} [options]
 * @param {number} [options.stagger] 每层之间的延迟比例（0 = 同时折；0.35 = 依次折）
 * @param {number} [options.root] 底面下标（默认 0）：折叠时保持不动的那一格
 * @returns {{ ok: boolean, reason: string|null, cells: Array<{
 *   cell: [number, number], face: string, depth: number,
 *   corners: [number,number,number][],      // 世界坐标四角（刚体旋转，共享边随父格运动）
 *   center: [number,number,number],         // 四角平均（= 面中心）
 *   normal: [number,number,number],         // 着色用：+z 平滑过渡到该面的外法向
 *   progress: number
 * }> }}
 */
export function foldAnimationFrame(cells, t, options = {}) {
  const stagger = Number.isFinite(options.stagger) ? Math.max(0, Math.min(1, options.stagger)) : 0.35;
  const rootIndex = normalizeRoot(cells, options.root);
  const { folded, tree, orient } = analyze(cells, rootIndex);
  if (!folded.ok) return { ok: false, reason: folded.reason, cells: [] };
  if (!tree) return { ok: false, reason: 'fold-tree', cells: [] };
  return computeFrame(cells, tree, folded, rootIndex, t, stagger, orient);
}

/** 帧计算主体（analyze 算 orient 时也会以 t=1 调用它）。orient 只影响着色法向。 */
function computeFrame(cells, tree, folded, rootIndex, t, stagger, orient) {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  const maxDepth = Math.max(...[...tree.info.values()].map((v) => v.depth), 1);

  // 呈现对齐：t=0 以整张图的质心为中心，t=1 以立方体中心为中心。
  // 平移随 t 平滑过渡（一次缓慢的全局推移，不影响铰链运动本身）。
  const root = cells[rootIndex];
  const netCentroid = cells
    .reduce((acc, [c, r]) => [acc[0] + c + 0.5, acc[1] + r + 0.5, acc[2]], [0, 0, 0])
    .map((v) => v / cells.length);
  const cubeCenter = [root[0] + 0.5, root[1] + 0.5, 0.5];
  const pan = lerpVec(netCentroid, cubeCenter, easeInOut(clamped));

  // 逐格求世界变换（BFS 序，父先于子）
  const world = new Map(); // key -> { m, t }
  world.set(tree.order[0] ?? `${root[0]},${root[1]}`, { m: IDENTITY_M, t: [0, 0, 0] });
  const byKey = new Map(); // key -> 输出状态
  for (const key of tree.order) {
    const node = tree.info.get(key);
    let m;
    let origin;
    if (!node.parent) {
      m = IDENTITY_M;
      origin = [0, 0, 0];
    } else {
      const parentWorld = world.get(`${node.parent[0]},${node.parent[1]}`);
      const local = Math.max(0, Math.min(1, (clamped - stagger * (node.depth / maxDepth))
        / Math.max(1e-6, 1 - stagger * (node.depth / maxDepth))));
      const angle = node.hinge.sign * (Math.PI / 2) * easeInOut(local);
      const rotation = node.hinge.axis === 'x' ? rotX(angle) : rotY(angle);
      // 铰链 = 绕 q 的旋转：H(x) = R(x − q) + q = R·x + (q − R·q)
      const hingeTranslation = subVec(node.hinge.q, mulVec(rotation, node.hinge.q));
      m = mulMat(parentWorld.m, rotation);
      origin = addVec(mulVec(parentWorld.m, hingeTranslation), parentWorld.t);
      world.set(key, { m, t: origin });
    }
    const cornersWorld = node.corners.map((p) => addVec(mulVec(m, p), origin));
    const center = cornersWorld
      .reduce((acc, p) => addVec(acc, p), [0, 0, 0])
      .map((v) => v / 4);
    const face = folded.faces[node.cellIndex] ?? null;
    const delayShare = stagger * (node.depth / maxDepth);
    const local = Math.max(0, Math.min(1, (clamped - delayShare) / Math.max(1e-6, 1 - delayShare)));
    byKey.set(key, {
      cell: node.cell,
      face,
      depth: node.depth,
      corners: cornersWorld.map((p) => subVec(p, pan)),
      center: subVec(center, pan),
      // 着色法向的终点是「该面外法向」在当前底面朝向下的方向：
      // 根 0 时 orient 是单位阵（历史行为）；换底后法向随立方体一起转。
      normal: slerpDir([0, 0, 1], face ? mulVec(orient, FACE_NORMAL[face]) : [0, 0, 1], easeInOut(local)),
      progress: local
    });
  }

  // 输出按题库输入序（与 net-fold 的 faces 数组同序，测试与调用方都按位对应）
  const out = cells.map((cell) => byKey.get(`${cell[0]},${cell[1]}`));
  if (out.some((state) => !state)) return { ok: false, reason: 'fold-tree', cells: [] };
  return { ok: true, reason: null, cells: out };
}

function dotVec(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function transpose(m) {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]]
  ];
}

/** 三个向量按列组成 3×3。 */
function cols(v0, v1, v2) {
  return [
    [v0[0], v1[0], v2[0]],
    [v0[1], v1[1], v2[1]],
    [v0[2], v1[2], v2[2]]
  ];
}

/**
 * 由两组对应的 t=1 面心（同一立方体的两种朝向，均中心在原点）求旋转 R：R·aᵢ = bᵢ。
 * t=1 时面心是轴向 ±0.5，取三个互相垂直的即可拼出正交基。
 * ⚠️ 基向量必须先归一化：±0.5 的列直接转置得到的是 0.25·逆矩阵，不是逆矩阵。
 */
function rotationFromPoses(a, b) {
  const unit = (v) => {
    const len = Math.hypot(...v) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  };
  const picked = [];
  for (let i = 0; i < a.length && picked.length < 3; i += 1) {
    if (picked.every((j) => Math.abs(dotVec(a[i], a[j])) < 0.2)) picked.push(i);
  }
  if (picked.length < 3) return null;
  const [i, j, k] = picked;
  const basisA = cols(unit(a[i]), unit(a[j]), unit(a[k])); // 正交归一 → 逆 = 转置
  const basisB = cols(unit(b[i]), unit(b[j]), unit(b[k]));
  return mulMat(basisB, transpose(basisA));
}

/** 3×3 旋转矩阵 → 轴角（供换底补间插值用）。 */
function matToAxisAngle(R) {
  const trace = R[0][0] + R[1][1] + R[2][2];
  const cos = Math.max(-1, Math.min(1, (trace - 1) / 2));
  const angle = Math.acos(cos);
  if (angle < 1e-6) return { axis: [0, 0, 1], angle: 0 };
  if (Math.PI - angle < 1e-3) {
    // 近 180°：反对称部分趋于 0，改从对角线恢复转轴（符号取非对角元）
    const x = Math.sqrt(Math.max(0, (R[0][0] + 1) / 2));
    const y = Math.sqrt(Math.max(0, (R[1][1] + 1) / 2));
    const z = Math.sqrt(Math.max(0, (R[2][2] + 1) / 2));
    const axis = [
      x * (R[0][1] >= 0 ? 1 : -1) * (x >= y && x >= z ? 1 : Math.sign(R[2][0] - R[0][2]) || 1),
      y * (y > x && y >= z ? 1 : Math.sign(R[0][1] + R[1][0]) || 1),
      z * (z > x && z > y ? 1 : Math.sign(R[0][2] + R[2][0]) || 1)
    ];
    const len = Math.hypot(...axis) || 1;
    return { axis: axis.map((v) => v / len), angle };
  }
  const s = 2 * Math.sin(angle);
  return {
    axis: [(R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s],
    angle
  };
}

/**
 * 轴角 → 旋转向量函数（Rodrigues）。
 * @param {[number,number,number]} axis 单位转轴
 * @returns {(p: [number,number,number]) => [number,number,number]}
 */
export function axisAngleRotation(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const C = 1 - c;
  const m = [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C]
  ];
  return (p) => mulVec(m, p);
}

/**
 * 换底的姿态差：返回把「以 rootA 为底的立方体」旋到「以 rootB 为底的立方体」的轴角。
 * 渲染层用它做点击换底时的原地转向补间（先转过去，再展开，避免姿态跳变）。
 * 两个底相同 → 零角；展开图非法 → null。
 */
export function rotationBetweenRoots(cells, rootA, rootB) {
  const a = normalizeRoot(cells, rootA);
  const b = normalizeRoot(cells, rootB);
  if (a === b) return { axis: [0, 0, 1], angle: 0 };
  const A = analyze(cells, a);
  const B = analyze(cells, b);
  if (!A.folded.ok || !B.folded.ok || !A.tree || !B.tree) return null;
  return matToAxisAngle(mulMat(B.orient, transpose(A.orient)));
}

/** 折叠动画是否可用（展开图非法时不可用）。 */
export function canAnimateFold(cells) {
  return analyze(cells, 0).folded?.ok === true;
}

/** 供渲染层复用：三个可见槽位。 */
export { VISIBLE_SLOTS };

export default { foldAnimationFrame, canAnimateFold, rotationBetweenRoots, axisAngleRotation, VISIBLE_SLOTS };
