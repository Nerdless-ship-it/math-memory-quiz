/**
 * 标准几何体（圆柱 / 圆锥 / 球 / 长方体 / 正棱柱 / 正棱锥）的三视图与画法。
 *
 * 与 three-views.js 的分工：
 *   · three-views.js —— 单位小方块堆叠，视图是**方格**（一行行数方块）
 *   · 本文件 —— 曲面体与棱柱棱锥，视图是**矩形 / 圆 / 等腰三角形 / 正多边形**
 * 两者的方向约定完全一致（中国第一角投影）：俯视图下方＝物体前方、左视图右方＝物体前方。
 *
 * ── 视图规则（教材结论，本文件逐条实现，测试逐条断言）──────────────────
 *   圆柱：主视图 矩形(2r × h)   俯视图 圆(r)        左视图 矩形(2r × h)
 *   圆锥：主视图 等腰三角形      俯视图 圆(r)        左视图 等腰三角形
 *   球　：三个视图都是圆(r)
 *   长方体：主视图 矩形(w × h)   俯视图 矩形(w × d)   左视图 矩形(d × h)
 *   正三棱柱（一条棱朝前）：主视图 矩形(棱长 × h)   俯视图 正三角形   左视图 矩形(1.5r × h)
 *     为什么两个矩形不一样宽：从正面看到的是三角形的**宽度**（棱长 √3·r），
 *     从左面看到的是三角形的**前后进深**（r + r/2 = 1.5r）。这正是本题型的考点之一。
 *   正四棱锥：主视图 等腰三角形(底=边长, 高=h)   俯视图 正方形＋对角线   左视图 等腰三角形
 *
 * ── 画法约定 ──────────────────────────────────────────────────────
 *   与 figure.js 同一套斜二测投影（正面不变形），凸体的轮廓 = 投影点的**凸包**
 *   （凸体的投影轮廓就是顶点投影的凸包，这条对棱柱棱锥长方体都成立），
 *   曲面体再用若干采样点近似圆，于是圆在画面上自然成为椭圆——与教材画法一致。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEPTH_X = 0.5;
const DEPTH_Y = 0.33;
const CAMERA_DIR = normalize([0.62, 0.58, 1]); // 右上前方（与 figure.js 一致）
const CIRCLE_SAMPLES = 48;

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** 斜二测投影：x 直接取、y 翻转（SVG 向下为正）、z 斜着退出深度。 */
const project = ([x, y, z]) => ({ x: x + z * DEPTH_X, y: -y - z * DEPTH_Y });

/** 立体目录：三视图题库用它出题，搭建器/演示也可以复用。 */
export const SOLID_SHAPES = Object.freeze([
  { id: 'cylinder', name: '圆柱', radius: 1, height: 1.8 },
  { id: 'cone', name: '圆锥', radius: 1, height: 1.8 },
  { id: 'sphere', name: '球', radius: 1 },
  { id: 'cuboid', name: '长方体', width: 1.9, depth: 1.1, height: 1.3 },
  { id: 'prism3', name: '正三棱柱', sides: 3, radius: 1.1, height: 1.6 },
  { id: 'pyramid4', name: '正四棱锥', sides: 4, radius: 1.2, height: 1.7 }
]);

export const SOLID_BY_ID = Object.freeze(Object.fromEntries(SOLID_SHAPES.map((s) => [s.id, s])));

/** 正多边形（俯视图）的边长：外接圆半径 r → 边长 2r·sin(π/n)。 */
export const sideLength = (radius, sides) => 2 * radius * Math.sin(Math.PI / sides);

/**
 * 求一个立体的三个视图（形状描述）。
 *
 * 形状有三种：rect（矩形，宽×高）、circle（圆，半径）、triangle（等腰三角形，底×高）、
 * polygon（正多边形，边数/半径/是否画中心连线）——正是考公三视图选项里会出现的那几种。
 *
 * @param {{id: string}} solid
 * @returns {{ front: object, top: object, left: object }}
 */
export function solidViews(solid) {
  const id = typeof solid === 'string' ? solid : solid?.id;
  const shape = SOLID_BY_ID[id];
  if (!shape) throw new Error(`solid-shapes: 未知立体 "${id}"，可用：${SOLID_SHAPES.map((s) => s.id).join(', ')}`);

  if (id === 'cylinder') {
    const rect = { kind: 'rect', width: 2 * shape.radius, height: shape.height };
    return { front: rect, top: { kind: 'circle', radius: shape.radius }, left: { ...rect } };
  }
  if (id === 'cone') {
    const triangle = { kind: 'triangle', base: 2 * shape.radius, height: shape.height };
    return { front: triangle, top: { kind: 'circle', radius: shape.radius }, left: { ...triangle } };
  }
  if (id === 'sphere') {
    const circle = { kind: 'circle', radius: shape.radius };
    return { front: { ...circle }, top: { ...circle }, left: { ...circle } };
  }
  if (id === 'cuboid') {
    return {
      front: { kind: 'rect', width: shape.width, height: shape.height },
      top: { kind: 'rect', width: shape.width, height: shape.depth },
      left: { kind: 'rect', width: shape.depth, height: shape.height }
    };
  }
  if (id === 'prism3') {
    const edge = sideLength(shape.radius, 3); // 棱长 = √3·r
    return {
      front: { kind: 'rect', width: edge, height: shape.height },
      // 一条棱朝前 ⇒ 俯视图的三角形有一个顶点朝下（下方＝前方）
      top: { kind: 'polygon', sides: 3, radius: shape.radius, spin: 180 },
      left: { kind: 'rect', width: 1.5 * shape.radius, height: shape.height }
    };
  }
  // pyramid4：底面是边长为 √2·r 的正方形，俯视图画成「正方形＋对角线」
  const side = sideLength(shape.radius, 4);
  const triangle = { kind: 'triangle', base: side, height: shape.height };
  return {
    front: triangle,
    top: { kind: 'polygon', sides: 4, radius: shape.radius, spin: 45, spokes: true },
    left: { ...triangle }
  };
}

/** 形状判等键（生成干扰项、断言「恰好一项正确」都用它）。 */
export function shapeKey(shape) {
  if (!shape) return 'null';
  const parts = [shape.kind];
  for (const key of ['width', 'height', 'radius', 'base', 'sides', 'spin', 'rx', 'ry']) {
    if (shape[key] !== undefined) parts.push(`${key}=${Number(shape[key].toFixed ? shape[key].toFixed(4) : shape[key])}`);
  }
  if (shape.spokes) parts.push('spokes');
  return parts.join('|');
}

/** 三个视图合起来的判等键（「哪个立体的三视图与题干一致」用它）。 */
export function solidViewsKey(solid) {
  const views = solidViews(solid);
  return ['front', 'top', 'left'].map((name) => shapeKey(views[name])).join('||');
}

// ── 2D 形状 ─────────────────────────────────────────────────────────

/** 形状的包围盒（画布尺寸用）。 */
export function shapeBounds(shape) {
  if (shape.kind === 'circle') return { width: 2 * shape.radius, height: 2 * shape.radius };
  if (shape.kind === 'ellipse') return { width: 2 * shape.rx, height: 2 * shape.ry };
  if (shape.kind === 'rect') return { width: shape.width, height: shape.height };
  if (shape.kind === 'triangle') return { width: shape.base, height: shape.height };
  if (shape.kind === 'polygon') {
    const points = polygonPoints(shape);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  throw new Error(`solid-shapes: 未知形状 "${shape?.kind}"`);
}

function polygonPoints({ sides, radius, spin = 0 }) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = ((spin - 90 + (360 / sides) * i) * Math.PI) / 180;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

/**
 * 画一个视图形状（二维）。
 * @param {object} shape solidViews() 返回的形状描述
 * @param {{ unit?: number, pad?: number, className?: string }} [options]
 * @returns {SVGElement}
 */
export function renderShape(shape, options = {}) {
  const unit = Number.isFinite(options.unit) ? options.unit : 46; // 每个「单位长度」多少像素
  const pad = Number.isFinite(options.pad) ? options.pad : 12;
  const className = options.className ?? 'figure-view-shape';
  const bounds = shapeBounds(shape);
  const width = Math.round(bounds.width * unit + pad * 2);
  const height = Math.round(bounds.height * unit + pad * 2);
  const cx = width / 2;
  const cy = height / 2;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': shapeLabel(shape),
    class: 'figure-view-svg'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;

  if (shape.kind === 'circle') {
    svg.append(svgEl('circle', { cx, cy, r: shape.radius * unit, class: className }));
  } else if (shape.kind === 'ellipse') {
    // 椭圆只会作为**干扰项**出现：它正是「斜着看一个圆」的样子，
    // 也就是把立体图的观感当成俯视图的典型错误。
    svg.append(svgEl('ellipse', { cx, cy, rx: shape.rx * unit, ry: shape.ry * unit, class: className }));
  } else if (shape.kind === 'rect') {
    svg.append(svgEl('rect', {
      x: cx - (shape.width * unit) / 2,
      y: cy - (shape.height * unit) / 2,
      width: shape.width * unit,
      height: shape.height * unit,
      class: className
    }));
  } else if (shape.kind === 'triangle') {
    const points = [
      [cx, cy - (shape.height * unit) / 2], // 顶点朝上
      [cx + (shape.base * unit) / 2, cy + (shape.height * unit) / 2],
      [cx - (shape.base * unit) / 2, cy + (shape.height * unit) / 2]
    ];
    svg.append(svgEl('path', { d: polygonPath(points), class: className }));
  } else if (shape.kind === 'polygon') {
    const points = polygonPoints(shape).map(([x, y]) => [cx + x * unit, cy + y * unit]);
    svg.append(svgEl('path', { d: polygonPath(points), class: className }));
    if (shape.spokes) {
      // 棱锥的俯视图：从中心连到每个顶点（教材画法，也是学生判断棱数的依据）
      for (const [x, y] of points) {
        svg.append(svgEl('line', { x1: cx, y1: cy, x2: x, y2: y, class: `${className}-spoke` }));
      }
    }
  } else {
    throw new Error(`solid-shapes: 未知形状 "${shape?.kind}"`);
  }
  return svg;
}

/** 形状的中文描述（无障碍与测试用）。 */
export function shapeLabel(shape) {
  if (!shape) return '空图形';
  const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (shape.kind === 'circle') return `半径 ${num(shape.radius)} 的圆`;
  if (shape.kind === 'ellipse') return `长轴 ${num(2 * shape.rx)}、短轴 ${num(2 * shape.ry)} 的椭圆`;
  if (shape.kind === 'rect') return `长 ${num(shape.width)}、宽 ${num(shape.height)} 的矩形`;
  if (shape.kind === 'triangle') return `底 ${num(shape.base)}、高 ${num(shape.height)} 的等腰三角形`;
  if (shape.kind === 'polygon') return `正 ${shape.sides} 边形${shape.spokes ? '（带中心连线）' : ''}`;
  return '图形';
}

// ── 3D 画法 ────────────────────────────────────────────────────────

function svgEl(tagName, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

const polygonPath = (points) => `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`;

/** 圆采样（水平面上的圆：y 固定）。 */
function circleSamples(radius, y, samples = CIRCLE_SAMPLES) {
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const angle = (2 * Math.PI * i) / samples;
    points.push([radius * Math.cos(angle), y, radius * Math.sin(angle)]);
  }
  return points;
}

/** 凸包（Andrew monotone chain）——凸体的投影轮廓。 */
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** 立体的「绘制片段」：hull = 投影点求凸包；poly = 按顺序连成多边形。 */
function solidPrimitives(solid) {
  const shape = SOLID_BY_ID[typeof solid === 'string' ? solid : solid?.id];
  if (!shape) throw new Error(`solid-shapes: 未知立体 "${solid?.id ?? solid}"`);

  if (shape.id === 'cylinder') {
    const bottom = circleSamples(shape.radius, 0);
    const top = circleSamples(shape.radius, shape.height);
    return [
      { kind: 'hull', points: [...bottom, ...top], shade: 'b' }, // 侧面
      { kind: 'poly', points: top, shade: 'a' }                  // 顶面：完整的椭圆
    ];
  }
  if (shape.id === 'cone') {
    const bottom = circleSamples(shape.radius, 0);
    return [
      { kind: 'hull', points: [...bottom, [0, shape.height, 0]], shade: 'b' }, // 锥面
      { kind: 'poly', points: bottom, shade: null, strokeOnly: true }          // 底面椭圆
    ];
  }
  if (shape.id === 'sphere') {
    // 球单独处理：教材里球画成**圆**（斜二测的仿射投影会把它压成椭圆，看起来不像球），
    // 再加一条赤道椭圆表示它是立体。
    return [
      { kind: 'sphere', radius: shape.radius },
      { kind: 'equator', radius: shape.radius }
    ];
  }
  if (shape.id === 'cuboid') {
    const { width: w, depth: d, height: h } = shape;
    return polyhedronPrimitives(
      [
        [-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2], // 0-3 底面
        [-w / 2, h, -d / 2], [w / 2, h, -d / 2], [w / 2, h, d / 2], [-w / 2, h, d / 2]  // 4-7 顶面
      ],
      [
        { indices: [4, 5, 6, 7], normal: [0, 1, 0] },
        { indices: [0, 3, 2, 1], normal: [0, -1, 0] },
        { indices: [3, 2, 6, 7], normal: [0, 0, 1] },
        { indices: [0, 1, 5, 4], normal: [0, 0, -1] },
        { indices: [1, 2, 6, 5], normal: [1, 0, 0] },
        { indices: [0, 3, 7, 4], normal: [-1, 0, 0] }
      ]
    );
  }
  if (shape.id === 'prism3') {
    // 一条棱朝前：底面的三个顶点分别在「前」「左后」「右后」
    const angles = [90, 210, 330]; // 以 +z（前方）为 0° 起算，绕竖直轴
    const bottom = angles.map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return [shape.radius * Math.cos(rad), 0, shape.radius * Math.sin(rad)];
    });
    const top = bottom.map(([x, , z]) => [x, shape.height, z]);
    const vertices = [...bottom, ...top];
    const faces = [
      { indices: [3, 4, 5], normal: [0, 1, 0] }, // 顶面
      { indices: [0, 2, 1], normal: [0, -1, 0] } // 底面
    ];
    for (let i = 0; i < 3; i += 1) {
      const next = (i + 1) % 3;
      const a = bottom[i];
      const b = bottom[next];
      // 侧面法向 = 边向量 × 竖直轴（取朝外的那一侧）
      const edge = [b[0] - a[0], 0, b[2] - a[2]];
      const normal = normalize([edge[2], 0, -edge[0]]);
      const outward = dot(normal, [a[0], 0, a[2]]) >= 0 ? normal : normal.map((v) => -v);
      faces.push({ indices: [i, next, next + 3, i + 3], normal: outward });
    }
    return polyhedronPrimitives(vertices, faces);
  }
  // pyramid4：底面正方形（边长 √2·r）+ 顶点
  const r = shape.radius;
  const corners = [[-r, 0, -r], [r, 0, -r], [r, 0, r], [-r, 0, r]];
  const vertices = [...corners, [0, shape.height, 0]];
  const faces = [{ indices: [0, 3, 2, 1], normal: [0, -1, 0] }];
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    const a = corners[i];
    const b = corners[next];
    const edge = [b[0] - a[0], 0, b[2] - a[2]];
    const normal = normalize([edge[2], 0, -edge[0]]);
    const outward = dot(normal, [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2]) >= 0 ? normal : normal.map((v) => -v);
    faces.push({ indices: [i, next, 4], normal: outward });
  }
  return polyhedronPrimitives(vertices, faces);
}

/** 多面体：只画朝向观察者的面（凸体可见面互不重叠，无需排序）。 */
function polyhedronPrimitives(vertices, faces) {
  const shades = ['a', 'b', 'c'];
  const visible = faces.filter((face) => dot(face.normal, CAMERA_DIR) > 1e-6);
  // 顶面最亮、正对观察者的次之：按法向与视线的夹角排序，正面越亮
  visible.sort((a, b) => dot(b.normal, CAMERA_DIR) - dot(a.normal, CAMERA_DIR));
  return visible.map((face, index) => ({
    kind: 'poly',
    points: face.indices.map((i) => vertices[i]),
    shade: shades[index % shades.length]
  }));
}

/**
 * 画一个立体的直观图（斜二测）。
 * @param {object|string} solid 立体描述或 id
 * @param {{ width?: number, height?: number }} [options]
 * @returns {SVGElement}
 */
export function renderSolid3d(solid, options = {}) {
  const shape = SOLID_BY_ID[typeof solid === 'string' ? solid : solid?.id];
  if (!shape) throw new Error(`solid-shapes: 未知立体 "${solid?.id ?? solid}"`);
  const primitives = solidPrimitives(shape);

  // 投影所有点求包围盒 → 缩放到画布并居中（任何立体都画得下，且大小一致）
  const projected = [];
  for (const primitive of primitives) {
    for (const point of primitive.points ?? []) projected.push(project(point));
  }
  if (shape.id === 'sphere') {
    // 球的轮廓按解析圆处理（见 solidPrimitives 的说明）
    const radius = shape.radius;
    for (const [x, y] of [[-radius, -radius], [radius, -radius], [0, 0], [0, -2 * radius]]) {
      projected.push({ x, y });
    }
  }
  const minX = Math.min(...projected.map((p) => p.x));
  const maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y));
  const maxY = Math.max(...projected.map((p) => p.y));
  const pad = 14;
  const boxW = Math.max(maxX - minX, 1e-6);
  const boxH = Math.max(maxY - minY, 1e-6);
  const unit = Math.min((options.width ?? 190) / boxW, (options.height ?? 170) / boxH);
  const width = Math.round(boxW * unit + pad * 2);
  const height = Math.round(boxH * unit + pad * 2);
  const toScreen = ([x, y, z]) => {
    const p = project([x, y, z]);
    return [(p.x - minX) * unit + pad, (p.y - minY) * unit + pad];
  };

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `${shape.name}的立体图`,
    class: 'figure-solid-3d'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;

  for (const primitive of primitives) {
    if (primitive.kind === 'sphere') {
      // 解析圆：球在任何角度看起来都是圆（半径 r）
      svg.append(svgEl('circle', {
        cx: (0 - minX) * unit + pad,
        cy: (-primitive.radius - minY) * unit + pad,
        r: primitive.radius * unit,
        class: 'figure-solid-face figure-cube-face--b'
      }));
      continue;
    }
    if (primitive.kind === 'equator') {
      const points = circleSamples(primitive.radius, primitive.radius).map(toScreen);
      svg.append(svgEl('path', { d: polygonPath(points), class: 'figure-solid-equator' }));
      continue;
    }
    const points = primitive.kind === 'hull'
      ? convexHull(primitive.points.map(toScreen))
      : primitive.points.map(toScreen);
    svg.append(svgEl('path', {
      d: polygonPath(points),
      class: `figure-solid-face${primitive.shade ? ` figure-cube-face--${primitive.shade}` : ''}${primitive.strokeOnly ? ' figure-solid-outline' : ''}`
    }));
  }
  return svg;
}

/**
 * 画一个立体的三视图组合（标准布局：主视图左上、左视图右上、俯视图在正下方）。
 * @param {object|string} solid
 * @returns {SVGElement}
 */
export function renderShapeViews(solid, options = {}) {
  const shape = SOLID_BY_ID[typeof solid === 'string' ? solid : solid?.id];
  if (!shape) throw new Error(`solid-shapes: 未知立体 "${solid?.id ?? solid}"`);
  const unit = Number.isFinite(options.unit) ? options.unit : 26;
  const gap = 30;
  const pad = 12;
  const titleH = 20;
  const views = solidViews(shape);

  const box = (view) => {
    const bounds = shapeBounds(view);
    return { width: bounds.width * unit, height: bounds.height * unit };
  };
  const frontBox = box(views.front);
  const topBox = box(views.top);
  const leftBox = box(views.left);

  const frontX = pad;
  const frontY = pad;
  const leftX = frontX + frontBox.width + gap;
  const topX = frontX; // 长对正
  const topY = frontY + frontBox.height + titleH + gap;

  const width = Math.round(leftX + leftBox.width + pad);
  const height = Math.round(topY + topBox.height + titleH + pad);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `${shape.name}的三视图。主视图：${shapeLabel(views.front)}。`
      + `俯视图：${shapeLabel(views.top)}。左视图：${shapeLabel(views.left)}`,
    class: 'figure-view-svg'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;

  const placeShape = (view, x, y, boxInfo) => {
    const scale = unit;
    const cx = x + boxInfo.width / 2;
    const group = svgEl('g', {});
    const to = ([sx, sy]) => [cx + sx * scale, y + boxInfo.height / 2 + sy * scale];
    if (view.kind === 'circle') {
      group.append(svgEl('circle', { cx, cy: y + boxInfo.height / 2, r: view.radius * scale, class: 'figure-view-shape' }));
    } else if (view.kind === 'rect') {
      group.append(svgEl('rect', {
        x: cx - (view.width * scale) / 2,
        y: y + boxInfo.height / 2 - (view.height * scale) / 2,
        width: view.width * scale,
        height: view.height * scale,
        class: 'figure-view-shape'
      }));
    } else if (view.kind === 'triangle') {
      group.append(svgEl('path', {
        d: polygonPath([
          [cx, y + boxInfo.height / 2 - (view.height * scale) / 2],
          [cx + (view.base * scale) / 2, y + boxInfo.height / 2 + (view.height * scale) / 2],
          [cx - (view.base * scale) / 2, y + boxInfo.height / 2 + (view.height * scale) / 2]
        ]),
        class: 'figure-view-shape'
      }));
    } else if (view.kind === 'polygon') {
      const points = polygonPoints(view).map(([sx, sy]) => to([sx, sy]));
      group.append(svgEl('path', { d: polygonPath(points), class: 'figure-view-shape' }));
      if (view.spokes) {
        for (const [px, py] of points) {
          group.append(svgEl('line', { x1: cx, y1: y + boxInfo.height / 2, x2: px, y2: py, class: 'figure-view-shape-spoke' }));
        }
      }
    }
    return group;
  };

  const title = (text, boxInfo, x, y) => svgEl('text', {
    x: x + boxInfo.width / 2,
    y,
    class: 'figure-view-title',
    'text-anchor': 'middle',
    'aria-hidden': 'true'
  }, text);

  svg.append(placeShape(views.front, frontX, frontY, frontBox));
  svg.append(placeShape(views.left, leftX, frontY, leftBox));
  svg.append(placeShape(views.top, topX, topY, topBox));
  svg.append(title('主视图', frontBox, frontX, frontY + frontBox.height + 15));
  svg.append(title('左视图', leftBox, leftX, frontY + leftBox.height + 15));
  svg.append(title('俯视图', topBox, topX, topY + topBox.height + 15));
  return svg;
}

export default {
  SOLID_SHAPES,
  SOLID_BY_ID,
  solidViews,
  solidViewsKey,
  shapeKey,
  shapeBounds,
  shapeLabel,
  renderShape,
  renderSolid3d,
  renderShapeViews,
  sideLength
};
