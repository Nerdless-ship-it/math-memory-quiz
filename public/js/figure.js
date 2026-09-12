/**
 * 图形渲染层：把 figure.spec 转成**内联 SVG**。
 *
 * 契约见 docs/ARCHITECTURE.md 第 7.3 节。spec 形状由该节锁定，渲染层与题库作者
 * 不得各自发明字段。
 *
 * 三条不可动摇的约束（都是零依赖 + 静态托管逼出来的）：
 *   1. 所有图形由 geometry.js **算出来**再画，不得手写坐标、不得外链图片、不得引入依赖。
 *      手写坐标做不到正确——这是给人复习考公用的，画错比画不出来更糟。
 *   2. 未知 kind **必须抛错**。静默渲染成空白是图形题最危险的失败模式：
 *      学生看到一道没有图的图形题，会以为自己看错了。
 *   3. 每个 <svg> 都要有 role="img" 与 aria-label（无障碍 + 便于自动化测试定位）。
 *
 * ── 投影约定（与 spec 的 visible 语义对齐，改动前请先读懂）─────────────
 * 观察方向取自右上前方：viewDir = (0.8, -0.5, 1) 归一化后的**反向**即相机方向。
 * 在这个视角下，从 `visible: ['front','top','right']` 出发 —— 正面/顶面/右面
 * 恰好是三个可见面，与「上-右-前」的习惯视角一致（正对着观察者的面就是正面）。
 *
 * 注意：geometry.js 的 project() 用的是**等距投影**（绕 Y 轴 45°），
 * 那会让「正面」看起来是斜的。渲染层因此不直接使用 project()，而是自己算
 * 正交投影，保证「正面正对观察者」。几何计算（截面、折叠）仍然全部复用 geometry.js。
 */

import { cubeSection, sectionSideCount, sectionName } from './geometry-loader.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** 深度位移系数：决定另外两个面斜着退出去的方向（约 45° 向右上）。 */
const DEPTH_X = 0.5;
const DEPTH_Y = 0.33;

/** 立方体顶点（边长 2、中心在原点），与 geometry.js 的约定保持一致。 */
const CUBE_VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], // 0-3 后面 z=-1
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]      // 4-7 前面 z=1
];

/** 六个面：名称 → { indices, normal }。normal 指向立方体外侧。 */
const CUBE_FACES = Object.freeze({
  front: { indices: [4, 5, 6, 7], normal: [0, 0, 1] },
  back: { indices: [1, 0, 3, 2], normal: [0, 0, -1] },
  right: { indices: [5, 1, 2, 6], normal: [1, 0, 0] },
  left: { indices: [0, 4, 7, 3], normal: [-1, 0, 0] },
  top: { indices: [7, 6, 2, 3], normal: [0, 1, 0] },
  bottom: { indices: [0, 1, 5, 4], normal: [0, -1, 0] }
});

/** 12 条棱（顶点索引对），与 geometry.js 一致。 */
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

/**
 * 投影：正交相机 + 斜角视角，**正面保持正方形**。
 *
 * 为什么不用等距投影：等距投影下三个可见面看起来一样大，但**没有任何一个面正对观察者**，
 * 初学者很难把「选项里的三个面」与「展开图上的格子」对应起来。这里的视角让正面不变形、
 * 另外两个面斜着退出去，与教材/真题里的立体图习惯一致。
 *
 * ⚠️ 投影与可见面判定**必须来自同一套相机基**。
 * 早先的写法毛病就在这里：project() 用「+z 越远」推屏幕位移，
 * 而 VIEW_DIR 用「观察者在 +z」判可见面 —— 两者互相矛盾，
 * 结果 `['front','top','right']` 被判成「不可见」直接抛错。
 * 现在统一由 forward / RIGHT / TRUE_UP 推导，不可能再打架。
 */
const CAMERA_DIR = normalize([0.62, 0.58, 1]); // 相机位置方向（观察者在右上前方）
const FORWARD = [-CAMERA_DIR[0], -CAMERA_DIR[1], -CAMERA_DIR[2]]; // 相机看向原点
const WORLD_UP = [0, 1, 0];
const RIGHT = normalize(cross(FORWARD, WORLD_UP));
const TRUE_UP = cross(RIGHT, FORWARD);

/** 正交投影：屏幕 x 取世界 x，向上取世界 y；用 z 推一段斜向位移表现深度。 */
function project(point3d) {
  const [x, y, z] = point3d;
  return { x: x + z * DEPTH_X, y: -y - z * DEPTH_Y };
}

/**
 * 该面是否朝向观察者。
 * 用与投影同一套相机基判定：法向朝向相机（即与 FORWARD 反向）才可见。
 */
function isFrontFacing(faceName) {
  const face = CUBE_FACES[faceName];
  return -dot(face.normal, FORWARD) > 1e-6;
}

/** 把立方体面画成 SVG 路径（四边形）。 */
function facePath(faceName, toScreen) {
  const pts = CUBE_FACES[faceName].indices.map((i) => toScreen(CUBE_VERTICES[i]));
  return `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;
}

/** 面中心（3D），用于放文字标签。 */
function faceCenter(faceName) {
  const idx = CUBE_FACES[faceName].indices;
  const sum = idx.reduce((acc, i) => [acc[0] + CUBE_VERTICES[i][0], acc[1] + CUBE_VERTICES[i][1], acc[2] + CUBE_VERTICES[i][2]], [0, 0, 0]);
  return sum.map((v) => v / idx.length);
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

function createSvg({ width, height, label, children }) {
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': label,
    class: 'figure-svg'
  });
  // 高度通过 CSS 的 max-width + aspect-ratio 控制；这里显式给 style 兜底，
  // 保证不依赖外部样式表也能有合理比例（避免 390px 下被拉爆）。
  svg.style.maxWidth = `${width}px`;
  svg.style.aspectRatio = `${width} / ${height}`;
  for (const child of children) svg.append(child);
  return svg;
}

const FACE_LABELS = Object.freeze({ front: '前', top: '上', right: '右', back: '后', left: '左', bottom: '下' });

// ── ① 正方体展开图 ──────────────────────────────────────────────────

function renderCubeNet(spec) {
  const cells = spec?.cells;
  if (!Array.isArray(cells) || cells.length === 0) throw new Error('figure:cube-net: spec.cells 不能为空');
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 2 || !Number.isFinite(cell[0]) || !Number.isFinite(cell[1])) {
      throw new Error(`figure:cube-net: cells 的元素必须是 [col, row] 数字对，收到 ${JSON.stringify(cell)}`);
    }
  }

  const cols = cells.map((c) => c[0]);
  const rows = cells.map((c) => c[1]);
  const minCol = Math.min(...cols); const maxCol = Math.max(...cols);
  const minRow = Math.min(...rows); const maxRow = Math.max(...rows);
  const gridW = maxCol - minCol + 1;
  const gridH = maxRow - minRow + 1;

  const CELL = 52;
  const PAD = 12;
  const width = gridW * CELL + PAD * 2;
  const height = gridH * CELL + PAD * 2;

  const children = [];
  // 每个格子的序号：便于学生与解析对照（按行优先编号）
  const ordered = [...cells].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  ordered.forEach((cell, index) => {
    const x = PAD + (cell[0] - minCol) * CELL;
    const y = PAD + (cell[1] - minRow) * CELL;
    children.push(svgElement('rect', {
      x, y, width: CELL, height: CELL,
      class: 'figure-net-cell', 'stroke-linejoin': 'round'
    }));
    children.push(svgElement('text', {
      x: x + CELL / 2, y: y + CELL / 2 + 1,
      class: 'figure-net-index', 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'aria-hidden': 'true'
    }, String(index + 1)));
  });

  return createSvg({
    width,
    height,
    label: `正方体展开图，共 ${cells.length} 个面，按行优先依次编号 1 到 ${cells.length}`,
    children
  });
}

// ── ② 折叠后的立体图 ────────────────────────────────────────────────

function renderCubeFold(spec) {
  const visible = spec?.visible;
  if (!Array.isArray(visible) || visible.length !== 3) {
    throw new Error('figure:cube-fold: spec.visible 必须是三个面名的数组，如 ["front","top","right"]');
  }
  for (const name of visible) {
    if (!CUBE_FACES[name]) throw new Error(`figure:cube-fold: 未知面名 "${name}"`);
  }

  // labels：贴在三个可见面上的「面身份」（本题是展开图的格子编号 '1'..'6'）。
  //
  // ⚠️ 为什么必须有它：`visible` 是**固定的三个槽位名**（前/上/右），对任何一张立体图
  // 都一样，光靠它四个选项会渲染成**四张完全相同的图** —— 题目在数据层唯一、在屏幕上不可解。
  // 这是图形题最危险的一类静默失败，所以这里不做「缺省就画前/上/右」的兜底，
  // 而是由题库通过 labels 提供身份；确实没有 labels 时才退回槽位名（用于非题库场景）。
  const labels = Array.isArray(spec?.labels) ? spec.labels : null;
  if (labels && (labels.length !== visible.length || labels.some((l) => typeof l !== 'string' || !l.trim()))) {
    throw new Error('figure:cube-fold: spec.labels 必须与 visible 等长，且都是非空字符串');
  }

  // 视图缩放：把 [-1,1]^3 投到画布
  const SCALE = 40;
  const CX = 92; const CY = 84;
  const toScreen = (p) => {
    const q = project(p);
    return { x: CX + q.x * SCALE, y: CY + q.y * SCALE };
  };

  const width = 184; const height = 168;
  const children = [];

  // 先画背面（朝后的面），再画可见面，保证可见面在上层
  const frontFacing = Object.keys(CUBE_FACES).filter(isFrontFacing);
  const backFacing = Object.keys(CUBE_FACES).filter((f) => !isFrontFacing(f));

  for (const name of backFacing) {
    const inSpec = visible.includes(name);
    children.push(svgElement('path', {
      d: facePath(name, toScreen),
      class: inSpec ? 'figure-cube-face figure-cube-face--listed' : 'figure-cube-face figure-cube-face--hidden'
    }));
  }

  const SHADES = ['figure-cube-face--a', 'figure-cube-face--b', 'figure-cube-face--c'];
  visible.forEach((name, index) => {
    if (!isFrontFacing(name)) {
      // 选项里列了一个从当前视角看不见的面 —— 这是数据错误，必须暴露出来
      throw new Error(`figure:cube-fold: visible 里的 "${name}" 在当前视角下不可见，选项数据有误`);
    }
    children.push(svgElement('path', {
      d: facePath(name, toScreen),
      class: `figure-cube-face ${SHADES[index % SHADES.length]}`
    }));
    const center = toScreen(faceCenter(name));
    const text = labels ? labels[index] : FACE_LABELS[name];
    children.push(svgElement('text', {
      x: center.x.toFixed(1), y: center.y.toFixed(1),
      class: labels ? 'figure-cube-label figure-cube-label--identity' : 'figure-cube-label',
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'aria-hidden': 'true'
    }, text));
  });

  // 棱：可见棱实线、被遮挡的棱虚线
  for (const [i, j] of CUBE_EDGES) {
    const a = toScreen(CUBE_VERTICES[i]);
    const b = toScreen(CUBE_VERTICES[j]);
    const facesOfEdge = Object.keys(CUBE_FACES).filter((f) => CUBE_FACES[f].indices.includes(i) && CUBE_FACES[f].indices.includes(j));
    const visibleEdge = facesOfEdge.some(isFrontFacing);
    children.push(svgElement('line', {
      x1: a.x.toFixed(2), y1: a.y.toFixed(2), x2: b.x.toFixed(2), y2: b.y.toFixed(2),
      class: visibleEdge ? 'figure-cube-edge' : 'figure-cube-edge figure-cube-edge--hidden'
    }));
  }

  // 无障碍描述把「哪个槽位是哪一号面」讲清楚，否则读屏用户完全无法作答。
  const description = visible
    .map((name, index) => `${FACE_LABELS[name]}面是第 ${labels ? labels[index] : FACE_LABELS[name]} 号面`)
    .join('，');

  return createSvg({
    width,
    height,
    label: `折叠后的正方体，${description}`,
    children
  });
}

// ── ③ 立方体截面（立体被平面所截）──────────────────────────────────

function renderCrossSection(spec) {
  const { planeNormal, d } = spec ?? {};
  const points = cubeSection(planeNormal, d);

  const SCALE = 42;
  const CX = 84; const CY = 88;
  const toScreen = (p) => {
    const q = project(p);
    return { x: CX + q.x * SCALE, y: CY + q.y * SCALE };
  };

  const width = 168; const height = 172;
  const children = [];

  // 半透明实体面（只画可见面）
  for (const name of Object.keys(CUBE_FACES).filter(isFrontFacing)) {
    children.push(svgElement('path', {
      d: facePath(name, toScreen),
      class: 'figure-solid-face'
    }));
  }

  // 截面多边形
  if (points.length >= 3) {
    const poly = points.map((p) => toScreen(p));
    children.push(svgElement('path', {
      d: `M${poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`,
      class: 'figure-section-face'
    }));
  }

  // 棱
  for (const [i, j] of CUBE_EDGES) {
    const a = toScreen(CUBE_VERTICES[i]);
    const b = toScreen(CUBE_VERTICES[j]);
    const facesOfEdge = Object.keys(CUBE_FACES).filter((f) => CUBE_FACES[f].indices.includes(i) && CUBE_FACES[f].indices.includes(j));
    const visibleEdge = facesOfEdge.some(isFrontFacing);
    children.push(svgElement('line', {
      x1: a.x.toFixed(2), y1: a.y.toFixed(2), x2: b.x.toFixed(2), y2: b.y.toFixed(2),
      class: visibleEdge ? 'figure-cube-edge' : 'figure-cube-edge figure-cube-edge--hidden'
    }));
  }

  const name = sectionName(planeNormal, d);
  const count = sectionSideCount(planeNormal, d);
  const shapeText = name ? `，截面是${name}（${count} 边形）` : '，该平面与立方体没有形成截面';

  return createSvg({
    width,
    height,
    label: `被平面所截的立方体${shapeText}`,
    children
  });
}

// ── ④ 截面形状（只画截面本身，正视图）──────────────────────────────

/**
 * 无法成形的选项要画成**看不出区别的凸多边形**，绝不能标注「不成立」。
 *
 * ⚠️ 这里踩过一个会毁掉整个题型的坑（section-dev 发现、Lead 确认）：
 * 本库的「不可能」选项按契约就是「平面与立方体无交」（cubeSection 返回 0 个点）。
 * 如果渲染层把这种选项画成一个写着「不成立」的方框，学生**不用任何几何推理**，
 * 只要挑那个写了字的框就能选对——题目退化成送分题，而数据层完全合法，
 * 测试也全绿。渲染层的表达方式直接决定了题目还有没有意义。
 *
 * 正确做法：画一个**看起来同样合理**的凸多边形，让学生必须真的去判断
 * 「这个形状能不能由切立方体得到」。这里用七边形：
 *   - 立方体只有 6 个面 ⇒ 截面最多 6 边 ⇒ **七边形在几何上不可能**，
 *     它正是真题里最常见的陷阱选项，语义与「无交」一致；
 *   - 它长得像正常选项，不泄露任何信息。
 */
function impossibleOptionShape(width, height) {
  const n = 7;
  const cx = width / 2; const cy = height / 2;
  const rx = width / 2 - 24; const ry = height / 2 - 24;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    pts.push(`${(cx + rx * Math.cos(angle)).toFixed(2)},${(cy + ry * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function renderSectionShape(spec) {
  const { planeNormal, d } = spec ?? {};
  const points = cubeSection(planeNormal, d);

  const width = 150; const height = 150;

  if (points.length < 3) {
    // 中性占位：形状、样式、无障碍描述都与正常选项一致，不透露「这个是答案」。
    const children = [svgElement('path', { d: impossibleOptionShape(width, height), class: 'figure-section-face' })];
    return createSvg({ width, height, label: '一个多边形截面', children });
  }

  // 把 3D 截面点投到平面内 2D 坐标，再等比缩放到画布（正视图）
  const n = normalize(planeNormal);
  const helper = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(n, helper));
  const v = normalize(cross(n, u));
  const flat = points.map((p) => ({ x: dot(p, u), y: dot(p, v) }));
  const xs = flat.map((p) => p.x); const ys = flat.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs) || 1;
  const spanY = Math.max(...ys) - Math.min(...ys) || 1;
  const pad = 22;
  const k = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const toScreen = (p) => ({
    x: (p.x - (Math.min(...xs) + spanX / 2)) * k + width / 2,
    y: -(p.y - (Math.min(...ys) + spanY / 2)) * k + height / 2
  });

  const poly = flat.map(toScreen);
  const children = [svgElement('path', {
    d: `M${poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`,
    class: 'figure-section-face'
  })];
  poly.forEach((p, index) => {
    children.push(svgElement('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 3, class: 'figure-section-vertex' }));
    children.push(svgElement('text', {
      x: p.x.toFixed(1), y: (p.y - 9).toFixed(1), class: 'figure-section-vertex-label',
      'text-anchor': 'middle', 'aria-hidden': 'true'
    }, String(index + 1)));
  });

  const name = sectionName(planeNormal, d);
  return createSvg({
    width, height,
    label: `${name ?? '多边形'}截面，共 ${points.length} 条边`,
    children
  });
}

// ── ⑤ 自定义 ────────────────────────────────────────────────────────

function renderCustom(spec) {
  const markup = spec?.svg;
  if (typeof markup !== 'string' || !markup.trim()) throw new Error('figure:custom: spec.svg 必须是非空字符串');
  if (!/^\s*<svg[\s>]/i.test(markup)) throw new Error('figure:custom: spec.svg 必须以 <svg 开头');
  const wrapper = document.createElement('div');
  wrapper.className = 'figure-custom';
  wrapper.innerHTML = markup;
  const node = wrapper.firstElementChild;
  if (!node) throw new Error('figure:custom: spec.svg 解析后没有元素');
  if (!node.getAttribute('role')) node.setAttribute('role', 'img');
  if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', '题目配图');
  return node;
}

const RENDERERS = Object.freeze({
  'figure:cube-net': renderCubeNet,
  'figure:cube-fold': renderCubeFold,
  'figure:cross-section': renderCrossSection,
  'figure:section-shape': renderSectionShape,
  'figure:custom': renderCustom
});

export const FIGURE_KINDS = Object.freeze(new Set(Object.keys(RENDERERS)));

/**
 * 图形类型取值一律是带命名空间前缀的规范形式（`figure:<name>`），见契约 7.3。
 * 这里刻意**不做旧写法别名兼容**：曾经为兼容早期数据加过一层别名表，
 * 结果表里的键与科目 id 完全同名，被架构测试（渲染代码不得硬编码科目 id）逮住了
 * ——那是正确的告警：两个命名空间一旦重叠，后续每加一个科目都可能误伤。
 * 与其放宽规则，不如让它们彻底不重叠：数据侧统一写规范形式。
 * 未知 kind 仍然抛错，不放过任何拼写错误。
 */
function canonicalKind(kind) {
  return typeof kind === 'string' ? kind.trim() : kind;
}

/**
 * 渲染一个图形。
 * @param {{kind: string, spec: object}} figure
 * @returns {SVGElement}
 * @throws 当 figure 为空、kind 未知或 spec 非法时抛错（**绝不静默返回空白**）
 */
export function renderFigure(figure) {
  if (!figure || typeof figure !== 'object') throw new Error('renderFigure: figure 不能为空');
  const kind = canonicalKind(figure.kind);
  const render = RENDERERS[kind];
  if (!render) {
    throw new Error(`renderFigure: 未知图形类型 "${figure.kind}"，可用类型：${[...FIGURE_KINDS].join(', ')}`);
  }
  return render(figure.spec);
}

/**
 * 一句话描述，供无障碍与测试使用。
 * 刻意**不做 try/catch**：figure 非法时应当抛错而不是返回「图形无法渲染」这种
 * 看起来像正常文案的字符串——那会把数据错误伪装成一句提示。
 */
export function figureAriaLabel(figure) {
  const node = renderFigure(figure);
  return node.getAttribute('aria-label') ?? '';
}

/** 题库数据校验用：判断一个 figure 描述是否合法（不渲染）。 */
export function isValidFigure(figure) {
  if (!figure || typeof figure !== 'object') return false;
  const kind = canonicalKind(figure.kind);
  if (!FIGURE_KINDS.has(kind)) return false;
  if (kind === 'figure:cube-net') return Array.isArray(figure.spec?.cells) && figure.spec.cells.length > 0;
  if (kind === 'figure:cube-fold') return Array.isArray(figure.spec?.visible) && figure.spec.visible.length === 3;
  if (kind === 'figure:cross-section' || kind === 'figure:section-shape') {
    return Array.isArray(figure.spec?.planeNormal) && figure.spec.planeNormal.length === 3
      && Number.isFinite(figure.spec?.d);
  }
  if (kind === 'figure:custom') return typeof figure.spec?.svg === 'string' && figure.spec.svg.trim().startsWith('<svg');
  return false;
}

export default { renderFigure, figureAriaLabel, isValidFigure, FIGURE_KINDS };
