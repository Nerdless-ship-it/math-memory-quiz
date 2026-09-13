/**
 * 三视图搭建器：自己用小立方体搭立体，实时看三个视图怎么变。
 *
 * 与题库的分工：题库考「给立体选视图」，这里让人**自己搭**——搭一块、三个视图立刻跟着变，
 * 「视图由立体本身决定、与观察角度无关」这件事只有自己动手才真正明白。
 * 几何全部复用 three-views.js（同一套坐标与方向约定），本文件只管画与交互。
 *
 * ── 坐标与相机（与 three-views.js 同一套世界坐标）────────────────────
 *   世界坐标：x 向右、y 向上、z 向前（朝观察者）；立方体占 [x,x+1]×[y,y+1]×[z,z+1]。
 *   相机：绕世界竖直轴 yaw、再绕相机水平轴 pitch（默认 yaw=-32°、pitch=26°，
 *   即从右上前方看，能看到前面 / 上面 / 右面三个面）。
 *   ⚠️ 这里刻意**不复用** fold-anim-view.js 的 viewRotation：那套是为折叠动画的
 *   「纸面坐标（y 向下、z 离纸向上）」写的，基不同；直接借用会把 y/z 搞反。
 *   本文件用自己的 orbit()，并有测试断言 yaw=pitch=0 时是恒等变换、且保持长度。
 *
 * ── 交互 ──────────────────────────────────────────────────────────
 *   拖动 = 旋转观察方向（不改变立体，因此**不改变三个视图**——这正是要传达的点）
 *   点某个面 = 在那一侧加一个方块；点地面 = 在地面加一个方块
 *   删除模式点方块 = 移除它
 *   视图切换：立体图 / 主视图 / 俯视图 / 左视图（放大看某一个）
 *   三个视图始终在下方实时显示，搭的时候能看见它们怎么变。
 *
 * ── 尺寸限制 ──────────────────────────────────────────────────────
 *   每个方向最多 MAX_SIZE 格（4×4×4）。限制是为了让画布尺寸稳定（场景范围固定，
 *   加方块时画面不跳），也够搭出所有常考形状。
 */

import { orthoViews, VIEW_LABELS } from './three-views.js';

export const MAX_SIZE = 4;
export const DEFAULT_VIEW = Object.freeze({ yaw: -32, pitch: 26 });
export const VIEW_LIMITS = Object.freeze({ yaw: 180, pitch: 78 });

const PITCH_LIMIT = VIEW_LIMITS.pitch;
const CELL = 34; // 画布上每小格的边长（像素）

/** 六个面方向：法向 + 中文名（提示语用）。 */
const FACE_DIRECTIONS = Object.freeze([
  { key: 'front', normal: [0, 0, 1], label: '前面' },
  { key: 'back', normal: [0, 0, -1], label: '后面' },
  { key: 'right', normal: [1, 0, 0], label: '右面' },
  { key: 'left', normal: [-1, 0, 0], label: '左面' },
  { key: 'top', normal: [0, 1, 0], label: '上面' },
  { key: 'bottom', normal: [0, -1, 0], label: '下面' }
]);

const key3 = ([x, y, z]) => `${x},${y},${z}`;
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, Number.isFinite(value) ? value : 0));

/**
 * 相机旋转：先绕世界竖直轴（y）转 yaw，再绕相机水平轴（x）转 pitch。
 * yaw = pitch = 0 时是恒等变换（有测试）。
 */
export function orbit([x, y, z], yawDeg = 0, pitchDeg = 0) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = x * cy + z * sy;
  const z1 = z * cy - x * sy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

/** 面法向（相机系）是否朝向观察者：屏幕深度是相机系 z，越大越近。 */
const facesViewer = ([, , z]) => z > 1e-6;

/** 某个面的四个角（世界坐标）。 */
export function faceCorners([x, y, z], normal) {
  const [nx, ny, nz] = normal;
  const base = [x + (nx > 0 ? 1 : 0), y + (ny > 0 ? 1 : 0), z + (nz > 0 ? 1 : 0)];
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const inPlane = axes.filter(([ax, ay, az]) => ax * nx + ay * ny + az * nz === 0);
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [
    base[0] + u * inPlane[0][0] + v * inPlane[1][0],
    base[1] + u * inPlane[0][1] + v * inPlane[1][1],
    base[2] + u * inPlane[0][2] + v * inPlane[1][2]
  ]);
}

/** 加一个方块（越界或已占用则原样返回）。 */
export function addCube(cubes, position) {
  const [x, y, z] = position;
  if (![x, y, z].every((v) => Number.isInteger(v) && v >= 0 && v < MAX_SIZE)) return cubes;
  if (cubes.some((cube) => cube[0] === x && cube[1] === y && cube[2] === z)) return cubes;
  return [...cubes, [x, y, z]];
}

/** 移除一个方块（不存在则原样返回）。 */
export function removeCube(cubes, position) {
  const target = key3(position);
  const next = cubes.filter((cube) => key3(cube) !== target);
  return next.length === cubes.length ? cubes : next;
}

/** 点某个面时，新方块加在哪里：沿该面法向往外一格。 */
export function neighborAcross(cube, normal) {
  return [cube[0] + normal[0], cube[1] + normal[1], cube[2] + normal[2]];
}

/**
 * 场景投影：把固定的场景范围（0..MAX_SIZE 的立方体区域）投到画布上。
 * 范围固定 ⇒ 加方块时画面不跳、不缩放；任何合法立体都在画面内。
 */
export function sceneProjection(yaw, pitch, canvas = { width: 260, height: 240 }) {
  const bounds = [];
  for (const x of [0, MAX_SIZE]) {
    for (const y of [0, MAX_SIZE]) {
      for (const z of [0, MAX_SIZE]) bounds.push(orbit([x, y, z], yaw, pitch));
    }
  }
  const xs = bounds.map((p) => p[0]);
  const ys = bounds.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (canvas.width - 24) / Math.max(maxX - minX, 1e-6),
    (canvas.height - 24) / Math.max(maxY - minY, 1e-6)
  );
  const offsetX = (canvas.width - (maxX - minX) * scale) / 2;
  const offsetY = (canvas.height - (maxY - minY) * scale) / 2;
  return {
    scale,
    toScreen(point) {
      const [x, y] = orbit(point, yaw, pitch);
      return {
        x: offsetX + (x - minX) * scale,
        y: offsetY + (maxY - y) * scale // SVG 的 y 轴向下，这里翻过来
      };
    }
  };
}

/** 画一个二维方格视图（主/俯/左视图都是它）。 */
export function renderGridView(view, { cell = CELL, pad = 8, className = 'builder-view-cell' } = {}) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${view.cols * cell + pad * 2} ${view.rows * cell + pad * 2}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': describeView(view),
    class: 'builder-view-svg'
  });
  svg.style.maxWidth = `${view.cols * cell + pad * 2}px`;
  svg.style.aspectRatio = `${view.cols * cell + pad * 2} / ${view.rows * cell + pad * 2}`;
  for (const [c, r] of view.cells) {
    svg.append(svgEl('rect', {
      x: pad + c * cell, y: pad + r * cell, width: cell, height: cell,
      class: className, 'stroke-linejoin': 'round'
    }));
  }
  return svg;
}

/** 视图的文字描述（无障碍与测试都用它）。 */
export function describeView(view) {
  const rows = [];
  for (let r = 0; r < view.rows; r += 1) {
    const cols = view.cells.filter(([, row]) => row === r).map(([c]) => c + 1);
    rows.push(cols.length ? `第 ${r + 1} 行第 ${cols.join('、')} 列` : `第 ${r + 1} 行空`);
  }
  return `${view.cols} 列 ${view.rows} 行，共 ${view.cells.length} 个小正方形：${rows.join('；')}`;
}

function svgEl(tagName, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 画立体场景（含地面网格）。每个可见面都是可点命中目标：
 *   data-cube="x,y,z" data-dir="前后左右上下" —— 点它就往那一侧加方块。
 */
export function renderSolidScene(cubes, { yaw, pitch, width = 260, height = 240, showGround = true } = {}) {
  const projection = sceneProjection(yaw, pitch, { width, height });
  const cubeKeys = new Set(cubes.map(key3));
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `由 ${cubes.length} 个小立方体搭成的立体图形，可拖动旋转、点击面加方块`,
    class: 'builder-scene'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;

  // 地面网格先画（在最底层），点空格子可以在地面放第一个方块
  if (showGround) {
    for (let x = 0; x < MAX_SIZE; x += 1) {
      for (let z = 0; z < MAX_SIZE; z += 1) {
        const pts = [[x, 0, z], [x + 1, 0, z], [x + 1, 0, z + 1], [x, 0, z + 1]].map(projection.toScreen);
        svg.append(svgEl('path', {
          d: `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`,
          class: 'builder-ground',
          'data-ground': `${x},${z}`
        }));
      }
    }
  }

  // 收集所有「朝外且朝向观察者」的面，按相机深度从远到近画
  const faces = [];
  for (const cube of cubes) {
    for (const { key, normal, label } of FACE_DIRECTIONS) {
      const neighbor = neighborAcross(cube, normal);
      if (cubeKeys.has(key3(neighbor))) continue; // 相邻两块之间的内部面不画
      const rotated = orbit(normal, yaw, pitch);
      if (!facesViewer(rotated)) continue;
      faces.push({ cube, normal, key, label, depth: orbit(cube, yaw, pitch)[2], facing: rotated[2] });
    }
  }
  faces.sort((a, b) => a.depth - b.depth || a.facing - b.facing);

  for (const face of faces) {
    const pts = faceCorners(face.cube, face.normal).map(projection.toScreen);
    // 灰阶跟朝向走：正对观察者最亮，越侧越暗（与题库里的立体图同一套色）
    const shade = face.facing > 0.75 ? 'a' : face.facing > 0.3 ? 'b' : 'c';
    svg.append(svgEl('path', {
      d: `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`,
      class: `builder-face figure-cube-face--${shade}`,
      'data-cube': key3(face.cube),
      'data-dir': face.key,
      'data-label': face.label
    }));
  }
  return svg;
}

/**
 * 挂一个搭建器到容器里。
 *
 * @param {object} [options]
 * @param {Array<[number,number,number]>} [options.cubes] 初始立体（默认搭好一个 L 形）
 * @param {number} [options.yaw] @param {number} [options.pitch] 初始观察角度
 * @returns {{ setCubes: Function, getCubes: Function, setMode: Function, setTab: Function,
 *            clear: Function, root: Element, destroy: Function }}
 */
export function mountSolidBuilder(container, options = {}) {
  const doc = options.document ?? globalThis.document;
  const win = options.window ?? globalThis.window ?? globalThis;

  let cubes = Array.isArray(options.cubes) && options.cubes.length > 0
    ? options.cubes.map((cube) => [...cube])
    : [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  let history = [];
  const view = {
    yaw: clamp(options.yaw ?? DEFAULT_VIEW.yaw, VIEW_LIMITS.yaw),
    pitch: clamp(options.pitch ?? DEFAULT_VIEW.pitch, PITCH_LIMIT)
  };
  let mode = 'add'; // add | remove
  let tab = 'solid'; // solid | front | top | left
  let drag = null;

  const host = doc.createElement('div');
  host.className = 'builder';
  container.append(host);

  // ── 工具条 ────────────────────────────────────────────────────
  const toolbar = doc.createElement('div');
  toolbar.className = 'builder-toolbar';
  const tabs = doc.createElement('div');
  tabs.className = 'builder-tabs';
  const tabButtons = new Map();
  for (const [key, text] of [['solid', '立体图'], ['front', VIEW_LABELS.front], ['top', VIEW_LABELS.top], ['left', VIEW_LABELS.left]]) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'builder-tab';
    button.textContent = text;
    button.setAttribute('aria-pressed', String(key === tab));
    button.addEventListener('click', () => setTab(key));
    tabButtons.set(key, button);
    tabs.append(button);
  }
  toolbar.append(tabs);

  const modes = doc.createElement('div');
  modes.className = 'builder-modes';
  const modeButtons = new Map();
  for (const [key, text, hint] of [['add', '加方块', '点面或地面加方块'], ['remove', '删方块', '点方块移除它']]) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'builder-mode';
    button.textContent = text;
    button.setAttribute('aria-label', hint);
    button.addEventListener('click', () => setMode(key));
    modeButtons.set(key, button);
    modes.append(button);
  }
  toolbar.append(modes);

  const actions = doc.createElement('div');
  actions.className = 'builder-actions';
  const undo = doc.createElement('button');
  undo.type = 'button';
  undo.className = 'builder-action';
  undo.textContent = '撤销';
  undo.addEventListener('click', () => {
    const previous = history.pop();
    if (previous) { cubes = previous; draw(); }
  });
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.className = 'builder-action';
  reset.textContent = '清空';
  reset.addEventListener('click', () => clear());
  actions.append(undo, reset);
  toolbar.append(actions);
  host.append(toolbar);

  // ── 画布 + 三个实时视图 ───────────────────────────────────────
  const canvas = doc.createElement('div');
  canvas.className = 'builder-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', '立体图形画布：拖动旋转观察方向，点击面加方块，方向键也可旋转');
  host.append(canvas);

  const strip = doc.createElement('div');
  strip.className = 'builder-strip';
  host.append(strip);

  const status = doc.createElement('p');
  status.className = 'builder-status';
  host.append(status);

  const hint = doc.createElement('p');
  hint.className = 'builder-hint';
  hint.textContent = '拖动可旋转观察方向；点某个面在那一侧加方块，点地面在地面加方块。'
    + '三个视图由立体本身决定——转动观察方向，它们不会变。';
  host.append(hint);

  // ── 交互 ──────────────────────────────────────────────────────
  function hitFromEvent(event) {
    let node = event?.target;
    const face = node?.closest?.('.builder-face');
    if (face) return { kind: 'face', cube: face.getAttribute('data-cube'), dir: face.getAttribute('data-dir') };
    const ground = node?.closest?.('.builder-ground');
    if (ground) return { kind: 'ground', cell: ground.getAttribute('data-ground') };
    return null;
  }

  function applyHit(hit) {
    if (!hit) return;
    if (mode === 'remove') {
      if (hit.kind !== 'face') return;
      const next = removeCube(cubes, hit.cube.split(',').map(Number));
      if (next !== cubes) { history.push(cubes); cubes = next; draw(); }
      return;
    }
    if (hit.kind === 'face') {
      const direction = FACE_DIRECTIONS.find((d) => d.key === hit.dir);
      if (!direction) return;
      const next = addCube(cubes, neighborAcross(hit.cube.split(',').map(Number), direction.normal));
      if (next !== cubes) { history.push(cubes); cubes = next; draw(); }
      return;
    }
    const [x, z] = hit.cell.split(',').map(Number);
    const next = addCube(cubes, [x, 0, z]);
    if (next !== cubes) { history.push(cubes); cubes = next; draw(); }
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (tab !== 'solid') return; // 放大看某个视图时不旋转
    if (event.button !== undefined && event.button !== 0) { applyHit(hitFromEvent(event)); return; }
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      yaw: view.yaw, pitch: view.pitch, moved: 0, hit: hitFromEvent(event)
    };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    if (drag.moved < 6) return;
    view.yaw = clamp(drag.yaw + dx * 0.5, VIEW_LIMITS.yaw);
    view.pitch = clamp(drag.pitch + dy * 0.5, PITCH_LIMIT);
    drag.hit = null; // 拖动过的不算点击
    draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const hit = drag.moved < 6 ? drag.hit : null;
    drag = null;
    event.preventDefault?.();
    applyHit(hit);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('contextmenu', (event) => {
    const hit = hitFromEvent(event);
    event.preventDefault?.();
    if (hit?.kind === 'face') {
      const next = removeCube(cubes, hit.cube.split(',').map(Number));
      if (next !== cubes) { history.push(cubes); cubes = next; draw(); }
    }
  });
  canvas.addEventListener('keydown', (event) => {
    const step = 5;
    let handled = true;
    if (event.key === 'ArrowLeft') view.yaw = clamp(view.yaw - step, VIEW_LIMITS.yaw);
    else if (event.key === 'ArrowRight') view.yaw = clamp(view.yaw + step, VIEW_LIMITS.yaw);
    else if (event.key === 'ArrowUp') view.pitch = clamp(view.pitch - step, PITCH_LIMIT);
    else if (event.key === 'ArrowDown') view.pitch = clamp(view.pitch + step, PITCH_LIMIT);
    else handled = false;
    if (handled) { event.preventDefault?.(); if (tab === 'solid') draw(); }
  });

  // ── 绘制 ──────────────────────────────────────────────────────
  function draw() {
    // 空立体是合法状态（刚清空）：几何层不接受空数组，所以这里单独处理
    const views = cubes.length > 0 ? orthoViews(cubes) : null;
    for (const [key, button] of tabButtons) button.setAttribute('aria-pressed', String(key === tab));
    for (const [key, button] of modeButtons) button.setAttribute('aria-pressed', String(key === mode));

    canvas.replaceChildren();
    if (tab === 'solid' || !views) {
      canvas.append(renderSolidScene(cubes, { yaw: view.yaw, pitch: view.pitch }));
    } else {
      const big = renderGridView(views[tab], { cell: CELL, className: 'builder-view-cell' });
      big.style.maxWidth = '100%';
      canvas.append(big);
    }

    strip.replaceChildren();
    for (const name of ['front', 'top', 'left']) {
      const cell = doc.createElement('div');
      cell.className = 'builder-strip-cell';
      const title = doc.createElement('div');
      title.className = 'builder-strip-title';
      title.textContent = VIEW_LABELS[name];
      cell.append(title);
      if (views) {
        cell.append(renderGridView(views[name], { cell: 22, pad: 4, className: 'builder-view-cell' }));
      } else {
        const empty = doc.createElement('div');
        empty.className = 'builder-strip-empty';
        empty.textContent = '还没有方块';
        cell.append(empty);
      }
      strip.append(cell);
    }

    const total = cubes.length;
    status.textContent = `当前有 ${total} 个小方块` + (total === 0 ? '——点地面上的格子开始搭' : '');
    canvas.setAttribute('aria-label', total === 0
      ? '立体图形画布：还没有方块，点地面上的格子开始搭。'
      : `立体图形画布：当前 ${total} 个小方块。${VIEW_LABELS.front}${describeView(views.front)}。`
        + `${VIEW_LABELS.top}${describeView(views.top)}。${VIEW_LABELS.left}${describeView(views.left)}。`
        + '拖动或方向键旋转观察方向。');
  }

  function setTab(next) {
    if (!['solid', 'front', 'top', 'left'].includes(next)) return;
    tab = next;
    draw();
  }
  function setMode(next) {
    if (!['add', 'remove'].includes(next)) return;
    mode = next;
    draw();
  }
  function clear() {
    history.push(cubes);
    cubes = [];
    draw();
  }
  function setCubes(next) {
    if (!Array.isArray(next)) return;
    history.push(cubes);
    cubes = next.map((cube) => [...cube]);
    draw();
  }

  draw();

  return {
    setCubes,
    getCubes: () => cubes.map((cube) => [...cube]),
    setTab,
    setMode,
    clear,
    get view() { return { ...view }; },
    root: host,
    destroy() { host.remove(); }
  };
}

export default { mountSolidBuilder, renderSolidScene, renderGridView, orbit, MAX_SIZE, DEFAULT_VIEW };
