// 立方体截面图题库的几何正确性校验（task-7 的验收闸门）。
//
// 契约依据：docs/ARCHITECTURE.md 第 7.2 节（Item 的 figure 字段）、第 7.3 节
//           （spec 形状锁定）、第 7.4 节（geometry.js 契约）。
//
// 为什么必须有这个测试：截面图题的价值全在「哪个选项截不出来」这一个判断上。
// 选项不是人工画的，而是用 planeNormal/d 表达的 —— 一旦有人凭感觉改一个 d，
// 题就会变成「四个都能截出来」或者「两个都截不出来」，而这种错在界面上完全看不出来
// （图形照样渲染得很漂亮）。所以本文件把每条出题规则都变成断言：
//
//   1. 每题 4 个选项，**恰好 1 个**不可能（cubeSection 求不出 ≥3 个交点）；
//   2. 其余 3 个**确实可能**（≥3 个交点），且边数 ∈ {3,4,5,6}；
//   3. **显式断言从未出现 7 边及以上** —— 立方体只有 6 个面，七边形几何上不存在；
//   4. 同一题 3 个「可能」选项是 3 种不同边数的合法截面（不许三个都是正方形）；
//   5. choiceFigures 与 choiceTexts 等长（7.2 硬性约定），back 指向那个不可能项。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../public/subjects/cross-section.item.js';
import { cubeSection, sectionSideCount, sectionName } from '../public/js/geometry.js';

/** 真题统一问法（题面文字必须逐字一致）。 */
const FRONT = '该立方体被平面所截，截面不可能是';
const LABELS = ['A', 'B', 'C', 'D'];
const ALLOWED_SIDES = Object.freeze([3, 4, 5, 6]);
const SIDE_NAME = Object.freeze({ 3: '三角形', 4: '四边形', 5: '五边形', 6: '六边形' });
const CUBE_HALF = 1;          // 立方体 = [-1,1]³，棱长 2
const MIN_ITEMS = 24;
const MAX_ITEMS = 30;

/**
 * 下列辅助函数一律接收 **figure 对象**（`{ kind, spec:{ planeNormal, d } }`），
 * 而不是 spec —— 直接传 spec 会静默拿到 undefined 并让所有选项都变成「无交」，
 * 那正是本测试要防的失败模式，所以这里统一口径。
 */
function planeOf(figure) {
  return figure.spec;
}

/** 平面 n·x=d 与立方体的交点个数；<3 表示「截不出截面」。 */
function pointCount(figure) {
  const { planeNormal, d } = planeOf(figure);
  return cubeSection(planeNormal, d).length;
}

/** 平面是否能截出多边形（≥3 个交点）。 */
function isPossible(figure) {
  return pointCount(figure) >= 3;
}

/** 平面对立方体的取值上界 L = |n₁|+|n₂|+|n₃|（|d|>L 时必无交）。 */
function bound(figure) {
  return planeOf(figure).planeNormal.reduce((sum, v) => sum + Math.abs(v), 0);
}

/** 平面的归一化指纹，用来判断两个选项是不是同一个平面。 */
function planeKey(figure) {
  const { planeNormal, d: rawD } = planeOf(figure);
  const [a, b, c] = planeNormal;
  const len = Math.hypot(a, b, c) || 1;
  let n = [a / len, b / len, c / len];
  let d = rawD / len;
  // 法向取反 + d 取反表示的是同一个平面：统一取「首个非零分量为正」的那种写法。
  const firstNonZero = n.find((v) => Math.abs(v) > 1e-12) ?? 0;
  if (firstNonZero < 0) {
    n = n.map((v) => -v);
    d = -d;
  }
  return `${n.map((v) => v.toFixed(6)).join(',')}|${d.toFixed(6)}`;
}

test('题库规模在 24~30 题之间', () => {
  assert.ok(Array.isArray(ITEMS), 'cross-section.item.js 必须导出 ITEMS 数组');
  assert.ok(
    ITEMS.length >= MIN_ITEMS && ITEMS.length <= MAX_ITEMS,
    `题量应在 ${MIN_ITEMS}~${MAX_ITEMS} 之间，实际 ${ITEMS.length}`
  );
});

test('每条题目字段齐全：id/front/back/tags/figure/choiceFigures/choiceTexts', () => {
  const ids = new Set();
  for (const item of ITEMS) {
    const label = item?.id ?? '(无 id)';
    assert.match(String(item.id), /^[a-z0-9][a-z0-9.-]*$/i, `${label} 的 id 非法`);
    assert.ok(!ids.has(item.id), `id 重复：${item.id}`);
    ids.add(item.id);

    for (const field of ['front', 'back']) {
      assert.equal(typeof item[field], 'string', `${label} 的 ${field} 必须是字符串`);
      assert.ok(item[field].length > 0, `${label} 的 ${field} 不能为空`);
    }
    assert.ok(Array.isArray(item.tags) && item.tags.includes('截面图'), `${label} 的 tags 必须含「截面图」`);
    assert.ok(Array.isArray(item.choiceFigures), `${label} 的 choiceFigures 必须是数组`);
    assert.ok(Array.isArray(item.choiceTexts), `${label} 的 choiceTexts 必须是数组`);

    // 题干图形：立方体截面（立体被一刀切）。kind 带 `figure:` 命名空间前缀（契约 7.3）。
    assert.equal(item.figure?.kind, 'figure:cross-section', `${label} 的题干 figure.kind 必须是 figure:cross-section`);
    assert.ok(Array.isArray(item.figure.spec?.planeNormal), `${label} 的题干缺少 planeNormal`);
    assert.equal(item.figure.spec.planeNormal.length, 3, `${label} 的题干 planeNormal 必须是三元组`);
    assert.ok(Number.isFinite(item.figure.spec.d), `${label} 的题干 d 必须是有限数`);
  }
});

test('题面文字逐字统一为真题问法', () => {
  for (const item of ITEMS) {
    assert.equal(item.front, FRONT, `${item.id} 的题面偏离统一问法：${JSON.stringify(item.front)}`);
  }
});

test('choiceFigures 与 choiceTexts 等长（契约 7.2 硬性约定），且 kind / spec 合法', () => {
  for (const item of ITEMS) {
    assert.equal(
      item.choiceFigures.length,
      item.choiceTexts.length,
      `${item.id} 的 choiceFigures(${item.choiceFigures.length}) 与 choiceTexts(${item.choiceTexts.length}) 不等长`
    );
    assert.equal(item.choiceFigures.length, 4, `${item.id} 必须恰好 4 个选项`);
    assert.deepEqual(item.choiceTexts, LABELS, `${item.id} 的选项标签必须是 A/B/C/D`);

    for (const figure of item.choiceFigures) {
      assert.equal(figure?.kind, 'figure:section-shape', `${item.id} 的选项 kind 只能是 figure:section-shape`);
      const { planeNormal, d } = figure.spec ?? {};
      assert.ok(Array.isArray(planeNormal) && planeNormal.length === 3, `${item.id} 的选项 planeNormal 非法`);
      assert.ok(planeNormal.every((v) => Number.isFinite(v)), `${item.id} 的选项 planeNormal 含非数字`);
      assert.ok(!planeNormal.every((v) => v === 0), `${item.id} 的选项 planeNormal 不得是零向量`);
      assert.ok(Number.isFinite(d), `${item.id} 的选项 d 必须是有限数`);
    }
  }
});

test('每题恰好 1 个「不可能」选项，且 back 指向它', () => {
  for (const item of ITEMS) {
    const possible = item.choiceFigures.map(isPossible);
    const impossibleIndexes = possible.map((ok, i) => (ok ? -1 : i)).filter((i) => i >= 0);

    assert.equal(
      impossibleIndexes.length,
      1,
      `${item.id} 应有且仅有 1 个不可能选项，实际 ${impossibleIndexes.length} 个（选项交点个数：` +
        `${item.choiceFigures.map((f) => pointCount(f)).join(', ')}）`
    );

    const answerIndex = item.choiceTexts.indexOf(item.back);
    assert.ok(answerIndex >= 0, `${item.id} 的 back="${item.back}" 不在 choiceTexts 里`);
    assert.equal(
      answerIndex,
      impossibleIndexes[0],
      `${item.id} 的 back 指向 ${item.back}，但真正截不出截面的是 ${item.choiceTexts[impossibleIndexes[0]]}`
    );
  }
});

test('其余 3 个选项确实可能：≥3 交点，且 sectionSideCount / sectionName 与几何一致', () => {
  for (const item of ITEMS) {
    const possible = item.choiceFigures.filter(isPossible);
    assert.equal(possible.length, 3, `${item.id} 的「可能」选项应为 3 个，实际 ${possible.length}`);

    for (const figure of possible) {
      const { planeNormal, d } = figure.spec;
      const points = cubeSection(planeNormal, d);
      const count = sectionSideCount(planeNormal, d);
      assert.equal(count, points.length, `${item.id} 的 sectionSideCount 与 cubeSection 点数不一致`);
      assert.equal(
        sectionName(planeNormal, d),
        SIDE_NAME[points.length],
        `${item.id} 的 sectionName 与边数 ${points.length} 不匹配`
      );
    }
  }
});

test('可能选项的边数 ∈ {3,4,5,6}，且**显式断言从未出现 7 边及以上**', () => {
  const seen = new Set();
  let maxSeen = 0;

  for (const item of ITEMS) {
    for (const figure of item.choiceFigures) {
      if (!isPossible(figure)) continue;
      const n = pointCount(figure);
      seen.add(n);
      maxSeen = Math.max(maxSeen, n);
      assert.ok(
        ALLOWED_SIDES.includes(n),
        `${item.id} 出现 ${n} 边形（法向 ${JSON.stringify(figure.spec.planeNormal)}、d=${figure.spec.d}）——` +
          `立方体只有 6 个面，截面只可能是 3~6 边形`
      );
      assert.ok(n < 7, `${item.id} 出现了 7 边及以上：${n}`);
    }
  }

  assert.deepEqual([...seen].sort((a, b) => a - b), ALLOWED_SIDES, `题库应覆盖 3/4/5/6 四种截面`);
  assert.ok(maxSeen <= 6, `题库里最大边数是 ${maxSeen}，超过 6 即意味着几何事实被破坏`);
  assert.equal(seen.has(7), false, '立方体截面不可能是七边形，题库里不得出现 7 边选项');
});

test('穷举扫描平面参数：边数集合 ⊆ {3,4,5,6}，七边形不可能', () => {
  const seen = new Set();
  for (let a = -4; a <= 4; a += 1) {
    for (let b = -4; b <= 4; b += 1) {
      for (let c = -4; c <= 4; c += 1) {
        if (a === 0 && b === 0 && c === 0) continue;
        const normal = [a, b, c];
        const sum = Math.abs(a) + Math.abs(b) + Math.abs(c);
        for (let k = -17; k <= 17; k += 1) {
          const d = k * 0.25;
          // 只取可能与立方体有交的参数（|d| ≤ 上界）；越界情形另有用例覆盖。
          if (Math.abs(d) > sum) continue;
          const n = cubeSection(normal, d).length;
          if (n >= 3) seen.add(n);
        }
      }
    }
  }
  const sorted = [...seen].sort((x, y) => x - y);
  assert.deepEqual(sorted, ALLOWED_SIDES, `穷举得到的边数集合应恰为 3/4/5/6，实际 ${sorted.join(',')}`);
  assert.equal(sorted.includes(7), false, '穷举里出现了 7 边形 —— 与「立方体只有 6 个面」矛盾');
});

test('同一题 3 个「可能」选项是 3 种不同边数的合法截面（不许三个都是正方形）', () => {
  const stats = { 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const item of ITEMS) {
    const sides = item.choiceFigures.filter(isPossible).map(pointCount).sort((a, b) => a - b);
    assert.equal(new Set(sides).size, 3, `${item.id} 的三个可能项边数应互不相同，实际 ${sides.join('/')}`);
    for (const n of sides) stats[n] += 1;
  }
  // 四个边数档位在整卷里都要出现，且分布均衡（每组 24 题的 3/4 组合都会用到）。
  assert.deepEqual(Object.keys(stats).map(Number).sort((a, b) => a - b), ALLOWED_SIDES);
  for (const n of ALLOWED_SIDES) {
    assert.ok(stats[n] > 0, `整卷没有出现 ${n} 边形选项`);
  }
  console.log('\n截面图题库可能选项边数分布：', JSON.stringify(stats));
});

test('同一题内 4 个平面互不相同（避免两个选项其实是一张图）', () => {
  for (const item of ITEMS) {
    const keys = item.choiceFigures.map(planeKey);
    assert.equal(new Set(keys).size, 4, `${item.id} 的四个选项存在重复平面：${keys.join(' || ')}`);
  }
});

test('「不可能」选项确实无交：|d| > |n₁|+|n₂|+|n₃|，且 cubeSection 返回 0 交点', () => {
  for (const item of ITEMS) {
    const impossible = item.choiceFigures.filter((figure) => !isPossible(figure));
    assert.equal(impossible.length, 1, `${item.id} 应恰好 1 个不可能选项`);
    const { planeNormal, d } = impossible[0].spec;
    const limit = bound(impossible[0]);

    assert.ok(
      Math.abs(d) > limit,
      `${item.id} 的不可能选项不满足「无交」判据：|d|=${Math.abs(d)} 未超过上界 ${limit}`
    );
    assert.equal(cubeSection(planeNormal, d).length, 0, `${item.id} 的不可能选项居然有交点`);
    assert.equal(sectionSideCount(planeNormal, d), 0, `${item.id} 的不可能选项边数应为 0`);
    assert.equal(sectionName(planeNormal, d), null, `${item.id} 的不可能选项形状名应为 null`);
  }
});

test('所有截面顶点都落在立方体上（|坐标| ≤ 1）', () => {
  for (const item of ITEMS) {
    for (const figure of item.choiceFigures) {
      for (const [x, y, z] of cubeSection(figure.spec.planeNormal, figure.spec.d)) {
        for (const v of [x, y, z]) {
          assert.ok(
            Math.abs(v) <= CUBE_HALF + 1e-9,
            `${item.id} 的截面顶点越出立方体：${x},${y},${z}`
          );
        }
      }
    }
  }
});

test('题干只画完整立方体（不画具体截面），题目身份落在选项组合上', () => {
  const stemKeys = new Set();
  const choiceKeys = new Set();

  for (const item of ITEMS) {
    const { planeNormal, d } = item.figure.spec;
    assert.equal(
      cubeSection(planeNormal, d).length,
      0,
      `${item.id} 的题干平面与立方体有交 —— 题干会画出一道具体截面，` +
        `学生就会把题干上那个截面当成已知条件，题目随之变得不可解`
    );
    stemKeys.add(JSON.stringify(item.figure));
    choiceKeys.add(JSON.stringify(item.choiceFigures));
  }

  // 注册表声明 allowDuplicateFront + uniqueBy: 'choices'：
  // 题干（含图形）允许 24 条完全一致，但「题目身份」= 选项组合必须唯一，
  // 否则才是真的在重复出同一道题。这两条正是 subjects.test.mjs 的判据，这里对齐。
  assert.equal(stemKeys.size, 1, `24 条题干应当完全一致，实际有 ${stemKeys.size} 种`);
  assert.equal(
    choiceKeys.size,
    ITEMS.length,
    `24 组 choiceFigures 必须互不相同（实际 ${choiceKeys.size} 组）—— 这是该科「题目身份」的判据`
  );
});

test('答案位置均衡：A/B/C/D 各 6 题', () => {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of ITEMS) counts[item.back] += 1;
  console.log('截面图题库答案分布：', JSON.stringify(counts));
  for (const label of LABELS) {
    assert.equal(counts[label], ITEMS.length / 4, `答案 ${label} 出现 ${counts[label]} 次，应均衡分布`);
  }
});
