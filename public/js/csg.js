// 可组合立体（SDF）与任意切面。
//
// ── 为什么换成这条路 ────────────────────────────────────────────────
// 之前是「逐个体型写求交」：cylinderSection / coneSection / … 每加一种立体、
// 每一种挖空方式都要再写一套，组合数是爆炸的。
//
// 改成**隐式函数（SDF）**后，可组合性变成三个运算：
//   并 A∪B → min(a, b)
//   交 A∩B → max(a, b)
//   差 A−B → max(a, −b)
// 于是「正方体挖方洞」「圆柱掏空心」「圆台挖球」都只是表达式，不需要新代码。
//
// ── 截面怎么算 ──────────────────────────────────────────────────────
// 截面 = 切割平面上的一个**有符号距离场**。在平面上撒网格，
// 每格取 |sdf| 作为「到边界的最短距离」（用来定位边界），
// 再用 **marching squares** 抽出 sdf = 0 的等值线。
//
// 这样做的直接收益：**挖空自然产生两条回路**（外轮廓 + 内轮廓），
// 「刀切空心部分不带线」不再是一条需要特判的规则，而是「回路有几条、谁套谁」的
// 自然结果 —— 这正是照片里「五大易错点」第 1 条要教的东西。
//
// 代价：截面边界是**近似**的（精度由网格分辨率决定），不是解析精确。
// 作为教学演示足够；需要精确值的地方（例如判定截面是圆还是椭圆）另用解析式校核。

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ── 基本体（SDF，单位：与世界同尺度）────────────────────────────────

/** 立方体（棱长 size，中心在原点）。 */
export function box(size) {
  const h = size / 2;
  return (p) => {
    const q = [Math.abs(p[0]) - h, Math.abs(p[1]) - h, Math.abs(p[2]) - h];
    const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
    const inside = Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);
    return outside + inside;
  };
}

/** 竖直圆柱（半径 radius、高 height，中心在原点）。 */
export function cylinder(radius, height) {
  const h = height / 2;
  return (p) => {
    const dRadial = Math.hypot(p[0], p[1]) - radius;
    const dAxial = Math.abs(p[2]) - h;
    const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dAxial, 0));
    const inside = Math.min(Math.max(dRadial, dAxial), 0);
    return outside + inside;
  };
}

/** 竖直圆锥（底半径 radius、高 height，底面在 z=−h/2，顶点在 z=+h/2）。 */
export function cone(radius, height) {
  const h = height / 2;
  // 用「圆锥侧面」的隐式近似：以轴为基准的径向判定
  return (p) => {
    const r = Math.hypot(p[0], p[1]);
    const zNorm = (p[2] + h) / height;          // 0 在底面，1 在顶点
    const rAllowed = radius * (1 - zNorm);      // 该高度处的允许半径
    const dRadial = r - rAllowed;               // >0 在锥外
    const dTop = p[2] - h;                      // >0 在顶点之上
    const dBottom = -h - p[2];                  // >0 在底面之下
    const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dTop, 0), Math.max(dBottom, 0));
    const inside = Math.min(Math.max(dRadial, Math.max(dTop, dBottom)), 0);
    return outside + inside;
  };
}

/** 球（半径 radius，中心在原点）。 */
export function sphere(radius) {
  return (p) => Math.hypot(p[0], p[1], p[2]) - radius;
}

// ── 组合运算 ────────────────────────────────────────────────────────

export const union = (...solids) => (p) => Math.min(...solids.map((f) => f(p)));
export const intersect = (...solids) => (p) => Math.max(...solids.map((f) => f(p)));
/** A − B：从 A 中挖掉 B。 */
export const subtract = (a, b) => (p) => Math.max(a(p), -b(p));

/** 平移。 */
export const translate = (solid, offset) => (p) => solid(sub(p, offset));
/** 沿 z 轴缩放高度（用于把圆柱压扁等）。 */
export const scaleZ = (solid, k) => (p) => solid([p[0], p[1], p[2] / k]) * Math.min(1, k);

/** 把「参数化的立体描述」编译成 SDF 函数。 */
export function compile(node) {
  if (typeof node === 'function') return node;
  if (!node || typeof node !== 'object') throw new Error('compile: 需要函数或立体描述对象');
  const { type } = node;
  if (type === 'box') return box(node.size ?? 2);
  if (type === 'cylinder') return cylinder(node.radius ?? 1, node.height ?? 2);
  if (type === 'cone') return cone(node.radius ?? 1, node.height ?? 2);
  if (type === 'sphere') return sphere(node.radius ?? 1);
  if (type === 'union') return union(...node.children.map(compile));
  if (type === 'intersect') return intersect(...node.children.map(compile));
  if (type === 'subtract') return subtract(compile(node.base), compile(node.tool));
  throw new Error(`compile: 未知立体类型 "${type}"`);
}

// ── 平面上的网格采样 ────────────────────────────────────────────────

/** 平面内正交单位基。 */
function basisOf(planeNormal) {
  const n = norm(planeNormal);
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(n, helper));
  const v = norm(cross(n, u));
  return { u, v, n };
}

/**
 * 在切割平面上对 sdf 采样，返回网格。
 * 采样点：P(u,v) = origin + u·U + v·V，其中 origin 是平面上离原点最近的点。
 */
export function samplePlane(solid, planeNormal, d, options = {}) {
  const extent = Number.isFinite(options.extent) ? options.extent : 3;
  const resolution = Number.isFinite(options.resolution) ? options.resolution : 64;
  const { u, v, n } = basisOf(planeNormal);
  const origin = mul(n, d / (dot(n, n) || 1)); // 平面上离世界原点最近的点

  const step = (extent * 2) / resolution;
  const values = new Float64Array((resolution + 1) * (resolution + 1));
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i <= resolution; i += 1) {
    for (let j = 0; j <= resolution; j += 1) {
      const x = -extent + i * step;
      const y = -extent + j * step;
      const world = add(origin, add(mul(u, x), mul(v, y)));
      const value = solid(world);
      values[i * (resolution + 1) + j] = value;
      if (value < minValue) minValue = value;
      if (value > maxValue) maxValue = value;
    }
  }
  return { origin, u, v, n, extent, resolution, step, values, minValue, maxValue };
}

/**
 * marching squares：从采样网格抽出 sdf = 0 的等值线，返回 2D 回路。
 * 输出坐标是平面内的 (x, y)（相对平面原点）。
 */
export function extractLoops(grid, options = {}) {
  const { resolution, step, values } = grid;
  const index = (i, j) => i * (resolution + 1) + j;
  const segments = [];

  // 线性插值求边上的零点
  const lerpZero = (a, b) => (Math.abs(a - b) < 1e-12 ? 0.5 : a / (a - b));

  for (let i = 0; i < resolution; i += 1) {
    for (let j = 0; j < resolution; j += 1) {
      const v00 = values[index(i, j)];
      const v10 = values[index(i + 1, j)];
      const v11 = values[index(i + 1, j + 1)];
      const v01 = values[index(i, j + 1)];

      // 四个角的「在内部」判定（负值 = 内部）
      const code = (v00 < 0 ? 1 : 0) | (v10 < 0 ? 2 : 0) | (v11 < 0 ? 4 : 0) | (v01 < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;

      const x0 = -grid.extent + i * step;
      const y0 = -grid.extent + j * step;
      // 四条边上的交点（沿逆时针：下、右、上、左）
      const bottom = { x: x0 + step * lerpZero(v00, v10), y: y0 };
      const right = { x: x0 + step, y: y0 + step * lerpZero(v10, v11) };
      const top = { x: x0 + step * lerpZero(v01, v11), y: y0 + step };
      const left = { x: x0, y: y0 + step * lerpZero(v00, v01) };

      const push = (a, b) => segments.push([a, b]);
      // 16 种情形（含鞍点拆两段）
      switch (code) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(right, top); break;
        case 6: case 9: push(bottom, top); break;
        case 7: case 8: push(left, top); break;
        case 5: push(left, bottom); push(right, top); break;
        case 10: push(left, top); push(bottom, right); break;
        default: break;
      }
    }
  }

  // 把线段接成闭合回路（按端点距离贪心连接，容差取步长的一小部分）
  const tol = step * 0.5;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < tol;
  const loops = [];
  const used = new Array(segments.length).fill(false);

  for (let s = 0; s < segments.length; s += 1) {
    if (used[s]) continue;
    used[s] = true;
    const loop = [segments[s][0], segments[s][1]];
    let extended = true;
    while (extended) {
      extended = false;
      const tail = loop[loop.length - 1];
      for (let t = 0; t < segments.length; t += 1) {
        if (used[t]) continue;
        if (near(segments[t][0], tail)) { loop.push(segments[t][1]); used[t] = true; extended = true; break; }
        if (near(segments[t][1], tail)) { loop.push(segments[t][0]); used[t] = true; extended = true; break; }
      }
    }
    if (loop.length >= 4) loops.push(loop);
  }

  // 过滤抖动的微小回路
  const minPoints = Number.isFinite(options.minPoints) ? options.minPoints : 6;
  return loops.filter((loop) => loop.length >= minPoints);
}

/** 计算 2D 多边形面积（正负表示绕向）。 */
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** 点是否在多边形内（射线法）。 */
export function pointInPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]; const b = points[j];
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 把回路分类成「外轮廓」与「内轮廓（洞）」。
 *
 * ⚠️ 两个坑，都踩过：
 *  1. **不能拿回路的第一个点去判断它在不在别的回路内**。相切/退化情形下（例如球内切于
 *     正方体、切面正好是内切圆），外轮廓的顶点会**落在**另一个回路的边上，
 *     射线法的结果会随机翻转，于是四个角块被误判成「洞」。
 *  2. 判断要多点投票：在回路质心与顶点之间取若干代表点，多数命中才算「在里面」，
 *     单点判断在退化情形下不可靠。
 */
export function classifyLoops(loops) {
  if (loops.length === 0) return { outer: [], holes: [] };
  const withArea = loops.map((loop) => ({ loop, area: polygonArea(loop) }));
  // 面积大的先处理：外层先被认下来，内层才可能被判定为洞
  withArea.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

  /** 取若干个「明确在回路内部」的代表点：质心到各顶点的中点。 */
  function representativePoints(loop) {
    const cx = loop.reduce((a, p) => a + p.x, 0) / loop.length;
    const cy = loop.reduce((a, p) => a + p.y, 0) / loop.length;
    const points = [{ x: cx, y: cy }];
    const stride = Math.max(1, Math.floor(loop.length / 8));
    for (let i = 0; i < loop.length; i += stride) {
      const p = loop[i];
      points.push({ x: (cx + p.x) / 2, y: (cy + p.y) / 2 });
    }
    return points;
  }

  const outer = [];
  const holes = [];
  for (const item of withArea) {
    const reps = representativePoints(item.loop);
    const isHole = outer.some((o) => {
      const hits = reps.filter((p) => pointInPolygon(p, o)).length;
      return hits * 2 > reps.length; // 多数代表点落在某个外轮廓内部 ⇒ 这是洞
    });
    if (isHole) holes.push(item.loop);
    else outer.push(item.loop);
  }
  return { outer, holes };
}

/**
 * 一站式：任意组合立体 + 任意平面 → 截面回路（外轮廓 + 洞）。
 *
 * @param {function|object} solid SDF 函数或立体描述
 * @param {number[]} planeNormal 平面法向
 * @param {number} d 平面到原点的有符号距离
 * @returns {{ ok: boolean, outer: object[][], holes: object[][], grid: object }}
 */
export function sectionLoops(solid, planeNormal, d, options = {}) {
  const sdf = compile(solid);
  const grid = samplePlane(sdf, planeNormal, d, options);
  if (grid.minValue > 0) {
    return { ok: false, reason: 'no-intersection', outer: [], holes: [], grid };
  }
  const loops = extractLoops(grid, options);
  const { outer, holes } = classifyLoops(loops);
  return { ok: outer.length > 0, reason: outer.length ? null : 'empty', outer, holes, grid };
}

/**
 * 射线步进求交：从相机方向找立体表面点。
 * 供渲染层把 SDF 立体画成可见面（比逐体型写投影通用得多）。
 * @returns {{ point: number[], distance: number, normal: number[] } | null}
 */
export function raycast(sdf, origin, direction, options = {}) {
  const maxDist = Number.isFinite(options.maxDist) ? options.maxDist : 12;
  const maxSteps = Number.isFinite(options.maxSteps) ? options.maxSteps : 128;
  const eps = Number.isFinite(options.eps) ? options.eps : 1e-3;
  const dir = norm(direction);
  let t = Number.isFinite(options.start) ? options.start : 0;

  for (let i = 0; i < maxSteps; i += 1) {
    const p = add(origin, mul(dir, t));
    const value = sdf(p);
    if (value < eps) {
      if (t <= 0.02) return null; // 起点已在体内
      // 中心差分求法向
      const h = 1e-3;
      const normal = norm([
        sdf([p[0] + h, p[1], p[2]]) - sdf([p[0] - h, p[1], p[2]]),
        sdf([p[0], p[1] + h, p[2]]) - sdf([p[0], p[1] - h, p[2]]),
        sdf([p[0], p[1], p[2] + h]) - sdf([p[0], p[1], p[2] - h])
      ]);
      return { point: p, distance: t, normal };
    }
    t += Math.max(value, eps);
    if (t > maxDist) return null;
  }
  return null;
}

export default {
  box, cylinder, cone, sphere, union, intersect, subtract, translate, scaleZ, compile,
  samplePlane, extractLoops, polygonArea, pointInPolygon, classifyLoops, sectionLoops, raycast
};
