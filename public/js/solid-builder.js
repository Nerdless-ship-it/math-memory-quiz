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
import {
  SOLID_SHAPES, SOLID_BY_ID, solidViews, shapeLabel, shapeNodes, renderShape,
  renderSolidRotated, solidRotatedNodes, solidRotatedPoints, polygonPath
} from './solid-shapes.js';

/**
 * 组合体的部件目录：每个部件占几格（size，单位格）+ 它的几何定义（view）。
 * 尺寸刻意取整数格，这样「放在地面上 / 叠在别的部件上」都有确定的位置，
 * 也保证组合体的三个视图能按格子对齐画出来。
 * ⚠️ 与题库图形的尺寸不同（题库圆柱高 1.8，这里高 2）——视图规则完全一样，
 * 只是搭建器要整数格；solidViews 支持传尺寸覆盖。
 */
export const PART_CATALOG = Object.freeze([
  { id: 'cube', name: '小方块', size: [1, 1, 1], view: { id: 'cuboid', width: 1, depth: 1, height: 1 } },
  { id: 'brick', name: '长方体', size: [2, 1, 1], view: { id: 'cuboid', width: 2, depth: 1, height: 1 } },
  { id: 'cylinder', name: '圆柱', size: [2, 2, 2], view: { id: 'cylinder', radius: 1, height: 2 } },
  { id: 'cone', name: '圆锥', size: [2, 2, 2], view: { id: 'cone', radius: 1, height: 2 } },
  { id: 'sphere', name: '球', size: [2, 2, 2], view: { id: 'sphere', radius: 1 } },
  { id: 'prism3', name: '正三棱柱', size: [2, 2, 2], view: { id: 'prism3', sides: 3, radius: 1, height: 2 } },
  { id: 'pyramid4', name: '正四棱锥', size: [2, 2, 2], view: { id: 'pyramid4', sides: 4, radius: 1, height: 2 } }
]);

export const PART_BY_ID = Object.freeze(Object.fromEntries(PART_CATALOG.map((p) => [p.id, p])));

/** 两个部件的包围盒是否相交（组合体不允许穿插——穿插的立体图画不出来也说不清）。 */
export function partsOverlap(a, b) {
  const [ax, ay, az] = a.at;
  const [aw, ah, ad] = PART_BY_ID[a.id].size;
  const [bx, by, bz] = b.at;
  const [bw, bh, bd] = PART_BY_ID[b.id].size;
  return ax < bx + bw && bx < ax + aw
    && ay < by + bh && by < ay + ah
    && az < bz + bd && bz < az + ad;
}

/** 部件是否可以放在这个位置：在场景范围内、不与已有部件相交。 */
export function canPlacePart(parts, candidate) {
  const part = PART_BY_ID[candidate?.id];
  if (!part) return false;
  const [x, y, z] = candidate.at;
  const [w, h, d] = part.size;
  if (x < 0 || y < 0 || z < 0 || x + w > MAX_SIZE || z + d > MAX_SIZE || y + h > MAX_SIZE) return false;
  return !parts.some((other) => partsOverlap(other, candidate));
}

/** 组合体的场景范围（格）：三个方向的已用尺寸，至少 1×1×1。 */
export function partsExtent(parts) {
  let width = 1;
  let height = 1;
  let depth = 1;
  for (const part of parts) {
    const [w, h, d] = PART_BY_ID[part.id].size;
    width = Math.max(width, part.at[0] + w);
    height = Math.max(height, part.at[1] + h);
    depth = Math.max(depth, part.at[2] + d);
  }
  return { width, height, depth };
}

/**
 * 组合体的三个视图：把每个部件的视图形状按它的位置摆进同一张二维图。
 *
 * 方向约定与 three-views.js 完全一致：
 *   主视图：列 = x（向右），行从下往上对应 y（所以行号 = 场景高 − y）
 *   俯视图：列 = x，行 = z（向下 = 向前）
 *   左视图：列 = z（向右 = 向前），行同上（从下往上对应 y）
 *
 * @returns {{ front: object, top: object, left: object }}
 *   每个视图 = { cols, rows, shapes: [{ shape, center: [col, row] }] }
 */
export function compositeViews(parts) {
  const { width, height, depth } = partsExtent(parts);
  const views = {
    front: { cols: width, rows: height, shapes: [] },
    top: { cols: width, rows: depth, shapes: [] },
    left: { cols: depth, rows: height, shapes: [] }
  };
  for (const part of parts) {
    const [w, h, d] = PART_BY_ID[part.id].size;
    const [px, py, pz] = part.at;
    const shapes = solidViews(PART_BY_ID[part.id].view);
    views.front.shapes.push({ shape: shapes.front, center: [px + w / 2, height - py - h / 2] });
    views.top.shapes.push({ shape: shapes.top, center: [px + w / 2, pz + d / 2] });
    views.left.shapes.push({ shape: shapes.left, center: [pz + d / 2, height - py - h / 2] });
  }
  return views;
}

/** 画组合体的某个视图（多个形状摆进同一张图，按格定位）。 */
export function renderCompositeView(view, { cell = 34, pad = 10, className } = {}) {
  const width = Math.round(view.cols * cell + pad * 2);
  const height = Math.round(view.rows * cell + pad * 2);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `组合体视图：${view.cols} 列 ${view.rows} 行，由 ${view.shapes.length} 个部件拼成`,
    class: 'builder-view-svg'
  });
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;
  for (const { shape, center } of view.shapes) {
    for (const node of shapeNodes(shape, pad + center[0] * cell, pad + center[1] * cell, cell, className)) {
      svg.append(node);
    }
  }
  return svg;
}

/** 画组合体的立体场景：地面网格 + 各部件（按相机深度从远到近）。 */
export function renderCompositeScene(parts, { yaw = 0, pitch = 0, width = 260, height = 240 } = {}) {
  // 场景范围固定为 MAX_SIZE 的方盒 + 实际用到的部分，保证加部件时画面不跳
  const corners = [];
  for (const x of [0, MAX_SIZE]) {
    for (const y of [0, MAX_SIZE]) {
      for (const z of [0, MAX_SIZE]) corners.push(orbit([x, y, z], yaw, pitch));
    }
  }
  const minX = Math.min(...corners.map((p) => p[0]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => -p[1]));
  const maxY = Math.max(...corners.map((p) => -p[1]));
  const pad = 12;
  const unit = Math.min(
    (width - pad * 2) / Math.max(maxX - minX, 1e-6),
    (height - pad * 2) / Math.max(maxY - minY, 1e-6)
  );
  const canvasW = Math.round((maxX - minX) * unit + pad * 2);
  const canvasH = Math.round((maxY - minY) * unit + pad * 2);
  const toScreen = ([x, y, z]) => [(x - minX) * unit + pad, (-y - minY) * unit + pad];

  const svg = svgEl('svg', {
    viewBox: `0 0 ${canvasW} ${canvasH}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `组合体：${parts.length} 个部件，可拖动旋转、点击地面或部件放置`,
    class: 'builder-scene'
  });
  svg.style.maxWidth = `${canvasW}px`;
  svg.style.aspectRatio = `${canvasW} / ${canvasH}`;

  // 地面网格（点空格子在地面放部件）
  for (let x = 0; x < MAX_SIZE; x += 1) {
    for (let z = 0; z < MAX_SIZE; z += 1) {
      const pts = [[x, 0, z], [x + 1, 0, z], [x + 1, 0, z + 1], [x, 0, z + 1]].map((p) => toScreen(orbit(p, yaw, pitch)));
      svg.append(svgEl('path', {
        d: polygonPath(pts),
        class: 'builder-ground',
        'data-ground': `${x},${z}`
      }));
    }
  }

  // 部件按相机深度（远 → 近）画；每个面挂 data-part 供点击叠放
  const ordered = parts
    .map((part, index) => {
      const [w, h, d] = PART_BY_ID[part.id].size;
      const center = [part.at[0] + w / 2, part.at[1] + h / 2, part.at[2] + d / 2];
      const [, , depth] = orbit(center, yaw, pitch);
      return { part, index, depth };
    })
    .sort((a, b) => a.depth - b.depth);

  for (const { part, index } of ordered) {
    for (const node of solidRotatedNodes(PART_BY_ID[part.id].view, {
      at: part.at, yaw, pitch, toScreen,
      attrs: () => ({ 'data-part': String(index) })
    })) {
      // 补上命中用的类名：点击判定靠 .builder-face + data-part（与方块模式同一套）
      const classes = node.getAttribute('class') ?? '';
      node.setAttribute('class', `${classes} builder-face`.trim());
      svg.append(node);
    }
  }
  return svg;
}

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
  const view = {
    yaw: clamp(options.yaw ?? DEFAULT_VIEW.yaw, VIEW_LIMITS.yaw),
    pitch: clamp(options.pitch ?? DEFAULT_VIEW.pitch, PITCH_LIMIT)
  };
  let mode = 'add'; // add | remove（仅「自由搭建」模式）
  let tab = 'solid'; // solid | front | top | left
  let source = ['cubes', 'shapes', 'parts'].includes(options.source) ? options.source : 'cubes';
  let shapeId = SOLID_BY_ID[options.shape] ? options.shape : SOLID_SHAPES[0].id;
  let parts = []; // 组合体：[{ id, at: [x, y, z] }]
  let partId = PART_BY_ID[options.part] ? options.part : 'cube';
  // 撤销栈存的是两种模型的快照（方块模式用 cubes、组合体模式用 parts）
  let history = [];
  let drag = null;

  const host = doc.createElement('div');
  host.className = 'builder';
  container.append(host);

  // ── 工具条 ────────────────────────────────────────────────────
  const toolbar = doc.createElement('div');
  toolbar.className = 'builder-toolbar';

  // 内容来源：自己堆方块 / 从标准几何体里选一个
  const sources = doc.createElement('div');
  sources.className = 'builder-sources';
  const sourceButtons = new Map();
  for (const [key, text, hint] of [
    ['cubes', '自由搭建', '自己用小方块搭立体'],
    ['shapes', '标准几何体', '从圆柱、圆锥、球等几何体里选一个看它的三视图'],
    ['parts', '组合体', '把方块和圆柱、圆锥等拼在一起，看组合体的三视图']
  ]) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'builder-source';
    button.textContent = text;
    button.setAttribute('aria-label', hint);
    button.addEventListener('click', () => setSource(key));
    sourceButtons.set(key, button);
    sources.append(button);
  }
  toolbar.append(sources);

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
    if (previous) { cubes = previous.cubes; parts = previous.parts; draw(); }
  });
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.className = 'builder-action';
  reset.textContent = '清空';
  reset.addEventListener('click', () => clear());
  actions.append(undo, reset);
  toolbar.append(actions);
  host.append(toolbar);

  // ── 几何体库（仅「标准几何体」模式）─────────────────────────────
  const gallery = doc.createElement('div');
  gallery.className = 'builder-gallery';
  const shapeButtons = new Map();
  for (const solid of SOLID_SHAPES) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'builder-shape';
    button.setAttribute('aria-label', `选择${solid.name}`);
    const label = doc.createElement('span');
    label.className = 'builder-shape-name';
    label.textContent = solid.name;
    button.append(label);
    button.addEventListener('click', () => setShape(solid.id));
    shapeButtons.set(solid.id, button);
    gallery.append(button);
  }
  host.append(gallery);

  // ── 部件库（仅「组合体」模式）：方块与标准几何体都能往上放 ────────
  const palette = doc.createElement('div');
  palette.className = 'builder-palette';
  const partButtons = new Map();
  for (const part of PART_CATALOG) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'builder-part';
    button.textContent = part.name;
    button.setAttribute('aria-label', `放置${part.name}`);
    button.addEventListener('click', () => setPart(part.id));
    partButtons.set(part.id, button);
    palette.append(button);
  }
  host.append(palette);

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
    + '三个视图由立体本身决定——转动观察方向，它们不会变。';  host.append(hint);

  // ── 交互 ──────────────────────────────────────────────────────
  function hitFromEvent(event) {
    let node = event?.target;
    const face = node?.closest?.('.builder-face');
    if (face) {
      return {
        kind: 'face',
        cube: face.getAttribute('data-cube'),
        dir: face.getAttribute('data-dir'),
        part: face.getAttribute('data-part')
      };
    }
    const ground = node?.closest?.('.builder-ground');
    if (ground) return { kind: 'ground', cell: ground.getAttribute('data-ground') };
    return null;
  }

  /** 组合体：在指定位置放一个当前选中的部件（越界 / 相交则忽略）。 */
  function placePartAt(at) {
    const candidate = { id: partId, at };
    if (!canPlacePart(parts, candidate)) return false;
    history.push({ cubes, parts });
    parts = [...parts, candidate];
    draw();
    return true;
  }

  function applyHit(hit) {
    if (!hit) return;

    if (source === 'parts') {
      if (hit.kind === 'ground') {
        const [x, z] = hit.cell.split(',').map(Number);
        placePartAt([x, 0, z]);
        return;
      }
      if (hit.kind === 'face' && hit.part !== null && hit.part !== undefined) {
        const target = parts[Number(hit.part)];
        if (target) {
          // 叠放在被点部件的正上方（与它在 x / z 方向对齐）
          placePartAt([target.at[0], target.at[1] + PART_BY_ID[target.id].size[1], target.at[2]]);
        }
      }
      return;
    }

    if (source === 'shapes') return; // 几何体模式下不可增删（没有方块可编辑）
    if (mode === 'remove') {
      if (hit.kind !== 'face') return;
      const next = removeCube(cubes, hit.cube.split(',').map(Number));
      if (next !== cubes) { history.push({ cubes, parts }); cubes = next; draw(); }
      return;
    }
    if (hit.kind === 'face') {
      const direction = FACE_DIRECTIONS.find((d) => d.key === hit.dir);
      if (!direction) return;
      const next = addCube(cubes, neighborAcross(hit.cube.split(',').map(Number), direction.normal));
      if (next !== cubes) { history.push({ cubes, parts }); cubes = next; draw(); }
      return;
    }
    const [x, z] = hit.cell.split(',').map(Number);
    const next = addCube(cubes, [x, 0, z]);
    if (next !== cubes) { history.push({ cubes, parts }); cubes = next; draw(); }
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
    if (source === 'shapes') return;
    if (hit?.kind === 'face') {
      const next = removeCube(cubes, hit.cube.split(',').map(Number));
      if (next !== cubes) { history.push({ cubes, parts }); cubes = next; draw(); }
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
    const isShapes = source === 'shapes';
    const isParts = source === 'parts';
    // 方块模式：空立体是合法状态（刚清空），几何层不接受空数组，所以单独处理
    const cubeViews = !isShapes && !isParts && cubes.length > 0 ? orthoViews(cubes) : null;
    const shapeViewData = isShapes ? solidViews(shapeId) : null;
    const shape = isShapes ? SOLID_BY_ID[shapeId] : null;
    const partViewData = isParts && parts.length > 0 ? compositeViews(parts) : null;

    for (const [key, button] of tabButtons) button.setAttribute('aria-pressed', String(key === tab));
    for (const [key, button] of sourceButtons) button.setAttribute('aria-pressed', String(key === source));
    for (const [key, button] of modeButtons) button.setAttribute('aria-pressed', String(key === mode));
    for (const [key, button] of shapeButtons) button.setAttribute('aria-pressed', String(key === shapeId));
    for (const [key, button] of partButtons) button.setAttribute('aria-pressed', String(key === partId));
    modes.hidden = isShapes || isParts; // 加/删方块只对「自由搭建」有意义
    actions.hidden = isShapes; // 撤销 / 清空：方块与组合体都有意义
    gallery.hidden = !isShapes;
    palette.hidden = !isParts;
    hint.textContent = isShapes
      ? '拖动可旋转观察方向，点上面一排几何体换一个。三个视图由立体本身决定——转动观察方向，它们不会变。'
      : isParts
        ? '点地面的格子放置部件，点已有部件把它叠在上面（x / z 方向自动对齐）；拖动可旋转观察方向。'
          + '三个视图由组合体本身决定——转动观察方向，它们不会变。'
        : '拖动可旋转观察方向；点某个面在那一侧加方块，点地面在地面加方块。'
          + '三个视图由立体本身决定——转动观察方向，它们不会变。';

    canvas.replaceChildren();
    if (isParts) {
      canvas.append(tab === 'solid' || !partViewData
        ? renderCompositeScene(parts, { yaw: view.yaw, pitch: view.pitch, width: 260, height: 240 })
        : renderCompositeView(partViewData[tab], { cell: CELL }));
    } else if (isShapes) {
      canvas.append(tab === 'solid'
        ? renderSolidRotated(shapeId, { yaw: view.yaw, pitch: view.pitch, width: 260, height: 240 })
        : renderShape(shapeViewData[tab], { unit: 46 }));
    } else if (tab === 'solid' || !cubeViews) {
      canvas.append(renderSolidScene(cubes, { yaw: view.yaw, pitch: view.pitch }));
    } else {
      const big = renderGridView(cubeViews[tab], { cell: CELL, className: 'builder-view-cell' });
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
      if (isParts) {
        if (partViewData) {
          cell.append(renderCompositeView(partViewData[name], { cell: 20, pad: 6 }));
        } else {
          const empty = doc.createElement('div');
          empty.className = 'builder-strip-empty';
          empty.textContent = '还没有部件';
          cell.append(empty);
        }
      } else if (isShapes) {
        cell.append(renderShape(shapeViewData[name], { unit: 18, pad: 6 }));
      } else if (cubeViews) {
        cell.append(renderGridView(cubeViews[name], { cell: 22, pad: 4, className: 'builder-view-cell' }));
      } else {
        const empty = doc.createElement('div');
        empty.className = 'builder-strip-empty';
        empty.textContent = '还没有方块';
        cell.append(empty);
      }
      strip.append(cell);
    }

    if (isParts) {
      const counts = new Map();
      for (const part of parts) counts.set(part.id, (counts.get(part.id) ?? 0) + 1);
      const list = [...counts.entries()].map(([id, n]) => `${PART_BY_ID[id].name}×${n}`).join('、');
      status.textContent = parts.length === 0
        ? `当前选中：${PART_BY_ID[partId].name}——点地面上的格子开始拼`
        : `当前有 ${parts.length} 个部件：${list}`;
      canvas.setAttribute('aria-label', parts.length === 0
        ? `组合体画布：还没有部件。当前选中${PART_BY_ID[partId].name}，点地面上的格子开始拼。`
        : `组合体画布：${list}。主视图 ${partViewData.front.cols} 列 ${partViewData.front.rows} 行。`
          + `俯视图 ${partViewData.top.cols} 列 ${partViewData.top.rows} 行。`
          + `左视图 ${partViewData.left.cols} 列 ${partViewData.left.rows} 行。拖动或方向键旋转观察方向。`);
      return;
    }

    if (isShapes) {
      status.textContent = `当前：${shape.name}`;
      canvas.setAttribute('aria-label',
        `${shape.name}的立体图形画布。主视图${shapeLabel(shapeViewData.front)}。`
        + `俯视图${shapeLabel(shapeViewData.top)}。左视图${shapeLabel(shapeViewData.left)}。`
        + '拖动或方向键旋转观察方向。');
      return;
    }

    const total = cubes.length;
    status.textContent = `当前有 ${total} 个小方块` + (total === 0 ? '——点地面上的格子开始搭' : '');
    canvas.setAttribute('aria-label', total === 0
      ? '立体图形画布：还没有方块，点地面上的格子开始搭。'
      : `立体图形画布：当前 ${total} 个小方块。${VIEW_LABELS.front}${describeView(cubeViews.front)}。`
        + `${VIEW_LABELS.top}${describeView(cubeViews.top)}。${VIEW_LABELS.left}${describeView(cubeViews.left)}。`
        + '拖动或方向键旋转观察方向。');
  }

  function setSource(next) {
    if (!['cubes', 'shapes', 'parts'].includes(next) || next === source) return;
    source = next;
    draw();
  }

  function setPart(next) {
    if (!PART_BY_ID[next]) return;
    partId = next;
    draw();
  }

  function setShape(next) {
    if (!SOLID_BY_ID[next]) return;
    shapeId = next;
    draw();
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
    history.push({ cubes, parts });
    if (source === 'parts') parts = [];
    else cubes = [];
    draw();
  }
  function setCubes(next) {
    if (!Array.isArray(next)) return;
    history.push({ cubes, parts });
    cubes = next.map((cube) => [...cube]);
    draw();
  }

  draw();

  return {
    setCubes,
    getCubes: () => cubes.map((cube) => [...cube]),
    setTab,
    setMode,
    setSource,
    setShape,
    setPart,
    placePart: (id, at) => {
      const previous = partId;
      if (PART_BY_ID[id]) partId = id;
      const ok = placePartAt(at);
      partId = previous;
      return ok;
    },
    getParts: () => parts.map((part) => ({ id: part.id, at: [...part.at] })),
    clear,
    get view() { return { ...view }; },
    get source() { return source; },
    get shape() { return shapeId; },
    get part() { return partId; },
    root: host,
    destroy() { host.remove(); }
  };
}

export default { mountSolidBuilder, renderSolidScene, renderGridView, orbit, MAX_SIZE, DEFAULT_VIEW };
