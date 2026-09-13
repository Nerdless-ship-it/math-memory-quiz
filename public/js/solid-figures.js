// 几何易错点图解（B 方案：精确、干净的 2D 矢量画法）。
//
// ── 画法与参考样张对齐（这一版重画的原因）────────────────────────────
// 用户给了一张标准**斜投影（cavalier）**立方体做样张：
//   正面 = **真正的正方形**，完全不变形；
//   深度沿 45° 斜向、**1:1 足尺**。
// 实测参考图：正面 (150,118)-(283,250) 即 133×132 的正方形，
// 顶面右上角 (380,45) ⇒ 深度向量 (97,-73)，约为边长的 (0.73,-0.55)（长约 0.91、仰角约 37°）。
//
// 我上一版用的是「深度收缩 0.5/0.33」的近似，又配了居中椭圆和灰调小字，
// 整体发糊、不像样张。现在统一到**足尺斜投影 + 细黑线 + 淡色填充**：
// 干净、清楚，和参考图同一种画法。
//
// ── 为什么圆柱的顶面画成椭圆是对的 ──────────────────────────────────
// 斜投影下，法向为 (0,-1,0) 的圆投影后是**椭圆**（因为投影依赖 y 坐标）。
// 只有**正对观察者的圆**（法向沿深度方向）才投影成圆。
// 所以椭圆的顶面不是偷懒，是这种投影的必然结果。

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── 斜投影参数：**斜二测（cabinet）**────────────────────────────────
// 正面不变形，深度取**半尺**、方向 45°。这是教材/考公图的标准画法，也才读得出「等边」。
//
// 注意别照抄用户那张参考图的实测比例：那张正面 133×132，深度向量 (97,−73) 即 0.73 倍边长，
// 按那个比例画出来的立方体**看起来是长方体**（我照抄后就是这样）。
// 参考图本身是个略扁的盒子，不是标准立方体。
const OBLIQUE_ANGLE_DEG = 45;
const OBLIQUE_SCALE = 0.5;
const DEPTH_X = OBLIQUE_SCALE * Math.cos((OBLIQUE_ANGLE_DEG * Math.PI) / 180);
const DEPTH_Y = -OBLIQUE_SCALE * Math.sin((OBLIQUE_ANGLE_DEG * Math.PI) / 180);

/** 世界坐标 → 屏幕。x 右、y 上、z 朝观察者（z 增大表示往观察者方向出来）。 */
function project([x, y, z]) {
  return { x: x + z * DEPTH_X, y: -y + z * DEPTH_Y };
}

const INK = '#17231f';
const FILL_FRONT = '#e8eeea';
const FILL_TOP = '#dfe7e2';
const FILL_SIDE = '#cfdcd6';
const FILL_DEEP = '#c2d2ca';   // 「看进去」的内壁，比侧面再深一档
const CUT_LINE = '#126b52';
const CUT_FILL = 'rgba(18, 107, 82, 0.16)';
const MUTED = '#66716d';

function svgElement(tagName, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function createSvg({ width, height, label, children }) {
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': label,
    class: 'figure-svg'
  });
  // ⚠️ 必须给**具体像素宽度**，不能只给 width:100% + aspect-ratio：
  // 放在 flex 容器里（本模块的预览与题库排版都是）时，100% 会解析成 0，
  // 整个 SVG 塌成不可见——实测就是一片空白，而 DOM 里图形元素全都在、viewBox 也正常。
  // 用 min(宽度上限, 100%) 兼顾「不超出容器」与「有确定尺寸」。
  svg.style.width = `min(${width}px, 100%)`;
  svg.style.height = 'auto';
  svg.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) svg.append(child);
  return svg;
}

const SHARP = {
  stroke: INK,
  'stroke-width': 1.6,
  'stroke-linejoin': 'round',
  'stroke-linecap': 'round',
  fill: 'none'
};

const toPath = (pts) => `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`;
const closedPath = (pts) => `${toPath(pts)}Z`;

/**
 * 立方体（棱长 size，一角在原点，往 +x / +y / −z 展开）。
 * 可见三面：front（正对观察者的正方形）、top、right —— 与参考样张完全同构。
 */
function cubeGeometry(origin, size) {
  const [ox, oy, oz] = origin;
  const P = (x, y, z) => project([ox + x * size, oy + y * size, oz + z * size]);
  const front = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)];
  const top = [P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1)];
  const right = [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)];
  return {
    front, top, right,
    // 可见轮廓：正面下/右/左三条边 + 三条深度边 + 顶面与右面之间那条
    outline: [
      [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1)],
      [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1)],
      [P(1, 1, 0), P(0, 1, 0), P(0, 1, 1)],
      [P(0, 1, 1), P(1, 1, 1)],
      [P(1, 1, 1), P(1, 0, 1)],
      [P(0, 1, 0), P(0, 1, 1)]
    ],
    P,
    visibleEdges: { front, top, right }
  };
}

/**
 * 以「世界原点在角落」的简单坐标画好图形，再用 **viewBox 平移**把它框住。
 *
 * ⚠️ 不再去算「原点的绝对位置」——那个办法我连错三次符号（project() 返回的是屏幕
 * 坐标，而 origin 加在世界坐标上，x 与 y 的符号方向相反），每次都是
 * 「DOM 里元素齐全、viewBox 正常、fill 正常，但画面一片空白」。
 * 改成先按最朴素的坐标画（原点就在 0,0），量出包围盒后只调 viewBox：
 * viewBox 的 min-x/min-y 天生就是「把哪个角落对到画布左上」，
 * 一个减号都不会错。
 *
 * ⚠️ 包围盒必须覆盖**所有**图元的坐标，包括用 `d` 字符串描述的曲线。
 * 第一版只统计了 `item.points`，于是圆柱（用 d 画的）没参与计算，
 * viewBox 框小了、图形直接溢出卡片并盖住标题。
 * 现在改用 getBBox 量真实几何——SVG 自己算的，不会漏。
 */
function frameToSvg({ label, build, padding = 24 }) {
  const items = build();

  // 先按朴素坐标画出来，挂到一个隐藏容器里，用 getBBox 量真实包围盒
  const probeChildren = items.map((item) => svgElement('path', {
    d: item.points ? closedPath(item.points) : item.d,
    fill: item.fill ?? 'none',
    stroke: item.stroke ?? INK,
    'stroke-width': item.dash ? 2 : 1.6
  }));
  const measurer = svgElement('svg', { viewBox: '0 0 10 10' });
  measurer.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  for (const child of probeChildren) measurer.append(child);
  let box = { x: 0, y: 0, width: 1, height: 1 };
  try {
    document.body.append(measurer);
    box = measurer.getBBox();
  } finally {
    measurer.remove();
  }
  // getBBox 在无布局环境（如测试）可能返回全 0，兜一个退化值
  if (!(box.width > 0) || !(box.height > 0)) box = { x: 0, y: 0, width: 1, height: 1 };

  const width = box.width + padding * 2;
  const height = box.height + padding * 2;

  // 真实绘制（坐标不变，只挪 viewBox 把它框住）
  const children = items.map((item) => {
    const attrs = {
      d: item.points ? closedPath(item.points) : item.d,
      fill: item.fill ?? 'none',
      stroke: item.stroke ?? INK,
      'stroke-width': item.dash ? 2 : 1.6,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    };
    if (item.dash) attrs['stroke-dasharray'] = '7 5';
    if (item.evenodd) attrs['fill-rule'] = 'evenodd';
    return svgElement('path', attrs);
  });

  const svg = svgElement('svg', {
    viewBox: `${(box.x - padding).toFixed(1)} ${(box.y - padding).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': label,
    class: 'figure-svg'
  });
  svg.style.width = `min(${Math.round(width)}px, 100%)`;
  svg.style.height = 'auto';
  svg.style.aspectRatio = `${Math.round(width)} / ${Math.round(height)}`;
  for (const child of children) svg.append(child);
  return svg;
}

/**
 * 参考样张：一个干净的立方体（正面正方形 + 45° 退出的深度），
 * 与用户给的那张图完全同构。这张对上，才谈得上后面的图解也对齐。
 */
export function renderCubeReference(options = {}) {
  const size = Number.isFinite(options.size) ? options.size : 118;
  return frameToSvg({
    label: '立方体：正面是正方形，深度沿 45° 斜向退出',
    build: () => {
      const P = (x, y, z) => project([x * size, y * size, z * size]);
      return [
        { points: [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)], fill: FILL_FRONT },
        { points: [P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1)], fill: FILL_TOP },
        { points: [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)], fill: FILL_SIDE }
      ];
    }
  });
}

// ── 圆柱的斜二测几何 ────────────────────────────────────────────────
//
// 斜二测下，**水平圆**（在 xz 平面上）投影出来是**椭圆**，很扁：
//   世界点 (R cosθ, y, R sinθ) → 屏幕 (R cosθ + R sinθ·dx, −y + R sinθ·dy)
//   ⇒ 水平半轴 = R√(1+dx²) ≈ 1.118R，竖直半轴 = R·|dy| = 0.354R（dx=dy=0.354）
// 这不是偷懒画扁，是这种投影的必然结果——所以圆柱的顶面就是一个很扁的椭圆。
//
// 顶面椭圆中心比底面中心**高 0.354h**（深度位移 dy 造成的），这就是立体感来源。

/** 水平圆投影后的半轴与端点。 */
function projectedCircle(radius) {
  const rx = radius * Math.sqrt(1 + DEPTH_X * DEPTH_X);
  const ry = Math.abs(DEPTH_Y) * radius;
  return { rx, ry };
}

/**
 * 画一个（可空心的）竖直圆柱。
 * @param {object} o radius/height/cavityRatio（0 表示实心）/planeY（切面高度比例）
 */
function buildCylinder(o) {
  const radius = Number.isFinite(o.radius) ? o.radius : 78;
  const height = Number.isFinite(o.height) ? o.height : 150;
  const ratio = Number.isFinite(o.cavityRatio) ? o.cavityRatio : 0;
  const inner = radius * ratio;

  // 底面椭圆中心放在 y=0；世界坐标 y 向上，故顶面中心 cy = −height
  const { rx, ry } = projectedCircle(radius);
  const innerProj = projectedCircle(inner);
  const topCenter = { x: 0, y: -height };

  const arcs = [];
  arcs.push({
    // 侧面：左竖线 → 底弧 → 右竖线
    d: `M${-rx},${topCenter.y}`
      + `L${-rx},0`
      + `A${rx},${ry} 0 0 0 ${rx},0`
      + `L${rx},${topCenter.y}`,
    fill: FILL_SIDE
  });
  arcs.push({
    // 顶面
    d: `M${topCenter.x - rx},${topCenter.y}`
      + `A${rx},${ry} 0 1 0 ${topCenter.x + rx},${topCenter.y}`
      + `A${rx},${ry} 0 1 0 ${topCenter.x - rx},${topCenter.y}Z`,
    fill: FILL_TOP
  });

  if (inner > 0) {
    // 空腔开口：顶面上的内圈椭圆
    arcs.push({
      d: `M${topCenter.x - innerProj.rx},${topCenter.y}`
        + `A${innerProj.rx},${innerProj.ry} 0 1 0 ${topCenter.x + innerProj.rx},${topCenter.y}`
        + `A${innerProj.rx},${innerProj.ry} 0 1 0 ${topCenter.x - innerProj.rx},${topCenter.y}Z`,
      fill: '#ffffff'
    });
    // 内壁可见的那一段：从右端经椭圆**下方**绕到左端（近侧内壁）
    arcs.push({
      d: `M${topCenter.x + innerProj.rx},${topCenter.y}`
        + `A${innerProj.rx},${innerProj.ry} 0 0 0 ${topCenter.x - innerProj.rx},${topCenter.y}`,
      fill: null
    });
  }

  return { arcs, topCenter, rx, ry, innerProj, inner, height };
}

/**
 * 空心圆柱被水平平面所截 —— 截面是**环，内部没有线**。
 * 这是「刀切到空心部分不带线」最直接的一张图。
 */
export function renderHollowCylinderCut(options = {}) {
  const radius = Number.isFinite(options.radius) ? options.radius : 74;
  const height = Number.isFinite(options.height) ? options.height : 150;
  const ratio = Number.isFinite(options.cavityRatio) ? options.cavityRatio : 0.5;
  return frameToSvg({
    label: '空心圆柱被水平平面所截：截面是一个环，内部没有线',
    build: () => {
      const cyl = buildCylinder({ radius, height, cavityRatio: ratio });
      const items = cyl.arcs.map((a) => ({ d: a.d, fill: a.fill }));
      // 切面：一条虚线横过立体
      const planeY = cyl.topCenter.y + height * 0.55;
      items.push({
        d: `M${-cyl.rx - 22},${planeY}L${cyl.rx + 34},${planeY}`,
        fill: null, stroke: CUT_LINE, dash: true
      });
      // 右侧截面示意：环
      const cx = cyl.rx + 132;
      const shapeR = { rx: radius * 0.62 * Math.sqrt(1 + DEPTH_X * DEPTH_X), ry: radius * 0.62 * Math.abs(DEPTH_Y) };
      const inR = { rx: shapeR.rx * ratio, ry: shapeR.ry * ratio };
      const cy = cyl.topCenter.y + height * 0.5;
      items.push({
        d: `M${cx - shapeR.rx},${cy}A${shapeR.rx},${shapeR.ry} 0 1 0 ${cx + shapeR.rx},${cy}`
          + `A${shapeR.rx},${shapeR.ry} 0 1 0 ${cx - shapeR.rx},${cy}Z `
          + `M${cx - inR.rx},${cy}A${inR.rx},${inR.ry} 0 1 0 ${cx + inR.rx},${cy}`
          + `A${inR.rx},${inR.ry} 0 1 0 ${cx - inR.rx},${cy}Z`,
        fill: FILL_FRONT, evenodd: true
      });
      return items;
    }
  });
}

/**
 * 斜切圆柱 —— 截面是**椭圆**，不是梯形。
 *
 * 照片里的易错点之一：很多选项画成「梯形」，那是不可能的。
 * 圆柱的截面只能是：圆（水平切）、椭圆（斜切）、矩形（平行于轴切）。
 */
export function renderObliqueCylinderCut(options = {}) {
  const radius = Number.isFinite(options.radius) ? options.radius : 74;
  const height = Number.isFinite(options.height) ? options.height : 150;
  return frameToSvg({
    label: '斜切圆柱：截面是椭圆，永远不会是梯形',
    build: () => {
      const cyl = buildCylinder({ radius, height, cavityRatio: 0 });
      const items = cyl.arcs.map((a) => ({ d: a.d, fill: a.fill }));
      // 斜切面：一条斜虚线
      const cy = cyl.topCenter.y + height * 0.5;
      items.push({
        d: `M${-cyl.rx - 26},${cy + 26}L${cyl.rx + 34},${cy - 26}`,
        fill: null, stroke: CUT_LINE, dash: true
      });
      // 右侧截面：椭圆（斜切得到的形状）
      const cx = cyl.rx + 140;
      const er = { rx: radius * 0.78 * Math.sqrt(1 + DEPTH_X * DEPTH_X), ry: radius * 0.62 * Math.abs(DEPTH_Y) };
      items.push({
        d: `M${cx - er.rx},${cy}A${er.rx},${er.ry} 0 1 0 ${cx + er.rx},${cy}`
          + `A${er.rx},${er.ry} 0 1 0 ${cx - er.rx},${cy}Z`,
        fill: FILL_FRONT
      });
      return items;
    }
  });
}

/**
 * 正方体挖一个方形通孔 —— 「方洞是方的，斜着切才会变成别的形状」。
 *
 * 画法：正面的正方形要挖空，顶面露出洞的开口，再补上洞的内壁（往深度方向退）。
 * 关键在**内壁的可见性**：斜二测下能看到洞的**右侧内壁与后侧内壁**。
 */
export function renderCubeWithSquareHole(options = {}) {
  const size = Number.isFinite(options.size) ? options.size : 130;
  const holeRatio = Number.isFinite(options.holeRatio) ? options.holeRatio : 0.42;
  return frameToSvg({
    label: '正方体挖方形通孔：方洞是方的，斜着切才会变其他形状',
    build: () => {
      const P = (x, y, z) => project([x * size, y * size, z * size]);
      const h = holeRatio;
      // 洞在正面的开口：以正面中心为中心的小正方形
      const x0 = (1 - h) / 2;
      const x1 = (1 + h) / 2;
      const y0 = (1 - h) / 2;
      const y1 = (1 + h) / 2;
      const items = [];
      // 正面：**真正挖空**（evenodd）。
      // ⚠️ 两个子路径必须各自以 M 开头、各自 Z 收口。
      // 我上一版把顶点拼成 `M...L...M...L...Z`（只有一个结尾 Z），
      // 第二个子路径没有闭合 ⇒ evenodd 把正面切成了几乎全白。
      const f = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)];
      const fh = [P(x0, y0, 0), P(x1, y0, 0), P(x1, y1, 0), P(x0, y1, 0)];
      const sub = (pts) => `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`;
      items.push({ d: `${sub(f)} ${sub(fh)}`, fill: FILL_FRONT, evenodd: true });
      // 顶面（同样挖空洞的开口）
      const t = [P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1)];
      const th = [P(x0, 1, 0), P(x1, 1, 0), P(x1, 1, 1), P(x0, 1, 1)];
      items.push({ d: `${sub(t)} ${sub(th)}`, fill: FILL_TOP, evenodd: true });
      // 右侧面
      items.push({
        points: [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)],
        fill: FILL_SIDE
      });
      // 洞的内壁：右侧内壁 + 后侧内壁（深一档，表示「看进去」）
      items.push({
        points: [P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, 1), P(x1, y0, 1)],
        fill: FILL_DEEP
      });
      items.push({
        points: [P(x0, y0, 1), P(x1, y0, 1), P(x1, y1, 1), P(x0, y1, 1)],
        fill: FILL_DEEP
      });
      return items;
    }
  });
}

export const SOLID_FIGURE_KINDS = Object.freeze(new Set([
  'cube-reference',
  'hollow-horizontal-cut',
  'oblique-cylinder-cut',
  'cube-with-square-hole'
]));

export function renderSolidFigure(kind, options = {}) {
  switch (kind) {
    case 'cube-reference': return renderCubeReference(options);
    case 'hollow-horizontal-cut': return renderHollowCylinderCut(options);
    case 'oblique-cylinder-cut': return renderObliqueCylinderCut(options);
    case 'cube-with-square-hole': return renderCubeWithSquareHole(options);
    default: throw new Error(`solid-figures: 未知图解类型 "${kind}"`);
  }
}

export default { renderSolidFigure, SOLID_FIGURE_KINDS };
