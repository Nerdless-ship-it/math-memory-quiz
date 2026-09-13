// 可组合立体（SDF）与任意切面的几何校验。
//
// 这套东西的价值主张是「**任意组合 + 任意切面**」——不需要为每种立体单独写求交代码。
// 因此测试的重点不是「某个形状对不对」，而是：
//   1. 组合运算（并/交/差）是否真的可组合，且截面回路数符合几何预期；
//   2. 数值精度是否达到「能用解析解核对」的程度；
//   3. 空心体的截面是否自然给出「外轮廓 + 洞」两条回路
//      （这是照片里「刀切空心部分不带线」那条规则的正确表达）。
//
// 全部用解析解核对，不看图说话。

import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, sectionLoops, polygonArea } from '../public/js/csg.js';

const area = (loop) => Math.abs(polygonArea(loop));
const totalLoopArea = (r) => r.outer.reduce((a, l) => a + area(l), 0);
const holeArea = (r) => r.holes.reduce((a, l) => a + area(l), 0);
const OPTS = { extent: 2.2, resolution: 192 };

test('圆柱：水平切得到圆，面积 = πr²', () => {
  const r = sectionLoops({ type: 'cylinder', radius: 1, height: 2 }, [0, 0, 1], 0, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.outer.length, 1);
  assert.equal(r.holes.length, 0);
  assert.ok(Math.abs(totalLoopArea(r) - Math.PI) < 0.02,
    `面积应约为 π≈3.1416，实际 ${totalLoopArea(r).toFixed(4)}`);
});

test('圆柱：斜切 45° 得到椭圆，面积 = πab = π√2', () => {
  const r = sectionLoops({ type: 'cylinder', radius: 1, height: 2 }, [1, 0, 1], 0, OPTS);
  assert.equal(r.ok, true);
  // 斜切圆柱的截面是椭圆，半轴 a=√2、b=1 ⇒ 面积 π√2
  const expected = Math.PI * Math.SQRT2;
  assert.ok(Math.abs(totalLoopArea(r) - expected) < 0.05,
    `面积应约为 π√2≈4.4429，实际 ${totalLoopArea(r).toFixed(4)}`);
});

test('空心圆柱：截面自然给出「1 条外轮廓 + 1 个洞」，洞面积 = π(r内)²', () => {
  const hollow = {
    type: 'subtract',
    base: { type: 'cylinder', radius: 1, height: 2 },
    tool: { type: 'cylinder', radius: 0.5, height: 2.4 }
  };
  const r = sectionLoops(hollow, [0, 0, 1], 0, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.outer.length, 1, '应恰好 1 条外轮廓');
  assert.equal(r.holes.length, 1, '应恰好 1 个洞（这就是「刀切空心部分不带线」的表达）');
  assert.ok(Math.abs(holeArea(r) - Math.PI * 0.25) < 0.02,
    `洞面积应约为 π/4≈0.7854，实际 ${holeArea(r).toFixed(4)}`);
});

test('空心圆柱：斜切时外轮廓与洞保持面积比 = (r外/r内)²', () => {
  const hollow = {
    type: 'subtract',
    base: { type: 'cylinder', radius: 1, height: 2 },
    tool: { type: 'cylinder', radius: 0.5, height: 2.4 }
  };
  const r = sectionLoops(hollow, [1, 0, 1], 0, OPTS);
  assert.equal(r.outer.length, 1);
  assert.equal(r.holes.length, 1);
  const ratio = totalLoopArea(r) / holeArea(r);
  // 内外都是椭圆，且椭圆由同一个平面与同轴圆柱相交得到 ⇒ 面积比恒为半径比的平方 4
  assert.ok(Math.abs(ratio - 4) < 0.05, `面积比应为 4，实际 ${ratio.toFixed(4)}`);
});

test('正方体挖球：洞面积随切面高度变化，与解析式 π(1−d²) 吻合', () => {
  const solid = {
    type: 'subtract',
    base: { type: 'box', size: 2 },
    tool: { type: 'sphere', radius: 1 }
  };
  for (const d of [-0.8, -0.5, -0.2, 0.2, 0.5, 0.8]) {
    const r = sectionLoops(solid, [0, 0, 1], d, OPTS);
    assert.equal(r.outer.length, 1, `d=${d} 应有 1 条外轮廓`);
    assert.equal(r.holes.length, 1, `d=${d} 应有 1 个洞`);
    const expected = Math.PI * (1 - d * d); // 球在该高度的截面半径 = √(1−d²)
    assert.ok(Math.abs(holeArea(r) - expected) < 0.03,
      `d=${d}: 洞面积应约为 ${expected.toFixed(4)}，实际 ${holeArea(r).toFixed(4)}`);
  }
});

test('退化情形：球内切于正方体、切面恰好过内切圆 → 4 条外轮廓、0 个洞', () => {
  const solid = {
    type: 'subtract',
    base: { type: 'box', size: 2 },
    tool: { type: 'sphere', radius: 1 }
  };
  const r = sectionLoops(solid, [0, 0, 1], 0, { extent: 2.2, resolution: 320 });
  // 内切圆把正方形分成 4 个互不相连的角块，每块面积 1−π/4
  assert.equal(r.outer.length, 4, `应得 4 条外轮廓（4 个角块），实际 ${r.outer.length}`);
  assert.equal(r.holes.length, 0, '角块是独立外轮廓，不该被误判成洞');
  for (const loop of r.outer) {
    assert.ok(Math.abs(area(loop) - (1 - Math.PI / 4)) < 0.01,
      `每个角块面积应约为 ${(1 - Math.PI / 4).toFixed(4)}，实际 ${area(loop).toFixed(4)}`);
  }
});

test('任意组合：正方体 ∪ 球，再挖圆柱通孔', () => {
  const solid = {
    type: 'subtract',
    base: { type: 'union', children: [{ type: 'box', size: 1.6 }, { type: 'sphere', radius: 1.1 }] },
    tool: { type: 'cylinder', radius: 0.4, height: 2.6 }
  };
  const r = sectionLoops(solid, [0, 0, 1], 0, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.outer.length, 1);
  assert.equal(r.holes.length, 1);
  // 球（r=1.1）比正方体（半棱 0.8）大 ⇒ 外轮廓是半径 1.1 的圆；孔是半径 0.4 的圆
  assert.ok(Math.abs(totalLoopArea(r) - Math.PI * 1.1 * 1.1) < 0.03,
    `外轮廓应约为 ${(Math.PI * 1.21).toFixed(4)}，实际 ${totalLoopArea(r).toFixed(4)}`);
  assert.ok(Math.abs(holeArea(r) - Math.PI * 0.16) < 0.02,
    `洞应约为 ${(Math.PI * 0.16).toFixed(4)}，实际 ${holeArea(r).toFixed(4)}`);
});

test('切面完全离开立体时明确返回无交，而不是给空壳结果', () => {
  const r = sectionLoops({ type: 'box', size: 2 }, [0, 0, 1], 5, OPTS);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-intersection');
  assert.equal(r.outer.length, 0);
});

test('切面恰好相切（极值处）不产生错误的大回路', () => {
  // 球心在原点、半径 1，切面 z=1 恰好相切于一点 ⇒ 不应给出有面积的截面
  const r = sectionLoops({ type: 'sphere', radius: 1 }, [0, 0, 1], 1, { extent: 1.6, resolution: 128 });
  const a = r.ok ? totalLoopArea(r) : 0;
  assert.ok(a < 0.05, `相切处截面面积应趋近 0，实际 ${a.toFixed(4)}`);
});

test('compile 拒绝未知立体类型（不静默返回恒零函数）', () => {
  assert.throws(() => compile({ type: '这不是立体' }), /未知立体类型/);
});
