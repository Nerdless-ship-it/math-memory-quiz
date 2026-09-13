// 曲面体与空心体：截面求解。
//
// 为什么需要单独一层：现有 geometry.js 的 cubeSection 只处理**立方体**，
// 做法是「平面 ∩ 12 条棱 = 凸多边形顶点」。这套做法对两类立体完全失效：
//
//   1. **曲面体**（圆柱 / 圆锥 / 圆台）—— 平面与侧面相交得到的是**曲线**
//      （椭圆 / 抛物线 / 双曲线 / 圆），不是多边形。必须参数化曲面后求交再采样。
//   2. **带空心的立体** —— 截面是否是**闭合轮廓**取决于平面有没有穿过空腔。
//      这就是照片里最关键的那条：**「刀切空心部分不带线」**。
//      空心圆柱被斜切时，截面外轮廓是椭圆，内部那块空心是「断开的开口」，
//      所以截面图形上**不画那条线** —— 画了就是错的。
//
// 本文件是纯几何：不碰 DOM、不 import 渲染层。渲染见 figure.js / fold-anim-view.js。

export const EPS = 1e-9;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const len = (v) => Math.hypot(v[0], v[1], v[2]);

/** 平面内的正交单位基，用于把 3D 截面点摊到 2D。 */
export function planeBasis(planeNormal) {
  const n = norm(planeNormal);
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(n, helper));
  const v = norm(cross(n, u));
  return { u, v, n };
}

/**
 * 求平面 n·x = d 与「竖直圆柱侧面」的交线。
 *
 * 参数化：(r cosθ, r sinθ, z)，用 |z| ≤ h/2 截断；由平面方程解出 z(θ)：
 *   z(θ) = (d − r(nx cosθ + ny sinθ)) / nz
 * 这是 θ 的正弦函数 ⇒ 交线在平面内的投影恒为**椭圆**（一般结论：
 * 平面与圆柱侧面相交，截面恒为椭圆；当平面平行于轴时退化为两条直线/矩形）。
 *
 * @returns {{ ok: boolean, reason: string|null, points: number[][], closed: boolean, kind: string }}
 */
export function cylinderSection({ radius = 1, height = 2 }, planeNormal, d, options = {}) {
  const samples = Number.isFinite(options.samples) ? options.samples : 720;
  const n = norm(planeNormal);
  const half = height / 2;

  // 平面平行于轴（nz≈0）：截面是矩形或退化，不走椭圆分支
  if (Math.abs(n[2]) < 1e-6) {
    const nx = n[0]; const ny = n[1];
    // 有向距离恒为 d ⇒ 若 |d| > r 则无交
    const distance = Math.abs(d) / (Math.hypot(nx, ny) || 1);
    if (distance > radius + EPS) return { ok: false, reason: 'no-intersection', points: [], closed: false, kind: 'none' };
    // 两条母线：n·x = d 与圆 x²+y²=r² 的交点
    const c = d / (Math.hypot(nx, ny) || 1);
    const base = mul([nx, ny, 0], c / (Math.hypot(nx, ny) || 1));
    const halfChord = Math.sqrt(Math.max(0, radius * radius - c * c));
    const dir = norm([-ny, nx, 0]);
    const p1 = add(base, mul(dir, halfChord));
    const p2 = sub(base, mul(dir, halfChord));
    const points = [add(p1, [0, 0, half]), add(p2, [0, 0, half]), sub(p2, [0, 0, half]), sub(p1, [0, 0, half])];
    return { ok: true, reason: null, points, closed: true, kind: 'rectangle' };
  }

  // 一般情形：采样 θ，解出 z，保留 |z| ≤ h/2 的部分
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const theta = (Math.PI * 2 * i) / samples;
    const x = radius * Math.cos(theta);
    const y = radius * Math.sin(theta);
    const z = (d - n[0] * x - n[1] * y) / n[2];
    if (Math.abs(z) <= half + EPS) points.push([x, y, Math.max(-half, Math.min(half, z))]);
  }
  if (points.length < 8) return { ok: false, reason: 'no-intersection', points: [], closed: false, kind: 'none' };

  // 是否整圈都在高度范围内 → 闭合椭圆；否则是截断的开口曲线
  const fullCircle = points.length === samples;
  return {
    ok: true,
    reason: null,
    points,
    closed: fullCircle,
    kind: fullCircle ? 'ellipse' : 'truncated-ellipse'
  };
}

/**
 * 求平面与「同心空腔」的交线，用于判断截面内部该不该画线。
 *
 * 关键规则（照片里「五大易错点」第 1 条）：
 *   **刀切到空心部分就不带线**——截面图形上只有外轮廓，内部空腔是断开的开口。
 *   所以这个函数不是用来画线的，而是用来告诉渲染层「内部无轮廓」。
 *
 * @returns {{ intersects: boolean, points: number[][], closed: boolean }}
 */
export function cavitySection({ radius = 0.5, height = 2 }, planeNormal, d, options = {}) {
  if (!(radius > EPS)) return { intersects: false, points: [], closed: false };
  const inner = cylinderSection({ radius, height }, planeNormal, d, options);
  if (!inner.ok) return { intersects: false, points: [], closed: false };
  return { intersects: true, points: inner.points, closed: inner.closed };
}

/**
 * 求平面与「竖直圆锥侧面」的交线。
 * 参数化：母线从顶点 (0,0,h/2) 到底圆 (r cosθ, r sinθ, -h/2)。
 * 点 P(θ,t) = apex + t·(base(θ) − apex)，t ∈ [0,1]。
 * 代入平面方程解 t(θ) ⇒ 保留 t ∈ [0,1] 的部分。
 * 截面类型取决于平面与轴、母线的夹角：圆 / 椭圆 / 抛物线 / 双曲线 / 三角形（过顶点）。
 */
export function coneSection({ radius = 1, height = 2 }, planeNormal, d, options = {}) {
  const samples = Number.isFinite(options.samples) ? options.samples : 720;
  const n = norm(planeNormal);
  const apex = [0, 0, height / 2];
  const points = [];
  let visibleSamples = 0;
  for (let i = 0; i < samples; i += 1) {
    const theta = (Math.PI * 2 * i) / samples;
    const base = [radius * Math.cos(theta), radius * Math.sin(theta), -height / 2];
    const dir = sub(base, apex);
    const denom = dot(n, dir);
    if (Math.abs(denom) < 1e-12) continue; // 母线平行于平面
    const t = (d - dot(n, apex)) / denom;
    if (t < -EPS || t > 1 + EPS) continue;
    visibleSamples += 1;
    points.push(add(apex, mul(dir, Math.max(0, Math.min(1, t)))));
  }
  if (points.length < 3) return { ok: false, reason: 'no-intersection', points: [], closed: false, kind: 'none' };
  // 过顶点 → 三角形；整圈都在 → 圆/椭圆；否则开口曲线
  const passesApex = Math.abs(dot(n, apex) - d) < 1e-6;
  const fullCircle = visibleSamples === samples;
  return {
    ok: true,
    reason: null,
    points,
    closed: fullCircle,
    kind: passesApex ? 'triangle' : (fullCircle ? 'ellipse' : 'open-conic')
  };
}

/**
 * 把 3D 截面点摊到平面内的 2D 坐标（相对质心），供渲染层画正视图。
 * 闭合曲线按极角排序；开口曲线保持原采样顺序（排序会把开口连成一团）。
 */
export function flattenSection(points, planeNormal, closed) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const { u, v } = planeBasis(planeNormal);
  const flat = points.map((p) => ({ x: dot(p, u), y: dot(p, v) }));
  if (!closed) return flat;
  const cx = flat.reduce((a, p) => a + p.x, 0) / flat.length;
  const cy = flat.reduce((a, p) => a + p.y, 0) / flat.length;
  return [...flat].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

/** 取截面的 3D 包围盒尺寸，用于判断「是否被截断」。 */
export function sectionExtent(points) {
  if (!points.length) return { width: 0, height: 0, depth: 0 };
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]); const zs = points.map((p) => p[2]);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    depth: Math.max(...zs) - Math.min(...zs)
  };
}

/**
 * 椭圆的半长轴/半短轴与倾斜角——用来判断「斜切圆柱得到的是不是椭圆」，
 * 以及验证采样结果的正确性（拟合误差应远小于 1e-6）。
 */
export function fitEllipse(flatPoints) {
  if (flatPoints.length < 5) return null;
  const n = flatPoints.length;
  const cx = flatPoints.reduce((a, p) => a + p.x, 0) / n;
  const cy = flatPoints.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0; let syy = 0; let sxy = 0;
  for (const p of flatPoints) {
    const x = p.x - cx; const y = p.y - cy;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // 对均匀采样的椭圆，二阶矩特征值与半轴关系：λ = a²/2（均匀椭圆分布）
  return {
    center: [cx, cy],
    semiMajor: Math.sqrt(Math.max(0, l1) * 2),
    semiMinor: Math.sqrt(Math.max(0, l2) * 2),
    angle: theta
  };
}
