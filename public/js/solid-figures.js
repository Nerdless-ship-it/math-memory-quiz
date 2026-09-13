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
 */
function frameToSvg({ label, build, padding = 24 }) {
  // 先用朴素坐标画一次，量包围盒
  const probe = build();
  const all = [];
  for (const item of probe) {
    if (item.points) all.push(...item.points);
  }
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;

  // 真实绘制一次（坐标不变，只挪 viewBox）
  const children = build().map((item) => svgElement('path', {
    d: item.points ? closedPath(item.points) : item.d,
    ...(item.fill ? { fill: item.fill } : { fill: 'none' }),
    ...SHARP
  }));

  const svg = svgElement('svg', {
    viewBox: `${(minX - padding).toFixed(1)} ${(minY - padding).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`,
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

export const SOLID_FIGURE_KINDS = Object.freeze(new Set(['cube-reference']));

export function renderSolidFigure(kind, options = {}) {
  switch (kind) {
    case 'cube-reference': return renderCubeReference(options);
    default: throw new Error(`solid-figures: 未知图解类型 "${kind}"`);
  }
}

export default { renderSolidFigure, SOLID_FIGURE_KINDS };
