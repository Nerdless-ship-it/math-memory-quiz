// 真 3D 透视渲染：相机、投影、深度排序、近平面裁剪。
//
// ── 为什么必须换掉斜二测 ──────────────────────────────────────────────
// 沙盒里切开一个立体后，「切口那块面」与「立体自身挡住的轮廓」需要同时表达。
// 斜二测把三维沿一个固定方向压平，椭圆的**前后两半在屏幕上几乎重叠**，
// 于是怎么画都不对：染色 ⇒ 像贴纸；求凸包 ⇒ 变成月牙；画完整交线 ⇒ 叠成一圈实线；
// 填成一块面 ⇒ 变成一条带子（而且误导）。四版都失败，根因是投影方式，不是画法。
//
// 透视投影下前后自然分离（近大远小 + 深度排序 + 遮挡判定），
// 才能做到「一刀切开、露出切口」这种表达。
//
// ── 坐标系（右手系）─────────────────────────────────────────────────
//   x 向右、y 向上、z 朝向观察者。相机在 +z 侧看向原点。
//   相机空间：x 右、y 上、-z 朝前（与 WebGL 惯例一致，便于理解）。
// 屏幕坐标：原点在画布左上，y 向下（SVG 惯例）。

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * 透视相机。
 *
 * @param {object} options
 * @param {number} options.yawDeg 绕竖直轴（y 轴）旋转，0 表示从 +z 看向原点
 * @param {number} options.pitchDeg 仰角，正值表示相机在上方往下看
 * @param {number} options.distance 相机到原点的距离
 * @param {number} options.fovDeg 竖直视场角
 */
export function createCamera(options = {}) {
  const yaw = ((options.yawDeg ?? 32) * Math.PI) / 180;
  const pitch = ((options.pitchDeg ?? 20) * Math.PI) / 180;
  const distance = Number.isFinite(options.distance) ? options.distance : 6.2;
  const fov = ((options.fovDeg ?? 34) * Math.PI) / 180;

  // 相机位置：绕 y 轴 yaw、再抬 pitch
  const eye = [
    distance * Math.cos(pitch) * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * Math.cos(pitch) * Math.cos(yaw)
  ];
  const forward = norm(mul(eye, -1)); // 看向原点
  const right = norm(cross(forward, [0, 1, 0]));
  const up = norm(cross(right, forward));

  return {
    eye,
    forward,
    right,
    up,
    distance,
    focal: 1 / Math.tan(fov / 2),
    /** 世界点 → 相机空间（x 右、y 上、z 为「离相机的距离」，正数表示在相机前方） */
    toCameraSpace(p) {
      const rel = sub(p, eye);
      return [dot(rel, right), dot(rel, up), dot(rel, forward)];
    },
    /** 世界方向 → 相机空间方向（不求平移） */
    directionToCameraSpace(d) {
      return [dot(d, right), dot(d, up), dot(d, forward)];
    }
  };
}

/**
 * 把相机空间的点投到屏幕。
 *
 * @returns {{ x: number, y: number, z: number, visible: boolean }}
 *   z = 离相机的深度（越大越远）；visible=false 表示在相机后方或过近，已被裁掉。
 */
export function projectCameraPoint(camPoint, view) {
  const { width, height } = view;
  const z = camPoint[2];
  const near = view.near ?? 0.05;
  if (z <= near) return { x: 0, y: 0, z, visible: false };
  // 透视除法：屏幕偏移 = 焦点长度 × (相机坐标 / 深度)
  const scale = view.focal * (Math.min(width, height) / 2);
  return {
    x: width / 2 + (camPoint[0] * scale) / z,
    y: height / 2 - (camPoint[1] * scale) / z,
    z,
    visible: true
  };
}

/** 世界点 → 屏幕（带深度）。 */
export function projectPoint(point, camera, view) {
  return projectCameraPoint(camera.toCameraSpace(point), view);
}

/**
 * 线段按近平面裁剪（相机空间，z ≥ near）。
 * 返回裁剪后的端点数组；完全在近平面之后则返回 null。
 * 透视投影必须有这一步，否则跨越相机的线段会被投到屏幕外产生巨型错误多边形。
 */
export function clipSegmentNear(a, b, near = 0.05) {
  const aIn = a[2] >= near;
  const bIn = b[2] >= near;
  if (aIn && bIn) return [a, b];
  if (!aIn && !bIn) return null;
  const t = (near - a[2]) / (b[2] - a[2]);
  const mid = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near];
  return aIn ? [a, mid] : [mid, b];
}

/**
 * 把「一格子一格子」的表面采样连成**连续四边形网格**。
 *
 * 这是让轮廓变干净的关键。之前是每个采样点画一个小矩形（像素画），边缘必然呈锯齿。
 * 现在把格点处的命中位置取相邻四格的平均，形成连续顶点，再连成四边形：
 *   · 轮廓边界就是 quad 的外沿，是干净的多边形，不是阶梯；
 *   · 每个 quad 可以在世界空间做光照，明暗过渡也连续。
 *
 * @param {Map<string, {point: number[], normal: number[]}>} samples 键为 "i,j" 的命中点
 * @param {number} cols 列数（i 方向）
 * @param {number} rows 行数（j 方向）
 * @returns {Array<{ corners: number[][], center: number[], normal: number[] }>}
 */
export function buildSurfaceQuads(samples, cols, rows) {
  // 先算格点位置：格点 (i,j) 是它周围四格命中的平均；四格全空则无顶点
  const vertexOf = new Map();
  const key = (i, j) => `${i},${j}`;
  for (let i = 0; i < cols - 1; i += 1) {
    for (let j = 0; j < rows - 1; j += 1) {
      const four = [samples.get(key(i, j)), samples.get(key(i + 1, j)),
        samples.get(key(i, j + 1)), samples.get(key(i + 1, j + 1))];
      const present = four.filter(Boolean);
      if (present.length < 3) continue; // 少于 3 个命中说明这里是边界，不生成顶点
      const point = present.reduce((acc, s) => add(acc, s.point), [0, 0, 0]).map((v) => v / present.length);
      const normal = norm(present.reduce((acc, s) => add(acc, s.normal), [0, 0, 0]));
      vertexOf.set(key(i, j), { point, normal });
    }
  }

  // 再用格点拼四边形
  const quads = [];
  for (let i = 0; i < cols - 2; i += 1) {
    for (let j = 0; j < rows - 2; j += 1) {
      const a = vertexOf.get(key(i, j));
      const b = vertexOf.get(key(i + 1, j));
      const c = vertexOf.get(key(i + 1, j + 1));
      const d = vertexOf.get(key(i, j + 1));
      if (!a || !b || !c || !d) continue;
      const center = mul(add(add(a.point, b.point), add(c.point, d.point)), 0.25);
      const normal = norm(add(add(a.normal, b.normal), add(c.normal, d.normal)));
      quads.push({ corners: [a.point, b.point, c.point, d.point], center, normal });
    }
  }
  return quads;
}

/**
 * 画家算法：把 quad 按「到相机的距离」从远到近排序。
 * 距离用相机空间 z；对凸体足够，对一般组合体也是可接受的近似
 * （真正的深度缓冲在 SVG 里做不到，只能靠排序）。
 */
export function sortQuadsByDepth(quads, camera, toScreen) {
  return quads
    .map((q) => ({ ...q, depth: camera.toCameraSpace(q.center)[2] }))
    .filter((q) => q.depth > (toScreen?.near ?? 0.05))
    .sort((a, b) => b.depth - a.depth);
}

export const vec = { dot, add, sub, mul, cross, norm };
export default { createCamera, projectPoint, projectCameraPoint, clipSegmentNear, buildSurfaceQuads, sortQuadsByDepth, vec };
