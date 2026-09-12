// 折叠动画的渲染层：把 fold-anim 算出的每格 3D 状态画成 SVG。
//
// 与 figure.js 的分工：figure.js 画**静态图**（题干与选项），本文件只服务动画。
// 复用 figure.js 的相机约定（斜二测：正面不变形），保证动画末帧与静态选项图看起来是同一个东西。
//
// 三条约束同 figure.js：零依赖、不手写坐标（全部由 fold-anim 算）、每个 svg 带 role/aria-label。

import { foldAnimationFrame } from './fold-anim.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 与 figure.js 保持一致的斜二测投影。 */
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

/** 一个面在 3D 里的四个角（用中心 ± 面内两个切向拼出来）。 */
function faceCorners(center, normal) {
  // 取一个与法向不平行的辅助轴，构造面内正交基
  const helper = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const u = norm(cross(normal, helper));
  const v = norm(cross(normal, u));
  const h = 0.5; // 单位格子半边
  return [
    [center[0] - u[0] * h - v[0] * h, center[1] - u[1] * h - v[1] * h, center[2] - u[2] * h - v[2] * h],
    [center[0] + u[0] * h - v[0] * h, center[1] + u[1] * h - v[1] * h, center[2] + u[2] * h - v[2] * h],
    [center[0] + u[0] * h + v[0] * h, center[1] + u[1] * h + v[1] * h, center[2] + u[2] * h + v[2] * h],
    [center[0] - u[0] * h + v[0] * h, center[1] - u[1] * h + v[1] * h, center[2] - u[2] * h + v[2] * h]
  ];
}

/**
 * 画一帧折叠动画。
 * @param {Array<[number,number]>} cells 展开图网格坐标
 * @param {number} t 进度 0..1
 * @param {{ labels?: string[], width?: number, height?: number, scale?: number, stagger?: number, ariaLabel?: string }} options
 * @returns {SVGElement}
 */
export function renderFoldFrame(cells, t, options = {}) {
  const labels = Array.isArray(options.labels) ? options.labels : null;
  const scale = Number.isFinite(options.scale) ? options.scale : 1;
  const stagger = Number.isFinite(options.stagger) ? options.stagger : 0.35;
  const frame = foldAnimationFrame(cells, t, { stagger });
  if (!frame.ok) {
    throw new Error(`fold-anim: 展开图不合法（${frame.reason}）`);
  }

  const width = Number.isFinite(options.width) ? options.width : 200;
  const height = Number.isFinite(options.height) ? options.height : 200;
  const PX = 62 * scale;
  const CX = width / 2;
  const CY = height / 2;
  const toScreen = (p) => {
    const q = project3d(p);
    return { x: CX + q.x * PX, y: CY + q.y * PX };
  };

  // 画家算法：按面中心的「深度」排序，远的先画。
  // 深度取投影后的 z 分量（相机在 +z 方向）：用 center 的 (x+y+2z) 作启发式足够稳定，
  // 因为我们的立方体是凸的、面互不嵌套。
  const sorted = [...frame.cells].sort((a, b) => {
    const da = a.center[0] + a.center[1] + 2 * a.center[2];
    const db = b.center[0] + b.center[1] + 2 * b.center[2];
    return da - db;
  });

  const children = [];
  for (const cellState of sorted) {
    const corners = faceCorners(cellState.center, cellState.normal);
    const pts = corners.map(toScreen);
    const d = `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;
    // 朝向观察者的面亮一些，背面的暗一些，折叠过程才有立体感
    const facing = cellState.normal[2] > 0.2 ? 'fold-face--front'
      : cellState.normal[2] < -0.2 ? 'fold-face--back' : 'fold-face--side';
    children.push(svgElement('path', { d, class: `fold-face ${facing}` }));

    // 面身份标注：加 labels 时用展开图编号，否则用面名首字
    const label = labels ? labels[cells.indexOf(cellState.cell)] : null;
    if (label) {
      const c = toScreen(cellState.center);
      children.push(svgElement('text', {
        x: c.x.toFixed(1), y: c.y.toFixed(1),
        class: 'fold-face-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'aria-hidden': 'true'
      }, label));
    }
  }

  const wrapper = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': options.ariaLabel ?? '正方体展开图折叠过程演示',
    class: 'fold-svg'
  });
  wrapper.style.maxWidth = `${width}px`;
  wrapper.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) wrapper.append(child);
  return wrapper;
}

/**
 * 挂一个可播放的折叠动画到容器里，返回控制句柄。
 * 用 requestAnimationFrame 驱动；prefers-reduced-motion 时直接显示终态（无障碍要求）。
 *
 * @returns {{ play: () => void, setProgress: (t: number) => void, stop: () => void, destroy: () => void }}
 */
export function mountFoldAnimation(container, cells, options = {}) {
  const duration = Number.isFinite(options.duration) ? options.duration : 2600;
  const labels = Array.isArray(options.labels) ? options.labels : null;
  const win = options.window ?? globalThis.window ?? globalThis;
  const doc = options.document ?? globalThis.document;

  let rafId = null;
  let startTime = 0;
  let current = 0;

  const host = doc.createElement('div');
  host.className = 'fold-anim';
  container.append(host);

  const stage = doc.createElement('div');
  stage.className = 'fold-anim-stage';
  host.append(stage);

  const reduceMotion = (() => {
    try { return win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch { return false; }
  })();

  function draw(t) {
    current = t;
    stage.replaceChildren(renderFoldFrame(cells, t, { ...options, labels }));
  }

  function stop() {
    if (rafId !== null) { win.cancelAnimationFrame?.(rafId); rafId = null; }
  }

  function setProgress(t) {
    stop();
    draw(Math.max(0, Math.min(1, t)));
  }

  function play() {
    stop();
    if (reduceMotion) { draw(1); return; } // 降级：不做动画，直接给终态
    startTime = 0;
    const step = (now) => {
      if (!startTime) startTime = now;
      const t = Math.min(1, (now - startTime) / duration);
      draw(t);
      if (t < 1) rafId = win.requestAnimationFrame(step);
      else rafId = null;
    };
    rafId = win.requestAnimationFrame(step);
  }

  draw(options.initialProgress ?? 0);

  // 控制条：重播 + 一句说明。演示的目的就是让人反复看，所以按钮是必需的。
  if (options.controls !== false) {
    const controls = doc.createElement('div');
    controls.className = 'fold-anim-controls';
    const replay = doc.createElement('button');
    replay.type = 'button';
    replay.className = 'fold-anim-button';
    replay.textContent = reduceMotion ? '显示折好的样子' : '重播折叠';
    replay.addEventListener('click', () => play());
    controls.append(replay);
    host.append(controls);

    if (options.note) {
      const note = doc.createElement('p');
      note.className = 'fold-anim-note';
      note.textContent = options.note;
      host.append(note);
    }
  }

  return {
    play,
    setProgress,
    stop,
    root: host,
    get progress() { return current; },
    destroy() { stop(); host.remove(); }
  };
}

/**
 * 截面动画：让平面沿法向**扫过**立方体，实时画出交线多边形。
 *
 * 教学价值：静态图只给一个切面，学生看不出「这个形状是怎么切出来的」。
 * 扫动过程把「不同深度切出不同边数的多边形」直接演示出来——这正是截面题考的东西。
 *
 * 立方体固定（顶点 ±1），平面为 n·x = d；动画让 d 从 -|n|₁（刚接触）走到 +|n|₁（刚离开）。
 */
export function renderCrossSectionFrame(planeNormal, d, options = {}) {
  const width = Number.isFinite(options.width) ? options.width : 200;
  const height = Number.isFinite(options.height) ? options.height : 200;
  const PX = Number.isFinite(options.scale) ? 62 * options.scale : 62;
  const CX = width / 2;
  const CY = height / 2;
  const toScreen = (p) => {
    const q = project3d(p);
    return { x: CX + q.x * PX, y: CY + q.y * PX };
  };

  const n = planeNormal ?? [0, 0, 1];
  const nLen = Math.hypot(n[0], n[1], n[2]) || 1;
  const nHat = [n[0] / nLen, n[1] / nLen, n[2] / nLen];

  const CUBE_V = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
  ];
  const EDGES = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const FACES = [
    [4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]
  ];
  const FACE_NORMALS = [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]];

  const children = [];

  // 半透明实体面（只画朝向观察者的）
  for (let i = 0; i < FACES.length; i += 1) {
    const fn = FACE_NORMALS[i];
    // 观察方向（+z 偏右上）：法向 z 分量为正的面朝向观察者
    if (fn[2] < -0.1) continue;
    const pts = FACES[i].map((idx) => toScreen(CUBE_V[idx]));
    children.push(svgElement('path', {
      d: `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`,
      class: 'section-demo-solid'
    }));
  }

  // 截面多边形：逐棱求交（与 geometry.js 同一套判据，这里内联以避免额外依赖顺序问题）
  const points = [];
  const pushPoint = (p) => {
    for (const q of points) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6) return;
    }
    points.push(p);
  };
  const signed = (p) => nHat[0] * p[0] + nHat[1] * p[1] + nHat[2] * p[2] - d;
  for (const [i, j] of EDGES) {
    const a = CUBE_V[i]; const b = CUBE_V[j];
    const da = signed(a); const db = signed(b);
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) continue;
    if (Math.abs(da) < 1e-9) { pushPoint(a); continue; }
    if (Math.abs(db) < 1e-9) { pushPoint(b); continue; }
    if (da * db > 0) continue;
    const t = da / (da - db);
    pushPoint([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }

  if (points.length >= 3) {
    // 平面内极角排序，得到凸多边形
    const centre = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
      .map((v) => v / points.length);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const helper = Math.abs(nHat[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(nHat, helper));
    const v = norm(cross(nHat, u));
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const ordered = [...points].sort((p, q) => {
      const pa = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
      const qa = [q[0] - centre[0], q[1] - centre[1], q[2] - centre[2]];
      return Math.atan2(dot(pa, v), dot(pa, u)) - Math.atan2(dot(qa, v), dot(qa, u));
    });
    const pts = ordered.map(toScreen);
    children.push(svgElement('path', {
      d: `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`,
      class: 'section-demo-cut'
    }));
  }

  // 立方体棱（后画的压在上面，保证结构清晰）
  for (const [i, j] of EDGES) {
    const a = toScreen(CUBE_V[i]); const b = toScreen(CUBE_V[j]);
    children.push(svgElement('line', {
      x1: a.x.toFixed(2), y1: a.y.toFixed(2), x2: b.x.toFixed(2), y2: b.y.toFixed(2),
      class: 'section-demo-edge'
    }));
  }

  const sides = points.length >= 3 ? `${points.length} 边形` : '无截面';
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': options.ariaLabel ?? `平面扫过立方体的过程，当前截面为${sides}`,
    class: 'fold-svg section-demo-svg'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) svg.append(child);
  return svg;
}

/**
 * 挂载可播放的截面扫动动画。
 * @returns {{play: () => void, setProgress: (t:number)=>void, stop: () => void, destroy: () => void}}
 */
export function mountCrossSectionAnimation(container, spec, options = {}) {
  const duration = Number.isFinite(options.duration) ? options.duration : 3000;
  const win = options.window ?? globalThis.window ?? globalThis;
  const doc = options.document ?? globalThis.document;
  const planeNormal = spec?.planeNormal ?? [1, 1, 1];

  const host = doc.createElement('div');
  host.className = 'fold-anim';
  container.append(host);
  const stage = doc.createElement('div');
  stage.className = 'fold-anim-stage';
  host.append(stage);

  const reduceMotion = (() => {
    try { return win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch { return false; }
  })();

  // 扫动范围：平面与 [-1,1]³ 有交的 d 区间是 [-|n|₁, +|n|₁]（已按 |n| 归一化）
  const nLen = Math.hypot(planeNormal[0], planeNormal[1], planeNormal[2]) || 1;
  const nHat = planeNormal.map((v) => v / nLen);
  const extent = Math.abs(nHat[0]) + Math.abs(nHat[1]) + Math.abs(nHat[2]);
  const from = -extent;
  const to = extent;

  let rafId = null; let startTime = 0; let current = 0;

  function draw(t) {
    current = t;
    const d = from + (to - from) * t;
    stage.replaceChildren(renderCrossSectionFrame(planeNormal, d, options));
  }
  function stop() { if (rafId !== null) { win.cancelAnimationFrame?.(rafId); rafId = null; } }
  function setProgress(t) { stop(); draw(Math.max(0, Math.min(1, t))); }
  function play() {
    stop();
    if (reduceMotion) { setProgress(0.5); return; }
    startTime = 0;
    const step = (now) => {
      if (!startTime) startTime = now;
      const t = Math.min(1, (now - startTime) / duration);
      draw(t);
      if (t < 1) rafId = win.requestAnimationFrame(step); else rafId = null;
    };
    rafId = win.requestAnimationFrame(step);
  }

  draw(options.initialProgress ?? 0.5);

  if (options.controls !== false) {
    const controls = doc.createElement('div');
    controls.className = 'fold-anim-controls';
    const replay = doc.createElement('button');
    replay.type = 'button';
    replay.className = 'fold-anim-button';
    replay.textContent = '重播切割';
    replay.addEventListener('click', () => play());
    controls.append(replay);
    host.append(controls);
    if (options.note) {
      const note = doc.createElement('p');
      note.className = 'fold-anim-note';
      note.textContent = options.note;
      host.append(note);
    }
  }

  return { play, setProgress, stop, root: host, get progress() { return current; }, destroy() { stop(); host.remove(); } };
}

export default { renderFoldFrame, mountFoldAnimation, renderCrossSectionFrame, mountCrossSectionAnimation };
