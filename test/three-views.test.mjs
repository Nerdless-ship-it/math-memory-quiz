// 三视图：几何约定 + 题库正确性 + 渲染冒烟。
//
// 这份文件里**手推的黄金样例是核心**：下面的期望网格是按教材约定一行一行推出来的
// （不是从实现里抄的），所以它能守住方向约定本身。改 three-views.js 的取行/取列方式
// 一定会让它们变红——这正是要防的：视图左右镜像了，题目就会整套错。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCubes,
  orthoView,
  orthoViews,
  viewKey,
  viewsKey,
  mirrorHorizontally,
  mirrorVertically,
  withoutCell,
  withExtraCell,
  VIEWS,
  VIEW_LABELS
} from '../public/js/three-views.js';
import { ITEMS, DISTRACTOR_REASONS, SOLIDS } from '../public/subjects/three-views.item.js';

/** 把视图画成字符网格，便于断言与失败时肉眼比对。 */
function grid(view) {
  const rows = [];
  for (let r = 0; r < view.rows; r += 1) {
    rows.push(Array.from({ length: view.cols },
      (_, c) => (view.cells.some(([cc, rr]) => cc === c && rr === r) ? '#' : '.')).join(''));
  }
  return rows;
}

const DIRECTION_BY_LABEL = Object.freeze({
  主视图: 'front',
  俯视图: 'top',
  左视图: 'left'
});

// ── ① 手推黄金样例：方向约定 ────────────────────────────────────────────

test('三视图约定：角块的三个视图与手推结果逐格一致', () => {
  // 底面 (0,0) 与 (1,0) 各一格、前侧 (0,0,1) 一格、上面 (0,1,0) 一格
  const cubes = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]];
  const views = orthoViews(cubes);
  assert.deepEqual(grid(views.front), ['#.', '##'], '主视图：左列有上下两格，右列只有底下一格');
  assert.deepEqual(grid(views.top), ['##', '#.'], '俯视图：后一排满、前一排只有左格（下方＝前方）');
  assert.deepEqual(grid(views.left), ['#.', '##'], '左视图：左列（后方）上下两格，右列（前方）只有底下一格');
});

test('三视图约定：前后错开的立体，俯视图下方＝前方、左视图右方＝前方', () => {
  // 后下 (0,0,0) 与 前上 (1,1,1)：两个方块在对角线上，三个视图都不相同
  const cubes = [[0, 0, 0], [1, 1, 1]];
  const views = orthoViews(cubes);
  assert.deepEqual(grid(views.front), ['.#', '#.'], '主视图：右在上、左在下');
  assert.deepEqual(grid(views.top), ['#.', '.#'], '俯视图：上一行（后方）是左格，下一行（前方）是右格');
  assert.deepEqual(grid(views.left), ['.#', '#.'], '左视图：右列（前方）在上、左列（后方）在下');
});

test('三视图约定：左右镜像与正确答案不同（本题型最主要的干扰项成立）', () => {
  const cubes = [[0, 0, 0], [1, 1, 1]];
  const front = orthoView(cubes, 'front');
  assert.notEqual(viewKey(mirrorHorizontally(front)), viewKey(front), '左右镜像必须与原图不同');
  assert.deepEqual(grid(mirrorHorizontally(front)), ['#.', '.#']);
  assert.deepEqual(grid(mirrorVertically(front)), ['#.', '.#']);
});

test('三视图约定：长对正、高平齐、宽相等', () => {
  for (const solid of SOLIDS) {
    const { width, height, depth } = normalizeCubes(solid.cubes);
    const views = orthoViews(solid.cubes);
    assert.equal(views.front.cols, width, `${solid.id}：主视图列数＝左右宽度（长对正）`);
    assert.equal(views.top.cols, width, `${solid.id}：俯视图列数＝左右宽度（长对正）`);
    assert.equal(views.front.rows, height, `${solid.id}：主视图行数＝高度`);
    assert.equal(views.left.rows, height, `${solid.id}：左视图行数＝高度（高平齐）`);
    assert.equal(views.top.rows, depth, `${solid.id}：俯视图行数＝前后深度`);
    assert.equal(views.left.cols, depth, `${solid.id}：左视图列数＝前后深度（宽相等）`);
  }
});

// ── ② 几何工具 ─────────────────────────────────────────────────────────

test('normalizeCubes：平移到非负、去重、给出包围盒', () => {
  const result = normalizeCubes([[3, 2, 5], [4, 2, 5], [3, 2, 5], [3, 3, 6]]);
  assert.deepEqual(result.cubes, [[0, 0, 0], [1, 0, 0], [0, 1, 1]]);
  assert.deepEqual([result.width, result.height, result.depth], [2, 2, 2]);
  assert.throws(() => normalizeCubes([]), /不能为空/);
  assert.throws(() => normalizeCubes([[0.5, 0, 0]]), /整数三元组/);
});

test('视图工具：镜像、加减格都保持网格合法，且能构造出不同的图形', () => {
  const view = orthoView([[0, 0, 0], [1, 1, 0]], 'front'); // 2×2 对角两格
  for (const variant of [mirrorHorizontally(view), mirrorVertically(view), withoutCell(view), withExtraCell(view)]) {
    assert.ok(variant.cols >= 1 && variant.rows >= 1);
    for (const [c, r] of variant.cells) {
      assert.ok(c >= 0 && c < variant.cols && r >= 0 && r < variant.rows, '格子必须在网格内');
    }
  }
  // 网格占满时「加一格」要能整列加宽，而不是报错
  const full = orthoView([[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], 'top');
  assert.equal(full.cells.length, 4);
  const wider = withExtraCell(full);
  assert.equal(wider.cols, full.cols + 1, '满格时应加宽一列');
  assert.equal(wider.cells.length, 5);
});

// ── ③ 题库正确性 ───────────────────────────────────────────────────────

test('题库：36 题（24 道方块 + 12 道标准几何体）、id 唯一、方块题都能定位唯一答案', () => {
  assert.equal(ITEMS.length, 36, '题库应为 36 题');
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length, '题目 id 必须唯一');
  assert.equal(SOLIDS.length * (VIEWS.length + 1), 24, '方块部分：6 个立体 ×（3 个方向 + 1 道反向题）');

  // 标准几何体的 12 题由 test/solid-shapes.test.mjs 逐条校验，这里只管方块部分
  const voxelItems = ITEMS.filter((item) => item.figure.kind === 'figure:block-solid'
    || item.figure.kind === 'figure:three-views');
  assert.equal(voxelItems.length, 24, '方块题的题干只有两种：立体图 / 三视图组合');

  for (const item of voxelItems) {
    const answerIndex = 'ABCD'.indexOf(item.back);
    assert.ok(answerIndex >= 0, `${item.id}: back 必须是 A~D，收到 ${item.back}`);
    assert.deepEqual(item.choiceTexts, ['A', 'B', 'C', 'D'], `${item.id}: 选项标签固定 A~D`);
    assert.equal(item.choiceFigures.length, 4, `${item.id}: 必须有四个选项图形`);

    if (item.figure.kind === 'figure:block-solid') {
      // 题型①：题干是立体，问某个视图 —— 正确答案 = 该方向的视图
      const label = item.front.replace('该立体图形的', '').replace('是', '');
      const view = DIRECTION_BY_LABEL[label];
      assert.ok(view, `${item.id}: 题面「${item.front}」的视图方向无法识别`);
      const expected = orthoView(item.figure.spec.cubes, view);
      const answer = item.choiceFigures[answerIndex];
      assert.equal(answer.kind, 'figure:view-cells');
      assert.deepEqual(answer.spec.cells, expected.cells,
        `${item.id}: 答案图形必须是${label}的视图`);
      assert.equal(answer.spec.cols, expected.cols);
      assert.equal(answer.spec.rows, expected.rows);
    } else {
      // 题型②：题干是三视图，选项是立体 —— 恰好一个立体的三视图与题干一致
      assert.equal(item.figure.kind, 'figure:three-views', `${item.id}: 题型②的题干必须是三视图`);
      const stemKey = viewsKey(item.figure.spec.cubes);
      const matches = item.choiceFigures
        .map((figure, index) => (figure.spec.cubes && viewsKey(figure.spec.cubes) === stemKey ? index : -1))
        .filter((index) => index >= 0);
      assert.deepEqual(matches, [answerIndex],
        `${item.id}: 四个立体里应恰好有一个的三视图与题干一致（实际 ${JSON.stringify(matches)}）`);
    }
  }
});

test('题库：四个选项两两不同（选项里有重复图形 = 题目不可解）', () => {
  for (const item of ITEMS) {
    const keys = item.choiceFigures.map((figure) => JSON.stringify(figure.spec));
    assert.equal(new Set(keys).size, 4, `${item.id}: 存在重复的选项图形`);
  }
});

test('题库：每题都有三个干扰项，且理由都在约定的错误类型里', () => {
  // 理由后面会跟一个尺寸说明（如「（1.80×2.00）」），所以只校验前缀
  const allowedPrefixes = [
    '方向看错', '左右镜像', '上下镜像', '少画了一个方块', '多画了一个方块',
    '在 (', '缺了 (', '前后镜像',
    '尺寸看错', '直径当成半径', '半径当成直径', '长宽互换', '宽度看错', '高度看错',
    '底面看错', '边数看错', '漏画对角线', '把圆画成了椭圆', '整体画小了', '形状认错', '三视图不符'
  ];
  for (const item of ITEMS) {
    const reasons = DISTRACTOR_REASONS.get(item.id);
    assert.ok(Array.isArray(reasons), `${item.id}: 缺干扰项理由`);
    assert.equal(reasons.length, 3, `${item.id}: 应有三个干扰项理由`);
    for (const reason of reasons) {
      assert.equal(typeof reason, 'string');
      assert.ok(reason.trim().length > 0, `${item.id}: 理由不能为空`);
      assert.ok(allowedPrefixes.some((prefix) => reason.startsWith(prefix)),
        `${item.id}: 干扰项理由「${reason}」不在约定的错误类型里`);
    }
  }
});

test('题库：干扰项必须是「像样但不对」的图形（非空、不与答案重合）', () => {
  for (const item of ITEMS) {
    const answerIndex = 'ABCD'.indexOf(item.back);
    const answerKey = JSON.stringify(item.choiceFigures[answerIndex].spec);
    for (const [index, figure] of item.choiceFigures.entries()) {
      if (index === answerIndex) continue;
      assert.notEqual(JSON.stringify(figure.spec), answerKey, `${item.id}: 干扰项与答案相同`);
      if (figure.kind === 'figure:view-cells') {
        assert.ok(figure.spec.cells.length > 0, `${item.id}: 干扰项不能是空图形`);
        assert.ok(figure.spec.cells.length >= 2, `${item.id}: 干扰项只剩一格太不像话`);
      }
    }
  }
});

// ── ④ 渲染冒烟（Node 里用极简 DOM stub）──────────────────────────────────

function makeStubDocument() {
  const create = (tagName) => {
    const node = {
      tagName,
      attributes: {},
      children: [],
      style: {},
      textContent: '',
      setAttribute(key, value) { node.attributes[key] = String(value); },
      getAttribute(key) { return node.attributes[key]; },
      append(...items) { node.children.push(...items); },
      addEventListener() {},
      remove() {}
    };
    return node;
  };
  return { createElement: create, createElementNS: (_ns, tag) => create(tag) };
}

function withStubDocument(fn) {
  const saved = globalThis.document;
  globalThis.document = makeStubDocument();
  try {
    return fn();
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
}

test('渲染：题干与四个选项都能画出带 role / aria-label 的 svg', async () => {
  const { renderFigure, isValidFigure } = await import('../public/js/figure.js');
  let rendered = 0;
  for (const item of ITEMS) {
    for (const figure of [item.figure, ...item.choiceFigures]) {
      assert.ok(isValidFigure(figure), `${item.id}: ${figure.kind} 的 spec 未通过 isValidFigure`);
      const svg = withStubDocument(() => renderFigure(figure));
      assert.equal(svg.tagName, 'svg');
      assert.equal(svg.getAttribute('role'), 'img');
      const label = svg.getAttribute('aria-label');
      assert.ok(label && label.length > 4, `${item.id}: ${figure.kind} 的 aria-label 太短：${label}`);
      assert.ok(svg.children.length > 0, `${item.id}: ${figure.kind} 画出来是空的`);
      rendered += 1;
    }
  }
  assert.equal(rendered, ITEMS.length * 5, '每题应有 1 个题干 + 4 个选项图形');
});

test('渲染：未知视图方向 / 越界格子必须抛错，不能静默画空白', async () => {
  const { renderFigure } = await import('../public/js/figure.js');
  assert.throws(
    () => withStubDocument(() => renderFigure({ kind: 'figure:view-cells', spec: { cols: 2, rows: 2, cells: [[3, 0]] } })),
    /越出/
  );
  assert.throws(
    () => withStubDocument(() => renderFigure({ kind: 'figure:view-cells', spec: { cols: 0, rows: 2, cells: [[0, 0]] } })),
    /正整数/
  );
  assert.throws(
    () => withStubDocument(() => renderFigure({ kind: 'figure:block-solid', spec: { cubes: [[0.5, 0, 0]] } })),
    /整数三元组/
  );
});
