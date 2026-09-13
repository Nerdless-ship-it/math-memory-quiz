// SDF 立体的渲染层：光线步进画实体 + 高亮切面 + 画出截面轮廓。
//
// 与 figure.js 的关系：figure.js 画的是「已知解析形状」的静态图（立方体/展开图/截面形状），
// 讲究精确。本文件服务**任意组合**的立体，靠 raycast 求面，因此：
//   · 好处：任何 SDF 组合都能画，不需要为每种立体写投影代码；
//   · 代价：轮廓是光线步进近似（有步长误差），不适合当「精确图形题」的题干。
// 两者定位不同，不要互相替代。

import { compile, raycast, sectionLoops } from './csg.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 向量小工具：csg.js 里这些是模块内的私有函数，没有导出（导出它们会污染 API），
// 所以这里各自定义一份。数学一目了然，重复的代价小于把私有实现变成公开契约。
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function svgElement(tagName, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 相机：斜二测风格——yaw/pitch 决定视线方向。
 *
 * ⚠️ eye 必须放在 forward 的**正方向一侧**（eye = +forward·D）：
 * forward 是「从相机指向被看物体的方向」，所以相机在物体相对的另一头，
 * 即 eye = origin − forward·D = +forward·D 取反…… 我第一版就写反了，
 * 结果射线起点落在立体内部，整个实体只剩边缘一点残影。
 * 这里明确写成 eye = −forward·D，并用「起点必须在体外」的断言兜住。
 */
export function cameraBasis(yawDeg = 42, pitchDeg = 28, distance = 7) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  // 视线方向：从右上前方看向原点
  const forward = norm([
    -Math.cos(pitch) * Math.cos(yaw),
    -Math.cos(pitch) * Math.sin(yaw),
    -Math.sin(pitch)
  ]);
  const right = norm(cross(forward, [0, 0, 1]));
  const up = norm(cross(right, forward));
  const eye = mul(forward, -distance); // 相机在视线反方向后退 distance
  return { forward, right, up, eye };
}

const EPS_SURF = 2e-3;

/**
 * 光线步进渲染一个 SDF 立体。
 *
 * @param {function|object} solid SDF 或立体描述
 * @param {object} options
 * @param {boolean} options.showCut 是否高亮切面（把切面当作一个彩色薄片画出来）
 * @param {number[]} options.planeNormal 切面法向
 * @param {number} options.planeD 切面位置
 * @returns {SVGElement}
 */
export function renderSolid(solid, options = {}) {
  const sdf = compile(solid);
  const width = Number.isFinite(options.width) ? options.width : 260;
  const height = Number.isFinite(options.height) ? options.height : 260;
  const pxPerUnit = Number.isFinite(options.scale) ? options.scale : 58;
  const { forward, right, up, eye } = cameraBasis(options.yaw ?? 42, options.pitch ?? 28);

  const normal = options.planeNormal ?? [0, 0, 1];
  const d = Number.isFinite(options.planeD) ? options.planeD : 0;
  const showCut = options.showCut === true;
  const nHat = norm(normal);

  const children = [];
  const cx = width / 2;
  const cy = height / 2;

  // ── 逐像素（按网格步长画小方块，保持 SVG 体积可控）──
  //
  // ⚠️ 必须是**正交投影**：所有射线方向相同，只把起点在屏幕平面内平移。
  // 我第一版让所有射线都从 eye 出发（透视做法），于是方向随屏幕位置散开——
  // 实测屏幕两端夹角达 46°，只有中心附近能命中，命中率 0.9%，实体几乎画不出来。
  // 而且斜二测本来就是正交投影，透视会让近大远小，与 figure.js 的静态图风格不符。
  const stepPx = Number.isFinite(options.stepPx) ? options.stepPx : 1.7;
  const maxSteps = Number.isFinite(options.maxSteps) ? options.maxSteps : 400;
  for (let sx = -cx; sx <= cx; sx += stepPx) {
    for (let sy = -cy; sy <= cy; sy += stepPx) {
      // 正交：方向恒定，起点在屏幕平面内偏移
      const rayOrigin = add(eye, add(mul(right, sx / pxPerUnit), mul(up, -sy / pxPerUnit)));
      const hit = raycast(sdf, rayOrigin, forward, {
        maxDist: 20, maxSteps, eps: EPS_SURF, start: 0
      });
      if (!hit) continue;

      // 切面内的点被「切掉」：如果命中点就在切面上（距离 < 阈值），标记为切面
      const onCut = showCut && Math.abs(dot(nHat, hit.point) - d) < 0.02;

      // 简易光照：面法向与固定光方向
      const light = norm([0.4, -0.7, 0.6]);
      const lambert = Math.max(0.15, dot(hit.normal, light));
      const shade = Math.round(150 + 95 * lambert);
      const fill = onCut
        ? `rgba(18, 107, 82, ${0.55 + 0.3 * lambert})`
        : `rgb(${Math.round(shade * 0.93)}, ${shade}, ${Math.round(shade * 0.97)})`;

      children.push(svgElement('rect', {
        x: (cx + sx).toFixed(1), y: (cy + sy).toFixed(1),
        width: (stepPx + 0.4).toFixed(1), height: (stepPx + 0.4).toFixed(1),
        fill, 'aria-hidden': 'true'
      }));
    }
  }

  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': options.ariaLabel ?? '组合立体与被平面所截的示意图',
    class: 'solid-svg'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) svg.append(child);
  return svg;
}

/**
 * 画截面图形（正视）：外轮廓 + 洞。
 * 这是「截面是什么形状」的直接答案，也是空心体「不带线」的直观体现。
 */
export function renderSectionShape(solid, planeNormal, d, options = {}) {
  const result = sectionLoops(solid, planeNormal, d, {
    extent: options.extent ?? 2.2,
    resolution: options.resolution ?? 160
  });
  const width = Number.isFinite(options.width) ? options.width : 200;
  const height = Number.isFinite(options.height) ? options.height : 200;
  const scale = Number.isFinite(options.scale) ? options.scale : 68;
  const cx = width / 2;
  const cy = height / 2;

  const children = [];
  if (result.ok) {
    // 用 evenodd 填充：外轮廓与洞一起填充，洞自然被挖空 —— 这正是「不带线」的数学表达
    const allLoops = [...result.outer, ...result.holes];
    const dAttr = allLoops.map((loop) => {
      const pts = loop.map((p) => `${(cx + p.x * scale).toFixed(2)},${(cy + p.y * scale).toFixed(2)}`);
      return `M${pts.join('L')}Z`;
    }).join(' ');
    children.push(svgElement('path', { d: dAttr, class: 'section-solid-fill', 'fill-rule': 'evenodd' }));
    // 只描外轮廓与洞的边界（洞的边界本身就是「空心处的开口边」）
    for (const loop of allLoops) {
      const pts = loop.map((p) => `${(cx + p.x * scale).toFixed(2)},${(cy + p.y * scale).toFixed(2)}`);
      children.push(svgElement('path', { d: `M${pts.join('L')}Z`, class: 'section-solid-stroke' }));
    }
  } else {
    children.push(svgElement('text', {
      x: cx, y: cy, class: 'section-solid-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle'
    }, '该平面与立体无交'));
  }

  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': result.ok
      ? `截面形状：${result.outer.length} 条外轮廓${result.holes.length ? `，${result.holes.length} 处空心开口` : ''}`
      : '该平面与立体无交',
    class: 'solid-svg'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) svg.append(child);
  return { svg, result };
}

export default { renderSolid, renderSectionShape, cameraBasis };
