// 折叠动画：把展开图从「摊平」动到「折成立方体」。
//
// ── 为什么用「起止状态插值」而不是「沿铰链真实折叠」─────────────────────
// 我试过按铰链递归旋转的做法（建折叠树 → 每层绕铰链转 → 复合变换），
// 调了三轮都没能闭合成立方体：铰链轴取法、变换应用顺序、铰链随父面运动
// 三个地方各错一次，最后仍然只折出 3~4 个面。这条路要真正做对，
// 需要把每个面的局部坐标系与其在父面上的附着关系完整建模，成本远超收益。
//
// 现在采用的方案：**最终状态由 net-fold.js 给出地面真值**（每个格子折到哪个面是
// 已被 11 种展开图穷举验证过的），动画只在「平面位置」与「该面的立方体位置」
// 之间插值，并给每个格子按折叠层级加一点延迟，读起来就像依次折起来。
//
// 好处：
//   1. t=1 与 t=0 两端**必然正确**（一个来自地面真值，一个就是原图）；
//   2. 不依赖任何未经验证的几何推导；
//   3. 纯计算、可单测，渲染层只负责把结果画成 SVG。
// 代价：中间帧不是严格的刚体铰链运动（面与面之间会有轻微穿插），
// 但作为「帮助理解折叠关系」的演示足够了。

import { foldNet, VISIBLE_SLOTS } from './net-fold.js';

/** 面名 → 该面中心在单位立方体（棱长 1、中心在原点）里的位置。 */
const FACE_OFFSET = Object.freeze({
  front: [0, 0.5, 0],
  back: [0, -0.5, 0],
  top: [0, 0, 0.5],
  bottom: [0, 0, -0.5],
  right: [0.5, 0, 0],
  left: [-0.5, 0, 0]
});

/** 面名 → 外法向（右手系：front × top = right）。 */
const FACE_NORMAL = Object.freeze({
  front: [0, 1, 0],
  back: [0, -1, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0]
});

const CELL = 1; // 格子边长（同时也是立方体棱长）

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * 向量插值。
 *
 * ⚠️ 参数顺序刻意是 (from, to, t)，**不是** (from, t, to) ——
 * 我第一版写成后者，而调用处按 (a, b, t) 传，于是 `t[0]` 取到 undefined，
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

/**
 * 计算折叠动画在进度 t ∈ [0,1] 时的每一格状态。
 *
 * @param {Array<[number, number]>} cells 展开图网格坐标
 * @param {number} t 进度；0 = 完全摊平，1 = 已折成立方体
 * @param {object} [options]
 * @param {number} [options.stagger] 每层之间的延迟比例（0 = 同时折；0.35 = 依次折）
 * @returns {{ ok: boolean, reason: string|null, cells: Array<{
 *   cell: [number, number], face: string, depth: number,
 *   center: [number,number,number], normal: [number,number,number], progress: number
 * }> }}
 */
export function foldAnimationFrame(cells, t, options = {}) {
  const stagger = Number.isFinite(options.stagger) ? Math.max(0, Math.min(1, options.stagger)) : 0.35;
  const folded = foldNet(cells);
  if (!folded.ok) return { ok: false, reason: folded.reason, cells: [] };

  const clamped = Math.max(0, Math.min(1, Number(t) || 0));

  // 每个格子的折叠层级：用「到根格子的网格距离」衡量，越远越晚折。
  const keyOf = ([c, r]) => `${c},${r}`;
  const depth = new Map([[keyOf(cells[0]), 0]]);
  const queue = [cells[0]];
  const set = new Set(cells.map(keyOf));
  while (queue.length) {
    const cell = queue.shift();
    const d = depth.get(keyOf(cell));
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [cell[0] + dc, cell[1] + dr];
      const nk = keyOf(next);
      if (!set.has(nk) || depth.has(nk)) continue;
      depth.set(nk, d + 1);
      queue.push(next);
    }
  }
  const maxDepth = Math.max(...depth.values(), 1);

  // 用所有格子的平面中心求质心，把「摊平」与「折好」两个状态对齐到同一中心，
  // 否则动画里整张图会整体平移，看起来像在漂移而不是折叠。
  const flatCenters = cells.map(([c, r]) => [c, -r, 0]);
  const flatCentroid = flatCenters.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0])
    .map((v) => v / cells.length);

  return {
    ok: true,
    reason: null,
    cells: cells.map((cell, index) => {
      const face = folded.faces[index];
      const d = depth.get(keyOf(cell)) ?? 0;
      // 延迟：层级越深越晚开始折；每层占 stagger 的比例，整体仍在 [0,1] 内完成。
      const delay = stagger * (d / maxDepth);
      const local = Math.max(0, Math.min(1, (clamped - delay) / Math.max(1e-6, 1 - delay)));
      const p = easeInOut(local);

      const flatCenter = [flatCenters[index][0] - flatCentroid[0], flatCenters[index][1] - flatCentroid[1], 0];
      const foldedCenter = face ? FACE_OFFSET[face].map((v) => v * CELL) : flatCenter;
      const flatNormal = [0, 0, 1];
      const foldedNormal = face ? FACE_NORMAL[face] : flatNormal;

      return {
        cell,
        face,
        depth: d,
        center: lerpVec(flatCenter, foldedCenter, p),
        normal: slerpDir(flatNormal, foldedNormal, p),
        progress: p
      };
    })
  };
}

/** 折叠动画是否可用（展开图非法时不可用）。 */
export function canAnimateFold(cells) {
  return foldNet(cells)?.ok === true;
}

/** 供渲染层复用：三个可见槽位。 */
export { VISIBLE_SLOTS };

export default { foldAnimationFrame, canAnimateFold, VISIBLE_SLOTS };
