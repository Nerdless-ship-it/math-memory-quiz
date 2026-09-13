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
  const r = sectionLoops({ type: 'cylinder', radius: 1, height: 2 }, [0, 1, 0], 0, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.outer.length, 1);
  assert.equal(r.holes.length, 0);
  assert.ok(Math.abs(totalLoopArea(r) - Math.PI) < 0.02,
    `面积应约为 π≈3.1416，实际 ${totalLoopArea(r).toFixed(4)}`);
});

test('圆柱：斜切 45°（法向 [1,1,0]）得到椭圆，面积 = π√2', () => {
  const r = sectionLoops({ type: 'cylinder', radius: 1, height: 2 }, [1, 1, 0], 0, OPTS);
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
  const r = sectionLoops(hollow, [0, 1, 0], 0, OPTS);
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
  const r = sectionLoops(hollow, [1, 1, 0], 0, OPTS);
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
    const r = sectionLoops(solid, [0, 1, 0], d, OPTS);
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
  const r = sectionLoops(solid, [0, 1, 0], 0, { extent: 2.2, resolution: 320 });
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
  const r = sectionLoops(solid, [0, 1, 0], 0, OPTS);
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

test('空心圆柱：**任意倾角**的切面都必须给「1 外轮廓 + 1 洞」', () => {
  // ⚠️ 这条测试是补一个真实漏网 bug：
  // 沙盒页用「倾角滑块」推切面法向，而上面那条测试只用了 [1,1,0]。
  // 一个方向通过完全不能代表任意方向通过，所以要覆盖所有倾角。
  //
  // ⚠️⚠️ 法向写法有个坑：基本体轴是 **y 向上**（见 csg.js），
  // 所以「水平切」的法向是 (0,1,0)，不是 (0,0,1)。
  // 我第一版照 z-up 的直觉写成 (sin, 0, cos)，于是 tilt=0 实际是**竖直切**
  // （平行于轴），截面本该是两块矩形，却断言成「1 环 + 1 洞」，
  // 白白红了一轮。改坐标约定时这类「按轴推法向」的地方都要跟着改。
  const hollow = {
    type: 'subtract',
    base: { type: 'cylinder', radius: 1, height: 2 },
    tool: { type: 'cylinder', radius: 0.5, height: 2.4 }
  };
  // ⚠️ 倾角有物理上限：半径 1、高 2 的圆柱，只有倾角 < arctan(高/直径) = 45°
  // 时平面才同时穿过上下两个底面，截面才是**完整椭圆**（面积 π/cosθ）。
  // 超过 45° 平面会切到侧面、截面被截断，π/cosθ 不再成立——
  // 这是几何事实，不是代码缺陷。第一版我把 60°/75° 也按完整椭圆断言，白红了一轮。
  const FULL_ELLIPSE_LIMIT = (Math.atan2(2, 2) * 180) / Math.PI; // = 45°
  for (const tilt of [0, 15, 30, 35, 44, 60, 75]) {
    const rad = (tilt * Math.PI) / 180;
    // y-up：tilt=0 → (0,1,0) 水平；tilt=90 → (1,0,0) 竖直
    const normal = [Math.sin(rad), Math.cos(rad), 0];
    const r = sectionLoops(hollow, normal, 0, { extent: 4, resolution: 240 });

    if (tilt < FULL_ELLIPSE_LIMIT) {
      // 完整椭圆：1 条外轮廓 + 1 个洞，外/洞面积比恒为半径比的平方 4
      assert.equal(r.ok, true, `tilt=${tilt}° 应有截面`);
      assert.equal(r.outer.length, 1, `tilt=${tilt}° 应恰好 1 条外轮廓，实际 ${r.outer.length}`);
      assert.equal(r.holes.length, 1, `tilt=${tilt}° 应恰好 1 个洞，实际 ${r.holes.length}`);
      const expected = Math.PI / Math.cos(rad);
      assert.ok(Math.abs(totalLoopArea(r) - expected) < 0.06,
        `tilt=${tilt}° 外轮廓面积应约为 π/cos(tilt)=${expected.toFixed(4)}，实际 ${totalLoopArea(r).toFixed(4)}`);
      assert.ok(Math.abs(totalLoopArea(r) / holeArea(r) - 4) < 0.06,
        `tilt=${tilt}° 外/洞面积比应为 4，实际 ${(totalLoopArea(r) / holeArea(r)).toFixed(4)}`);
    } else {
      // 截断区：不再断言椭圆，但**必须有截面且面积有限、有限个回路**
      // （防的是「面积突然爆炸」或「回路碎成几十条」这类真正的退化）
      assert.equal(r.ok, true, `tilt=${tilt}° 虽被截断，但仍应有截面`);
      const total = totalLoopArea(r);
      assert.ok(total > 0.5 && total < 12,
        `tilt=${tilt}° 截断后的截面面积应落在合理区间，实际 ${total.toFixed(4)}`);
      assert.ok(r.outer.length + r.holes.length <= 6,
        `tilt=${tilt}° 回路数不应异常膨胀，实际 外${r.outer.length}+洞${r.holes.length}`);
    }
  }
});

test('compile 拒绝未知立体类型（不静默返回恒零函数）', () => {
  assert.throws(() => compile({ type: '这不是立体' }), /未知立体类型/);
});


