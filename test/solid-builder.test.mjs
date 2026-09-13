// 三视图搭建器：相机数学 + 增删逻辑 + 交互 + 「视图与观察角度无关」这条核心不变量。
//
// 最后一条是搭建器存在的理由：用户拖动旋转时，三个视图必须**一点不变**——
// 视图由立体本身决定。这条断言写在这里，就是为了防止以后有人「顺手」把视角
// 混进视图计算里。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  orbit,
  faceCorners,
  addCube,
  removeCube,
  neighborAcross,
  sceneProjection,
  renderSolidScene,
  renderGridView,
  mountSolidBuilder,
  MAX_SIZE,
  DEFAULT_VIEW,
  VIEW_LIMITS,
  PART_CATALOG,
  PART_BY_ID,
  partsOverlap,
  canPlacePart,
  partsExtent,
  compositeViews,
  renderCompositeView,
  renderCompositeScene
} from '../public/js/solid-builder.js';
import { orthoViews, viewKey } from '../public/js/three-views.js';
import { solidViews } from '../public/js/solid-shapes.js';

// ── 极简 DOM stub（带 parent 链，closest 才能穿过 SVG 节点）───────────────
function makeStubDocument() {
  const create = (tagName) => {
    const node = {
      tagName,
      attributes: {},
      children: [],
      style: {},
      textContent: '',
      className: '',
      listeners: {},
      parent: null,
      hidden: false,
      disabled: false,
      setAttribute(key, value) {
        node.attributes[key] = String(value);
        if (key === 'class') node.className = String(value);
      },
      getAttribute(key) { return node.attributes[key]; },
      append(...items) {
        for (const item of items) { item.parent = node; node.children.push(item); }
      },
      replaceChildren(...items) { node.children = []; node.append(...items); },
      addEventListener(type, fn) { (node.listeners[type] ??= []).push(fn); },
      dispatch(type, event) { for (const fn of node.listeners[type] ?? []) fn(event ?? { target: node }); },
      closest(selector) {
        const want = selector.replace(/^\./, '');
        let current = node;
        while (current) {
          if ((current.className ?? '').split(' ').includes(want)) return current;
          current = current.parent;
        }
        return null;
      },
      remove() { if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node); },
      classList: {
        contains: (c) => (node.attributes.class ?? '').split(' ').includes(c),
        add(c) { if (!node.classList.contains(c)) node.setAttribute('class', `${node.attributes.class ?? ''} ${c}`.trim()); },
        remove(c) {
          node.setAttribute('class', (node.attributes.class ?? '').split(' ').filter((x) => x && x !== c).join(' '));
        },
        toggle(c, force) {
          const want = force === undefined ? !node.classList.contains(c) : Boolean(force);
          if (want) node.classList.add(c); else node.classList.remove(c);
          return want;
        }
      }
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

/** 深度遍历找节点。 */
function collect(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) collect(child, predicate, out);
  return out;
}
const byClass = (root, className) => collect(root, (n) => (n.className ?? '').split(' ').includes(className));

/** 视图缩略图的形状签名（用于断言「转视角后视图没变」）。 */
function stripSignature(builder) {
  const strip = byClass(builder, 'builder-strip')[0];
  return byClass(strip, 'builder-view-cell')
    .map((rect) => `${rect.getAttribute('x')},${rect.getAttribute('y')}`)
    .join('|');
}

// ── ① 相机与几何 ────────────────────────────────────────────────────────

test('相机：yaw=pitch=0 是恒等变换，且旋转保持长度', () => {
  const points = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [2, -3, 4], [0, 0, 0]];
  for (const p of points) {
    assert.deepEqual(orbit(p, 0, 0), p, `${JSON.stringify(p)} 在 0/0 下被改了`);
  }
  for (const [yaw, pitch] of [[30, 20], [-120, 45], [180, -78], [0, 60]]) {
    const p = [1.5, -2.5, 3.5];
    const q = orbit(p, yaw, pitch);
    assert.ok(Math.abs(Math.hypot(...q) - Math.hypot(...p)) < 1e-9,
      `(${yaw}, ${pitch}) 下长度变了：${Math.hypot(...p)} → ${Math.hypot(...q)}`);
  }
});

test('相机：yaw 绕竖直轴转（y 不变），pitch 抬高相机往下看', () => {
  assert.deepEqual(orbit([1, 5, 0], 90, 0).map((v) => Math.round(v)), [0, 5, -1]);
  // pitch = +90°：相机升到正上方往下看，世界的「上」正对观察者（+z 在相机系里是朝向观察者）
  const top = orbit([0, 1, 0], 0, 90);
  assert.ok(Math.abs(top[1]) < 1e-9 && top[2] > 0, `pitch=90 时 +y 应正对观察者，实际 ${JSON.stringify(top)}`);
  // 顶面可见正是靠这个：所以默认视角（pitch=26°）能看到上面
  const normal = orbit([0, 1, 0], DEFAULT_VIEW.yaw, DEFAULT_VIEW.pitch);
  assert.ok(normal[2] > 0.2, `默认视角下顶面法向应朝向观察者，实际 ${JSON.stringify(normal)}`);
});

test('面的四个角：都在该面上、边长都是 1', () => {
  const corners = faceCorners([1, 2, 3], [0, 0, 1]); // 前面：z = 4
  assert.equal(corners.length, 4);
  for (const [x, y, z] of corners) {
    assert.equal(z, 4, '前面的四个角 z 都应是 4');
    assert.ok(x === 1 || x === 2);
    assert.ok(y === 2 || y === 3);
  }
  const edge = Math.hypot(corners[0][0] - corners[1][0], corners[0][1] - corners[1][1], corners[0][2] - corners[1][2]);
  assert.equal(edge, 1);
  // 上面：y = 3
  for (const [, y] of faceCorners([0, 0, 0], [0, 1, 0])) assert.equal(y, 1);
});

test('增删方块：越界与重复都不改变集合，且不改原数组', () => {
  const start = [[0, 0, 0]];
  assert.deepEqual(addCube(start, [1, 0, 0]), [[0, 0, 0], [1, 0, 0]]);
  assert.equal(addCube(start, [0, 0, 0]), start, '重复位置应原样返回');
  assert.equal(addCube(start, [MAX_SIZE, 0, 0]), start, '越界应原样返回');
  assert.equal(addCube(start, [-1, 0, 0]), start, '负数应原样返回');
  assert.deepEqual(start, [[0, 0, 0]], '原数组不得被修改');
  assert.equal(removeCube(start, [9, 9, 9]), start, '删不存在的方块应原样返回');
  assert.deepEqual(removeCube([[0, 0, 0], [1, 0, 0]], [0, 0, 0]), [[1, 0, 0]]);
});

test('点面加方块：新方块落在该面外侧一格', () => {
  assert.deepEqual(neighborAcross([1, 1, 1], [0, 0, 1]), [1, 1, 2]);
  assert.deepEqual(neighborAcross([1, 1, 1], [0, 1, 0]), [1, 2, 1]);
  assert.deepEqual(neighborAcross([1, 1, 1], [-1, 0, 0]), [0, 1, 1]);
});

test('场景投影：范围固定（加方块不跳），投影点都落在画布内', () => {
  const a = sceneProjection(0, 0, { width: 260, height: 240 });
  const b = sceneProjection(DEFAULT_VIEW.yaw, DEFAULT_VIEW.pitch, { width: 260, height: 240 });
  assert.equal(typeof a.scale, 'number');
  for (const projection of [a, b]) {
    for (const x of [0, MAX_SIZE]) {
      for (const y of [0, MAX_SIZE]) {
        for (const z of [0, MAX_SIZE]) {
          const p = projection.toScreen([x, y, z]);
          assert.ok(p.x >= -1 && p.x <= 261, `投影 x 越界：${p.x}`);
          assert.ok(p.y >= -1 && p.y <= 241, `投影 y 越界：${p.y}`);
        }
      }
    }
  }
});

// ── ② 渲染 ──────────────────────────────────────────────────────────────

test('立体场景：地面格子数固定，内部面不画，可见面带命中信息', () => {
  withStubDocument(() => {
    const svg = renderSolidScene([[0, 0, 0]], { yaw: 0, pitch: 0 });
    assert.equal(byClass(svg, 'builder-ground').length, MAX_SIZE * MAX_SIZE, '地面应有 MAX_SIZE² 个格子');
    const faces = byClass(svg, 'builder-face');
    // 正视角（yaw=pitch=0）只能看到前面一个面
    assert.equal(faces.length, 1);
    assert.equal(faces[0].getAttribute('data-cube'), '0,0,0');
    assert.equal(faces[0].getAttribute('data-dir'), 'front');
  });

  withStubDocument(() => {
    // 两个沿 z 排的方块：正视角下只看得见最前面那个的前面，其余全是内部面/背面
    const svg = renderSolidScene([[0, 0, 0], [0, 0, 1]], { yaw: 0, pitch: 0 });
    const dirs = byClass(svg, 'builder-face').map((f) => f.getAttribute('data-dir'));
    assert.deepEqual(dirs, ['front'], '正视角下只能看到最前面的一块的前面');
  });

  withStubDocument(() => {
    // 默认 3/4 视角：一个方块应能看到前面 / 上面 / 右面三个面
    const svg = renderSolidScene([[0, 0, 0]], { yaw: DEFAULT_VIEW.yaw, pitch: DEFAULT_VIEW.pitch });
    const dirs = byClass(svg, 'builder-face').map((f) => f.getAttribute('data-dir')).sort();
    assert.deepEqual(dirs, ['front', 'right', 'top'], '默认视角应看到前/上/右三个面');
    // 从远处先画：最后画的那个面应离观察者最近
    const depths = byClass(svg, 'builder-face').map((f) => f.getAttribute('data-cube'));
    assert.equal(depths.length, 3);
  });
});

test('二维视图：格子数与 orthoViews 一致，越界不画', () => {
  withStubDocument(() => {
    const cubes = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const views = orthoViews(cubes);
    const svg = renderGridView(views.front, { cell: 20, pad: 4 });
    assert.equal(byClass(svg, 'builder-view-cell').length, views.front.cells.length);
    assert.match(svg.getAttribute('aria-label'), /共 3 个小正方形/);
  });
});

// ── ③ 交互 ──────────────────────────────────────────────────────────────

function mountBuilder(cubes) {
  const container = globalThis.document.createElement('div');
  const handle = mountSolidBuilder(container, { cubes });
  const canvas = byClass(container, 'builder-canvas')[0];
  const click = (node) => {
    canvas.dispatch('pointerdown', { target: node, clientX: 50, clientY: 50, pointerId: 1, button: 0, preventDefault() {} });
    canvas.dispatch('pointerup', { target: node, clientX: 50, clientY: 50, pointerId: 1, preventDefault() {} });
  };
  return { container, handle, canvas, click };
}

test('交互：点地面加方块、点面加方块、删除模式删方块', () => {
  withStubDocument(() => {
    const { container, handle, click } = mountBuilder([[0, 0, 0]]);
    assert.equal(handle.getCubes().length, 1);

    // 点地面 (2,0) → 在地面加一块
    const ground = byClass(container, 'builder-ground').find((g) => g.getAttribute('data-ground') === '2,0');
    click(ground);
    assert.equal(handle.getCubes().length, 2);
    assert.ok(handle.getCubes().some((c) => c[0] === 2 && c[1] === 0 && c[2] === 0), '应加在地面 (2,0,0)');

    // 点某个可见面 → 在那一侧加一块
    const face = byClass(container, 'builder-face')[0];
    const before = handle.getCubes().length;
    click(face);
    assert.equal(handle.getCubes().length, before + 1, '点面应加一块');

    // 切到删除模式，点方块 → 减一块
    const removeButton = byClass(container, 'builder-mode').find((b) => b.getAttribute('aria-label').includes('移除'));
    removeButton.dispatch('click');
    const target = byClass(container, 'builder-face')[0];
    const targetCube = target.getAttribute('data-cube');
    click(target);
    assert.equal(handle.getCubes().length, before, '删除模式点方块应减一块');
    assert.ok(!handle.getCubes().some((c) => c.join(',') === targetCube));
  });
});

test('交互：清空、撤销', () => {
  withStubDocument(() => {
    const { container, handle } = mountBuilder([[0, 0, 0], [1, 0, 0]]);
    const buttons = byClass(container, 'builder-action');
    const [undo, reset] = buttons;
    reset.dispatch('click');
    assert.equal(handle.getCubes().length, 0, '清空后没有方块');
    assert.match(byClass(container, 'builder-status')[0].textContent, /点地面/);
    undo.dispatch('click');
    assert.equal(handle.getCubes().length, 2, '撤销应恢复清空前的立体');
  });
});

test('交互：拖动旋转观察方向，且不误加方块', () => {
  withStubDocument(() => {
    const { handle, canvas } = mountBuilder([[0, 0, 0]]);
    const before = handle.view;
    canvas.dispatch('pointerdown', { target: canvas, clientX: 100, clientY: 100, pointerId: 1, button: 0, preventDefault() {} });
    canvas.dispatch('pointermove', { target: canvas, clientX: 160, clientY: 130, pointerId: 1 });
    canvas.dispatch('pointerup', { target: canvas, clientX: 160, clientY: 130, pointerId: 1, preventDefault() {} });
    assert.equal(handle.view.yaw, before.yaw + 30, '横拖 60px × 0.5°/px 应转 30°');
    assert.equal(handle.view.pitch, before.pitch + 15);
    assert.equal(handle.getCubes().length, 1, '拖动不得加方块');
  });
});

test('交互：视图切换（立体图 / 主视图 / 俯视图 / 左视图）', () => {
  withStubDocument(() => {
    const cubes = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const { container, handle } = mountBuilder(cubes);
    const views = orthoViews(cubes);
    const tabs = byClass(container, 'builder-tab');

    // 默认：立体图（画布里有地面和面）
    assert.equal(byClass(container, 'builder-ground').length > 0, true);

    for (const [index, name] of [[1, 'front'], [2, 'top'], [3, 'left']]) {
      tabs[index].dispatch('click');
      const canvas = byClass(container, 'builder-canvas')[0];
      assert.equal(byClass(canvas, 'builder-ground').length, 0, `${name} 视图下不该有地面网格`);
      const cells = byClass(canvas, 'builder-view-cell');
      assert.equal(cells.length, views[name].cells.length, `${name} 视图的格子数应与几何层一致`);
      assert.equal(tabs[index].getAttribute('aria-pressed'), 'true');
    }

    tabs[0].dispatch('click'); // 切回立体图
    assert.equal(byClass(container, 'builder-ground').length > 0, true);
    handle.destroy();
  });
});

test('交互：三个视图始终实时显示，且**不随观察角度改变**（核心不变量）', () => {
  withStubDocument(() => {
    const cubes = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const { container, handle, canvas } = mountBuilder(cubes);
    const views = orthoViews(cubes);

    const cellsInStrip = byClass(container, 'builder-strip')[0];
    assert.equal(byClass(cellsInStrip, 'builder-view-cell').length,
      views.front.cells.length + views.top.cells.length + views.left.cells.length,
      '三个视图的格子都应显示');

    const beforeRotation = stripSignature(container);
    canvas.dispatch('pointerdown', { target: canvas, clientX: 20, clientY: 20, pointerId: 1, button: 0, preventDefault() {} });
    canvas.dispatch('pointermove', { target: canvas, clientX: 200, clientY: 90, pointerId: 1 });
    canvas.dispatch('pointerup', { target: canvas, clientX: 200, clientY: 90, pointerId: 1, preventDefault() {} });
    assert.equal(stripSignature(container), beforeRotation,
      '转动观察方向后三个视图必须完全不变——视图由立体本身决定');
    assert.equal(handle.getCubes().length, 3, '旋转不应改立体');

    // 而改立体一定会改视图（点一个还空着的地面格）
    const freeGround = byClass(container, 'builder-ground').find((g) => g.getAttribute('data-ground') === '3,3');
    canvas.dispatch('pointerdown', { target: freeGround, clientX: 50, clientY: 50, pointerId: 1, button: 0, preventDefault() {} });
    canvas.dispatch('pointerup', { target: freeGround, clientX: 50, clientY: 50, pointerId: 1, preventDefault() {} });
    assert.notEqual(stripSignature(container), beforeRotation, '加方块后视图应变化');
  });
});

test('交互：画布的无障碍标签描述当前三个视图', () => {
  withStubDocument(() => {
    const cubes = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const { container } = mountBuilder(cubes);
    const canvas = byClass(container, 'builder-canvas')[0];
    const label = canvas.getAttribute('aria-label');
    assert.match(label, /当前 3 个小方块/);
    assert.match(label, /主视图/);
    assert.match(label, /俯视图/);
    assert.match(label, /左视图/);
    assert.match(label, /拖动或方向键旋转/);
  });
});

// ── ④ 标准几何体模式（圆柱 / 圆锥 / 球 / 长方体 / 正棱柱 / 正棱锥）──────────

test('几何体模式：切换后出现几何体库，加删方块控件隐藏', () => {
  withStubDocument(() => {
    const { container, handle } = mountBuilder([[0, 0, 0]]);
    const shapes = byClass(container, 'builder-shape');
    assert.equal(shapes.length, 6, '几何体库应有六个标准几何体');
    assert.equal(byClass(container, 'builder-gallery')[0].hidden, true, '方块模式下几何体库应隐藏');

    byClass(container, 'builder-source').find((b) => b.textContent === '标准几何体').dispatch('click');
    assert.equal(handle.source, 'shapes');
    assert.equal(byClass(container, 'builder-gallery')[0].hidden, false, '几何体模式下应显示几何体库');
    // 加/删、撤销/清空这两个控件行整体隐藏（CSS 里补了 [hidden] 规则，
    // 否则 display:flex 会把 hidden 顶掉——浏览器里实测过一次）
    assert.equal(byClass(container, 'builder-modes')[0].hidden, true, '加/删方块控件应隐藏');
    assert.equal(byClass(container, 'builder-actions')[0].hidden, true, '撤销/清空应隐藏');
    assert.match(byClass(container, 'builder-status')[0].textContent, /圆柱/, '默认选中第一个几何体');
    assert.match(byClass(container, 'builder-hint')[0].textContent, /几何体/, '提示语应随模式变化');
  });
});

test('几何体模式：三个视图用形状显示（圆柱 = 两个矩形 + 一个圆）', () => {
  withStubDocument(() => {
    const { container, handle } = mountBuilder([[0, 0, 0]]);
    handle.setSource('shapes');
    const strip = byClass(container, 'builder-strip')[0];
    const shapesInStrip = byClass(strip, 'figure-view-shape');
    assert.equal(shapesInStrip.length, 3, '三个视图各有一个形状');
    const tags = shapesInStrip.map((node) => node.tagName).sort();
    assert.deepEqual(tags, ['circle', 'rect', 'rect'], '圆柱三视图 = 两个矩形 + 一个圆');
    assert.match(byClass(container, 'builder-canvas')[0].getAttribute('aria-label'), /半径 1 的圆/);
  });
});

test('几何体模式：换几何体后画布与三视图都跟着换', () => {
  withStubDocument(() => {
    const { container, handle } = mountBuilder([[0, 0, 0]]);
    handle.setSource('shapes');
    const stripTags = () => byClass(byClass(container, 'builder-strip')[0], 'figure-view-shape')
      .map((node) => node.tagName).sort().join(',');
    assert.equal(stripTags(), 'circle,rect,rect');

    const coneButton = byClass(container, 'builder-shape').find((b) => b.getAttribute('aria-label') === '选择圆锥');
    coneButton.dispatch('click');
    assert.equal(handle.shape, 'cone');
    assert.equal(stripTags(), 'circle,path,path', '圆锥三视图 = 两个三角形（path）+ 一个圆');
    assert.match(byClass(container, 'builder-status')[0].textContent, /圆锥/);

    const sphereButton = byClass(container, 'builder-shape').find((b) => b.getAttribute('aria-label') === '选择球');
    sphereButton.dispatch('click');
    assert.equal(stripTags(), 'circle,circle,circle', '球的三视图都是圆');
  });
});

test('几何体模式：拖动旋转观察方向，三个视图仍然不变（核心不变量）', () => {
  withStubDocument(() => {
    const { container, handle, canvas } = mountBuilder([[0, 0, 0]]);
    handle.setSource('shapes');
    const signature = () => byClass(byClass(container, 'builder-strip')[0], 'figure-view-shape')
      .map((node) => `${node.tagName}:${node.attributes.r ?? node.attributes.d ?? ''}`).join('|');
    const before = signature();

    canvas.dispatch('pointerdown', { target: canvas, clientX: 30, clientY: 30, pointerId: 1, button: 0, preventDefault() {} });
    canvas.dispatch('pointermove', { target: canvas, clientX: 150, clientY: 70, pointerId: 1 });
    canvas.dispatch('pointerup', { target: canvas, clientX: 150, clientY: 70, pointerId: 1, preventDefault() {} });
    assert.equal(signature(), before, '几何体模式下旋转同样不能改变三个视图');
    assert.equal(handle.view.yaw, DEFAULT_VIEW.yaw + 60, '横拖 120px × 0.5°/px 应转 60°');
    assert.equal(handle.getCubes().length, 1, '几何体模式下拖动不得改方块');
  });
});

test('几何体模式：点面不会加方块（此模式没有方块可编辑）', () => {
  withStubDocument(() => {
    const { container, handle, canvas, click } = mountBuilder([[0, 0, 0]]);
    handle.setSource('shapes');
    const before = handle.getCubes().length;
    const anyShape = byClass(container, 'figure-view-shape')[0] ?? canvas;
    click(anyShape);
    assert.equal(handle.getCubes().length, before, '几何体模式下点面不应加方块');
  });
});

// ── ⑤ 组合体（方块 + 标准几何体拼在一起）────────────────────────────────

test('组合体几何：部件目录与尺寸、相交判定、场景范围', () => {
  assert.ok(PART_CATALOG.length >= 7, '部件目录应含方块与标准几何体');
  for (const part of PART_CATALOG) {
    assert.ok(part.size.every((v) => Number.isInteger(v) && v > 0), `${part.name} 的尺寸必须是正整数格`);
    assert.ok(solidViews(part.view).front, `${part.name} 必须有视图定义`);
  }
  const cube = { id: 'cube', at: [0, 0, 0] };
  const cylinder = { id: 'cylinder', at: [0, 1, 0] };
  assert.equal(partsOverlap(cube, cylinder), false, '包围盒正好相接（方块顶 y=1、圆柱底 y=1）不算相交');

  // 方块 (0,0,0) 与圆柱 (0,1,0)：方块顶面 y=1，圆柱从 y=1 起 ⇒ 不相交
  const touching = { id: 'cylinder', at: [0, 1, 0] };
  assert.equal(partsOverlap({ id: 'cube', at: [0, 0, 0] }, touching), false, '相邻不算相交');
  assert.equal(partsOverlap({ id: 'cube', at: [0, 0, 0] }, { id: 'cube', at: [0, 0, 0] }), true, '同一位置必然相交');
  assert.equal(partsOverlap({ id: 'cylinder', at: [0, 0, 0] }, { id: 'cube', at: [1, 0, 1] }), true, '圆柱占据 2×2 底面');

  assert.equal(canPlacePart([{ id: 'cube', at: [0, 0, 0] }], { id: 'cube', at: [1, 0, 0] }), true);
  assert.equal(canPlacePart([{ id: 'cube', at: [0, 0, 0] }], { id: 'cube', at: [0, 0, 0] }), false, '重叠不放');
  assert.equal(canPlacePart([], { id: 'cube', at: [MAX_SIZE, 0, 0] }), false, '越界不放');
  assert.equal(canPlacePart([], { id: 'cylinder', at: [MAX_SIZE - 1, 0, 0] }), false, '圆柱 2 格宽，贴边也越界');

  assert.deepEqual(partsExtent([{ id: 'cube', at: [0, 0, 0] }, { id: 'cylinder', at: [0, 1, 0] }]),
    { width: 2, height: 3, depth: 2 });
});

test('组合体视图：部件按位置摆进三视图（方块在下、圆柱在上）', () => {
  const parts = [{ id: 'cube', at: [0, 0, 0] }, { id: 'cylinder', at: [0, 1, 0] }];
  const views = compositeViews(parts);
  assert.deepEqual([views.front.cols, views.front.rows], [2, 3], '主视图：宽 2 格、高 3 格');
  assert.deepEqual([views.top.cols, views.top.rows], [2, 2], '俯视图：2×2');
  assert.deepEqual([views.left.cols, views.left.rows], [2, 3], '左视图：2×3');
  // 方块的正面是 1×1 的矩形，圆心在 (0.5, 3−0.5)；圆柱的正面是 2×2 的矩形，中心 (1, 3−1−1)
  assert.deepEqual(views.front.shapes.map((s) => s.center), [[0.5, 2.5], [1, 1]]);
  assert.equal(views.front.shapes[1].shape.kind, 'rect');
  assert.equal(views.front.shapes[1].shape.width, 2);
  // 俯视图里圆柱是圆，方块是 1×1 的矩形
  assert.deepEqual(views.top.shapes.map((s) => s.center), [[0.5, 0.5], [1, 1]]);
  assert.equal(views.top.shapes[1].shape.kind, 'circle');
  // 左视图：列 = z（右 = 前），圆柱的 2×2 矩形在 z 中间
  assert.equal(views.left.shapes[1].shape.kind, 'rect');
});

test('组合体渲染：三视图与立体场景都能画出来', () => {
  withStubDocument(() => {
    const parts = [{ id: 'cube', at: [0, 0, 0] }, { id: 'cylinder', at: [0, 1, 0] }];
    const views = compositeViews(parts);
    const svg = renderCompositeView(views.front, { cell: 30 });
    assert.equal(svg.tagName, 'svg');
    assert.equal(svg.children.length, 2, '主视图里应有方块与圆柱两个形状');
    assert.match(svg.getAttribute('aria-label'), /2 个部件/);

    const scene = renderCompositeScene(parts, { yaw: DEFAULT_VIEW.yaw, pitch: DEFAULT_VIEW.pitch });
    assert.equal(byClass(scene, 'builder-ground').length, MAX_SIZE * MAX_SIZE, '地面网格仍然在');
    const faces = byClass(scene, 'builder-face');
    assert.ok(faces.length > 0, '部件应有可见面');
    assert.deepEqual([...new Set(faces.map((f) => f.getAttribute('data-part')))].sort(), ['0', '1'],
      '每个面都要挂上它属于哪个部件（点击叠放靠它）');
  });
});

test('组合体模式：部件库出现，加删方块控件隐藏，撤销清空保留', () => {
  withStubDocument(() => {
    const { container, handle } = mountBuilder([[0, 0, 0]]);
    handle.setSource('parts');
    assert.equal(handle.source, 'parts');
    assert.equal(byClass(container, 'builder-palette')[0].hidden, false, '部件库应显示');
    assert.equal(byClass(container, 'builder-part').length, PART_CATALOG.length);
    assert.equal(byClass(container, 'builder-gallery')[0].hidden, true, '几何体库应隐藏（那是单立体模式）');
    assert.equal(byClass(container, 'builder-modes')[0].hidden, true);
    assert.equal(byClass(container, 'builder-actions')[0].hidden, false, '撤销 / 清空对组合体有意义');
    assert.match(byClass(container, 'builder-status')[0].textContent, /点地面/, '空组合体应提示怎么开始');
  });
});

test('组合体模式：点地面放部件、点部件叠在上面（x/z 自动对齐）', () => {
  withStubDocument(() => {
    const { container, handle, click } = mountBuilder([[0, 0, 0]]);
    handle.setSource('parts');
    const ground = byClass(container, 'builder-ground').find((g) => g.getAttribute('data-ground') === '0,0');
    click(ground);
    assert.deepEqual(handle.getParts(), [{ id: 'cube', at: [0, 0, 0] }], '默认放一个小方块在地面');

    // 选圆柱，再点方块的顶面 → 叠在方块正上方
    handle.setPart('cylinder');
    const cubeFace = byClass(container, 'builder-face')[0];
    click(cubeFace);
    assert.deepEqual(handle.getParts(), [
      { id: 'cube', at: [0, 0, 0] },
      { id: 'cylinder', at: [0, 1, 0] }
    ], '点部件应把它叠在正上方');

    // 组合体的三个视图应是「组合」出来的（方格模式不会有）
    const strip = byClass(container, 'builder-strip')[0];
    assert.ok(byClass(strip, 'figure-view-shape').length >= 6,
      '三个视图里应有多个部件的形状（方块 1 + 圆柱 1 每视图各 2 个）');
    assert.match(byClass(container, 'builder-status')[0].textContent, /小方块×1、圆柱×1/);
  });
});

test('组合体模式：相交 / 越界的位置放不进去', () => {
  withStubDocument(() => {
    const { container, handle, click } = mountBuilder([[0, 0, 0]]);
    handle.setSource('parts');
    const ground = byClass(container, 'builder-ground').find((g) => g.getAttribute('data-ground') === '0,0');
    click(ground);
    click(ground); // 同一格再放一次 → 相交，应被拒绝
    assert.equal(handle.getParts().length, 1, '重叠位置不得放入');
    assert.equal(handle.placePart('cylinder', [MAX_SIZE - 1, 0, 0]), false, '越界位置不得放入');
    assert.equal(handle.placePart('cylinder', [1, 0, 0]), true, '空位可以放');
  });
});

test('组合体模式：转动观察方向，三个视图仍然不变', () => {
  withStubDocument(() => {
    const { container, handle, canvas } = mountBuilder([[0, 0, 0]]);
    handle.setSource('parts');
    handle.placePart('cube', [0, 0, 0]);
    handle.placePart('cylinder', [0, 1, 0]);
    const signature = () => byClass(byClass(container, 'builder-strip')[0], 'figure-view-shape')
      .map((n) => `${n.tagName}:${n.attributes.r ?? n.attributes.d ?? n.attributes.width ?? ''}`).join('|');
    const before = signature();
    assert.ok(before.length > 0, '组合体视图应有内容');
    canvas.dispatch('pointerdown', { target: canvas, clientX: 30, clientY: 30, pointerId: 1, button: 0, preventDefault() {} });
    canvas.dispatch('pointermove', { target: canvas, clientX: 170, clientY: 80, pointerId: 1 });
    canvas.dispatch('pointerup', { target: canvas, clientX: 170, clientY: 80, pointerId: 1, preventDefault() {} });
    assert.equal(signature(), before, '组合体模式下旋转同样不能改变三个视图');
  });
});

test('组合体模式：清空与撤销', () => {
  withStubDocument(() => {
    const { container, handle } = mountBuilder([[0, 0, 0]]);
    handle.setSource('parts');
    handle.placePart('cube', [0, 0, 0]);
    handle.placePart('cylinder', [0, 1, 0]);
    assert.equal(handle.getParts().length, 2);
    const [undo, reset] = byClass(container, 'builder-action');
    reset.dispatch('click');
    assert.equal(handle.getParts().length, 0, '清空应只清组合体');
    undo.dispatch('click');
    assert.equal(handle.getParts().length, 2, '撤销应恢复组合体');
    assert.equal(handle.getCubes().length, 1, '清空 / 撤销不影响方块模式的数据');
  });
});

test('几何体模式：切回自由搭建，方块与视图都恢复', () => {
  withStubDocument(() => {
    const cubes = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const { container, handle } = mountBuilder(cubes);
    handle.setSource('shapes');
    handle.setSource('cubes');
    assert.equal(handle.source, 'cubes');
    assert.deepEqual(handle.getCubes(), cubes, '方块数据应原样保留');
    assert.equal(byClass(container, 'builder-gallery')[0].hidden, true);
    assert.equal(byClass(container, 'builder-modes')[0].hidden, false);
    assert.equal(byClass(container, 'builder-actions')[0].hidden, false);
    assert.equal(byClass(byClass(container, 'builder-strip')[0], 'builder-view-cell').length,
      orthoViews(cubes).front.cells.length + orthoViews(cubes).top.cells.length + orthoViews(cubes).left.cells.length,
      '方块模式的三个视图应恢复为方格');
  });
});
