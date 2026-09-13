// 标准几何体（圆柱 / 圆锥 / 球 / 长方体 / 正三棱柱 / 正四棱锥）的三视图规则与画法。
//
// 视图规则是**教材结论**，下面的期望值都是按定义手推的（不是从实现里抄的）：
//   圆柱：主 矩形(2r×h)、俯 圆(r)、左 矩形(2r×h)
//   圆锥：主 等腰三角形(2r×h)、俯 圆(r)、左 等腰三角形
//   球　：三个都是圆(r)
//   长方体：主 矩形(w×h)、俯 矩形(w×d)、左 矩形(d×h)
//   正三棱柱（一条棱朝前）：主 矩形(√3r×h)、俯 正三角形、左 矩形(1.5r×h)
//   正四棱锥：主/左 等腰三角形(√2r×h)、俯 正方形＋对角线
// 另外三条投影关系（长对正 / 高平齐 / 宽相等）对所有几何体都必须成立。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOLID_SHAPES,
  SOLID_BY_ID,
  solidViews,
  solidViewsKey,
  shapeKey,
  shapeBounds,
  shapeLabel,
  renderShape,
  renderSolid3d,
  renderShapeViews,
  sideLength
} from '../public/js/solid-shapes.js';
import { ITEMS, SHAPE_QUESTIONS } from '../public/subjects/three-views.item.js';

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

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('视图规则：圆柱 / 圆锥 / 球的三个视图', () => {
  const cylinder = solidViews('cylinder');
  assert.deepEqual(cylinder.front, { kind: 'rect', width: 2, height: 1.8 }, '圆柱主视图是 2r×h 的矩形');
  assert.deepEqual(cylinder.top, { kind: 'circle', radius: 1 }, '圆柱俯视图是圆');
  assert.deepEqual(cylinder.left, { kind: 'rect', width: 2, height: 1.8 }, '圆柱左视图与主视图同尺寸');

  const cone = solidViews('cone');
  assert.deepEqual(cone.front, { kind: 'triangle', base: 2, height: 1.8 }, '圆锥主视图是等腰三角形');
  assert.deepEqual(cone.top, { kind: 'circle', radius: 1 }, '圆锥俯视图是圆');
  assert.equal(cone.left.kind, 'triangle');

  const sphere = solidViews('sphere');
  for (const name of ['front', 'top', 'left']) {
    assert.deepEqual(sphere[name], { kind: 'circle', radius: 1 }, `球的${name}视图是圆`);
  }
});

test('视图规则：长方体三个视图的尺寸各不相同', () => {
  const views = solidViews('cuboid');
  const { width: w, depth: d, height: h } = SOLID_BY_ID.cuboid;
  assert.deepEqual(views.front, { kind: 'rect', width: w, height: h });
  assert.deepEqual(views.top, { kind: 'rect', width: w, height: d });
  assert.deepEqual(views.left, { kind: 'rect', width: d, height: h });
  assert.ok(!near(w, d) && !near(w, h) && !near(d, h), '三个尺寸必须互不相同，否则题目没区分度');
});

test('视图规则：正三棱柱主视图窄于俯视图的进深（这是本题的考点）', () => {
  const views = solidViews('prism3');
  const r = SOLID_BY_ID.prism3.radius;
  const edge = sideLength(r, 3); // 棱长 = √3·r
  assert.ok(near(views.front.width, edge), `主视图宽应是棱长 ${edge}（从正面看到的三角形宽度）`);
  assert.ok(near(views.left.width, 1.5 * r), `左视图宽应是 1.5r=${1.5 * r}（从左边看到的前后进深）`);
  assert.equal(views.top.kind, 'polygon');
  assert.equal(views.top.sides, 3);
  assert.equal(views.top.spin, 180, '一条棱朝前 ⇒ 俯视图有一个顶点朝下（下方＝前方）');
});

test('视图规则：正四棱锥俯视图是带对角线的正方形', () => {
  const views = solidViews('pyramid4');
  const r = SOLID_BY_ID.pyramid4.radius;
  const side = sideLength(r, 4); // 边长 = √2·r
  assert.equal(views.top.kind, 'polygon');
  assert.equal(views.top.sides, 4);
  assert.equal(views.top.spokes, true, '四棱锥的俯视图要画对角棱线');
  assert.ok(near(views.front.base, side), '主视图三角形的底＝正方形边长');
  assert.ok(near(views.front.height, SOLID_BY_ID.pyramid4.height));
});

test('投影关系：所有几何体都满足长对正 / 高平齐 / 宽相等', () => {
  for (const solid of SOLID_SHAPES) {
    const views = solidViews(solid.id);
    const width = (view) => shapeBounds(view).width;
    const height = (view) => shapeBounds(view).height;
    assert.ok(near(width(views.front), width(views.top)),
      `${solid.name}：长对正不成立（主视图宽 ${width(views.front)} vs 俯视图宽 ${width(views.top)}）`);
    assert.ok(near(height(views.front), height(views.left)),
      `${solid.name}：高平齐不成立（主视图高 ${height(views.front)} vs 左视图高 ${height(views.left)}）`);
    assert.ok(near(width(views.left), height(views.top)),
      `${solid.name}：宽相等不成立（左视图宽 ${width(views.left)} vs 俯视图高 ${height(views.top)}）`);
  }
});

test('判等键：形状相同 ⟺ 键相同；未知立体抛错', () => {
  assert.equal(shapeKey({ kind: 'circle', radius: 1 }), shapeKey({ kind: 'circle', radius: 1 }));
  assert.notEqual(shapeKey({ kind: 'circle', radius: 1 }), shapeKey({ kind: 'circle', radius: 0.5 }));
  assert.notEqual(shapeKey({ kind: 'rect', width: 2, height: 1 }), shapeKey({ kind: 'rect', width: 1, height: 2 }));
  assert.notEqual(shapeKey({ kind: 'polygon', sides: 4, radius: 1, spokes: true }),
    shapeKey({ kind: 'polygon', sides: 4, radius: 1, spokes: false }), '有没有对角线必须算不同图形');
  assert.throws(() => solidViews('dodecahedron'), /未知立体/);
  // 六个几何体的三视图两两不同（否则「给三视图选立体」会出现多个正确答案）
  const keys = SOLID_SHAPES.map((s) => solidViewsKey(s.id));
  assert.equal(new Set(keys).size, SOLID_SHAPES.length, '不同几何体的三视图组合必须互不相同');
});

test('渲染：每个几何体的立体图、视图形状、三视图组合都能画出来', () => {
  withStubDocument(() => {
    for (const solid of SOLID_SHAPES) {
      const three = renderSolid3d(solid.id);
      assert.equal(three.tagName, 'svg');
      assert.equal(three.getAttribute('role'), 'img');
      assert.match(three.getAttribute('aria-label'), new RegExp(solid.name));
      assert.ok(three.children.length >= 2, `${solid.name}的立体图元素太少`);

      const views = solidViews(solid.id);
      for (const name of ['front', 'top', 'left']) {
        const svg = renderShape(views[name]);
        assert.ok(svg.children.length >= 1, `${solid.name} 的${name}视图没画出东西`);
        assert.match(svg.getAttribute('aria-label'), /(圆|矩形|三角形|边形)/);
      }

      const composed = renderShapeViews(solid.id);
      assert.equal(composed.getAttribute('role'), 'img');
      assert.match(composed.getAttribute('aria-label'), /三视图/);
      assert.ok(composed.children.length >= 6, '三视图组合应有三个图形 + 三个标题');
    }
  });
});

test('渲染：椭圆（干扰项形状）能画，且被描述成椭圆', () => {
  withStubDocument(() => {
    const svg = renderShape({ kind: 'ellipse', rx: 1, ry: 0.55 });
    assert.equal(svg.children[0].tagName, 'ellipse');
    assert.match(svg.getAttribute('aria-label'), /椭圆/);
  });
});

test('题库：12 道标准几何体题目，恰好一项正确', () => {
  assert.equal(SHAPE_QUESTIONS.length, 6, '六个几何体各出一题');
  const shapeItems = ITEMS.filter((item) => item.figure.kind === 'figure:solid-3d' || item.figure.kind === 'figure:shape-views');
  assert.equal(shapeItems.length, 12, '标准几何体的题目应为 12 道（6 道选视图 + 6 道选立体）');

  const labelToView = { 主视图: 'front', 俯视图: 'top', 左视图: 'left' };
  for (const item of shapeItems) {
    const answerIndex = 'ABCD'.indexOf(item.back);
    assert.ok(answerIndex >= 0, `${item.id}: back 必须是 A~D`);
    const keys = item.choiceFigures.map((figure) => JSON.stringify(figure.spec));
    assert.equal(new Set(keys).size, 4, `${item.id}: 四个选项必须两两不同`);

    if (item.figure.kind === 'figure:solid-3d') {
      // 题型①：题干是几何体，问某个视图
      const solidId = item.figure.spec.solid;
      const match = item.front.match(/^(.+?)的(主视图|俯视图|左视图)是$/);
      assert.ok(match, `${item.id}: 题面格式应为「<立体>的<视图>是」，实际「${item.front}」`);
      assert.equal(match[1], SOLID_BY_ID[solidId].name, `${item.id}: 题面里的立体名与 figure 不一致`);
      const expected = solidViews(solidId)[labelToView[match[2]]];
      const answer = item.choiceFigures[answerIndex];
      assert.equal(answer.kind, 'figure:view-shape');
      assert.equal(shapeKey(answer.spec.shape), shapeKey(expected),
        `${item.id}: 答案图形必须是${match[2]}（期望 ${shapeKey(expected)}，实际 ${shapeKey(answer.spec.shape)}）`);
      // 其余三项必须都不是该视图，且**不能只是等比缩放**（同一个形状换个大小
      // 在语义上仍是正确答案——选项里没有比例尺参照，那会让题目出现两个正确答案）
      for (const [index, figure] of item.choiceFigures.entries()) {
        if (index === answerIndex) continue;
        const distractor = figure.spec.shape;
        assert.notEqual(shapeKey(distractor), shapeKey(expected), `${item.id}: 干扰项与答案相同`);
        if (distractor.kind === expected.kind) {
          if (expected.kind === 'circle') {
            assert.fail(`${item.id}: 干扰项是另一个半径的圆——语义上与正确答案相同`);
          }
          if (expected.kind === 'rect') {
            assert.ok(Math.abs(distractor.width / distractor.height - expected.width / expected.height) > 1e-9,
              `${item.id}: 干扰矩形与正确答案长宽比相同（只是缩放），会造成两个正确答案`);
          }
          if (expected.kind === 'triangle') {
            assert.ok(Math.abs(distractor.base / distractor.height - expected.base / expected.height) > 1e-9,
              `${item.id}: 干扰三角形与正确答案相似（只是缩放），会造成两个正确答案`);
          }
          if (expected.kind === 'polygon') {
            assert.ok(distractor.sides !== expected.sides || Boolean(distractor.spokes) !== Boolean(expected.spokes),
              `${item.id}: 干扰多边形与正确答案形状相同`);
          }
        }
      }
    } else {
      // 题型②：题干是三视图，恰好一个几何体的三视图与题干一致
      const stemKey = solidViewsKey(item.figure.spec.solid);
      const matches = item.choiceFigures
        .map((figure, index) => (solidViewsKey(figure.spec.solid) === stemKey ? index : -1))
        .filter((index) => index >= 0);
      assert.deepEqual(matches, [answerIndex],
        `${item.id}: 四个几何体里应恰好有一个的三视图与题干一致（实际 ${JSON.stringify(matches)}）`);
    }
  }
});
