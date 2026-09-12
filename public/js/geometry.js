// 图形推理（正方体展开图 / 截面图）的几何内核：立方体数据 + 轴测投影 + 平面截立方体。
//
// 为什么单独一个模块、且只做纯计算：
//   图形题的正确性完全押在这里 —— 截面算错一点，画出来的立体图就是错的，
//   而错的图比没有图更糟（用户会把错的形状背下来）。所以本模块：
//     · 不 import 任何东西（零依赖），不碰 DOM / localStorage；
//     · 不读时钟、不读随机数：同样的输入永远给同样的输出，可断言、可复现；
//     · 退化情形一律返回 [] / null / 0，**绝不抛异常**，渲染层据此决定画不画。
//
// 世界坐标约定（渲染层 figure.js 依赖，改动前先看 docs/ARCHITECTURE.md 7.4 节）：
//   · 立方体边长 2、中心在原点，z 轴向上（与 qa-output/geometry-feasibility.mjs 一致）；
//   · 顶点/棱/面的编号见 CUBE_VERTICES / CUBE_EDGES / cubeFaces()；
//   · 屏幕坐标 y 轴**向下**（SVG 约定），轴测投影、无透视。
//
// 面 id 与默认视角下屏幕位置的对应关系：
//
//         ┌─── top ───┐            top   在画面正上方
//        ╱           ╱|            front 在画面左侧
//       ┌───────────┐ |            right 在画面右侧
//       |  front    | └┐
//       |           | ╱   right
//       └───────────┘
//
//   front 取 +x 而不是 +y，是被投影算出来的、不是随手定的：相机放在物体的
//   「前-右-上」方向（方位角 45°、仰角 30°），此时外法向 +x 的面投影在屏幕左侧、
//   +y 的投影在右侧。真人看摆在右前方的盒子也是这样 —— 正面落在画面左侧、
//   右侧面落在右侧。若反过来把 +y 叫 front，图上就会出现「右」字写在左边的怪图。

/* ── 浮点阈值 ─────────────────────────────────────────────────────────── */

/** 点是否落在平面上的判据：|n̂·p − d̂| ≤ EPS。用归一化法向，故与入参缩放无关。 */
export const EPS = 1e-9;

/**
 * 交点去重阈值，**刻意比 EPS 大一档**（不是笔误）。
 *
 * 两个阈值管的是两件不同的事：
 *   · EPS（1e-9）判「拓扑」—— 这个点算不算在平面上、这条棱算不算在平面内；
 *   · MERGE_EPS（1e-6）判「几何重合」—— 两条棱各自插值出来的同一个点要合并。
 * 插值误差量级是 1e-16，用 1e-9 本也够；但真正要挡住的是**亚微观截面**：
 * 平面擦过某个顶点 1e-7 时，三条棱上的交点相距 ~1e-7，会围出一个宽 1e-7 的
 * 「三角形」—— 既画不出来、也无几何意义。这种细屑按退化处理掉（合并成 1 点 →
 * 点数不足 3 → 返回 []），比画出个看不见的三角形更符合题意。
 */
export const MERGE_EPS = 1e-6;

/* ── 小工具（私有，纯函数） ───────────────────────────────────────────── */

/** 取 [x,y,z] 数值三元组；任何非有限/非数组输入返回 null（调用方据此降级）。 */
function toVec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = value[0];
  const y = value[1];
  const z = value[2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

/** 归一化；null / 零向量返回 null（调用方据此降级）。 */
function normalize(value) {
  if (!value) return null;
  const len = length(value);
  if (!(len > 0)) return null;
  return [value[0] / len, value[1] / len, value[2] / len];
}

/**
 * 把 -0 归一成 0。
 *
 * `String(-0)` 就是 `'0'`，渲染与 SVG 输出都看不出差别，但 `Object.is(-0, 0)` 为 false、
 * `assert.deepStrictEqual` 也会判不相等 —— 让调用方在明明「等于 0」的坐标上踩坑。
 * 例如 project([0,0,0]).y 天然会算出 -0，坐标一律归一，省得下游为它写特例。
 */
function cleanZero(value) {
  return value === 0 ? 0 : value;
}

/** 距离小于 MERGE_EPS 视为同一点；返回是否是新点。 */
function pushUnique(points, point) {
  for (const existing of points) {
    if (length(sub(point, existing)) < MERGE_EPS) return false;
  }
  // 存副本：一来清掉 -0，二来保证返回值不与被冻结的 CUBE_VERTICES 共享引用
  // （否则调用方一改截面顶点就会在严格模式下抛 TypeError）。
  points.push([cleanZero(point[0]), cleanZero(point[1]), cleanZero(point[2])]);
  return true;
}

/* ── 立方体：8 顶点 / 12 棱 / 6 面 ────────────────────────────────────── */

/**
 * 8 个顶点，边长 2、中心原点。编号顺序与 qa-output/geometry-feasibility.mjs 完全一致
 * —— 两处若不一致，可行性脚本验证过的结论就不再适用于这里。
 */
export const CUBE_VERTICES = Object.freeze([
  Object.freeze([-1, -1, -1]), // 0  底面 z=-1
  Object.freeze([1, -1, -1]), // 1
  Object.freeze([1, 1, -1]), // 2
  Object.freeze([-1, 1, -1]), // 3
  Object.freeze([-1, -1, 1]), // 4  顶面 z=+1
  Object.freeze([1, -1, 1]), // 5
  Object.freeze([1, 1, 1]), // 6
  Object.freeze([-1, 1, 1]) // 7
]);

/** 12 条棱（顶点索引对）：先底面 4 条、再顶面 4 条、最后侧棱 4 条。 */
export const CUBE_EDGES = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([1, 2]),
  Object.freeze([2, 3]),
  Object.freeze([3, 0]),
  Object.freeze([4, 5]),
  Object.freeze([5, 6]),
  Object.freeze([6, 7]),
  Object.freeze([7, 4]),
  Object.freeze([0, 4]),
  Object.freeze([1, 5]),
  Object.freeze([2, 6]),
  Object.freeze([3, 7])
]);

/** 面的规范顺序：默认视角下的可见三面排在最前，visibleFaces() 直接复用这个顺序。 */
const FACE_TABLE = [
  { id: 'front', normal: [1, 0, 0], indices: [1, 2, 6, 5] },
  { id: 'top', normal: [0, 0, 1], indices: [4, 5, 6, 7] },
  { id: 'right', normal: [0, 1, 0], indices: [3, 7, 6, 2] },
  { id: 'back', normal: [-1, 0, 0], indices: [0, 4, 7, 3] },
  { id: 'bottom', normal: [0, 0, -1], indices: [0, 3, 2, 1] },
  { id: 'left', normal: [0, -1, 0], indices: [0, 1, 5, 4] }
];

// indices 的绕向已按「从立方体外侧看逆时针」排好（右手法则：相邻边叉积指向外法向），
// test/geometry.test.mjs 会逐面验证 —— 手写表最怕的就是绕向反了，反了会画出空心的图。
const CUBE_FACES = Object.freeze(
  FACE_TABLE.map((face) =>
    Object.freeze({
      id: face.id,
      normal: Object.freeze(face.normal),
      indices: Object.freeze(face.indices),
      vertices: Object.freeze(face.indices.map((index) => CUBE_VERTICES[index]))
    })
  )
);

const CUBE_EDGE_LIST = Object.freeze(
  CUBE_EDGES.map(([a, b]) =>
    Object.freeze({
      indices: Object.freeze([a, b]),
      a: CUBE_VERTICES[a],
      b: CUBE_VERTICES[b]
    })
  )
);

/** 立方体外接球半径：中心到顶点的距离 √3。d 超过它就不可能有交点了。 */
const CUBE_CIRCUMRADIUS = Math.sqrt(3);

/**
 * 6 个面：`{ id, normal, indices, vertices }`，顺序为 front/top/right/back/bottom/left。
 *   · normal   单位外法向（[1,0,0] 等坐标轴方向）；
 *   · indices  4 个顶点索引，**从外侧看逆时针**；
 *   · vertices 与 indices 一一对应的顶点坐标。
 * 返回的是同一个冻结对象，调用方改不动（共享数据被就地改写是最难查的一类 bug）。
 */
export function cubeFaces() {
  return CUBE_FACES;
}

/** 12 条棱：`{ indices: [i, j], a: [x,y,z], b: [x,y,z] }`，供渲染层逐条画线与消隐。 */
export function cubeEdges() {
  return CUBE_EDGE_LIST;
}

/* ── 轴测投影（确定性，无随机） ───────────────────────────────────────── */

const DEG = Math.PI / 180;

/** 方位角：相机绕竖直轴（z）转过的角度。 */
export const VIEW_AZIMUTH_DEG = 45;
/**
 * 仰角（俯角）：相机高出水平面的角度。
 *
 * 为什么是 30° 而不是正等测的 arcsin(1/√3) ≈ 35.264°：
 * 恰好在 35.264° 时，体对角线 (1,1,1) 与视线平行，近角点与远角点**精确重合**在
 * 画面中心 —— 立体图会退化成「两个角点叠在一起」的歧义图，8 个顶点投影后也不再
 * 互不重合（这条是 test 里的断言）。30° 只差 5°，观感仍是标准立方体，却把两个角点
 * 在画面上拉开约 0.32 个单位（约为立方体投影宽度的 11%），歧义消失。
 */
export const VIEW_ELEVATION_DEG = 30;

const AZ = VIEW_AZIMUTH_DEG * DEG;
const EL = VIEW_ELEVATION_DEG * DEG;
const COS_EL = Math.cos(EL);
const SIN_EL = Math.sin(EL);
const COS_AZ = Math.cos(AZ);
const SIN_AZ = Math.sin(AZ);

/** 相机方向（由立方体中心指向相机，单位向量）。 */
const TOWARD_CAMERA = Object.freeze([COS_EL * COS_AZ, COS_EL * SIN_AZ, SIN_EL]);
/** 视线方向（相机 → 场景，单位向量），即 isBackFacing 的默认 viewDir。 */
const VIEW_DIRECTION = Object.freeze(TOWARD_CAMERA.map((axis) => -axis));
/** 世界坐标中的「屏幕向右」方向。 */
const SCREEN_RIGHT = Object.freeze([-SIN_AZ, COS_AZ, 0]);
/** 世界坐标中的「屏幕向上」方向。屏幕 y 向下，故 project 里 y 取负号。 */
const SCREEN_UP = Object.freeze([-SIN_EL * COS_AZ, -SIN_EL * SIN_AZ, COS_EL]);

/**
 * 等距/轴测投影：3D 世界坐标 → 2D 屏幕坐标（y 轴向下，SVG 约定）。
 *
 * 正交投影（相机在无穷远），只有旋转、没有透视与缩放 —— 所以它是**线性**的、
 * 完全确定性的。量纲与世界坐标一致（立方体边长 2 → 投影宽约 2.83、高约 3.15），
 * 渲染层要放进 viewBox 请用 cubeProjectionBounds() 取包围盒再自行缩放。
 *
 * 非法输入（非数组、非有限数）返回 **null**，不抛异常、也**不返回 {0,0}**：
 * 静默画到原点上会产出一张看起来正常、其实完全错位的图，比抛错难查得多。
 */
export function project(point3d) {
  const point = toVec3(point3d);
  if (!point) return null;
  return {
    x: cleanZero(dot(point, SCREEN_RIGHT)),
    y: cleanZero(-dot(point, SCREEN_UP))
  };
}

/** 视线方向（相机 → 场景，单位向量）。isBackFacing 的默认第二参数。 */
export function defaultViewDirection() {
  return VIEW_DIRECTION;
}

/**
 * 该面是否背对相机（背面 = 看不见的那一侧）。
 *
 * `viewDir` 是**相机看向场景**的方向（默认 defaultViewDirection()），
 * 判据为 n̂·v̂ > EPS。若你手上是「由物体指向相机」的方向，请先取反再传入。
 * 视线恰好平行于面（n̂·v̂ = 0）时不算背面 —— 此时该面在画面上退化成一条线，
 * 交给渲染层当轮廓处理，画成虚线会被误读成「结构在后面」。
 *
 * 任一参数非法（零向量、非有限数）时返回 false（当成可见），不抛异常：
 * 可见面漏画成虚线，比隐藏面画成实线更容易被发现。
 */
export function isBackFacing(faceNormal, viewDir = VIEW_DIRECTION) {
  const normal = normalize(toVec3(faceNormal));
  const direction = normalize(toVec3(viewDir));
  if (!normal || !direction) return false;
  return dot(normal, direction) > EPS;
}

/**
 * 当前视线下可见的面 id 数组，按规范顺序（默认视角即 ['front','top','right']）。
 * 与 isBackFacing 是同一判据，渲染层用哪个都不会出现「两套消隐」不一致。
 */
export function visibleFaces(viewDir = VIEW_DIRECTION) {
  return CUBE_FACES.filter((face) => !isBackFacing(face.normal, viewDir)).map((face) => face.id);
}

/** 8 个顶点投影后的包围盒，可直接用来算 SVG viewBox（含 width/height/center）。 */
export const CUBE_PROJECTION_BOUNDS = (() => {
  const points = CUBE_VERTICES.map((vertex) => project(vertex));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return Object.freeze({
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  });
})();

/** 立方体投影包围盒（见上）。 */
export function cubeProjectionBounds() {
  return CUBE_PROJECTION_BOUNDS;
}

/* ── 平面截立方体 ─────────────────────────────────────────────────────── */

/**
 * 平面内的一组正交单位基：`{ u, v, n }`，满足 u × v = n。
 * 截面排序与 2D 轮廓都依赖它，因此必须确定：helper 轴取「与法向最不平行的坐标轴」
 * （保证叉积长度 ≥ 0.816，避免近轴法向时叉积趋近零向量而放大浮点误差）。
 * 法向非法（零向量、非数组、非有限数）时返回 null。
 */
export function planeBasis(planeNormal) {
  const n = normalize(toVec3(planeNormal));
  if (!n) return null;
  const abs = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  let axis = 0;
  if (abs[1] < abs[axis]) axis = 1;
  if (abs[2] < abs[axis]) axis = 2;
  const helper = [0, 0, 0];
  helper[axis] = 1;
  const u = normalize(cross(n, helper));
  if (!u) return null;
  const v = cross(n, u);
  return { u, v, n };
}

/**
 * 平面 `{ x | n·x = d }` ∩ **实心**立方体 → 凸多边形顶点（3D，已按极角排序）。
 *
 * 算法：逐条棱求与平面的交点 → 去重 → 在平面内按极角排序。
 *
 * ⚠️ 三个必须按这个顺序处理的退化情形：
 *
 * 1. **整条棱躺在平面上**（两端点都在平面上）→ 跳过这条棱。
 *    不是「随便跳」：跳过是**完备**的。某个顶点若被跳过，说明它的棱都躺在平面上，
 *    而一个顶点处的 3 条棱两两垂直，一个平面至多同时包含其中 2 条（第 3 条垂直于该
 *    平面）—— 所以每个被跳过的棱的端点，必定还被一条**不共面**的棱捕获（那条棱
 *    要么穿过平面、要么该端点本身就是平面上的点）。不跳的话，同一条棱会贡献两个
 *    端点，得到重复点、排序也随之错乱。
 * 2. **端点恰好在平面上** → 直接取该端点（此时不能再算插值：da=0 会让 t 退化成 0/0）。
 * 3. **点数不足 3** → 返回 **[]**。平面只擦到一个顶点（1 点）或一条棱（2 点）时，
 *    交集凑不出多边形；返回 [] 而不是 1~2 个点，渲染层才能用统一规则处理
 *    （「空 = 没得画」），也保证本函数的返回值恒为「0 或 3~6 个点」。
 *
 * 返回的顶点顺序：**从 +n 一侧看过去是逆时针**（在 u×v=n 的右手基里极角递增）。
 * 边界情形（零向量法向、d 超出立方体、非法入参）一律返回 []，不抛异常。
 *
 * 关于 d：法向会被归一化，因此 **d 是原点到平面的有向距离**，与法向的长度无关。
 * 这不改变任何几何结论（同一个平面，换个法向长度仍是同一个平面）。
 */
export function cubeSection(planeNormal, d) {
  const normal = toVec3(planeNormal);
  if (!normal) return [];
  const offsetInput = Number(d);
  if (!Number.isFinite(offsetInput)) return [];
  const direction = normalize(normal);
  if (!direction) return []; // 零向量法向：平面无从定义

  const offset = offsetInput / length(normal);
  // 平面完全在立方体外（外接球半径 √3）：先快速退出，也顺手兜住 d 极大的入参。
  if (Math.abs(offset) > CUBE_CIRCUMRADIUS + EPS) return [];

  const signed = CUBE_VERTICES.map((vertex) => dot(direction, vertex) - offset);
  const points = [];
  for (const [i, j] of CUBE_EDGES) {
    const da = signed[i];
    const db = signed[j];
    const aOn = Math.abs(da) <= EPS;
    const bOn = Math.abs(db) <= EPS;
    if (aOn && bOn) continue; // 退化 1：整条棱在平面上
    if (aOn) {
      pushUnique(points, CUBE_VERTICES[i]); // 退化 2：端点恰好落在平面上
      continue;
    }
    if (bOn) {
      pushUnique(points, CUBE_VERTICES[j]);
      continue;
    }
    if (da * db > 0) continue; // 两端同侧，无交点
    const t = da / (da - db);
    const a = CUBE_VERTICES[i];
    const b = CUBE_VERTICES[j];
    pushUnique(points, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }

  return orderPolygon(points, direction);
}

/** 极角排序：以截面质心为极点，在 (u,v) 基里按 atan2 升序 → 凸多边形且 CCW。 */
function orderPolygon(points, unitNormal) {
  if (points.length < 3) return [];
  const basis = planeBasis(unitNormal);
  if (!basis) return [];

  // 三角形也走同一套极角排序：宁可多算几次 atan2，也要让「返回值一律是从 +n 侧
  // 看去的逆时针」这条不变量无条件成立 —— 渲染层若按绕向判断朝向，特例就是陷阱。
  const center = [0, 0, 0];
  for (const point of points) {
    center[0] += point[0];
    center[1] += point[1];
    center[2] += point[2];
  }
  center[0] /= points.length;
  center[1] /= points.length;
  center[2] /= points.length;

  // 极角相同时（理论上只可能出现在退化多边形上）按半径兜底比较，
  // 保证排序结果与引擎的排序稳定性无关 —— 确定性是渲染层的前提。
  const keyed = points.map((point) => {
    const local = sub(point, center);
    const angle = Math.atan2(dot(local, basis.v), dot(local, basis.u));
    return { point, angle, radius: length(local) };
  });
  keyed.sort((a, b) => (a.angle - b.angle) || (a.radius - b.radius));
  return keyed.map((entry) => entry.point);
}

/** 截面边数；无有效截面时 0（不是 null，契约要求 number）。 */
export function sectionSideCount(planeNormal, d) {
  return cubeSection(planeNormal, d).length;
}

/** 边数 → 中文形状名。3~6 之外（含「无截面」）为 null。立方体只有 6 个面，故不存在七边形。 */
export const SECTION_SHAPE_NAMES = Object.freeze({
  3: '三角形',
  4: '四边形',
  5: '五边形',
  6: '六边形'
});

/** 截面形状中文名：'三角形' | '四边形' | '五边形' | '六边形' | null。 */
export function sectionName(planeNormal, d) {
  return SECTION_SHAPE_NAMES[sectionSideCount(planeNormal, d)] ?? null;
}

/**
 * 截面的 2D 轮廓：把 3D 顶点投到平面自身的 (u, v) 坐标里，**以质心为原点**，
 * y 轴向下（与 project 同一约定），可直接当 SVG 坐标用 —— 供 `section-shape`
 * 选项图（只画截面本身的正视图）使用，视角约定为「从 +n 一侧看过去」。
 *
 * 无有效截面时返回 []。这是等距变换，故 2D 与 3D 的边长、周长、角度完全一致。
 */
export function sectionOutline(planeNormal, d) {
  const section = cubeSection(planeNormal, d);
  if (section.length < 3) return [];
  const basis = planeBasis(planeNormal);
  if (!basis) return [];
  const center = [0, 0, 0];
  for (const point of section) {
    center[0] += point[0];
    center[1] += point[1];
    center[2] += point[2];
  }
  center[0] /= section.length;
  center[1] /= section.length;
  center[2] /= section.length;
  return section.map((point) => {
    const local = sub(point, center);
    return [cleanZero(dot(local, basis.u)), cleanZero(-dot(local, basis.v))];
  });
}
