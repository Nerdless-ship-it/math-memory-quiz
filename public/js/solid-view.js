// SDF 立体的渲染层：画立体实体 + 在该立体上画出切面轮廓。
//
// 与 figure.js 的分工：figure.js 画「已知解析形状」的静态图（立方体/展开图/截面形状），
// 讲究精确；本文件服务**任意组合**的立体（SDF 表达），靠光线步进求面。
// 两者定位不同，不要互相替代。
//
// ── 渲染方式的选择（走过弯路，记下来）────────────────────────────────
// 第一版是「逐像素光线步进，每个采样点画一个小矩形」。能出图，但：
//   1. 边缘锯齿明显（采样步长 1.7px 时尤其难看）；
//   2. 没有轮廓线，圆柱看起来像「贴了张纸」；
//   3. **切面表达是错的**：只是把「贴近切面的可见表面点」染色，在曲面体上那些点连成
//      一条弧线，屏幕上就是一条绿色虚线横穿立体 —— 用户反馈「立体图形怎么看着很奇怪」。
//      后来改成对这些点求凸包，得到的是**月牙**（前半圈椭圆与轮廓之间那块），
//      因为椭圆的后半圈根本没有可见表面点。月牙会让人误以为「截面是月牙形」。
//
// 现在采用的方案：**立体用光线步进画，切面轮廓用解析解画**。
//   · 切面轮廓来自 csg.sectionLoops（平面 ∩ 立体的精确交线），不是从可见点反推；
//   · 再逐段判定可见性（沿视线方向探一点，仍在立体内部即为被自身遮住），
//     可见段实线、被遮段虚线 —— 这正是教材画切断面的标准画法。
// 好处：截面轮廓是精确、干净的矢量线，不受采样密度影响。

import { compile, raycast, sectionLoops, planePointToWorld } from './csg.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * 斜二测投影：正面不变形，深度往右上收缩。
 * 与 figure.js 的静态图保持同一套视觉语言（那里也是 0.5 / 0.33）。
 */
const DEPTH_X = 0.5;
const DEPTH_Y = 0.33;
function project3d([x, y, z]) {
  return { x: x + z * DEPTH_X, y: -y - z * DEPTH_Y };
}

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
 * ⚠️ eye 必须放在 forward 的**反方向**（eye = −forward·D）：
 * forward 是「从相机指向物体的方向」，相机自然在物体相对的另一头。
 * 第一版写成 eye = +forward·D，射线起点落在立体内部，整个实体只剩边缘一点残影。
 */
export function cameraBasis(yawDeg = 42, pitchDeg = 28, distance = 7) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const forward = norm([
    -Math.cos(pitch) * Math.cos(yaw),
    -Math.cos(pitch) * Math.sin(yaw),
    -Math.sin(pitch)
  ]);
  const right = norm(cross(forward, [0, 0, 1]));
  const up = norm(cross(right, forward));
  const eye = mul(forward, -distance);
  return { forward, right, up, eye };
}

const EPS_SURF = 2e-3;

/** 采样的世界范围：按画布尺寸与缩放反推，保证覆盖整个屏幕窗口。 */
function extentFor(width, pxPerUnit) {
  return (width / 2) / pxPerUnit + 0.6;
}

/**
 * 预计算立体表面：把每个屏幕采样点对应的世界坐标与法向缓存下来。
 *
 * 这是「切面沙盒」能跟手拖动的原因。光线步进一次要几十毫秒，但**切面在动的时候，
 * 立体的表面几何完全没变**——只有切面轮廓要重画。缓存后拖动时不再做任何光线步进。
 *
 * @returns {{ hits: object[], toSvg: (options: object) => SVGElement }}
 */
export function cacheSurface(solid, options = {}) {
  const sdf = compile(solid);
  const width = Number.isFinite(options.width) ? options.width : 300;
  const height = Number.isFinite(options.height) ? options.height : 280;
  const pxPerUnit = Number.isFinite(options.scale) ? options.scale : 62;
  const { forward, right, up, eye } = cameraBasis(options.yaw ?? 42, options.pitch ?? 28);

  // 采样密度：0.95px 一档。早先用 1.7px，圆柱边缘锯齿很明显；
  // 加密后轮廓干净得多（代价是矩形数量翻倍，但只在切换立体时算一次）。
  const stepPx = Number.isFinite(options.stepPx) ? options.stepPx : 0.95;
  const maxSteps = Number.isFinite(options.maxSteps) ? options.maxSteps : 400;
  const cx = width / 2;
  const cy = height / 2;

  const hits = [];
  for (let sx = -cx; sx <= cx; sx += stepPx) {
    for (let sy = -cy; sy <= cy; sy += stepPx) {
      const rayOrigin = add(eye, add(mul(right, sx / pxPerUnit), mul(up, -sy / pxPerUnit)));
      const hit = raycast(sdf, rayOrigin, forward, { maxDist: 20, maxSteps, eps: EPS_SURF, start: 0 });
      if (!hit) continue;
      hits.push({ x: cx + sx, y: cy + sy, normal: hit.normal });
    }
  }

  const light = norm([0.42, -0.66, 0.62]);
  const toCamera = mul(forward, -1);

  return {
    hits,
    width,
    height,
    stepPx,
    pxPerUnit,
    camera: { forward, right, up, eye },
    /**
     * 用缓存的表面 + 当前切面参数画一帧。
     * 表面只做颜色重排；切面轮廓重新解析计算（很便宜，一次 marching squares）。
     */
    toSvg(renderOptions = {}) {
      const normal = renderOptions.planeNormal ?? [0, 0, 1];
      const d = Number.isFinite(renderOptions.planeD) ? renderOptions.planeD : 0;
      const showCut = renderOptions.showCut === true;
      const nHat = norm(normal);

      const children = [];

      // ── 第一层：立体表面（Lambert + 环境项 + 边缘光）──
      for (const h of hits) {
        const lambert = Math.max(0, dot(h.normal, light));
        // 边缘光：法向越垂直于视线越亮，让圆柱侧面不再是一块平灰
        const rim = Math.pow(1 - Math.min(1, Math.abs(dot(h.normal, toCamera))), 2.2);
        const shade = Math.max(150, Math.min(252, Math.round(196 + 54 * lambert + 16 * rim)));
        children.push(svgElement('rect', {
          x: h.x.toFixed(2), y: h.y.toFixed(2),
          width: (stepPx + 0.45).toFixed(2), height: (stepPx + 0.45).toFixed(2),
          fill: `rgb(${Math.round(shade * 0.94)}, ${shade}, ${Math.round(shade * 0.97)})`,
          'aria-hidden': 'true'
        }));
      }

      // ── 第二层：切面轮廓（精确椭圆/多边形，被自身遮住的部分画虚线）──
      if (showCut) {
        const section = sectionLoops(solid, nHat, d, {
          extent: extentFor(width, pxPerUnit),
          resolution: 200
        });
        const loops = section.ok ? [...section.outer, ...section.holes] : [];
        const visibleSegments = [];
        const hiddenSegments = [];

        for (const loop of loops) {
          if (loop.length < 3) continue;
          const closed = [...loop, loop[0]];
          let prev = null;
          for (const flat of closed) {
            const world = planePointToWorld(nHat, d, flat.x, flat.y);
            const q = project3d(world);
            const screen = { x: cx + q.x * pxPerUnit, y: cy + q.y * pxPerUnit };
            if (prev) {
              // 取线段中点判定可见性：端点正好落在立体表面上，探针会被判成内部，
              // 用端点会导致整圈都被标成虚线。
              const midWorld = mul(add(prev.world, world), 0.5);
              const probe = add(midWorld, mul(toCamera, 0.015));
              const hidden = sdf(probe) < 0;
              const segment = `M${prev.screen.x.toFixed(2)},${prev.screen.y.toFixed(2)}`
                + `L${screen.x.toFixed(2)},${screen.y.toFixed(2)}`;
              (hidden ? hiddenSegments : visibleSegments).push(segment);
            }
            prev = { world, screen };
          }
        }

        // 顺序很重要：**先画被遮的虚线，再画可见的实线**。
        // 反过来会让虚线叠在实线上，把可见的那半也打成虚线，看起来整圈都是虚的。
        if (hiddenSegments.length) {
          children.push(svgElement('path', {
            d: hiddenSegments.join(' '), class: 'solid-cut-hidden', 'aria-hidden': 'true'
          }));
        }
        if (visibleSegments.length) {
          children.push(svgElement('path', {
            d: visibleSegments.join(' '), class: 'solid-cut-visible', 'aria-hidden': 'true'
          }));
        }
      }

      const svg = svgElement('svg', {
        viewBox: `0 0 ${width} ${height}`,
        width: '100%',
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': renderOptions.ariaLabel ?? '组合立体与被平面所截的示意图',
        class: 'solid-svg'
      });
      svg.style.maxWidth = `${width}px`;
      svg.style.aspectRatio = `${width} / ${height}`;
      for (const child of children) svg.append(child);
      return svg;
    }
  };
}

/**
 * 一次性渲染（内部先建缓存再画一帧）。需要连续改切面时请直接用 cacheSurface。
 * @returns {SVGElement}
 */
export function renderSolid(solid, options = {}) {
  return cacheSurface(solid, options).toSvg(options);
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
    // 外轮廓与洞一起填充，配合 fill-rule: evenodd，洞自然被挖空
    const allLoops = [...result.outer, ...result.holes];
    const toPath = (loop) => `M${loop
      .map((p) => `${(cx + p.x * scale).toFixed(2)},${(cy + p.y * scale).toFixed(2)}`)
      .join('L')}Z`;
    children.push(svgElement('path', {
      d: allLoops.map(toPath).join(' '),
      class: 'section-solid-fill',
      'fill-rule': 'evenodd'
    }));
    for (const loop of allLoops) {
      children.push(svgElement('path', { d: toPath(loop), class: 'section-solid-stroke' }));
    }
  } else {
    children.push(svgElement('text', {
      x: cx, y: cy, class: 'section-solid-label',
      'text-anchor': 'middle', 'dominant-baseline': 'middle'
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

export default { renderSolid, renderSectionShape, cameraBasis, cacheSurface };
