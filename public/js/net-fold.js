// 正方体展开图折叠几何 —— 契约见 docs/ARCHITECTURE.md 第 7.4 节。
//
// 纯函数：不碰 DOM、不读 localStorage、零依赖；Node 测试与浏览器渲染共用同一份实现。
//
// ── 算法：滚动立方体（rolling cube）────────────────────────────────────
// 把展开图摊在纸面（z = 0 平面，格坐标 col→+x、row→+y）上，让一只立方体从某一格开始
// 「滚」过每一格：每向相邻格滚一格，就对立方体施加一次 90° 旋转。滚动时立方体的
// 六个「身体面」跟着一起转，于是可以用「滚到该格时，哪个身体面朝下（贴纸面）」
// 唯一确定该格折起来是立方体的哪个面。
//
// 为什么不用硬编码 11 种坐标表：11 种是「忽略旋转与翻转」后的等价类，任何旋转/翻折
// 过的等价形式都必须判为合法。用折叠算法判定，等价形式天然通过；硬编码坐标表则必然
// 漏判。合法性判据只有一条：
//   **6 格连通 + 折叠过程中无自相矛盾 + 6 个身体面互不重复（恰好铺满 6 个朝向）。**
// 这条判据恰好把 35 种六格骨牌里的 11 种选出来（见 test/net-fold.test.mjs 的穷举断言）。
//
// ── 坐标与朝向约定（figure.js 渲染层必须与此一致）─────────────────────
//   cells: [[col, row], ...]，col 向右增大、row 向下增大，恰好 6 格。
//   row 向下的那一格折起来是 +y（即 front 面）。
//   折好的立方体在纸面上方（+z）；贴着纸面的那一格是 cube 的 bottom 面。
//   六个面名与法向：front=+y  back=-y  right=+x  left=-x  top=+z  bottom=-z
//   因此标准观察方向看到的三面就是 ['front', 'top', 'right']（右手系：front × top = right）。
//
// 合法展开图的 (cell → 面) 赋值在不旋转整个立方体的前提下是唯一的；整体旋转立方体
// 相当于把「格子到面」的对应关系复合一个 24 阶旋转群，因此同一组三个面最多有 3 种
// 可行排列（三种循环序），镜像排列（反循环序）不可能出现——这正是 validateNetOption
// 的第二个判据。

/** 立方体六个面的名字。 */
export const FACE_NAMES = Object.freeze(['front', 'back', 'left', 'right', 'top', 'bottom']);

/** 立方体上互为对面的三组面（这是立方体的固有结构，与展开图无关）。 */
export const OPPOSITE_FACE_PAIRS = Object.freeze([
  Object.freeze(['front', 'back']),
  Object.freeze(['top', 'bottom']),
  Object.freeze(['left', 'right'])
]);

/** 立体图选项里三个可见面的固定渲染顺序：前 / 上 / 右（右手系）。 */
export const VISIBLE_SLOTS = Object.freeze(['front', 'top', 'right']);

/** 展开图格子的默认文字标签：第 i 格标 CELL_LABELS[i]（即 1 基编号）。 */
export const CELL_LABELS = Object.freeze(['1', '2', '3', '4', '5', '6']);

// ── 内部常量 ─────────────────────────────────────────────────────────

/** 六个绝对方向（纸面坐标系），索引即状态数组下标。 */
const DIR_NAMES = Object.freeze(['+x', '-x', '+y', '-y', '+z', '-z']);
/** 每个绝对方向在「初始姿态」下对应的身体面。 */
const DIR_FACE = Object.freeze(['right', 'left', 'front', 'back', 'top', 'bottom']);
/** 贴着纸面的方向（滚动时「该格折成哪个面」= 该格处朝下的身体面）。 */
const DOWN_INDEX = 5; // DIR_NAMES[5] === '-z'

/**
 * 滚动一步的置换：next[i] = state[perm[i]]。
 * 例：向 +x（右）滚一格，原本朝上的面转到 +x 侧，原本在 +x 侧的面转到朝下——
 * 于是滚到的新格折出来就是「原来朝 +x 的那个面」。
 * 四张表互为逆运算（right∘left = identity，down∘up = identity），由测试断言。
 */
const ROLL = Object.freeze({
  right: Object.freeze([4, 5, 2, 3, 1, 0]),
  left: Object.freeze([5, 4, 2, 3, 0, 1]),
  down: Object.freeze([0, 1, 4, 5, 3, 2]),
  up: Object.freeze([0, 1, 5, 4, 2, 3])
});

const MOVES = Object.freeze([
  Object.freeze({ dc: 1, dr: 0, roll: 'right' }),
  Object.freeze({ dc: -1, dr: 0, roll: 'left' }),
  Object.freeze({ dc: 0, dr: 1, roll: 'down' }),
  Object.freeze({ dc: 0, dr: -1, roll: 'up' })
]);

/** 面名 → 单位法向（整数分量，validateNetOption 的叉积判据可做精确比较）。 */
const FACE_NORMAL = Object.freeze({
  front: Object.freeze([0, 1, 0]),
  back: Object.freeze([0, -1, 0]),
  right: Object.freeze([1, 0, 0]),
  left: Object.freeze([-1, 0, 0]),
  top: Object.freeze([0, 0, 1]),
  bottom: Object.freeze([0, 0, -1])
});

/** 面名 → 它的对面。 */
const OPPOSITE_OF = Object.freeze({
  front: 'back', back: 'front',
  top: 'bottom', bottom: 'top',
  left: 'right', right: 'left'
});

/** 立方体上互邻的面（既不是自己，也不是自己的对面）。 */
const ADJACENT_OF = Object.freeze(
  Object.fromEntries(FACE_NAMES.map((face) => [
    face,
    Object.freeze(FACE_NAMES.filter((other) => other !== face && other !== OPPOSITE_OF[face]))
  ]))
);

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/**
 * 折叠分析：把 cells 逐格滚一遍，得出「第 i 格 → 立方体哪个面」。
 * 返回 { ok, reason, faces, coords }；faces 与输入等长，失败时可能含 null。
 * reason 取值：'need-6-cells' | 'bad-cell' | 'duplicate-cell' | 'disconnected'
 *              | 'fold-conflict' | 'face-overlap'（ok 时为 null）
 */
function analyze(cells) {
  // faces 必须与输入等长（契约：foldNet 的 faces 与 cells 等长），
  // 即使输入本身连数组都不是也要给出一个数组，避免调用方拿到 null。
  const blanks = Array.isArray(cells) ? cells.map(() => null) : [];
  const fail = (reason, faces = blanks, coords = null) => ({ ok: false, reason, faces, coords });

  if (!Array.isArray(cells) || cells.length !== 6) return fail('need-6-cells');

  const coords = [];
  const indexByKey = new Map();
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (!Array.isArray(cell) || cell.length !== 2) return fail('bad-cell');
    const col = cell[0];
    const row = cell[1];
    if (!Number.isInteger(col) || !Number.isInteger(row)) return fail('bad-cell');
    const key = `${col},${row}`;
    if (indexByKey.has(key)) return fail('duplicate-cell');
    indexByKey.set(key, i);
    coords.push([col, row]);
  }

  const faces = new Array(6).fill(null);
  const states = new Array(6).fill(null);
  const visited = new Array(6).fill(false);
  const queue = [0];
  let reached = 1;

  visited[0] = true;
  states[0] = DIR_FACE.slice();
  faces[0] = states[0][DOWN_INDEX]; // 起始格 = 立方体贴着纸面的那个面

  while (queue.length > 0) {
    const u = queue.shift();
    const state = states[u];
    const [col, row] = coords[u];
    for (const move of MOVES) {
      const v = indexByKey.get(`${col + move.dc},${row + move.dr}`);
      if (v === undefined) continue;
      const perm = ROLL[move.roll];
      const rolled = [state[perm[0]], state[perm[1]], state[perm[2]],
        state[perm[3]], state[perm[4]], state[perm[5]]];
      const face = rolled[DOWN_INDEX];
      if (!visited[v]) {
        visited[v] = true;
        reached += 1;
        states[v] = rolled;
        faces[v] = face;
        queue.push(v);
      } else if (faces[v] !== face) {
        // 同一格被两条不同路径滚到，却给出了不同的面 —— 这张图折不成立方体
        // （2×2 方块之类含环的布局会走到这里）。
        return fail('fold-conflict', faces, coords);
      }
    }
  }

  if (reached !== 6) return fail('disconnected', faces, coords);
  if (new Set(faces).size !== 6) return fail('face-overlap', faces, coords);
  return { ok: true, reason: null, faces, coords };
}

/**
 * 把一个「格子引用」解析成 0 基下标。**数字与字符串含义不同，务必按下面的规则用**：
 *   数字 0..5   → 0 基下标（JS 侧最自然的写法，也是本模块所有返回值的口径）
 *   '1'..'6'   → spec 里的格子标签，= 下标 + 1（item 数据与 figure.spec 的口径）
 *   'A'..'F'   → 0 基下标的字母写法
 * 非法返回 -1。
 */
function labelToIndex(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 5 ? value : -1;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^[1-6]$/.test(text)) return Number(text) - 1;
    if (/^[A-Fa-f]$/.test(text)) return text.toUpperCase().charCodeAt(0) - 65;
  }
  return -1;
}

/**
 * 把格子引用解析成 0 基下标：数字 / '1'..'6' / 'A'..'F' = 格子；[col, row] = 坐标。
 * 非法返回 -1。
 */
function cellRefToIndex(cells, ref) {
  if (Array.isArray(ref)) {
    if (ref.length !== 2) return -1;
    return cells.findIndex((cell) => cell[0] === ref[0] && cell[1] === ref[1]);
  }
  return labelToIndex(ref);
}

function isFaceName(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FACE_NORMAL, value);
}

/**
 * 归一化「三个可见面」选项，返回 0 基格子下标数组，或 null（形状不合法）。
 *
 * 支持四种写法，前两种是推荐写法：
 *   A. { visible: ['front','top','right'], labels: ['3','1','5'] }
 *      —— **推荐**：figure.js 的规范 spec。visible 是固定的三个槽位名，
 *         labels[i] 是贴在槽位 visible[i] 上的**展开图格子编号**。
 *   B. ['1','3','5'] / [0, 2, 4]
 *      —— 紧凑写法，直接按 [前, 上, 右] 给格子编号。
 *   C. { visible: ['1','3','5'] }
 *      —— 紧凑写法塞进 spec（visible 里放编号而不是槽位名）。
 *   D. { front: '1', top: '3', right: '5' }
 *
 * 数字一律是 0 基下标，字符串 '1'..'6' 一律是格子编号（= 下标 + 1），'A'..'F' 是下标字母写法。
 */
function normalizeVisibleTriple(option) {
  const toIndexes = (list) => {
    if (!Array.isArray(list) || list.length !== 3) return null;
    const indexes = [];
    for (const entry of list) {
      const index = labelToIndex(entry);
      if (index < 0) return null;
      indexes.push(index);
    }
    return indexes;
  };

  if (Array.isArray(option)) return toIndexes(option);
  if (!option || typeof option !== 'object') return null;

  const visible = Array.isArray(option.visible) ? option.visible : null;
  if (visible && visible.length === 3 && visible.every(isFaceName)) {
    // 形式 A：visible 是槽位名，身份在 labels 里。必须恰好覆盖前/上/右三个槽位。
    const bySlot = new Map();
    for (const slot of visible) {
      if (bySlot.has(slot)) return null; // 同一槽位写了两次
      bySlot.set(slot, true);
    }
    if (!VISIBLE_SLOTS.every((slot) => bySlot.has(slot))) return null;
    const labels = option.labels;
    if (!Array.isArray(labels) || labels.length !== 3) return null;
    const ordered = [];
    for (const slot of VISIBLE_SLOTS) {
      ordered.push(labels[visible.indexOf(slot)]);
    }
    return toIndexes(ordered);
  }
  if (visible) return toIndexes(visible);
  if (VISIBLE_SLOTS.every((slot) => option[slot] !== undefined)) {
    return toIndexes(VISIBLE_SLOTS.map((slot) => option[slot]));
  }
  return null;
}

/** 三个格子（0 基下标）能否作为「前 / 上 / 右」同时出现。faces 为折叠结果。 */
function isVisibleTriple(faces, indexes) {
  if (!Array.isArray(indexes) || indexes.length !== 3) return false;
  if (new Set(indexes).size !== 3) return false;
  if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= faces.length)) return false;
  const [front, top, right] = indexes.map((i) => faces[i]);
  if (!front || !top || !right) return false;
  // 判据一：三个可见面两两相邻（不能有两个是相对面——相对面永远不可能同时可见）。
  if (OPPOSITE_OF[front] === top || OPPOSITE_OF[front] === right || OPPOSITE_OF[top] === right) {
    return false;
  }
  // 判据二：手性。观察者看到的是标准右手系视图（front × top = right），
  // 而立方体只能整体旋转（旋转保手性），所以镜像排列折不出来。
  const expected = cross3(FACE_NORMAL[front], FACE_NORMAL[top]);
  const actual = FACE_NORMAL[right];
  return expected[0] === actual[0] && expected[1] === actual[1] && expected[2] === actual[2];
}

// ── 对外 API ─────────────────────────────────────────────────────────

/**
 * 把展开图折成立方体。
 *
 * @param {Array<[number, number]>} cells 恰好 6 个 [col, row] 坐标
 * @returns {{
 *   ok: boolean,                            // 折叠成功且 6 个面恰好铺满 6 个朝向
 *   reason: string|null,                    // 失败原因代码，ok 时为 null
 *   faces: (string|null)[],                 // 与 cells 等长：第 i 格折到哪个面
 *   byFace: Record<string, number>          // 面名 → 格子下标；未覆盖的面为 -1
 * }}
 */
export function foldNet(cells) {
  const result = analyze(cells);
  const byFace = {};
  for (const name of FACE_NAMES) byFace[name] = -1;
  if (result.ok) {
    result.faces.forEach((name, index) => {
      byFace[name] = index;
    });
  }
  return Object.freeze({
    ok: result.ok,
    reason: result.reason,
    faces: Object.freeze(result.faces.slice()),
    byFace: Object.freeze(byFace)
  });
}

/**
 * foldNet 的瘦身版：只要「第 i 格 → 面名」的数组。
 * 非法展开图返回 6 个 null。
 */
export function foldFaces(cells) {
  return foldNet(cells).faces;
}

/**
 * 该展开图折叠后的三组对面（格子下标，0 基）。
 * 合法展开图**恰好返回 3 组**：两两不重复、恰好覆盖 6 个格子；非法布局返回 []。
 * 每组内部升序，组间按首元素升序，保证确定性。
 */
export function oppositePairs(cells) {
  const folded = foldNet(cells);
  if (!folded.ok) return [];
  const pairs = [];
  for (const [a, b] of OPPOSITE_FACE_PAIRS) {
    const i = folded.byFace[a];
    const j = folded.byFace[b];
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0) return [];
    pairs.push(i < j ? [i, j] : [j, i]);
  }
  return pairs.sort((p, q) => p[0] - q[0]);
}

/** 是否合法展开图（等价于「折叠后 6 个面互不重叠且恰好铺满」）。 */
export function isValidNet(cells) {
  return analyze(cells).ok;
}

/**
 * 该展开图里两格在**纸面上**是否共享一条边（即展开图意义上的相邻）。
 * a / b 可为 0 基下标、1..6 的标签、'A'..'F'，或 [col, row] 坐标。
 */
export function isAdjacentInNet(cells, a, b) {
  if (!Array.isArray(cells)) return false;
  const i = cellRefToIndex(cells, a);
  const j = cellRefToIndex(cells, b);
  if (i < 0 || j < 0 || i === j) return false;
  const [ca, ra] = cells[i];
  const [cb, rb] = cells[j];
  return Math.abs(ca - cb) + Math.abs(ra - rb) === 1;
}

/**
 * 两个**面名**在立方体上是否互为对面。
 * 注意：这是立方体的固有结构（front↔back / top↔bottom / left↔right），
 * 与展开图无关，所以不需要传 cells。
 */
export function isOppositeInCube(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && a !== b && OPPOSITE_OF[a] === b;
}

/**
 * 面之间的相对关系（供干扰项判定与渲染层使用）。
 *
 * @returns {{
 *   ok: boolean,
 *   reason: string|null,
 *   faces: (string|null)[],                 // 格子下标 → 面名
 *   byFace: Record<string, number>,         // 面名 → 格子下标（-1 = 未覆盖）
 *   opposite: number[][],                   // 3 组对面（格子下标）
 *   adjacent: number[][],                   // 12 组互邻（格子下标）
 *   oppositeFaces: string[][],              // 3 组面名的对面
 *   cornerTriples: number[][],              // 8 组「三面共角」的格子组合（升序）
 *   visibleIndexes: number[][]              // 8 角 × 3 = 24 组可成立的 [前,上,右] 有序三元组
 * }}
 */
export function relativeFaces(cells) {
  const folded = foldNet(cells);
  const empty = Object.freeze({
    ok: false,
    reason: folded.reason,
    faces: folded.faces,
    byFace: folded.byFace,
    opposite: Object.freeze([]),
    adjacent: Object.freeze([]),
    oppositeFaces: Object.freeze(OPPOSITE_FACE_PAIRS.map((pair) => pair.slice())),
    cornerTriples: Object.freeze([]),
    visibleIndexes: Object.freeze([])
  });
  if (!folded.ok) return empty;

  const opposite = oppositePairs(cells);
  const adjacent = [];
  for (let i = 0; i < 6; i += 1) {
    for (let j = i + 1; j < 6; j += 1) {
      if (ADJACENT_OF[folded.faces[i]].includes(folded.faces[j])) adjacent.push([i, j]);
    }
  }
  // 8 个角：从三组对面里各挑一个面，三面必然共角。
  const cornerTriples = [];
  for (const pick of [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]) {
    const triple = [
      opposite[0][pick[0]],
      opposite[1][pick[1]],
      opposite[2][pick[2]]
    ].sort((x, y) => x - y);
    cornerTriples.push(triple);
  }
  cornerTriples.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));

  const visibleIndexes = visibleOptions(cells);

  return Object.freeze({
    ok: true,
    reason: null,
    faces: folded.faces,
    byFace: folded.byFace,
    opposite: Object.freeze(opposite.map((pair) => Object.freeze(pair))),
    adjacent: Object.freeze(adjacent.map((pair) => Object.freeze(pair))),
    oppositeFaces: Object.freeze(OPPOSITE_FACE_PAIRS.map((pair) => pair.slice())),
    cornerTriples: Object.freeze(cornerTriples.map((triple) => Object.freeze(triple))),
    visibleIndexes: Object.freeze(visibleIndexes.map((triple) => Object.freeze(triple)))
  });
}

/**
 * 判定一个立体图选项能否由该展开图折成。
 *
 * @param {Array<[number, number]>} cells  展开图（必须本身是合法展开图）
 * @param {Array|object} option            三个可见面，见 normalizeVisibleTriple 的四种写法；
 *                                         推荐 { visible: ['front','top','right'], labels: ['3','1','5'] }
 * @returns {boolean}
 */
export function validateNetOption(cells, option) {
  const folded = foldNet(cells);
  if (!folded.ok) return false;
  const indexes = normalizeVisibleTriple(option);
  if (!indexes) return false;
  return isVisibleTriple(folded.faces, indexes);
}

/**
 * 该展开图能折成的全部 [前, 上, 右] 有序三元组（**0 基格子下标**，可直接喂给
 * validateNetOption）。合法展开图恰好 24 组 = 8 个角 × 每个角 3 种旋转。
 */
export function visibleOptions(cells) {
  const folded = foldNet(cells);
  if (!folded.ok) return [];
  const out = [];
  for (let a = 0; a < 6; a += 1) {
    for (let b = 0; b < 6; b += 1) {
      for (let c = 0; c < 6; c += 1) {
        if (a === b || b === c || a === c) continue;
        if (isVisibleTriple(folded.faces, [a, b, c])) out.push([a, b, c]);
      }
    }
  }
  return out;
}

export default {
  foldNet,
  foldFaces,
  oppositePairs,
  isValidNet,
  isAdjacentInNet,
  isOppositeInCube,
  relativeFaces,
  validateNetOption,
  visibleOptions
};
