// 几何易错点图解（B 方案：精确、干净的 2D 矢量画法）。
//
// ── 为什么是这个方案 ─────────────────────────────────────────────────
// 之前做过一个「切面沙盒」（自由拖角度、实时看截面），技术上能跑，
// 但它是**几何实验室**，而这个 App 是**记忆训练**——用户来这是为了刷题和记东西，
// 不是为了玩几何。方向不对，所以整块删掉了（见 commit 074d221）。
//
// 现在改成：**把常考的易错点画成干净、精确的静态图**，一张图讲清一件事。
// 画法与 figure.js 的静态图一致（斜二测 + 同一套配色），所以放在题库里毫无违和。
//
// ── 与 figure.js 的关系 ──────────────────────────────────────────────
// 本文件**只画易错点讲解图**，不出题；figure.js 负责题干与选项。
// 两者都用斜二测，视觉语言一致但各自独立（figure.js 的 createSvg 是模块私有的，
// 且它正被并行开发改动，所以这里自带一份最小实现，不去 import 它的内部函数）。

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 斜二测投影：正面不变形，深度往右上收缩（与 figure.js 的 0.5 / 0.33 相同）。 */
const DEPTH_X = 0.5;
const DEPTH_Y = 0.33;

const INK = '#17231f';
const FACE_LIGHT = '#e8eeea';
const FACE_MID = '#cfdcd6';
const CUT_FILL = 'rgba(18, 107, 82, 0.20)';
const CUT_LINE = '#126b52';
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
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) svg.append(child);
  return svg;
}

// ── 绘制一个「立着的圆柱 / 空心圆柱」──────────────────────────────────
//
// 坐标系：世界坐标 y 向上、半径在 xz 平面。
// 斜二测把 z（朝观察者）投到屏幕的右上方向，于是底面与顶面都画成椭圆。
//
// 关键量（屏幕单位）：
//   rx = 半径的水平半轴
//   ry = 半径的竖直半轴（= rx * DEPTH_Y 的视觉效果，取 0.42 让椭圆看起来自然）
//   zx = 深度带来的水平偏移 = rx * DEPTH_X

const ELLIPSE_RY_RATIO = 0.42;

/**
 * 圆柱的可见轮廓：侧面（两条竖线 + 上下椭圆弧）+ 顶面椭圆。
 * @returns {{ top: object, bottom: object, left: number, right: number, topY: number, bottomY: number }}
 */
function cylinderGeometry(cx, cy, radiusPx, heightPx) {
  const rx = radiusPx;
  const ry = radiusPx * ELLIPSE_RY_RATIO;
  const zx = radiusPx * DEPTH_X;
  return {
    cx,
    cy,
    rx,
    ry,
    zx,
    // 顶面椭圆的中心（往上抬 height，再往右上偏 zx 表示深度）
    topCx: cx + zx,
    topCy: cy - heightPx,
    bottomCx: cx,
    bottomCy: cy
  };
}

/** 椭圆形路径（用于顶/底面）。 */
function ellipsePath({ cx, cy, rx, ry }) {
  return `M${cx - rx},${cy}`
    + `a${rx},${ry} 0 1,0 ${rx * 2},0`
    + `a${rx},${ry} 0 1,0 ${-rx * 2},0Z`;
}

/**
 * 画一个「外圈椭圆挖掉内圈椭圆」的环（用 fill-rule: evenodd 一次成型）。
 * 空心圆柱的顶面、以及「切到空心」的截面都是这个形状。
 */
function ringPath(outer, inner) {
  return `${ellipsePath(outer)} ${ellipsePath(inner)}`;
}

// ── 易错点图解 ──────────────────────────────────────────────────────

/**
 * 空心圆柱被**水平平面**所截 —— 截面是不带内部线的环。
 *
 * 这是「刀切空心部分不带线」最直接的一张图：左边切开，右边只有外圈与内圈，
 * 空腔内部**没有任何线**。
 */
export function renderHollowCylinderCut(options = {}) {
  const width = 380;
  const height = 230;
  const radius = Number.isFinite(options.radius) ? options.radius : 52;
  const barHeight = Number.isFinite(options.solidHeight) ? options.solidHeight : 96;
  const cavityRatio = Number.isFinite(options.cavityRatio) ? options.cavityRatio : 0.52;

  const children = [];
  const geo = cylinderGeometry(96, 168, radius, barHeight);
  const inner = radius * cavityRatio;

  // 顶面：环（外圈椭圆挖内圈）
  children.push(svgElement('path', {
    d: `${ellipsePath({ cx: geo.topCx, cy: geo.topCy, rx: geo.rx, ry: geo.ry })} `
      + `${ellipsePath({ cx: geo.topCx, cy: geo.topCy, rx: inner, ry: inner * ELLIPSE_RY_RATIO })}`,
    fill: FACE_LIGHT,
    stroke: INK,
    'stroke-width': 1.5,
    'fill-rule': 'evenodd'
  }));

  // 侧面：外轮廓（两竖线 + 底弧）
  children.push(svgElement('path', {
    d: `M${geo.cx - geo.rx},${geo.bottomCy}`
      + `L${geo.topCx - geo.rx},${geo.topCy}`
      + `A${geo.rx},${geo.ry} 0 0 1 ${geo.topCx + geo.rx},${geo.topCy}`
      + `L${geo.cx + geo.rx},${geo.bottomCy}`
      + `A${geo.rx},${geo.ry} 0 0 1 ${geo.cx - geo.rx},${geo.bottomCy}Z`,
    fill: FACE_MID,
    stroke: INK,
    'stroke-width': 1.5
  }));

  // 空腔的可见内壁（顶面开口处往下一点点，表示这是个通孔）
  children.push(svgElement('path', {
    d: `M${geo.topCx - inner},${geo.topCy}`
      + `A${inner},${inner * ELLIPSE_RY_RATIO} 0 0 0 ${geo.topCx + inner},${geo.topCy}`,
    fill: 'none',
    stroke: INK,
    'stroke-width': 1.2
  }));

  // 切面位置：一条水平线横过立体
  const planeY = geo.topCy + barHeight * 0.5;
  children.push(svgElement('line', {
    x1: geo.cx - geo.rx - 16, y1: planeY,
    x2: geo.cx + geo.rx + 16, y2: planeY,
    stroke: CUT_LINE, 'stroke-width': 2, 'stroke-dasharray': '7 4'
  }));

  // ── 右侧：截面图形 ──
  const shapeCx = 268;
  const shapeCy = 118;
  const shapeR = radius;
  children.push(svgElement('path', {
    d: `${ellipsePath({ cx: shapeCx, cy: shapeCy, rx: shapeR, ry: shapeR * ELLIPSE_RY_RATIO })} `
      + `${ellipsePath({ cx: shapeCx, cy: shapeCy, rx: inner, ry: inner * ELLIPSE_RY_RATIO })}`,
    fill: FACE_LIGHT,
    stroke: INK,
    'stroke-width': 1.6,
    'fill-rule': 'evenodd'
  }));

  children.push(svgElement('text', {
    x: shapeCx, y: shapeCy + shapeR * ELLIPSE_RY_RATIO + 34,
    'text-anchor': 'middle', fill: CUT_LINE, 'font-size': 13, 'font-weight': 700
  }, '截面：环，内部没有线'));

  children.push(svgElement('text', {
    x: 96, y: 214, 'text-anchor': 'middle', fill: MUTED, 'font-size': 12
  }, '刀切到空心部分'));

  return createSvg({ width, height, label: '空心圆柱被水平平面所截：截面是一个环，内部没有线', children });
}

/**
 * 空心圆柱被**倾斜平面**所截 —— 截面是内外两个椭圆组成的环，内部同样没有线。
 *
 * 这也是「斜切圆柱得到椭圆」与「空心不带线」两条规则的叠加。
 */
export function renderHollowObliqueCut(options = {}) {
  const width = 380;
  const height = 240;
  const radius = Number.isFinite(options.radius) ? options.radius : 52;
  const barHeight = Number.isFinite(options.solidHeight) ? options.solidHeight : 96;
  const cavityRatio = Number.isFinite(options.cavityRatio) ? options.cavityRatio : 0.52;
  const tilt = Number.isFinite(options.tiltDeg) ? options.tiltDeg : 32;

  const children = [];
  const geo = cylinderGeometry(96, 176, radius, barHeight);
  const inner = radius * cavityRatio;

  // 顶面环
  children.push(svgElement('path', {
    d: `${ellipsePath({ cx: geo.topCx, cy: geo.topCy, rx: geo.rx, ry: geo.ry })} `
      + `${ellipsePath({ cx: geo.topCx, cy: geo.topCy, rx: inner, ry: inner * ELLIPSE_RY_RATIO })}`,
    fill: FACE_LIGHT, stroke: INK, 'stroke-width': 1.5, 'fill-rule': 'evenodd'
  }));
  // 侧面
  children.push(svgElement('path', {
    d: `M${geo.cx - geo.rx},${geo.bottomCy}`
      + `L${geo.topCx - geo.rx},${geo.topCy}`
      + `A${geo.rx},${geo.ry} 0 0 1 ${geo.topCx + geo.rx},${geo.topCy}`
      + `L${geo.cx + geo.rx},${geo.bottomCy}`
      + `A${geo.rx},${geo.ry} 0 0 1 ${geo.cx - geo.rx},${geo.bottomCy}Z`,
    fill: FACE_MID, stroke: INK, 'stroke-width': 1.5
  }));
  // 内壁
  children.push(svgElement('path', {
    d: `M${geo.topCx - inner},${geo.topCy}`
      + `A${inner},${inner * ELLIPSE_RY_RATIO} 0 0 0 ${geo.topCx + inner},${geo.topCy}`,
    fill: 'none', stroke: INK, 'stroke-width': 1.2
  }));

  // 倾斜的切面：一条斜线
  const planeCy = geo.topCy + barHeight * 0.52;
  const halfW = geo.rx + 14;
  const slope = Math.tan((tilt * Math.PI) / 180);
  children.push(svgElement('line', {
    x1: geo.cx - halfW, y1: planeCy + halfW * slope * 0.42,
    x2: geo.cx + halfW, y2: planeCy - halfW * slope * 0.42,
    stroke: CUT_LINE, 'stroke-width': 2, 'stroke-dasharray': '7 4'
  }));

  // 截面：内外两个椭圆（外椭圆更扁长，因为斜切）
  const shapeCx = 268;
  const shapeCy = 120;
  const outerRx = radius * 1.22;
  const innerRx = inner * 1.22;
  children.push(svgElement('path', {
    d: `${ellipsePath({ cx: shapeCx, cy: shapeCy, rx: outerRx, ry: outerRx * ELLIPSE_RY_RATIO * 0.82 })} `
      + `${ellipsePath({ cx: shapeCx, cy: shapeCy, rx: innerRx, ry: innerRx * ELLIPSE_RY_RATIO * 0.82 })}`,
    fill: FACE_LIGHT, stroke: INK, 'stroke-width': 1.6, 'fill-rule': 'evenodd'
  }));
  children.push(svgElement('text', {
    x: shapeCx, y: shapeCy + outerRx * ELLIPSE_RY_RATIO * 0.82 + 34,
    'text-anchor': 'middle', fill: CUT_LINE, 'font-size': 13, 'font-weight': 700
  }, '截面：两个椭圆套成的环'));

  children.push(svgElement('text', {
    x: 96, y: 226, 'text-anchor': 'middle', fill: MUTED, 'font-size': 12
  }, '斜切空心圆柱'));

  return createSvg({ width, height, label: '空心圆柱被倾斜平面所截：截面是内外两个椭圆组成的环', children });
}

/**
 * 对照图：同一个空心圆台，「刀切到空心」与「刀没切到空心」的区别。
 *
 * 这是最容易被记混的一对——**带不带线只取决于这一刀有没有切到空心**，
 * 与立体本身长什么样无关。所以并排画出来最有效。
 */
export function renderHollowVsSolidCut(options = {}) {
  const width = 400;
  // ⚠️ 高度要算够：立体本身占到 y≈195，下面还要放两个截面图。
  // 原稿写 240，而截面中心被放在 y=236 ⇒ 直接画到画布外、被裁掉。这里给 300。
  const height = 300;
  const radius = Number.isFinite(options.radius) ? options.radius : 44;
  const barHeight = Number.isFinite(options.solidHeight) ? options.solidHeight : 84;
  const cavityRatio = Number.isFinite(options.cavityRatio) ? options.cavityRatio : 0.5;

  const children = [];
  const inner = radius * cavityRatio;
  const shapeCy = 246;          // 两个截面图的中心（放在立体下方）
  const shapeR = radius * 0.6;

  // ── 左：刀切到空心（切面在空腔范围内）──
  const leftCx = 88;
  const leftBase = 172;
  const left = cylinderGeometry(leftCx, leftBase, radius, barHeight);
  children.push(svgElement('path', {
    d: `${ellipsePath({ cx: left.topCx, cy: left.topCy, rx: left.rx, ry: left.ry })} `
      + `${ellipsePath({ cx: left.topCx, cy: left.topCy, rx: inner, ry: inner * ELLIPSE_RY_RATIO })}`,
    fill: FACE_LIGHT, stroke: INK, 'stroke-width': 1.4, 'fill-rule': 'evenodd'
  }));
  children.push(svgElement('path', {
    d: `M${left.cx - left.rx},${left.bottomCy}`
      + `L${left.topCx - left.rx},${left.topCy}`
      + `A${left.rx},${left.ry} 0 0 1 ${left.topCx + left.rx},${left.topCy}`
      + `L${left.cx + left.rx},${left.bottomCy}`
      + `A${left.rx},${left.ry} 0 0 1 ${left.cx - left.rx},${left.bottomCy}Z`,
    fill: FACE_MID, stroke: INK, 'stroke-width': 1.4
  }));
  children.push(svgElement('path', {
    d: `M${left.topCx - inner},${left.topCy}`
      + `A${inner},${inner * ELLIPSE_RY_RATIO} 0 0 0 ${left.topCx + inner},${left.topCy}`,
    fill: 'none', stroke: INK, 'stroke-width': 1.1
  }));
  const leftPlaneY = left.topCy + barHeight * 0.62;
  children.push(svgElement('line', {
    x1: left.cx - left.rx - 12, y1: leftPlaneY, x2: left.cx + left.rx + 12, y2: leftPlaneY,
    stroke: CUT_LINE, 'stroke-width': 2, 'stroke-dasharray': '6 4'
  }));
  children.push(svgElement('text', {
    x: leftCx, y: 208, 'text-anchor': 'middle', fill: CUT_LINE, 'font-size': 12.5, 'font-weight': 700
  }, '切到空心 ⇒ 不带线'));

  // 左图截面：环
  const leftShapeCx = 88;
  const leftShapeCy = shapeCy;
  children.push(svgElement('path', {
    d: `${ellipsePath({ cx: leftShapeCx, cy: leftShapeCy, rx: shapeR, ry: shapeR * ELLIPSE_RY_RATIO })} `
      + `${ellipsePath({ cx: leftShapeCx, cy: leftShapeCy, rx: inner / radius * shapeR, ry: inner / radius * shapeR * ELLIPSE_RY_RATIO })}`,
    fill: FACE_LIGHT, stroke: INK, 'stroke-width': 1.4, 'fill-rule': 'evenodd'
  }));

  // ── 右：刀没切到空心（切面在空腔之上，是实心圆盘）──
  const rightCx = 300;
  const rightBase = 172;
  const right = cylinderGeometry(rightCx, rightBase, radius, barHeight);
  children.push(svgElement('path', {
    d: ellipsePath({ cx: right.topCx, cy: right.topCy, rx: right.rx, ry: right.ry }),
    fill: FACE_LIGHT, stroke: INK, 'stroke-width': 1.4
  }));
  children.push(svgElement('path', {
    d: `M${right.cx - right.rx},${right.bottomCy}`
      + `L${right.topCx - right.rx},${right.topCy}`
      + `A${right.rx},${right.ry} 0 0 1 ${right.topCx + right.rx},${right.topCy}`
      + `L${right.cx + right.rx},${right.bottomCy}`
      + `A${right.rx},${right.ry} 0 0 1 ${right.cx - right.rx},${right.bottomCy}Z`,
    fill: FACE_MID, stroke: INK, 'stroke-width': 1.4
  }));
  // 空腔只在下方可见（虚线提示它在下面）
  children.push(svgElement('path', {
    d: `M${right.topCx - inner},${right.topCy + barHeight * 0.42}`
      + `A${inner},${inner * ELLIPSE_RY_RATIO} 0 0 0 ${right.topCx + inner},${right.topCy + barHeight * 0.42}`,
    fill: 'none', stroke: MUTED, 'stroke-width': 1.1, 'stroke-dasharray': '4 3'
  }));
  const rightPlaneY = right.topCy + barHeight * 0.16;
  children.push(svgElement('line', {
    x1: right.cx - right.rx - 12, y1: rightPlaneY, x2: right.cx + right.rx + 12, y2: rightPlaneY,
    stroke: CUT_LINE, 'stroke-width': 2, 'stroke-dasharray': '6 4'
  }));
  children.push(svgElement('text', {
    x: rightCx, y: 208, 'text-anchor': 'middle', fill: CUT_LINE, 'font-size': 12.5, 'font-weight': 700
  }, '没切到空心 ⇒ 实心圆'));

  children.push(svgElement('path', {
    d: ellipsePath({ cx: rightCx, cy: leftShapeCy, rx: shapeR, ry: shapeR * ELLIPSE_RY_RATIO }),
    fill: FACE_LIGHT, stroke: INK, 'stroke-width': 1.4
  }));

  return createSvg({
    width,
    height,
    label: '对照图：刀切到空心时截面不带线，没切到空心时截面是实心圆',
    children
  });
}

/** 本模块提供的所有图解类型。 */
export const SOLID_FIGURE_KINDS = Object.freeze(new Set([
  'hollow-horizontal-cut',
  'hollow-oblique-cut',
  'hollow-vs-solid'
]));

/** 按类型渲染一张易错点图解。 */
export function renderSolidFigure(kind, options = {}) {
  switch (kind) {
    case 'hollow-horizontal-cut': return renderHollowCylinderCut(options);
    case 'hollow-oblique-cut': return renderHollowObliqueCut(options);
    case 'hollow-vs-solid': return renderHollowVsSolidCut(options);
    default: throw new Error(`solid-figures: 未知图解类型 "${kind}"`);
  }
}

export default { renderSolidFigure, SOLID_FIGURE_KINDS };


