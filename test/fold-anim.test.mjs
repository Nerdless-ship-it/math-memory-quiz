// 折叠动画的几何校验。
//
// v2 起动画是**真铰链折叠**：每格绕它与折叠树父格共享的边做刚体 90° 旋转，
// 不再是 v1 的起止插值。因此除了「两端必须严格正确」之外，中间帧也有两条
// 可以精确断言的不变量——这正是「看起来像折叠」的数学定义：
//   连续：树上相邻两格的共享边在任意 t 严格重合（纸不撕开）；
//   刚体：每格四角在任意 t 恒为单位正方形（纸不拉伸变形）。
// 终态仍与 net-fold 的折叠结果逐面一致；非法展开图不得产出假动画。
//
// 注：真折叠里末页的 z 高度会先冲过终值再落回（绕铰链划弧、最后扣在顶面上），
// v1 时代的「各格 z 之和单调不减」对真实折叠**不成立**，已由上述两条取代。

import test from 'node:test';
import assert from 'node:assert/strict';
import { foldAnimationFrame, canAnimateFold, rotationBetweenRoots, axisAngleRotation } from '../public/js/fold-anim.js';
import { foldNet } from '../public/js/net-fold.js';
import { ITEMS as CUBE_NET_ITEMS } from '../public/subjects/cube-net.item.js';
import {
  viewRotation, viewDepth, facesViewer, effectiveView,
  renderFoldFrame, mountFoldAnimation, computeFit, VIEW_LIMITS
} from '../public/js/fold-anim-view.js';

/** 一个面在单位立方体（棱长 1、中心原点）里的中心位置。 */
const FACE_OFFSET = Object.freeze({
  front: [0, 0.5, 0], back: [0, -0.5, 0],
  top: [0, 0, 0.5], bottom: [0, 0, -0.5],
  right: [0.5, 0, 0], left: [-0.5, 0, 0]
});

/** 面名 → 外法向（右手系 front × top = right）。 */
const FACE_NORMAL = Object.freeze({
  front: [0, 1, 0], back: [0, -1, 0],
  top: [0, 0, 1], bottom: [0, 0, -1],
  right: [1, 0, 0], left: [-1, 0, 0]
});

/** 覆盖不同类型拓扑的四张展开图。 */
const NETS = Object.freeze({
  '十字形': [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]],
  '阶梯形': [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3], [0, 4]],
  'T 形': [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2], [1, 3]],
  'Z 形': [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1], [4, 1]]
});

function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

/**
 * 与 fold-anim.js 同一条规则重建折叠树（根 = cells[0]，BFS），
 * 返回树上相邻格对（含各自四角在树序里的对应关系由调用方按坐标匹配）。
 */
function foldTreePairs(cells) {
  const keyOf = ([c, r]) => `${c},${r}`;
  const byKey = new Map(cells.map((cell) => [keyOf(cell), cell]));
  const parentOf = new Map([[keyOf(cells[0]), null]]);
  const queue = [cells[0]];
  const pairs = [];
  while (queue.length) {
    const cell = queue.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = keyOf([cell[0] + dc, cell[1] + dr]);
      if (!byKey.has(nk) || parentOf.has(nk)) continue;
      parentOf.set(nk, keyOf(cell));
      const child = byKey.get(nk);
      pairs.push([cell, child]);
      queue.push(child);
    }
  }
  return pairs;
}

/** 树上相邻两格的共享边：两格中重合的那对格点（z=0 的格坐标）。 */
function sharedEdge(cellA, cellB) {
  const cornersOf = ([c, r]) => [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
  const key = ([c, r]) => `${c},${r}`;
  const setA = new Set(cornersOf(cellA).map(key));
  const shared = cornersOf(cellB).filter((p) => setA.has(key(p)));
  return shared; // 恰好 2 个（相邻格共享一条边）
}

/** 索引 i 的四角中心。 */
function centerOf(corners) {
  return corners
    .reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
    .map((v) => v / corners.length);
}

/** 四角是否构成边长 1 的正方形（刚体 + 尺度不变）。 */
function assertUnitSquare(corners, label) {
  const sides = [0, 1, 2, 3].map((i) => distance(corners[i], corners[(i + 1) % 4]));
  for (const side of sides) {
    assert.ok(Math.abs(side - 1) < 1e-9, `${label} 的边长不是 1：${side}`);
  }
  const diagonals = [distance(corners[0], corners[2]), distance(corners[1], corners[3])];
  for (const diagonal of diagonals) {
    assert.ok(Math.abs(diagonal - Math.SQRT2) < 1e-9, `${label} 的对角线不是 √2：${diagonal}`);
  }
}

test('折叠动画：t=0 是完整摊平的平面（每格在 z=0、法向 +z）', () => {
  for (const [name, cells] of Object.entries(NETS)) {
    const frame = foldAnimationFrame(cells, 0);
    assert.equal(frame.ok, true, `${name} 应可折叠`);
    assert.equal(frame.cells.length, 6, `${name} 应有 6 格`);
    for (const cell of frame.cells) {
      assert.ok(Math.abs(cell.center[2]) < 1e-9,
        `${name} 的格 ${JSON.stringify(cell.cell)} 在 t=0 时不在 z=0 平面：z=${cell.center[2]}`);
      assert.ok(Math.abs(cell.normal[2] - 1) < 1e-9,
        `${name} 的格 ${JSON.stringify(cell.cell)} 在 t=0 时法向不是 +z`);
      for (const corner of cell.corners) {
        assert.ok(Math.abs(corner[2]) < 1e-9, `${name} 的格 ${JSON.stringify(cell.cell)} 在 t=0 有角不在纸面`);
      }
      assertUnitSquare(cell.corners, `${name} t=0 的格 ${JSON.stringify(cell.cell)}`);
    }
  }
});

test('折叠动画：t=1 每格正好落在立方体对应面上（中心、四角与法向都精确）', () => {
  for (const [name, cells] of Object.entries(NETS)) {
    const frame = foldAnimationFrame(cells, 1);
    assert.equal(frame.ok, true, `${name} 应可折叠`);
    const faces = [];
    for (const cell of frame.cells) {
      assert.ok(cell.face, `${name} 的格 ${JSON.stringify(cell.cell)} 没有面名`);
      faces.push(cell.face);
      assert.ok(
        distance(cell.center, FACE_OFFSET[cell.face]) < 1e-9,
        `${name} 的格 ${JSON.stringify(cell.cell)} 中心不在 ${cell.face} 面上：` +
          `实际 ${JSON.stringify(cell.center)}，期望 ${JSON.stringify(FACE_OFFSET[cell.face])}`
      );
      assert.ok(
        distance(cell.normal, FACE_NORMAL[cell.face]) < 1e-9,
        `${name} 的格 ${JSON.stringify(cell.cell)} 法向与 ${cell.face} 不符`
      );
      // 四角必须恰好是该面在单位立方体上的四个角（集合相等，序可任意）
      const axisIndex = { front: 1, back: 1, top: 2, bottom: 2, right: 0, left: 0 }[cell.face];
      const tangents = [0, 1, 2].filter((i) => i !== axisIndex);
      const expected = [];
      for (const s1 of [-0.5, 0.5]) {
        for (const s2 of [-0.5, 0.5]) {
          const corner = [...FACE_OFFSET[cell.face]];
          corner[tangents[0]] += s1;
          corner[tangents[1]] += s2;
          expected.push(corner);
        }
      }
      const sortKey = (p) => p.map((v) => v.toFixed(6)).join(',');
      const actual = [...cell.corners].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      const want = expected.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      for (let i = 0; i < 4; i += 1) {
        assert.ok(distance(actual[i], want[i]) < 1e-9,
          `${name} 的格 ${JSON.stringify(cell.cell)} 在 ${cell.face} 面上的第 ${i} 角不符：` +
            `实际 ${JSON.stringify(actual[i])}，期望 ${JSON.stringify(want[i])}`);
      }
    }
    // 六格必须恰好铺满六个面（有重复就说明折叠结果不是立方体）
    assert.equal(new Set(faces).size, 6, `${name} 的 6 格没有铺满 6 个面：${faces.join(',')}`);
  }
});

test('折叠动画：t=1 的面分配与 net-fold 的地面真值逐格一致', () => {
  for (const [name, cells] of Object.entries(NETS)) {
    const truth = foldNet(cells);
    assert.equal(truth.ok, true, `${name} 在 net-fold 里应合法`);
    const frame = foldAnimationFrame(cells, 1);
    assert.deepEqual(
      frame.cells.map((c) => c.face),
      truth.faces,
      `${name} 的动画终态与 net-fold 的折叠结果不一致——说明两条路径对「哪格折到哪个面」的理解不同`
    );
  }
});

test('折叠动画：任意中间帧，折叠树上相邻格的共享边严格重合（纸不撕开）', () => {
  const samples = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
  for (const [name, cells] of Object.entries(NETS)) {
    const pairs = foldTreePairs(cells);
    assert.equal(pairs.length, 5, `${name} 的折叠树应有 5 条边`);
    for (const t of samples) {
      const frame = foldAnimationFrame(cells, t);
      const byKey = new Map(frame.cells.map((c) => [`${c.cell[0]},${c.cell[1]}`, c]));
      for (const [parentCell, childCell] of pairs) {
        const parent = byKey.get(`${parentCell[0]},${parentCell[1]}`);
        const child = byKey.get(`${childCell[0]},${childCell[1]}`);
        // 共享边在各自四角里的位置：按格坐标找出重合的两点
        const edge = sharedEdge(parentCell, childCell);
        assert.equal(edge.length, 2, `${name} 相邻格 ${parentCell}/${childCell} 应共享两点`);
        for (const point of edge) {
          const pk = `${point[0]},${point[1]}`;
          // 端点在四角数组里的下标：格 (c,r) 的角序为 (c,r)(c+1,r)(c+1,r+1)(c,r+1)
          const cornerIndex = (cell, [c, r]) => {
            const [cc, rr] = cell;
            if (c === cc && r === rr) return 0;
            if (c === cc + 1 && r === rr) return 1;
            if (c === cc + 1 && r === rr + 1) return 2;
            return 3;
          };
          const pp = parent.corners[cornerIndex(parentCell, point)];
          const cp = child.corners[cornerIndex(childCell, point)];
          const gap = distance(pp, cp);
          assert.ok(gap < 1e-9,
            `${name} t=${t} 处共享边点 ${pk} 撕开了 ${gap.toFixed(6)}（${parentCell}/${childCell}）`);
        }
      }
    }
  }
});

test('折叠动画：任意中间帧每格都是刚体（单位正方形），且对全部真题成立', () => {
  const samples = [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1];
  const allNets = [
    ...Object.values(NETS),
    ...CUBE_NET_ITEMS.map((item) => item.figure.spec.cells)
  ];
  for (const cells of allNets) {
    assert.equal(canAnimateFold(cells), true, '真题必须是合法展开图');
    for (const t of samples) {
      const frame = foldAnimationFrame(cells, t);
      assert.equal(frame.ok, true);
      for (const cell of frame.cells) {
        assertUnitSquare(cell.corners, `t=${t} 的格 ${JSON.stringify(cell.cell)}`);
        assert.ok(cell.center.every(Number.isFinite), `t=${t} 出现非有限坐标`);
        assert.ok(Math.abs(Math.hypot(...cell.normal) - 1) < 1e-6, `t=${t} 法向未归一化`);
        const cornerCenter = centerOf(cell.corners);
        assert.ok(distance(cornerCenter, cell.center) < 1e-9, `t=${t} 的 center 与四角平均不一致`);
      }
    }
  }
});

test('折叠动画：越界 t 被夹到 [0,1]，非法输入不产生假动画', () => {
  const cells = NETS['十字形'];
  assert.deepEqual(
    foldAnimationFrame(cells, 5).cells.map((c) => c.center),
    foldAnimationFrame(cells, 1).cells.map((c) => c.center),
    't>1 应与 t=1 完全一致'
  );
  assert.deepEqual(
    foldAnimationFrame(cells, -3).cells.map((c) => c.center),
    foldAnimationFrame(cells, 0).cells.map((c) => c.center),
    't<0 应与 t=0 完全一致'
  );

  // 非法展开图（两格折后重叠）：必须明确失败，而不是安静地画出一个假的立方体
  const invalid = [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 2]];
  const bad = foldAnimationFrame(invalid, 1);
  assert.equal(bad.ok, false, '非法展开图必须返回 ok:false');
  assert.equal(bad.cells.length, 0, '非法展开图不应给出任何格子状态');
  assert.ok(typeof bad.reason === 'string' && bad.reason.length > 0, '失败时必须给出原因');
  assert.equal(canAnimateFold(invalid), false);
  assert.equal(canAnimateFold(cells), true);
});

test('折叠动画：stagger 只改变时序，不改变两端状态', () => {
  const cells = NETS['阶梯形'];
  const a = foldAnimationFrame(cells, 0, { stagger: 0 });
  const b = foldAnimationFrame(cells, 0, { stagger: 0.5 });
  assert.deepEqual(a.cells.map((c) => c.center), b.cells.map((c) => c.center), 't=0 不应受 stagger 影响');
  const endA = foldAnimationFrame(cells, 1, { stagger: 0 });
  const endB = foldAnimationFrame(cells, 1, { stagger: 0.5 });
  assert.deepEqual(endA.cells.map((c) => c.center), endB.cells.map((c) => c.center), 't=1 不应受 stagger 影响');
});

// ── 观察视角（方向 / 角度）与遮挡 ────────────────────────────────────────
//
// 渲染层要真的画出 SVG，Node 里没有 document，所以这里装一个只满足用到的几个接口的
// 极简 stub——目的不是测 DOM，而是**测绘制顺序**：遮挡错误只能从「谁先画谁后画」看出来，
// 只测 viewDepth 这种纯函数挡不住「排序用错了键」的回归。

/** 极简 DOM stub（只实现 fold-anim-view 实际用到的接口）。 */
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
      setAttribute(key, value) { node.attributes[key] = String(value); },
      getAttribute(key) { return node.attributes[key]; },
      append(...items) { node.children.push(...items); },
      replaceChildren(...items) { node.children = [...items]; },
      addEventListener(type, fn) { (node.listeners[type] ??= []).push(fn); },
      dispatch(type, event) { for (const fn of node.listeners[type] ?? []) fn(event ?? { target: node }); },
      remove() {}
    };
    node.classList = {
      contains: (c) => (node.attributes.class ?? '').split(' ').filter(Boolean).includes(c),
      toggle: (c, force) => {
        const parts = new Set((node.attributes.class ?? '').split(' ').filter(Boolean));
        const want = force === undefined ? !parts.has(c) : Boolean(force);
        if (want) parts.add(c); else parts.delete(c);
        node.attributes.class = [...parts].join(' ');
        return want;
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

/** 可控时钟的 window stub：rAF 与 setTimeout 都由 step(ms) 手动推进。 */
function makeFakeWindow({ reduceMotion = false } = {}) {
  let now = 0;
  let nextId = 0;
  const rafQueue = new Map();
  const timers = new Map();
  return {
    matchMedia: () => ({ matches: reduceMotion }),
    requestAnimationFrame(cb) { nextId += 1; rafQueue.set(nextId, cb); return nextId; },
    cancelAnimationFrame(id) { rafQueue.delete(id); },
    setTimeout(cb, ms) { nextId += 1; timers.set(nextId, { cb, at: now + ms }); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    step(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) { // 先处理定时器（它们可能排 rAF）
        if (timer.at <= now) { timers.delete(id); timer.cb(); }
      }
      const cbs = [...rafQueue.values()];
      rafQueue.clear();
      for (const cb of cbs) cb(now);
    }
  };
}

/** 在挂载树里找「展开 ⇄ 折回」按钮。 */
function findDemoButton(container) {
  const controls = container.children[0].children.find((n) => n.className === 'fold-anim-controls');
  return controls.children.find((n) => n.tagName === 'button');
}

/** 在挂载树里找画布（拖动/点击/键盘交互都挂在它上面）。 */
function findStage(container) {
  return container.children[0].children.find((n) => n.className === 'fold-anim-stage');
}

/** 找某个编号对应的 face 路径节点（点击换底的命中目标）。 */
function findFacePath(container, cellIndex) {
  const svg = findStage(container).children[0];
  return svg.children.find((n) => n.tagName === 'path'
    && n.attributes['data-cell-index'] === String(cellIndex));
}

/** 模拟一次「按下即抬」的点击（位移 0 < CLICK_SLOP → 判定为点击而非拖动）。 */
function clickNode(stage, node) {
  stage.dispatch('pointerdown', { target: node, clientX: 100, clientY: 100, pointerId: 1, button: 0, preventDefault() {} });
  stage.dispatch('pointerup', { target: node, clientX: 100, clientY: 100, pointerId: 1 });
}

/** 一帧的完整签名：绘制顺序 + 每面的路径 + 编号文字（顺序即画家算法的顺序）。 */
function frameSignature(cells, t, options = {}) {
  const labels = cells.map((_, index) => String(index + 1));
  const svg = withStubDocument(() => renderFoldFrame(cells, t, { ...options, labels }));
  return svg.children.map((node) => (node.tagName === 'path'
    ? `${node.attributes.class}|${node.attributes.d}`
    : `text:${node.textContent}`));
}

/** 绘制顺序里每个编号的下标（用于判断谁盖住谁）。 */
function drawIndexByLabel(cells, t, options = {}) {
  const labels = cells.map((_, index) => String(index + 1));
  const svg = withStubDocument(() => renderFoldFrame(cells, t, { ...options, labels }));
  const order = new Map();
  let drawIndex = 0;
  for (let i = 0; i < svg.children.length; i += 1) {
    if (svg.children[i].tagName !== 'path') continue;
    // path 后面紧跟的就是这一格的编号文字——用它认脸，不能假设「第 k 个 path 就是编号 k+1」
    // （path 是按绘制顺序排的，编号顺序早就被打乱了）。
    const next = svg.children[i + 1];
    if (next?.tagName === 'text') order.set(next.textContent, drawIndex);
    drawIndex += 1;
  }
  return order;
}

const VIEW_SAMPLES = (() => {
  const samples = [];
  for (let yaw = -180; yaw <= 180; yaw += 45) {
    for (let pitch = -75; pitch <= 75; pitch += 25) samples.push([yaw, pitch]);
  }
  return samples;
})();

test('视角：yaw = pitch = 0 时严格等于原来的固定视角（默认画面不变）', () => {
  const toCamera = ([x, y, z]) => [x, -y, -z];
  const identity = viewRotation(0, 0);
  for (const p of [[0, 0, 0], [1, 2, 3], [-2.5, 0.25, -1], [3, -4, 0], [0.5, -0.5, 0.5]]) {
    const got = identity(p);
    const want = toCamera(p);
    // 逐分量比较：-0 与 0 在数值上等价（deepStrictEqual 会把它们判成不同）
    for (let i = 0; i < 3; i += 1) {
      assert.ok(
        got[i] === want[i],
        `${JSON.stringify(p)} 在默认视角下第 ${i} 个分量被改动：${got[i]} ≠ ${want[i]}`
      );
    }
  }
});

test('视角：旋转是刚体的（保长度），只改投影不改几何', () => {
  for (const [yaw, pitch] of VIEW_SAMPLES) {
    const rotate = viewRotation(yaw, pitch);
    const p = [0.7, -1.3, 2.1];
    const q = rotate(p);
    assert.ok(
      Math.abs(Math.hypot(...q) - Math.hypot(...p)) < 1e-9,
      `视角 (${yaw}, ${pitch}) 下长度被改变：${Math.hypot(...p)} → ${Math.hypot(...q)}`
    );
  }
});

test('视角：终态立方体里，可见面与不可见面被观察深度严格分开', () => {
  const frame = foldAnimationFrame(NETS['十字形'], 1);
  for (const [yaw, pitch] of VIEW_SAMPLES) {
    const rotate = viewRotation(yaw, pitch);
    const items = frame.cells.map((cell) => ({
      face: cell.face,
      depth: viewDepth(rotate(cell.center)),
      visible: facesViewer(rotate(cell.normal))
    }));
    const visible = items.filter((i) => i.visible);
    const hidden = items.filter((i) => !i.visible);
    assert.equal(visible.length, 3, `视角 (${yaw}, ${pitch}) 下可见面不是 3 个`);
    assert.equal(hidden.length, 3, `视角 (${yaw}, ${pitch}) 下不可见面不是 3 个`);
    assert.ok(
      Math.max(...hidden.map((i) => i.depth)) < Math.min(...visible.map((i) => i.depth)),
      `视角 (${yaw}, ${pitch}) 下可见/不可见面深度区间重叠——排序会画错`
    );
  }
});

test('视角：渲染出的绘制顺序把所有不可见面排在可见面之前（旧启发式会在这里挂）', () => {
  const cells = NETS['十字形'];
  const frame = foldAnimationFrame(cells, 1);
  const faceOf = new Map(frame.cells.map((cell, i) => [String(i + 1), cell.face]));
  for (const [yaw, pitch] of VIEW_SAMPLES) {
    const rotate = viewRotation(yaw, pitch);
    const visibleLabels = new Set();
    frame.cells.forEach((cell, i) => {
      if (facesViewer(rotate(cell.normal))) visibleLabels.add(String(i + 1));
    });
    const order = drawIndexByLabel(cells, 1, { direction: 'fold', yaw, pitch });
    const lastHidden = Math.max(...[...order.entries()]
      .filter(([label]) => !visibleLabels.has(label)).map(([, index]) => index));
    const firstVisible = Math.min(...[...order.entries()]
      .filter(([label]) => visibleLabels.has(label)).map(([, index]) => index));
    assert.ok(
      lastHidden < firstVisible,
      `视角 (${yaw}, ${pitch}) 下不可见面 ${faceOf.get('1')} 之后还有可见面被画——会盖住正面`
    );
  }
});

test('播放方向：展开就是折叠的时间反演（逐帧的几何与顺序完全一致）', () => {
  const cells = NETS['十字形'];
  for (const t of [0, 0.2, 0.35, 0.5, 0.7, 0.85, 1]) {
    assert.deepEqual(
      frameSignature(cells, t, { direction: 'unfold' }),
      frameSignature(cells, 1 - t, { direction: 'fold' }),
      `t=${t} 的展开帧不等于 t=${1 - t} 的折叠帧——两个方向不是同一条运动`
    );
  }
  assert.deepEqual(
    frameSignature(cells, 0, { direction: 'unfold' }),
    frameSignature(cells, 1, { direction: 'fold' }),
    '展开的起始帧必须是折好的立方体'
  );
});

test('播放方向：默认就是展开（起始帧是立方体、结束帧是展开图），非法展开图照旧报错', () => {
  const cells = NETS['T 形'];
  assert.deepEqual(
    frameSignature(cells, 0, {}),
    frameSignature(cells, 1, { direction: 'fold' }),
    '不传 direction 时起始帧应是折好的立方体——默认从立方体开始展开'
  );
  assert.deepEqual(
    frameSignature(cells, 1, {}),
    frameSignature(cells, 0, { direction: 'fold' }),
    '展开的结束帧应是摊平的展开图'
  );
  assert.deepEqual(VIEW_LIMITS, { yaw: 180, pitch: 75 });
  const invalid = [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 2]];
  assert.throws(
    () => withStubDocument(() => renderFoldFrame(invalid, 0.5, {})),
    /展开图不合法/,
    '非法展开图必须抛错而不是画出一个假的动画'
  );
});

// ── 自动适配（修「折叠图被挡住」）────────────────────────────────────────
// 立方体只占 ~1.7 格，摊平的展开图最高 4 格：固定比例尺必然裁掉摊平图的顶部/底部。
// 这组测试直接断言**渲染出来的每一个顶点**都在画布内——比只测 computeFit 的数值更接近
// 用户看到的画面。

/** 从 path 的 d 属性解析全部顶点坐标。 */
function pathVertices(d) {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

const FIT_VIEWS = [
  [0, 0], [45, 0], [90, 0], [135, 0], [-60, 35],
  [30, -40], [180, 20], [-135, -75], [-45, 75]
];
// 采样比 computeFit 内部更密的 t：交叉验证「采样 5 帧算包围盒」对中间帧也够保守
const FIT_TIMES = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];

test('自动适配：全部真题在任何视角、任何一帧都不出画布（修复「被挡住」）', () => {
  assert.equal(CUBE_NET_ITEMS.length > 0, true, '真题数据必须存在');
  for (const item of CUBE_NET_ITEMS) {
    const cells = item.figure.spec.cells;
    const labels = cells.map((_, i) => String(i + 1));
    for (const [yaw, pitch] of FIT_VIEWS) {
      for (const t of FIT_TIMES) {
        const svg = withStubDocument(() => renderFoldFrame(cells, t, { yaw, pitch, labels }));
        for (const node of svg.children) {
          if (node.tagName !== 'path') continue;
          for (const [x, y] of pathVertices(node.attributes.d)) {
            assert.ok(
              x >= -1 && x <= 201 && y >= -1 && y <= 201,
              `${item.id} @ 视角(${yaw},${pitch}) t=${t} 顶点 (${x}, ${y}) 探出 200×200 画布`
            );
          }
        }
      }
    }
  }
});

test('自动适配：fit=false 退回固定比例尺，此时 4 格高展开图确实会出画布（原 bug 现场）', () => {
  // 用户截图的第 2 图就是 4 格高：摊平时投影高 4×62=248 > 200 画布
  const tall = CUBE_NET_ITEMS.find((item) => {
    const ys = item.figure.spec.cells.map((c) => c[1]);
    return Math.max(...ys) - Math.min(...ys) >= 3;
  });
  assert.ok(tall, '题库应含 4 格高的展开图（用户截图那一类）');
  const cells = tall.figure.spec.cells;
  const svg = withStubDocument(() => renderFoldFrame(cells, 1, { fit: false }));
  const ys = svg.children.filter((n) => n.tagName === 'path')
    .flatMap((n) => pathVertices(n.attributes.d).map(([, y]) => y));
  assert.ok(
    Math.min(...ys) < 0 || Math.max(...ys) > 200,
    'fit=false 时 4 格高展开图应超出画布——这正是被修掉的问题，测试必须能抓到它'
  );
  // 同一副图开 fit（默认）就完整落回画布
  const fitted = withStubDocument(() => renderFoldFrame(cells, 1, {}));
  const fittedYs = fitted.children.filter((n) => n.tagName === 'path')
    .flatMap((n) => pathVertices(n.attributes.d).map(([, y]) => y));
  assert.ok(Math.min(...fittedYs) >= -1 && Math.max(...fittedYs) <= 201,
    '默认 fit 下同一副展开图必须完整在画布内');
});

test('自动适配：computeFit 按 cells 引用与视角缓存；缩放只变比例不变几何顺序', () => {
  const cells = NETS['十字形'];
  const a = computeFit(cells, 0, 0);
  const b = computeFit(cells, 0, 0);
  assert.equal(a, b, '同 cells 同视角必须命中缓存（返回同一引用）');
  const c = computeFit(cells, 45, 0);
  assert.notEqual(a, c, '换视角必须重算，不能吃旧缓存');
  assert.ok(a.w > 0 && a.h > 0, '包围盒必须有效');
  // fit 只改比例与平移：默认方向的逐帧签名在 fit 开关下只应差坐标、不差绘制顺序
  const on = drawIndexByLabel(cells, 1, {});
  const off = drawIndexByLabel(cells, 1, { fit: false });
  assert.deepEqual([...on.keys()], [...off.keys()], 'fit 不得改变绘制顺序');
});

// ── 演示流程（播放引擎）─────────────────────────────────────────────────
// 用户要求：调角度应该看的是**立方体**的不同角度。所以自动演示「展开 → 停一拍 → 折回」，
// 最终停在立方体上；按钮是「展开 ⇄ 折成立方体」双向切换，中途可逆。

test('演示流程：自动播放「展开 → 停一拍 → 折回」，最终停在立方体上', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], {
      window: win, duration: 1000, hold: 500
    });
    const button = findDemoButton(container);
    assert.equal(handle.progress, 0, '挂载时应停在立方体');
    assert.match(button.textContent, /^展开$/, '停在立方体时按钮应是「展开」');

    handle.play();
    win.step(16); // 首帧只确定 startTime
    win.step(1000); // 展开放完
    assert.equal(handle.progress, 1, '展开结束应到展开图');
    assert.match(button.textContent, /折成立方体/, '停在展开图时按钮应是「折成立方体」');

    win.step(500); // 停一拍结束，开始折回
    win.step(1000); // 折回放完
    assert.equal(handle.progress, 0, '自动演示必须回到立方体——拖滑块看的才是立方体');
    assert.match(button.textContent, /^展开$/, '回到立方体后按钮应恢复「展开」');
    handle.destroy();
  });
});

test('演示流程：播放中途点按钮从当前位置反向（可逆），不会从头重播', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], {
      window: win, duration: 1000
    });
    const button = findDemoButton(container);
    handle.play();
    win.step(16);
    win.step(400); // 走到 40%
    const mid = handle.progress;
    assert.ok(mid > 0.2 && mid < 0.8, `应在中途（实际 ${mid}）`);
    button.dispatch('click'); // 折成立方体
    win.step(16); // 反向首帧
    win.step(500); // 跨度 ≈0.4 → 400ms 内放完
    assert.equal(handle.progress, 0, '中途反向应回到立方体');
    handle.destroy();
  });
});

test('演示流程：reduced-motion 下不做动画，按钮在两种端态间即时切换', () => {
  const win = makeFakeWindow({ reduceMotion: true });
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], { window: win, duration: 1000 });
    const button = findDemoButton(container);
    assert.equal(handle.progress, 0, '降级时停在立方体');
    assert.match(button.textContent, /显示展开图/);
    handle.play();
    assert.equal(handle.progress, 0, '降级时 play 不得移动到展开图');
    button.dispatch('click');
    assert.equal(handle.progress, 1, '降级时点击应即时到展开图');
    assert.match(button.textContent, /显示立方体/);
    button.dispatch('click');
    assert.equal(handle.progress, 0, '降级时再次点击应即时回立方体');
    handle.destroy();
  });
});

test('演示流程：拖动画面旋转视角（1:1 跟手），不打断播放、不改进度', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], {
      window: win, duration: 1000
    });
    const stage = findStage(container);
    handle.play();
    win.step(16);
    win.step(400);
    const before = handle.progress;
    stage.dispatch('pointerdown', { target: stage, clientX: 100, clientY: 100, pointerId: 1, button: 0, preventDefault() {} });
    stage.dispatch('pointermove', { target: stage, clientX: 160, clientY: 130, pointerId: 1 });
    assert.equal(handle.view.yaw, 24, '横拖 60px × 0.4°/px 应转 24°');
    assert.equal(handle.view.pitch, 12, '竖拖 30px × 0.4°/px 应转 12°');
    assert.equal(handle.progress, before, '拖动不得改变播放进度');
    stage.dispatch('pointermove', { target: stage, clientX: -400, clientY: 100, pointerId: 1 });
    assert.equal(handle.view.yaw, -180, '拖动结果要夹在 ±180°');
    stage.dispatch('pointerup', { target: stage, clientX: -400, clientY: 100, pointerId: 1 });
    win.step(600); // 播放应继续走到展开图
    assert.equal(handle.progress, 1, '拖动不得打断播放');
    handle.destroy();
  });
});

test('演示流程：方向键旋转视角（滑块移除后的键盘无障碍路径）', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], { window: win });
    const stage = findStage(container);
    assert.equal(stage.tabIndex, 0, '画布必须可聚焦，键盘才能操作');
    stage.dispatch('keydown', { key: 'ArrowRight', target: stage, preventDefault() {} });
    stage.dispatch('keydown', { key: 'ArrowRight', target: stage, preventDefault() {} });
    stage.dispatch('keydown', { key: 'ArrowDown', target: stage, preventDefault() {} });
    assert.deepEqual(handle.view, { yaw: 10, pitch: 5 }, '每次方向键应步进 5°');
    stage.dispatch('keydown', { key: 'a', target: stage, preventDefault() {} });
    assert.deepEqual(handle.view, { yaw: 10, pitch: 5 }, '非方向键不得改视角');
    handle.destroy();
  });
});

test('演示流程：不再有滑块（直接操控替代），画布有交互说明', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    mountFoldAnimation(container, NETS['十字形'], { window: win });
    const inputs = [];
    (function walk(node) {
      if (node.tagName === 'input') inputs.push(node);
      for (const child of node.children ?? []) walk(child);
    }(container));
    assert.equal(inputs.length, 0, '不应再有任何滑块 input');
    const stage = findStage(container);
    assert.match(stage.getAttribute('aria-label') ?? '', /拖动/, '画布应有用法说明');
  });
});

// ── 换底（点击任意面，以它为底展开 / 折叠）───────────────────────────────
// 用户要的灵活性：「点哪个面就以哪个面为底」。模型层 = 折叠树换根；
// 两个关键性质：摊平姿态与根无关（展开图上换底零跳变）、换根后立方体只差一个旋转
// （所以可以用一段原地转向补间过渡，姿态不跳）。

const FACE_NORMALS = {
  front: [0, 1, 0], back: [0, -1, 0], top: [0, 0, 1],
  bottom: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0]
};
const subV = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const normV = (a) => {
  const len = Math.hypot(...a) || 1;
  return a.map((v) => v / len);
};

test('换底：摊平姿态与根无关（展开图上点面换底零跳变的依据）', () => {
  for (const item of CUBE_NET_ITEMS) {
    const cells = item.figure.spec.cells;
    const base = foldAnimationFrame(cells, 0, { root: 0 });
    for (let root = 1; root < cells.length; root += 1) {
      const frame = foldAnimationFrame(cells, 0, { root });
      assert.ok(frame.ok, `${item.id} 以 ${root} 为根应合法`);
      for (let i = 0; i < cells.length; i += 1) {
        assert.deepEqual(
          frame.cells[i].corners, base.cells[i].corners,
          `${item.id} 以 ${root} 为底时摊平姿态变了——点面换底会跳变`
        );
      }
    }
  }
});

test('换底：rotationBetweenRoots 把旧姿态精确旋到新姿态（保长度、保角点）', () => {
  const cells = NETS['十字形'];
  const pose0 = foldAnimationFrame(cells, 1, { root: 0 });
  for (let root = 1; root < cells.length; root += 1) {
    const rot = rotationBetweenRoots(cells, 0, root);
    assert.ok(rot, '合法展开图换底必须给得出旋转');
    const pose1 = foldAnimationFrame(cells, 1, { root });
    const apply = axisAngleRotation(rot.axis, rot.angle);
    for (let i = 0; i < cells.length; i += 1) {
      const rotated = apply(pose0.cells[i].center);
      const want = pose1.cells[i].center;
      for (let k = 0; k < 3; k += 1) {
        assert.ok(
          Math.abs(rotated[k] - want[k]) < 1e-9,
          `换底 ${root} 后面 ${i} 中心对不上：[${rotated}] ≠ [${want}]`
        );
      }
      const p = pose0.cells[i].corners[0];
      assert.ok(
        Math.abs(Math.hypot(...apply(p)) - Math.hypot(...p)) < 1e-9,
        '换底旋转必须是刚体旋转（保长度）'
      );
    }
  }
  assert.equal(rotationBetweenRoots(cells, 2, 2).angle, 0, '同一个面换底角度应为 0');
});

test('换底：相对面之间换底是 180°，姿态映射仍精确（覆盖 matToAxisAngle 近 π 分支）', () => {
  const cells = NETS['十字形'];
  const folded = foldNet(cells);
  const n0 = FACE_NORMALS[folded.faces[0]];
  const opp = folded.faces.findIndex((f) => {
    const n = FACE_NORMALS[f];
    return n[0] === -n0[0] && n[1] === -n0[1] && n[2] === -n0[2];
  });
  assert.ok(opp > 0, '十字形里应存在与 0 号格相对的面');
  const rot = rotationBetweenRoots(cells, 0, opp);
  assert.ok(Math.abs(rot.angle - Math.PI) < 1e-6, `相对面换底应转 180°，实际 ${rot.angle}`);
  const pose0 = foldAnimationFrame(cells, 1, { root: 0 });
  const pose1 = foldAnimationFrame(cells, 1, { root: opp });
  const apply = axisAngleRotation(rot.axis, rot.angle);
  for (let i = 0; i < cells.length; i += 1) {
    const got = apply(pose0.cells[i].center);
    const want = pose1.cells[i].center;
    for (let k = 0; k < 3; k += 1) {
      assert.ok(Math.abs(got[k] - want[k]) < 1e-9, `180° 换底面 ${i} 中心对不上`);
    }
  }
});

test('换底：任意根折出的立方体，着色法向仍等于几何外法向（orient 矩阵的正确性）', () => {
  for (const item of CUBE_NET_ITEMS) {
    const cells = item.figure.spec.cells;
    for (let root = 0; root < cells.length; root += 1) {
      const frame = foldAnimationFrame(cells, 1, { root });
      for (const cellState of frame.cells) {
        const [p0, p1, , p3] = cellState.corners;
        const winding = normV(crossV(subV(p1, p0), subV(p3, p0))); // 卷绕法向（印刷面）
        // 纸向 +z 折起 → 印刷面朝内，立方体外法向 = −卷绕法向
        const outward = winding.map((v) => -v);
        for (let k = 0; k < 3; k += 1) {
          assert.ok(
            Math.abs(cellState.normal[k] - outward[k]) < 1e-9,
            `${item.id} 以 ${root} 为底时 ${cellState.face} 面着色法向 ≠ 外法向：` +
            `[${cellState.normal}] ≠ [${outward}]`
          );
        }
      }
    }
  }
});

test('换底：立方体上点面 → 原地转向补间后完整演示，最终新面为底停在立方体', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], {
      window: win, duration: 1000, hold: 500
    });
    const stage = findStage(container);
    assert.equal(handle.base, 0, '默认底面是 0 号格');
    clickNode(stage, findFacePath(container, 3));
    assert.equal(handle.base, 3, '点击应立即换底');
    win.step(16); // 转向补间开始
    win.step(200);
    assert.equal(handle.progress, 0, '补间期间仍在立方体（原地转向，不展开）');
    win.step(220); // 补间结束（REORIENT_MS = 420），进入展开
    win.step(16);
    win.step(1000);
    assert.equal(handle.progress, 1, '补间后应展开到展开图');
    win.step(500); // 停一拍
    win.step(1000); // 折回
    assert.equal(handle.progress, 0, '完整演示后停回立方体');
    assert.equal(handle.base, 3, '底面保持为点选的面');
    handle.destroy();
  });
});

test('换底：在展开图上点面 → 直接以它为底折成立方体', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], {
      window: win, duration: 1000, hold: 500
    });
    findDemoButton(container).dispatch('click'); // 切到展开图
    win.step(16);
    win.step(1000);
    assert.equal(handle.progress, 1);
    const stage = findStage(container);
    clickNode(stage, findFacePath(container, 4));
    assert.equal(handle.base, 4, '展开图上点面应立即换底（摊平姿态与根无关）');
    win.step(16);
    win.step(1000);
    assert.equal(handle.progress, 0, '应以新底折成立方体');
    assert.equal(handle.base, 4);
    handle.destroy();
  });
});

test('换底：展开途中点面 → 摊平时刻才生效，折回用新底（姿态不跳）', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], {
      window: win, duration: 1000, hold: 500
    });
    const stage = findStage(container);
    handle.play();
    win.step(16);
    win.step(400); // 展开途中
    clickNode(stage, findFacePath(container, 2));
    assert.equal(handle.base, 0, '展开途中不得立即换底（姿态会跳变）');
    win.step(600); // 走到摊平 → 换底生效
    assert.equal(handle.base, 2, '摊平时刻换底应生效');
    win.step(500); // 停一拍
    win.step(1000); // 折回
    assert.equal(handle.progress, 0);
    assert.equal(handle.base, 2, '折回后底面是点选的面');
    handle.destroy();
  });
});

test('换底：reduced-motion 下点面即时换底并停在立方体（无补间、无动画）', () => {
  const win = makeFakeWindow({ reduceMotion: true });
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], { window: win, duration: 1000 });
    const stage = findStage(container);
    clickNode(stage, findFacePath(container, 5));
    assert.equal(handle.base, 5, '降级时也应能换底');
    assert.equal(handle.progress, 0, '降级时换底后停在立方体');
    handle.destroy();
  });
});

test('换底：静止时悬停面有高亮提示，播放中不提示', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], { window: win, duration: 1000 });
    const stage = findStage(container);
    const path = findFacePath(container, 1);
    stage.dispatch('pointerover', { target: path });
    assert.ok(path.classList.contains('fold-face--hover'), '静止时悬停应加高亮类');
    stage.dispatch('pointerleave', { target: stage });
    assert.ok(!path.classList.contains('fold-face--hover'), '移出后高亮应消失');
    handle.play();
    stage.dispatch('pointerover', { target: path });
    assert.ok(!path.classList.contains('fold-face--hover'), '播放中不得加高亮');
    handle.destroy();
  });
});

// ── 视角规则：展开图永远正放（用户实测「展开图应该不带角度」）──────────────
// 规则：视角随立体程度缩放（effectiveView）。摊平 = 二维图、对照题干用，必须正放；
// 立方体用满用户视角；中间帧连续过渡；用户设定不丢，折回时恢复。

/** 画布当前帧的签名（绘制顺序 + 几何 + 编号）。 */
function stageSignature(stage) {
  const svg = stage.children[0];
  return svg.children.map((n) => (n.tagName === 'path'
    ? `${n.attributes.class}|${n.attributes.d}`
    : `text:${n.textContent}`));
}

/** 一帧里每个面路径的顶点环。 */
function framePaths(svg) {
  return svg.children.filter((n) => n.tagName === 'path').map((n) => {
    const nums = (n.attributes.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const poly = [];
    for (let i = 0; i + 1 < nums.length; i += 2) poly.push([nums[i], nums[i + 1]]);
    return poly;
  });
}

/** 「不带角度」的判据：每条边都严格水平或垂直（斜边 = 被转过）。 */
function isAxisAligned(polys) {
  return polys.every((poly) => poly.every((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6;
  }));
}

/** 所有顶点的包围盒长宽比（缩放无关的形状指纹）。 */
function boundsAspect(polys) {
  const xs = polys.flat().map((p) => p[0]);
  const ys = polys.flat().map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return w / h;
}

test('视角规则：effectiveView 按立体程度缩放视角', () => {
  assert.deepEqual(effectiveView(60, 30, 1), [60, 30], '立方体（mp=1）用满用户视角');
  assert.deepEqual(effectiveView(60, 30, 0.5), [30, 15], '中间帧减半');
  assert.deepEqual(effectiveView(60, 30, 0), [0, 0], '摊平（mp=0）归零正放');
  assert.deepEqual(effectiveView(-120, -75, 0.25), [-30, -18.75], '负值同样按比例');
});

test('视角规则：摊平的展开图永远正放（边全部水平/垂直），立方体才吃视角', () => {
  const cells = NETS['十字形'];
  const flat0 = withStubDocument(() => renderFoldFrame(cells, 1, { direction: 'unfold' }));
  assert.ok(isAxisAligned(framePaths(flat0)), '摊平状态必须是正放的二维图（边水平/垂直）');
  const aspect0 = boundsAspect(framePaths(flat0));
  for (const [yaw, pitch] of [[90, 40], [-135, -75], [45, 20], [180, 0], [0, 75]]) {
    const flat = withStubDocument(() => renderFoldFrame(cells, 1, { direction: 'unfold', yaw, pitch }));
    assert.ok(
      isAxisAligned(framePaths(flat)),
      `视角 (${yaw}, ${pitch}) 下摊平图必须仍正放——展开图不带角度`
    );
    assert.ok(
      Math.abs(boundsAspect(framePaths(flat)) - aspect0) < 1e-3,
      `视角 (${yaw}, ${pitch}) 下摊平图的形状不能变（只允许整体缩放）`
    );
    const flatFold = withStubDocument(() => renderFoldFrame(cells, 0, { direction: 'fold', yaw, pitch }));
    assert.ok(isAxisAligned(framePaths(flatFold)), 'fold 方向的摊平端（t=0）同样正放');
  }
  const cube = withStubDocument(() => renderFoldFrame(cells, 0, { direction: 'unfold', yaw: 40 }));
  assert.ok(!isAxisAligned(framePaths(cube)), '立方体状态必须保留用户视角——不能把立体也压平');
});

test('视角规则：展开图上拖动只记住设定、画面保持正放；折回立方体后视角恢复', () => {
  const win = makeFakeWindow();
  withStubDocument(() => {
    const container = globalThis.document.createElement('div');
    const handle = mountFoldAnimation(container, NETS['十字形'], {
      window: win, duration: 1000, hold: 500
    });
    const stage = findStage(container);
    findDemoButton(container).dispatch('click'); // 切到展开图
    win.step(16);
    win.step(1000);
    assert.equal(handle.progress, 1);

    const flatAspect = boundsAspect(framePaths(stage.children[0]));
    stage.dispatch('pointerdown', { target: stage, clientX: 100, clientY: 100, pointerId: 1, button: 0, preventDefault() {} });
    stage.dispatch('pointermove', { target: stage, clientX: 250, clientY: 150, pointerId: 1 });
    stage.dispatch('pointerup', { target: stage, clientX: 250, clientY: 150, pointerId: 1 });
    assert.equal(handle.view.yaw, 60, '拖动量要记在设定里（150px × 0.4°/px）');
    assert.ok(
      isAxisAligned(framePaths(stage.children[0])),
      '摊平状态拖动不得把展开图转斜——它始终正放'
    );
    assert.ok(Math.abs(boundsAspect(framePaths(stage.children[0])) - flatAspect) < 1e-3,
      '摊平状态拖动不得改变展开图形状');

    findDemoButton(container).dispatch('click'); // 折成立方体
    win.step(16);
    win.step(1000);
    assert.equal(handle.progress, 0);
    const cubeWithView = stageSignature(stage);
    handle.setView({ yaw: 0, pitch: 0 });
    assert.notDeepEqual(cubeWithView, stageSignature(stage),
      '折回立方体后，之前拖的 60° 应恢复到画面上');
    handle.destroy();
  });
});
