// 折叠动画的几何校验。
//
// 这个动画的中间帧是「插值」出来的，但**两端必须严格正确**：
//   t=0 要与原图逐格一致（完全摊平），t=1 要与 net-fold 的折叠结果逐面一致（真立方体）。
// 只要两端对，中间帧即使不是严格刚体运动，作为教学演示也是可信的。
//
// 另一类必须守住的性质：非法展开图不得产出「看起来像立方体」的假动画。

import test from 'node:test';
import assert from 'node:assert/strict';
import { foldAnimationFrame, canAnimateFold } from '../public/js/fold-anim.js';
import { foldNet } from '../public/js/net-fold.js';

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

/** 覆盖不同类型拓扑的三张展开图。 */
const NETS = Object.freeze({
  '十字形': [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]],
  '阶梯形': [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3], [0, 4]],
  'T 形': [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2], [1, 3]],
  'Z 形': [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1], [4, 1]]
});

function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

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
    }
  }
});

test('折叠动画：t=1 每格正好落在立方体对应面上（位置与法向都精确）', () => {
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

test('折叠动画：中间帧数值有限、进度单调，且不会跳变', () => {
  const cells = NETS['十字形'];
  let previousSum = -Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    const frame = foldAnimationFrame(cells, t, { stagger: 0 });
    for (const cell of frame.cells) {
      assert.ok(cell.center.every(Number.isFinite), `t=${t} 出现非有限坐标`);
      assert.ok(cell.normal.every(Number.isFinite), `t=${t} 出现非有限法向`);
      assert.ok(Math.abs(Math.hypot(...cell.normal) - 1) < 1e-6, `t=${t} 法向未归一化`);
    }
    // 用「各格 z 之和」衡量整体折起程度，应随 t 单调不减
    const sum = frame.cells.reduce((acc, c) => acc + c.center[2], 0);
    assert.ok(sum >= previousSum - 1e-9, `t=${t} 整体折起程度回退了`);
    previousSum = sum;
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
