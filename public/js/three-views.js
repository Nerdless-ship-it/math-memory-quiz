/**
 * 三视图（主视图 / 俯视图 / 左视图）几何层。
 *
 * 与 geometry.js / net-fold.js 的分工：那两个算「截面」和「折叠」，这里算**投影视图**。
 * 零依赖、纯函数、不碰 DOM——渲染在 figure.js，出题在 subjects/three-views.item.js。
 *
 * ── 坐标约定（全库统一，改前先读懂）──────────────────────────────────
 *   x 向右为正、y 向上为正、z 向前（朝观察者）为正（右手系）。
 *   一个单位立方体放在整数坐标上：格子 (x, y, z) 占据 [x,x+1]×[y,y+1]×[z,z+1]。
 *   立体按「摆在地面上」建模：normalizeCubes 会把整体平移，使三个方向的最小值都为 0。
 *
 * ── 视图方向约定（中国第一角投影，与教材 / 考公真题一致）────────────────
 *   主视图（从前往后看）：右 = 物体右（x+），上 = 物体上（y+）
 *   俯视图（从上往下看）：右 = 物体右（x+），**下 = 物体前（z+）**
 *   左视图（从左往右看）：上 = 物体上（y+），**右 = 物体前（z+）**
 *
 *   两条加粗规则是「宽相等」的落点，也是最经典的错项来源（左右镜像）：
 *   **俯视图的下方、左视图的右方都表示物体的前方**——离主视图越远越靠前。
 *   出处一致的统一表述：新东方《三视图的对应规律》「俯视图的上方反映的是形体的后方，
 *   俯视图的下方反映的是形体的前方……左视图的左方反映的是形体的后方，右方反映的是
 *   形体的前方」；浩辰 CAD《三视图投影规律》「俯视图的下方和左视图右面都反映了物体的
 *   前方」。这两句是本题库所有选项对错的依据，改动前请先复核。
 *
 * ── 网格表示 ──────────────────────────────────────────────────────
 *   每个视图 = { view, cols, rows, cells }：cells 是从 0 开始的 [列, 行] 整数对，
 *   列从左往右、行从上往下。三个视图最终都归一到这个形状，于是可以直接画成 SVG，
 *   也可以用 viewKey() 判等（生成干扰项、校验「恰好一项正确」都靠它）。
 */

const VIEW_NAMES = Object.freeze(['front', 'top', 'left']);

/** 视图在界面上的中文名。 */
export const VIEW_LABELS = Object.freeze({
  front: '主视图',
  top: '俯视图',
  left: '左视图'
});

export const VIEWS = VIEW_NAMES;

function isIntTriple(value) {
  return Array.isArray(value) && value.length === 3
    && value.every((v) => Number.isInteger(v));
}

/**
 * 校验并归一化立方体集合：去重、平移到非负、按 (y, x, z) 排序。
 * 排序只为让输出稳定（测试与图形都是确定性的），与几何无关。
 *
 * @param {Array<[number, number, number]>} cubes
 * @returns {{ cubes: Array<[number,number,number]>, width: number, height: number, depth: number }}
 */
export function normalizeCubes(cubes) {
  if (!Array.isArray(cubes)) throw new Error('three-views: cubes 必须是数组');
  const seen = new Set();
  const unique = [];
  for (const cube of cubes) {
    if (!isIntTriple(cube)) {
      throw new Error(`three-views: 每个立方体必须是 [x,y,z] 整数三元组，收到 ${JSON.stringify(cube)}`);
    }
    const key = cube.join(',');
    if (seen.has(key)) continue; // 重复坐标无意义，静默去重（数据里写重复不是几何错误）
    seen.add(key);
    unique.push([cube[0], cube[1], cube[2]]);
  }
  if (unique.length === 0) throw new Error('three-views: cubes 不能为空');

  const minX = Math.min(...unique.map((c) => c[0]));
  const minY = Math.min(...unique.map((c) => c[1]));
  const minZ = Math.min(...unique.map((c) => c[2]));
  const shifted = unique.map(([x, y, z]) => [x - minX, y - minY, z - minZ]);
  shifted.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]) || (a[2] - b[2]));

  return {
    cubes: shifted,
    width: Math.max(...shifted.map((c) => c[0])) + 1,
    height: Math.max(...shifted.map((c) => c[1])) + 1,
    depth: Math.max(...shifted.map((c) => c[2])) + 1
  };
}

/** 由 cells 列表构造视图对象（统一入口，保证 cells 按行优先排序、无重复）。 */
function makeView(view, cols, rows, cells) {
  const seen = new Set();
  const clean = [];
  for (const [c, r] of cells) {
    if (c < 0 || r < 0 || c >= cols || r >= rows) {
      throw new Error(`three-views: ${view} 视图的格子 (${c},${r}) 越出 ${cols}×${rows} 网格`);
    }
    const key = `${c},${r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push([c, r]);
  }
  clean.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  return { view, cols, rows, cells: clean };
}

/**
 * 求某个方向的视图。
 *
 * 列/行的取法直接对应上面的方向约定：
 *   front —— 列 = x（向右），行 = 高度方向，**第 0 行是最上面**（所以行 = height−1−y）
 *   top   —— 列 = x（向右），行 = z，第 0 行是最远（z 最小），**最后一行是物体的前面**
 *   left  —— 列 = z，第 0 列是最远（z 最小），**最后一列是物体的前面**；行同 front
 *
 * @param {Array<[number, number, number]>} cubes
 * @param {'front'|'top'|'left'} view
 * @returns {{ view: string, cols: number, rows: number, cells: Array<[number, number]> }}
 */
export function orthoView(cubes, view) {
  if (!VIEW_NAMES.includes(view)) {
    throw new Error(`three-views: 未知视图方向 "${view}"，可用：${VIEW_NAMES.join(', ')}`);
  }
  const { cubes: normalized, width, height, depth } = normalizeCubes(cubes);
  const cells = [];
  for (const [x, y, z] of normalized) {
    if (view === 'front') cells.push([x, height - 1 - y]);
    else if (view === 'top') cells.push([x, z]);
    else cells.push([z, height - 1 - y]);
  }
  const cols = view === 'left' ? depth : width;
  const rows = view === 'top' ? depth : height;
  return makeView(view, cols, rows, cells);
}

/** 一次算出三个视图。 */
export function orthoViews(cubes) {
  return {
    front: orthoView(cubes, 'front'),
    top: orthoView(cubes, 'top'),
    left: orthoView(cubes, 'left')
  };
}

/**
 * 视图的判等键：形状相同 ⟺ 键相同（网格尺寸也计入，因为画出来不一样大）。
 * 生成干扰项、断言「恰好一项正确」都用它。
 */
export function viewKey(view) {
  const cells = view.cells.map(([c, r]) => `${c}.${r}`).join(' ');
  return `${view.cols}x${view.rows}:${cells}`;
}

/** 一组立方体的三视图判等键（三个视图拼起来，用于「两个立体三视图是否相同」）。 */
export function viewsKey(cubes) {
  const views = orthoViews(cubes);
  return VIEW_NAMES.map((name) => viewKey(views[name])).join('||');
}

/**
 * 左右镜像（干扰项①：把方向搞反——最常见的错误）。
 * 只翻格子，不改网格尺寸：这样画出来的轮廓一样大，学生必须靠方向分辨。
 */
export function mirrorHorizontally(view) {
  return makeView(view.view, view.cols, view.rows,
    view.cells.map(([c, r]) => [view.cols - 1 - c, r]));
}

/** 上下镜像（干扰项②：把高低搞反）。 */
export function mirrorVertically(view) {
  return makeView(view.view, view.cols, view.rows,
    view.cells.map(([c, r]) => [c, view.rows - 1 - r]));
}

/**
 * 去掉一格（干扰项③：漏数一个方块）。
 * 默认去掉行优先最后出现的那格——它一定在轮廓的边缘，去掉后仍是像样的图形。
 */
export function withoutCell(view, cell) {
  const target = cell ?? view.cells[view.cells.length - 1];
  const key = `${target[0]},${target[1]}`;
  const rest = view.cells.filter(([c, r]) => `${c},${r}` !== key);
  if (rest.length === view.cells.length) {
    throw new Error(`three-views: withoutCell 找不到格子 (${target})`);
  }
  if (rest.length === 0) throw new Error('three-views: 不能把视图删空');
  return makeView(view.view, view.cols, view.rows, rest);
}

/**
 * 加一格（干扰项④：多数一个方块）。
 * 先挑**第一个还没被占的格子**（行优先，结果确定）；网格已经占满时（例如俯视图是
 * 实心 2×2）整体加宽一列，把新格子贴在最右列已有格子的旁边——「多一格」本来就表现为
 * 图形更宽，这样任何视图都构造得出来，不会因为形状太规整而凑不出干扰项。
 */
export function withExtraCell(view, cell) {
  if (cell) return makeView(view.view, view.cols, view.rows, [...view.cells, cell]);
  const occupied = new Set(view.cells.map(([c, r]) => `${c},${r}`));
  for (let r = 0; r < view.rows; r += 1) {
    for (let c = 0; c < view.cols; c += 1) {
      if (!occupied.has(`${c},${r}`)) return makeView(view.view, view.cols, view.rows, [...view.cells, [c, r]]);
    }
  }
  const anchorRow = Math.max(...view.cells.map(([, r]) => r));
  return makeView(view.view, view.cols + 1, view.rows, [...view.cells, [view.cols, anchorRow]]);
}

export default {
  VIEWS,
  VIEW_LABELS,
  normalizeCubes,
  orthoView,
  orthoViews,
  viewKey,
  viewsKey,
  mirrorHorizontally,
  mirrorVertically,
  withoutCell,
  withExtraCell
};
