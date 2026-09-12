// 折叠 / 展开动画的渲染层：把 fold-anim 算出的每格 3D 状态画成 SVG。
//
// 与 figure.js 的分工：figure.js 画**静态图**（题干与选项），本文件只服务动画。
// 复用 figure.js 的斜二测投影风格（正面不变形），保证折叠末帧与静态立体图是同一种画法。
//
// 三条约束同 figure.js：零依赖、不手写坐标（全部由 fold-anim 算）、每个 svg 带 role/aria-label。
//
// ── 观察视角（方向 / 角度）────────────────────────────────────────────
// 相机可以在相机系里绕竖直轴转「方向」yaw、绕水平轴转「角度」pitch。
// yaw = pitch = 0 就是原来的固定视角，画面与历史版本逐像素一致（有测试断言）。
//
// ⚠️ 视角随**立体程度**缩放（effectiveView）：摊平的展开图是二维图、用来对照题干，
// 必须正放（用户实测「展开图应该不带角度」）；立方体才用满用户视角。
// 缩放是连续的——展开时视角随摊平渐归零，折回时随成形渐恢复，用户设定永不丢失。
//
// ⚠️ 视角一旦能转，遮挡排序就必须换成正确的观察深度。旧版按 `x + y + 2z` 排序，
// 那是只对固定视角成立的启发式：实测在 275 个采样视角里，立方体终态有 213 个视角
// 会把**不可见的面画在可见面之后**（背面盖住正面那类错误）。现在按
// 「观察方向上的投影深度」排序，同一组采样里违反数为 0。
//
// ── 自动适配（fit）────────────────────────────────────────────────────
// 立方体只占 ~1.7 格，摊平的展开图最高 4 格、最宽 5 格：固定比例尺在 200px 画布上
// 必然裁掉高/宽展开图的边缘（「折叠图被挡住」）。默认按折叠全程的投影包围盒自动
// 缩放居中，任何一帧都完整落在画布内；可用 options.fit = false 退回固定比例尺。

import { foldAnimationFrame, rotationBetweenRoots, axisAngleRotation } from './fold-anim.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 与 figure.js 保持一致的斜二测投影。 */
const DEPTH_X = 0.5;
const DEPTH_Y = 0.33;

/** 与 figure.js 保持一致的斜二测投影（截面动画也用它，勿改动其语义）。 */
function project3d([x, y, z]) {
  return { x: x + z * DEPTH_X, y: -y - z * DEPTH_Y };
}

/**
 * 折叠动画的相机变换：数学系（x=col、y=row 向下、z=离纸向上）→ 相机系。
 * 绕 x 轴转 180° 的**真旋转**（det=+1，保持手性）：y、z 同时翻转。
 * 效果：t=0 的摊平图行序与题干图一致（1 号格在左上、行向下增长），
 * 折叠墙面朝屏幕深处折起（像隔着玻璃桌向下折），标签始终朝向观察者。
 * ⚠️ 只作用于折叠动画；截面动画的坐标自成一系，直接走 project3d。
 */
function toCamera([x, y, z]) { return [x, -y, -z]; }

/** 视角可调范围（度）。方向 = 绕竖直轴环视；角度 = 抬头/低头。 */
export const VIEW_LIMITS = Object.freeze({ yaw: 180, pitch: 75 });

/** 把视角夹到合法范围并对齐到滑块的整数刻度。 */
function clampView(value, limit) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.max(-limit, Math.min(limit, Math.round(n)));
}

/**
 * 视角旋转：先 toCamera 进相机系，再绕相机系竖直轴转 yaw、绕水平轴转 pitch。
 * yaw = pitch = 0 时严格是恒等变换，因此默认画面与「视角可调」之前完全一致。
 *
 * 与 toCamera 一样是**线性**映射（无平移），所以同一个函数可以直接作用在法向上——
 * 只要方向，不要位置。
 */
export function viewRotation(yawDeg = 0, pitchDeg = 0) {
  const yaw = ((Number.isFinite(yawDeg) ? yawDeg : 0) * Math.PI) / 180;
  const pitch = ((Number.isFinite(pitchDeg) ? pitchDeg : 0) * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return ([x, y, z]) => {
    const [cx, cv, cz] = toCamera([x, y, z]);
    const x1 = cx * cy + cz * sy;
    const z1 = cz * cy - cx * sy;
    return [x1, cv * cp - z1 * sp, cv * sp + z1 * cp];
  };
}

/**
 * 观察深度（相机系）：值越大越靠近观察者。
 * 斜二测投影的观察方向是 w = (DEPTH_X, DEPTH_Y, -1)（沿它平移屏幕位置不变），
 * 所以「朝向观察者」的分量就是 z − DX·x − DY·y。按它升序绘制即「远的先画」。
 */
export function viewDepth([x, y, z]) {
  return z - DEPTH_X * x - DEPTH_Y * y;
}

/** 朝向观察者的单位方向（相机系）。面的可见性判据：法向与它的点积 > 0。 */
const TOWARD_VIEWER = Object.freeze((() => {
  const len = Math.hypot(DEPTH_X, DEPTH_Y, 1);
  return [-DEPTH_X / len, -DEPTH_Y / len, 1 / len];
})());

/** 相机系法向是否朝向观察者（用于灰阶与遮挡测试）。 */
export function facesViewer(normalCamera) {
  return normalCamera[0] * TOWARD_VIEWER[0]
    + normalCamera[1] * TOWARD_VIEWER[1]
    + normalCamera[2] * TOWARD_VIEWER[2] > 0;
}

/**
 * 视角的有效值 = 用户视角 × 立体程度（modelProgress：1 = 立方体，0 = 摊平）。
 * 摊平的展开图是二维图、用来对照题干，**必须正放（不带角度）**——用户实测反馈
 * 「立方体展开图的时候应该是不带角度的」。所以视角随立体程度连续缩放：
 * 立方体用满用户调的角度，摊平归零（正放），中间帧渐变；用户的设定始终保留，
 * 折回立方体时视角自然回来，不需要任何「重置」动作。
 */
export function effectiveView(yaw, pitch, modelProgress) {
  const level = Math.max(0, Math.min(1, Number.isFinite(modelProgress) ? modelProgress : 0));
  return [yaw * level, pitch * level];
}

// ── 自动适配（修「折叠图被挡住」）───────────────────────────────────────
// 立方体只占 ~1.7 格，而摊平的展开图最高 4 格、最宽 5 格；固定比例尺 PX=62 在 200px
// 画布上必然顾此失彼——立方体刚好，摊平图顶部/底部就被裁掉（用户截图的第 2 图正是 4 格高）。
// 因此每帧按「折叠全程的投影包围盒」自适应缩放并居中：采样全程（摊平 ↔ 立方体），
// 取并集，保证播放中任何一帧都不出画布；播放期间视角不变 → 缓存命中，几乎零开销。

const FIT_FILL = 0.86; // 内容最多占画幅的比例（四周各留 ~7% 呼吸位）
const REORIENT_MS = 420; // 点面换底时「原地转向」补间时长：长到看得清转向，短到不拖
const ROTATE_PER_PX = 0.4; // 拖动旋转灵敏度（度/像素）：200px 拖程 ≈ 80°，可控且不累
const CLICK_SLOP = 6; // 拖动位移小于它算点击（换底），大于它算拖动（旋转）
// 采样折叠全程（每 1/16 一帧）：铰链链的中间帧会探出端态并集（复合旋转的坐标
// 极值可以出现在窗口内部，实测 5 点采样漏了 ~0.4 格），所以采样必须密；
// 再乘 4% 保险系数吸收采样间隙的残余。
const FIT_SAMPLES = Array.from({ length: 17 }, (_, i) => i / 16);
const FIT_SAFETY = 1.04;

let fitCache = { cells: null, key: '', value: null };

/** 一帧在投影平面上的包围盒（单位=格）。 */
function projectedBounds(frame, rotate) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cellState of frame.cells) {
    for (const p of cellState.corners) {
      const [x, y, z] = rotate(p);
      const sx = x + z * DEPTH_X;
      const sy = -y - z * DEPTH_Y;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 算出把整段动画都装进画布所需的投影包围盒（单位=格）。
 * 结果按 (cells 引用, root, yaw, pitch, stagger) 缓存一格；yaw/pitch 经 mount 夹取后
 * 键空间有界。
 * @returns {{ cx: number, cy: number, w: number, h: number } | null}
 */
export function computeFit(cells, yaw = 0, pitch = 0, stagger = 0.35, root = 0) {
  const key = `${root}|${yaw}|${pitch}|${stagger}`;
  if (fitCache.cells === cells && fitCache.key === key) return fitCache.value;
  let bounds = null;
  for (const t of FIT_SAMPLES) {
    const frame = foldAnimationFrame(cells, t, { stagger, root });
    if (!frame.ok) continue;
    // 与渲染同一规则：视角随立体程度缩放（t 即模型进度，0 = 摊平正放）
    const b = projectedBounds(frame, viewRotation(...effectiveView(yaw, pitch, t)));
    bounds = bounds === null ? b : {
      minX: Math.min(bounds.minX, b.minX),
      minY: Math.min(bounds.minY, b.minY),
      maxX: Math.max(bounds.maxX, b.maxX),
      maxY: Math.max(bounds.maxY, b.maxY)
    };
  }
  const value = bounds === null ? null : {
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
    w: Math.max((bounds.maxX - bounds.minX) * FIT_SAFETY, 1e-6),
    h: Math.max((bounds.maxY - bounds.minY) * FIT_SAFETY, 1e-6)
  };
  fitCache = { cells, key, value };
  return value;
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
 * 画一帧折叠动画。
 * @param {Array<[number,number]>} cells 展开图网格坐标
 * @param {number} t 进度 0..1
 * @param {{ labels?: string[], width?: number, height?: number, scale?: number, stagger?: number, ariaLabel?: string }} options
 * @returns {SVGElement}
 */
/**
 * 画一帧折叠 / 展开动画。
 * @param {Array<[number,number]>} cells 展开图网格坐标
 * @param {number} t 播放进度 0..1（0 = 起始态，1 = 结束态）
 * @param {{ labels?: string[], width?: number, height?: number, scale?: number, stagger?: number,
 *           direction?: 'unfold' | 'fold', yaw?: number, pitch?: number, fit?: boolean,
 *           root?: number, preRotate?: (p: number[]) => number[], ariaLabel?: string }} options
 *   direction='unfold'（默认）播放「立方体 → 展开图」；'fold' 是历史方向「展开图 → 立方体」。
 *   yaw / pitch 是观察视角（度），0 / 0 等于原来的固定视角。
 *   fit（默认 true）按折叠全程的投影包围盒自动缩放并居中，任何一帧都不会被画布裁掉；
 *   scale 语义是「在适配结果上再乘的系数」，fit=false 时退回历史行为 62·scale。
 *   root 是底面下标（默认 0）：折叠时保持不动的那一格，换底 = 换根。
 *   preRotate 是换底补间用的模型空间预旋转（在相机旋转之前施加），平时为 null。
 * @returns {SVGElement}
 */
export function renderFoldFrame(cells, t, options = {}) {
  const labels = Array.isArray(options.labels) ? options.labels : null;
  const scale = Number.isFinite(options.scale) ? options.scale : 1;
  const stagger = Number.isFinite(options.stagger) ? options.stagger : 0.35;
  const direction = options.direction === 'fold' ? 'fold' : 'unfold';
  const yaw = options.yaw ?? 0;
  const pitch = options.pitch ?? 0;
  const preRotate = typeof options.preRotate === 'function' ? options.preRotate : null;
  const toModel = (p) => (preRotate ? preRotate(p) : p);
  // 播放方向只改「t 映射到折叠模型的哪个进度」：模型永远算「展开图 → 立方体」，
  // 所以展开就是把它倒过来放。铰链运动、错峰、末态对齐全部原样复用，不另写一套。
  const modelProgress = direction === 'unfold' ? 1 - (Number.isFinite(t) ? t : 0) : t;
  // 视角随立体程度缩放：摊平（modelProgress=0）正放，立方体（1）用满用户视角
  const rotate = viewRotation(...effectiveView(yaw, pitch, modelProgress));
  const frame = foldAnimationFrame(cells, modelProgress, { stagger, root: options.root });
  if (!frame.ok) {
    throw new Error(`fold-anim: 展开图不合法（${frame.reason}）`);
  }

  const width = Number.isFinite(options.width) ? options.width : 200;
  const height = Number.isFinite(options.height) ? options.height : 200;
  let PX = 62 * scale;
  let fitCx = 0;
  let fitCy = 0;
  if (options.fit !== false) {
    const fit = computeFit(cells, yaw, pitch, stagger, options.root ?? 0);
    if (fit) {
      PX = Math.min((width * FIT_FILL) / fit.w, (height * FIT_FILL) / fit.h) * scale;
      fitCx = fit.cx;
      fitCy = fit.cy;
    }
  }
  const CX = width / 2;
  const CY = height / 2;
  const toScreen = (p) => {
    const [x, y, z] = rotate(toModel(p));
    return { x: CX + (x + z * DEPTH_X - fitCx) * PX, y: CY + (-y - z * DEPTH_Y - fitCy) * PX };
  };

  // 画家算法：按观察深度升序，远的先画。
  // ⚠️ 不能用固定视角的启发式（旧版是 x + y + 2z）：视角一转它就让背面的面盖住正面的面。
  // 用 viewDepth（沿观察方向的投影）后，采样视角下「不可见面更远」恒成立（有测试）。
  const sorted = [...frame.cells].sort((a, b) => viewDepth(rotate(toModel(a.center))) - viewDepth(rotate(toModel(b.center))));

  const children = [];
  for (const cellState of sorted) {
    // 四角由铰链链刚体变换给出（v1 是从中心+法向重建，面内朝向会漂）。
    // 缺 corners 视为模块版本不匹配，直接抛错而不是画出错误的帧。
    if (!Array.isArray(cellState.corners) || cellState.corners.length !== 4) {
      throw new Error('fold-anim: 帧数据缺少 corners（fold-anim.js 与 fold-anim-view.js 版本不匹配）');
    }
    const pts = cellState.corners.map((p) => toScreen(p));
    const d = `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;
    // 朝向观察者的面亮一些，背面的暗一些，折叠过程才有立体感。
    // 判据沿用相机系法向的 z 分量（与历史版本同一口径 → 默认视角下灰阶逐像素不变），
    // 视角转动时法向一起转，所以亮暗仍然跟着朝向走。
    const nCam = rotate(toModel(cellState.normal));
    const facing = nCam[2] > 0.2 ? 'fold-face--front'
      : nCam[2] < -0.2 ? 'fold-face--back' : 'fold-face--side';
    // data-cell-index：点击换底的命中标识（mount 用）
    const cellIndex = cells.indexOf(cellState.cell);
    children.push(svgElement('path', { d, class: `fold-face ${facing}`, 'data-cell-index': cellIndex }));

    // 面身份标注：加 labels 时用展开图编号，否则用面名首字
    const label = labels ? labels[cellIndex] : null;
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
    'aria-label': options.ariaLabel
      ?? (direction === 'unfold' ? '正方体展开成展开图的过程演示' : '正方体展开图折叠过程演示'),
    class: 'fold-svg'
  });
  wrapper.style.maxWidth = `${width}px`;
  wrapper.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) wrapper.append(child);
  return wrapper;
}

/**
 * 挂一个可播放的展开 / 折叠动画到容器里，返回控制句柄。
 * 用 requestAnimationFrame 驱动；prefers-reduced-motion 时不做动画（无障碍要求）。
 *
 * 演示流程（play）：立方体 → 展开图 → 停一拍 → 折回立方体，**最终停在立方体上**。
 *
 * 交互（直接操控，不用滑块）：
 *  - **拖动画面** = 旋转观察视角（横拖转方向、竖拖转俯仰），1:1 跟手不加缓动；
 *    键盘方向键同样可用（无障碍）。
 *  - **点击某个面** = 以它为底重新展开：先把立方体原地转到「点选面朝下」（补间 ~0.4s，
 *    姿态不跳变），再展开、停一拍、折回。在展开图上点面则直接以它为底折起来。
 *    折叠树换根即可（模型层支持任意根），摊平姿态与根无关 → 在展开图换底零跳变。
 *
 * @param {object} [options]
 * @param {'unfold' | 'fold'} [options.direction] 默认 'unfold'（立方体 → 展开图）。
 * @param {number} [options.hold] 展开图停留毫秒数，默认 900。
 * @param {number} [options.yaw] 初始方向（度，±180）。@param {number} [options.pitch] 初始角度（度，±75）。
 * @returns {{ play: () => void, toggle: () => void, setProgress: (t: number) => void,
 *            setView: (view: object) => void, setBase: (index: number) => void,
 *            stop: () => void, root: Element, progress: number, base: number,
 *            view: { yaw: number, pitch: number }, destroy: () => void }}
 */
export function mountFoldAnimation(container, cells, options = {}) {
  const duration = Number.isFinite(options.duration) ? options.duration : 2600;
  const holdMs = Number.isFinite(options.hold) ? options.hold : 900;
  const labels = Array.isArray(options.labels) ? options.labels : null;
  const direction = options.direction === 'fold' ? 'fold' : 'unfold';
  const win = options.window ?? globalThis.window ?? globalThis;
  const doc = options.document ?? globalThis.document;
  const view = {
    yaw: clampView(options.yaw, VIEW_LIMITS.yaw),
    pitch: clampView(options.pitch, VIEW_LIMITS.pitch)
  };
  // t 的两个端态哪个是立方体、哪个是展开图（direction='fold' 时互换）
  const NET_T = direction === 'unfold' ? 1 : 0;
  const CUBE_T = 1 - NET_T;
  const setT = win.setTimeout ? win.setTimeout.bind(win) : globalThis.setTimeout;
  const clearT = win.clearTimeout ? win.clearTimeout.bind(win) : globalThis.clearTimeout;

  let rafId = null;
  let holdTimer = null;
  let doneCallback = null;
  let startTime = 0;
  let animFrom = CUBE_T;
  let current = CUBE_T;
  let target = CUBE_T;
  let replay = null;
  // 底面（折叠树根）与换底补间状态
  let baseIndex = 0;
  let preRotate = null; // 换底补间期间的模型空间预旋转（函数），平时为 null
  let pendingRoot = null; // 展开途中 / 停一拍期间点选的新底面，到摊平时刻生效
  let hoveredIndex = null; // 悬停高亮的面（仅静止时）
  let drag = null; // 拖动旋转的指针状态

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
    stage.replaceChildren(renderFoldFrame(cells, t, {
      ...options, labels, direction, yaw: view.yaw, pitch: view.pitch,
      root: baseIndex, preRotate
    }));
    applyHoverClass();
  }

  /** 悬停高亮：静止时鼠标下的面加粗描边，提示「可以点它换底」。重画后需重挂。 */
  function applyHoverClass() {
    const svg = stage.children[0];
    if (!svg) return;
    for (const node of svg.children ?? []) {
      if (node.tagName !== 'path') continue;
      const isHover = hoveredIndex !== null
        && Number(node.getAttribute?.('data-cell-index')) === hoveredIndex;
      node.classList?.toggle?.('fold-face--hover', isHover);
    }
  }

  function stop() {
    if (rafId !== null) { win.cancelAnimationFrame?.(rafId); rafId = null; }
    if (holdTimer !== null) { clearT(holdTimer); holdTimer = null; }
    doneCallback = null;
    preRotate = null; // 转向补间被打断时清掉预旋转，否则后续帧会带着残留旋转画
  }

  const toggleTarget = () => (target === NET_T ? CUBE_T : NET_T);

  function buttonText() {
    const to = toggleTarget();
    if (reduceMotion) return to === NET_T ? '显示展开图' : '显示立方体';
    return to === NET_T ? '展开' : '折成立方体';
  }

  function updateButton() {
    if (replay) replay.textContent = buttonText();
  }

  function step(now) {
    if (!startTime) startTime = now;
    const span = Math.abs(target - animFrom);
    const k = Math.min(1, (now - startTime) / (duration * span));
    draw(animFrom + (target - animFrom) * k);
    if (k < 1) { rafId = win.requestAnimationFrame(step); return; }
    rafId = null;
    const cb = doneCallback;
    doneCallback = null;
    if (cb) cb();
  }

  /** 从当前进度播到指定端态；跨度按比例折算时长，中途反向不会突然加速。 */
  function playTo(next, onDone) {
    stop();
    target = next;
    animFrom = current;
    updateButton();
    const span = Math.abs(target - animFrom);
    if (reduceMotion || span < 1e-6) {
      draw(target);
      if (onDone) onDone();
      return;
    }
    startTime = 0;
    doneCallback = onDone ?? null;
    rafId = win.requestAnimationFrame(step);
  }

  /** 按钮：在两种端态间切换（播放中途点击 = 从当前位置反向）。 */
  function toggle() {
    playTo(toggleTarget());
  }

  /** 完整演示：立方体 → 展开图（停一拍让人看清编号）→ 折回立方体，停在立方体上。 */
  function play() {
    if (reduceMotion) { // 降级：不做动画，停在立方体，按钮即时切换两种端态
      stop();
      target = CUBE_T;
      preRotate = null;
      draw(CUBE_T);
      updateButton();
      return;
    }
    playTo(NET_T, () => {
      // 摊平时刻换底零跳变（摊平姿态与根无关，有测试断言）
      if (pendingRoot !== null) { baseIndex = pendingRoot; pendingRoot = null; }
      holdTimer = setT(() => {
        holdTimer = null;
        // 停一拍期间点的面也在这里生效（此刻仍在摊平态，换底零跳变）
        if (pendingRoot !== null) { baseIndex = pendingRoot; pendingRoot = null; }
        playTo(CUBE_T);
      }, holdMs);
    });
  }

  function setProgress(t) {
    stop();
    const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    target = Math.abs(clamped - NET_T) < 0.5 ? NET_T : CUBE_T;
    draw(clamped);
    updateButton();
  }

  /** 通用补间：runTween(ms, onFrame(k), onDone)。与播放共用同一个 rAF 槽。 */
  function runTween(ms, onFrame, onDone) {
    stop();
    let t0 = 0;
    const fn = (now) => {
      if (!t0) t0 = now;
      const k = Math.min(1, (now - t0) / ms);
      onFrame(k);
      if (k < 1) { rafId = win.requestAnimationFrame(fn); return; }
      rafId = null;
      if (onDone) onDone();
    };
    rafId = win.requestAnimationFrame(fn);
  }

  const isIdle = () => rafId === null && holdTimer === null;

  /**
   * 以 idx 面为底，从立方体开始完整演示。
   * 关键在「姿态连续」：换底后立方体朝向变了，先把立方体原地转到新朝向
   * （preRotate 从 R⁻¹ 衰减到单位阵），再展开——看起来是「点选的面转到底下，然后摊开」。
   */
  function beginStoryWithBase(idx) {
    if (idx === baseIndex) { play(); return; }
    const rot = rotationBetweenRoots(cells, baseIndex, idx);
    baseIndex = idx;
    if (reduceMotion || !rot || rot.angle < 1e-3) { preRotate = null; play(); return; }
    runTween(REORIENT_MS, (k) => {
      preRotate = axisAngleRotation(rot.axis, -rot.angle * (1 - k));
      draw(current); // current === CUBE_T：原地转向
    }, () => {
      preRotate = null;
      play();
    });
  }

  /**
   * 点击某个面 = 以它为底。
   *  - 静止在立方体：换底并完整演示（带原地转向补间）。
   *  - 静止在展开图：摊平姿态与根无关，直接换底折起来。
   *  - 展开途中 / 停一拍：记下，到摊平时刻生效（零跳变）。
   *  - 折回途中 / 转向补间中：忽略（姿态连续优先，不抢戏）。
   */
  function onFaceClick(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= cells.length) return;
    if (!isIdle()) {
      if (target === NET_T) pendingRoot = idx;
      return;
    }
    if (current === NET_T) {
      baseIndex = idx;
      playTo(CUBE_T);
      return;
    }
    beginStoryWithBase(idx);
  }

  /** 程序化换底（等价于点击该面）。 */
  function setBase(idx) {
    onFaceClick(idx);
  }

  draw(options.initialProgress ?? CUBE_T);
  target = Math.abs(current - NET_T) < 0.5 ? NET_T : CUBE_T;

  // ── 直接操控：拖动旋转 + 点击换底（替代滑块，用户反馈滑块不方便）────────
  /** 事件里的面下标（点在面路径或它上面的编号文字上都有——编号不拦截事件另见 CSS）。 */
  function faceIndexFromEvent(e) {
    let el = e?.target;
    const host = el?.closest?.('.fold-face'); // 真 DOM：命中子节点（如 text）时回溯到面路径
    if (host) el = host;
    if (!el?.classList?.contains?.('fold-face')) return null;
    const idx = Number(el.getAttribute?.('data-cell-index'));
    return Number.isInteger(idx) ? idx : null;
  }

  function bindStageInteractions() {
    stage.tabIndex = 0; // 键盘可达：方向键旋转（滑块移除后的无障碍路径）
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label',
      '正方体展开演示。拖动画面或用方向键旋转观察角度（摊平的展开图始终正放）；点击某个面，以它为底展开。');

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      drag = {
        id: e.pointerId, x: e.clientX, y: e.clientY,
        yaw: view.yaw, pitch: view.pitch,
        moved: 0, faceIndex: faceIndexFromEvent(e)
      };
      stage.setPointerCapture?.(e.pointerId);
      e.preventDefault?.();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || (drag.id !== undefined && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      view.yaw = clampView(drag.yaw + dx * ROTATE_PER_PX, VIEW_LIMITS.yaw);
      view.pitch = clampView(drag.pitch + dy * ROTATE_PER_PX, VIEW_LIMITS.pitch);
      draw(current); // 1:1 跟手，不加缓动
    });
    const endDrag = (e) => {
      if (!drag) return;
      const wasClick = drag.moved < CLICK_SLOP;
      const faceIndex = drag.faceIndex;
      drag = null;
      if (wasClick && faceIndex !== null) onFaceClick(faceIndex);
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', () => { drag = null; });

    stage.addEventListener('keydown', (e) => {
      const step = 5;
      let handled = true;
      if (e.key === 'ArrowLeft') view.yaw = clampView(view.yaw - step, VIEW_LIMITS.yaw);
      else if (e.key === 'ArrowRight') view.yaw = clampView(view.yaw + step, VIEW_LIMITS.yaw);
      else if (e.key === 'ArrowUp') view.pitch = clampView(view.pitch - step, VIEW_LIMITS.pitch);
      else if (e.key === 'ArrowDown') view.pitch = clampView(view.pitch + step, VIEW_LIMITS.pitch);
      else handled = false;
      if (handled) { e.preventDefault?.(); draw(current); }
    });

    // 悬停高亮：只在静止时提示「这个面可以点」（播放中画面在变，不抢注意力）
    stage.addEventListener('pointerover', (e) => {
      if (!isIdle()) return;
      const idx = faceIndexFromEvent(e);
      if (idx !== hoveredIndex) { hoveredIndex = idx; applyHoverClass(); }
    });
    stage.addEventListener('pointerleave', () => {
      if (hoveredIndex !== null) { hoveredIndex = null; applyHoverClass(); }
    });
  }
  bindStageInteractions();

  // 控制条：「展开 ⇄ 折成立方体」切换 + 一句说明。
  // 演示停在立方体上；拖动画面转角度，点面换底——都在画布上直接完成。
  if (options.controls !== false) {
    const controls = doc.createElement('div');
    controls.className = 'fold-anim-controls';
    replay = doc.createElement('button');
    replay.type = 'button';
    replay.className = 'fold-anim-button';
    updateButton();
    replay.addEventListener('click', () => toggle());
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
    toggle,
    setProgress,
    setBase,
    stop,
    root: host,
    get progress() { return current; },
    get base() { return baseIndex; },
    get view() { return { ...view }; },
    setView(next = {}) {
      view.yaw = clampView(next.yaw ?? view.yaw, VIEW_LIMITS.yaw);
      view.pitch = clampView(next.pitch ?? view.pitch, VIEW_LIMITS.pitch);
      draw(current);
      return { ...view };
    },
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

export default {
  renderFoldFrame,
  mountFoldAnimation,
  renderCrossSectionFrame,
  mountCrossSectionAnimation,
  viewRotation,
  viewDepth,
  facesViewer,
  effectiveView,
  computeFit,
  VIEW_LIMITS
};
