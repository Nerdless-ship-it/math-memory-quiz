// 图形题几何内核（public/js/geometry.js）的单元测试。
//
// 为什么这个文件必须比一般单测更啰嗦：
//   图形题的失败模式是「画出一张看起来正常、其实错的图」。它不会报错、不会白屏，
//   用户会把错的形状当成知识背下来。所以这里对每一类风险都留了断言：
//     1. 截面算错/漏算 → 标准截面的边数、平面性、在体内、凸性、绕向；
//     2. 生成出根本不存在的形状（**七边形**，真题最常见的陷阱选项）→ 穷举断言；
//     3. 退化输入把渲染层带崩 → 零向量 / 超界 / 过顶点 / 过棱一律不抛异常；
//     4. 「共享数据被就地改写」这类最难查的 bug → 冻结与调用隔离。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as geometry from '../public/js/geometry.js';
import {
  CUBE_EDGES,
  CUBE_PROJECTION_BOUNDS,
  CUBE_VERTICES,
  EPS,
  MERGE_EPS,
  SECTION_SHAPE_NAMES,
  cubeEdges,
  cubeFaces,
  cubeProjectionBounds,
  cubeSection,
  defaultViewDirection,
  isBackFacing,
  planeBasis,
  project,
  sectionName,
  sectionOutline,
  sectionSideCount,
  visibleFaces
} from '../public/js/geometry.js';

/* ── 测试自带的小工具（不依赖被测模块，避免「用错的一起错」） ─────────── */

const GEOMETRY_URL = new URL('../public/js/geometry.js', import.meta.url);

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function unit(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** 多边形依次相连的边向量。 */
function edgeVectors(polygon) {
  return polygon.map((point, index) => sub(polygon[(index + 1) % polygon.length], point));
}

/** 两个向量是否平行（用叉积长度判，与向量长度无关）。 */
function isParallel(a, b) {
  return Math.hypot(...cross(a, b)) < 1e-9 * Math.hypot(...a) * Math.hypot(...b);
}

/** 平面 { n·x = d } 的单位法向 + 有向距离（与被测模块的归一化方式一致）。 */
function planeData(normal, d) {
  const len = Math.hypot(...normal);
  return { normal: unit(normal), offset: d / len };
}

/** 顶点到平面的距离。 */
function planeDistance(point, normal, d) {
  const { normal: n, offset } = planeData(normal, d);
  return Math.abs(dot(n, point) - offset);
}

/** 顶点索引对的规范化 key。 */
function edgeKey(i, j) {
  return `${Math.min(i, j)}-${Math.max(i, j)}`;
}

/**
 * 截面是否「从 +n 一侧看逆时针的凸多边形」：
 * 有向面积为正（逆时针）且每个转向都同号（凸）。转向留 1e-9 容差，
 * 免得把纯浮点噪声当成拓扑错误。
 */
function isConvexCounterClockwise(polygon, planeNormal) {
  const basis = planeBasis(planeNormal);
  const count = polygon.length;
  const center = [0, 1, 2].map((axis) => polygon.reduce((sum, p) => sum + p[axis], 0) / count);
  const flat = polygon.map((point) => {
    const local = sub(point, center);
    return [dot(local, basis.u), dot(local, basis.v)];
  });
  let area = 0;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    area += flat[i][0] * flat[j][1] - flat[j][0] * flat[i][1];
  }
  if (!(area > 1e-9)) return false;
  for (let i = 0; i < count; i += 1) {
    const a = flat[i];
    const b = flat[(i + 1) % count];
    const c = flat[(i + 2) % count];
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (turn < -1e-9) return false;
  }
  return true;
}

/** 任务书里点名的标准截面。 */
const STANDARD_CASES = [
  ['正三角形（过三个不相邻顶点）', [1, 1, 1], 1, 3],
  ['正三角形（切掉一个角）', [1, 1, 1], 2, 3],
  ['正方形（平行于面）', [0, 0, 1], 0, 4],
  ['正方形/长方形（垂直于面、过中心）', [1, 0, 0], 0, 4],
  ['正六边形（过中心、垂直于体对角线）', [1, 1, 1], 0, 6],
  ['五边形', [2, 3, 4], 1.2, 5],
  ['四边形（等腰梯形）', [1, 4, 4], -1.5, 4]
];

/* ── 立方体数据 ───────────────────────────────────────────────────────── */

test('立方体数据：8 顶点、12 棱、边长 2、中心在原点', () => {
  assert.equal(CUBE_VERTICES.length, 8);
  assert.equal(CUBE_EDGES.length, 12);
  for (const vertex of CUBE_VERTICES) {
    assert.equal(vertex.length, 3);
    assert.ok(vertex.every((axis) => Math.abs(axis) === 1), '顶点坐标必须是 ±1（边长 2、中心原点）');
  }
  assert.equal(new Set(CUBE_VERTICES.map((v) => v.join(','))).size, 8, '8 个顶点必须互不重合');
  const center = CUBE_VERTICES.reduce((sum, v) => [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]], [0, 0, 0]);
  assert.deepEqual(center, [0, 0, 0], '中心必须正好在原点');
});

test('cubeEdges：恰好是「距离为 2 的顶点对」全集（不多不少）', () => {
  const edges = cubeEdges();
  assert.equal(edges.length, 12);
  for (const edge of edges) {
    assert.equal(dist(edge.a, edge.b), 2, '每条棱长度必须是 2');
    assert.deepEqual(edge.a, CUBE_VERTICES[edge.indices[0]], 'a 必须与 indices[0] 对应');
    assert.deepEqual(edge.b, CUBE_VERTICES[edge.indices[1]], 'b 必须与 indices[1] 对应');
  }
  const listed = new Set(edges.map((edge) => edgeKey(...edge.indices)));
  assert.equal(listed.size, 12, '棱不能重复登记');
  const expected = new Set();
  for (let i = 0; i < 8; i += 1) {
    for (let j = i + 1; j < 8; j += 1) {
      if (dist(CUBE_VERTICES[i], CUBE_VERTICES[j]) === 2) expected.add(edgeKey(i, j));
    }
  }
  assert.equal(expected.size, 12, '立方体图里距离为 2 的顶点对正好 12 对');
  assert.deepEqual([...listed].sort(), [...expected].sort(), '漏一条棱 = 图上破个洞');
});

test('cubeFaces：6 个面、每面 4 个顶点，且都落在外法向自己的平面上', () => {
  const faces = cubeFaces();
  assert.equal(faces.length, 6);
  const ids = faces.map((face) => face.id);
  assert.deepEqual([...ids].sort(), ['back', 'bottom', 'front', 'left', 'right', 'top']);
  for (const face of faces) {
    assert.equal(face.indices.length, 4);
    assert.equal(face.vertices.length, 4);
    assert.ok(Math.abs(Math.hypot(...face.normal) - 1) < 1e-12, `${face.id} 外法向必须是单位向量`);
    for (const vertex of face.vertices) {
      assert.ok(Math.abs(dot(face.normal, vertex) - 1) < 1e-12, `${face.id} 的顶点必须落在自身平面上`);
    }
    assert.equal(new Set(face.indices).size, 4, '同一个面不能重复用顶点');
  }
});

test('cubeFaces：每个面从外侧看都是逆时针（绕向反了会画出空心图）', () => {
  for (const face of cubeFaces()) {
    const v = face.vertices;
    for (let i = 0; i < 4; i += 1) {
      const a = v[i];
      const b = v[(i + 1) % 4];
      const c = v[(i + 2) % 4];
      const turn = cross(sub(b, a), sub(c, b));
      assert.ok(dot(turn, face.normal) > 0, `${face.id} 第 ${i} 个角的绕向反了`);
    }
  }
});

test('cubeFaces：三组对面、每顶点属于 3 个面、每条棱属于 2 个面', () => {
  const faces = cubeFaces();
  const byId = new Map(faces.map((face) => [face.id, face]));
  for (const [a, b] of [['front', 'back'], ['left', 'right'], ['top', 'bottom']]) {
    assert.ok(byId.has(a) && byId.has(b), `缺少面 ${a} / ${b}`);
    const opposite = byId.get(a).normal.map((axis) => -axis);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(opposite[i] - byId.get(b).normal[i]) < 1e-12, `${a} 与 ${b} 必须是相对面`);
    }
  }
  const vertexUse = new Array(8).fill(0);
  const edgeUse = new Map();
  for (const face of faces) {
    for (let i = 0; i < 4; i += 1) {
      vertexUse[face.indices[i]] += 1;
      const key = edgeKey(face.indices[i], face.indices[(i + 1) % 4]);
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  assert.deepEqual(vertexUse, new Array(8).fill(3), '每个顶点恰好被 3 个面用到');
  assert.equal(edgeUse.size, 12, '面的边界必须正好覆盖 12 条棱');
  for (const [key, count] of edgeUse) assert.equal(count, 2, `棱 ${key} 被 ${count} 个面用到，应为 2`);
});

test('立方体数据是冻结的：调用方改不动共享对象', () => {
  assert.ok(Object.isFrozen(CUBE_VERTICES) && Object.isFrozen(CUBE_VERTICES[0]));
  assert.ok(Object.isFrozen(CUBE_EDGES) && Object.isFrozen(CUBE_EDGES[0]));
  const faces = cubeFaces();
  assert.ok(Object.isFrozen(faces));
  assert.ok(Object.isFrozen(faces[0]) && Object.isFrozen(faces[0].normal) && Object.isFrozen(faces[0].indices));
  assert.equal(cubeFaces(), faces, 'cubeFaces() 应稳定返回同一个冻结对象');
  assert.throws(() => {
    faces[0].id = 'hacked';
  }, TypeError);
});

/* ── 轴测投影 ─────────────────────────────────────────────────────────── */

test('project：确定性 —— 同一点任意次调用逐位相等（无随机、无时钟）', () => {
  for (const point of [...CUBE_VERTICES, [0, 0, 0], [0.3, -0.7, 0.11], [-2, 3, -4]]) {
    const first = project(point);
    const second = project([point[0], point[1], point[2]]);
    assert.deepEqual(first, second);
    assert.ok(Number.isFinite(first.x) && Number.isFinite(first.y));
    assert.equal(Object.keys(first).sort().join(','), 'x,y', '返回值形状必须是 { x, y }');
  }
});

test('project：8 个顶点投影后两两不重合（否则立体图会退化成歧义图）', () => {
  const projected = CUBE_VERTICES.map((vertex) => project(vertex));
  for (let i = 0; i < 8; i += 1) {
    for (let j = i + 1; j < 8; j += 1) {
      const gap = Math.hypot(projected[i].x - projected[j].x, projected[i].y - projected[j].y);
      assert.ok(gap > 0.05, `顶点 ${i} 与 ${j} 投影重合（间距 ${gap}）`);
    }
  }
});

test('project：y 轴向下（SVG 约定），原点落在屏幕原点，且不返回 -0', () => {
  const origin = project([0, 0, 0]);
  assert.deepEqual(origin, { x: 0, y: 0 });
  assert.ok(!Object.is(origin.y, -0), '返回 -0 会让下游的 Object.is / deepStrictEqual 判等失败');
  const top = project([0, 0, 1]);
  const bottom = project([0, 0, -1]);
  assert.ok(top.y < bottom.y, '顶面中心必须画在底面中心上方（y 越小越靠上）');
  assert.ok(Math.abs(top.x - bottom.x) < 1e-12, '两者必须同一竖直线');
});

test('project：非法输入返回 null（不抛异常，也不静默画到原点）', () => {
  for (const bad of [null, undefined, 'x', 42, [], [1, 2], [1, NaN, 2], [1, 2, Infinity], {}]) {
    assert.equal(project(bad), null, `project(${JSON.stringify(bad)}) 应为 null`);
  }
});

test('cubeProjectionBounds：包住全部 8 个投影点且在原点居中', () => {
  const bounds = cubeProjectionBounds();
  assert.equal(bounds, CUBE_PROJECTION_BOUNDS, '应稳定返回同一个冻结对象');
  assert.ok(Object.isFrozen(bounds));
  for (const point of CUBE_VERTICES.map((vertex) => project(vertex))) {
    assert.ok(point.x >= bounds.minX - 1e-12 && point.x <= bounds.maxX + 1e-12);
    assert.ok(point.y >= bounds.minY - 1e-12 && point.y <= bounds.maxY + 1e-12);
  }
  assert.equal(bounds.width, bounds.maxX - bounds.minX);
  assert.equal(bounds.height, bounds.maxY - bounds.minY);
  assert.ok(Math.abs(bounds.centerX) < 1e-12 && Math.abs(bounds.centerY) < 1e-12);
});

/* ── 消隐 ─────────────────────────────────────────────────────────────── */

test('默认视角恰好看到 front / top / right 三个面', () => {
  assert.deepEqual(visibleFaces(), ['front', 'top', 'right']);
  assert.deepEqual(visibleFaces(defaultViewDirection()), ['front', 'top', 'right']);
  const view = defaultViewDirection();
  assert.ok(Math.abs(Math.hypot(...view) - 1) < 1e-12, '视线方向必须是单位向量');
  for (const id of ['front', 'top', 'right']) {
    const face = cubeFaces().find((entry) => entry.id === id);
    assert.ok(dot(face.normal, view) < 0, `${id} 可见 ⟺ 它的外法向与视线方向相反`);
  }
});

test('isBackFacing：与 visibleFaces 是同一判据，不会出现「两套消隐」', () => {
  const view = defaultViewDirection();
  const visible = new Set(visibleFaces(view));
  for (const face of cubeFaces()) {
    assert.equal(
      isBackFacing(face.normal, view),
      !visible.has(face.id),
      `${face.id} 的消隐判定与可见面集合不一致`
    );
  }
  assert.equal(isBackFacing([1, 0, 0], view), false, 'front 的 +x 朝向相机');
  assert.equal(isBackFacing([-1, 0, 0], view), true, 'back 的 -x 背对相机');
});

test('isBackFacing：视线平行于面时不算背面；长度不影响结论；非法输入不抛异常', () => {
  assert.equal(isBackFacing([0, 0, 1], [1, 0, 0]), false, 'n·v = 0 时不判为背面（交给轮廓处理）');
  assert.equal(isBackFacing([0, 0, 1], [-1, 0, 0]), false);
  assert.equal(isBackFacing([0, 0, 7], [3, 0, 0]), false, '缩放不该改变结论');
  assert.equal(isBackFacing([1, 0, 0], [0.001, 0, 0]), true, '只要方向朝内就是背面，与长度无关');
  assert.equal(isBackFacing([0, 0, 0], [1, 0, 0]), false);
  assert.equal(isBackFacing([1, 0, 0], [0, 0, 0]), false);
  assert.equal(isBackFacing(null, [1, 0, 0]), false);
  assert.equal(isBackFacing([1, 0, 0], 'x'), false);
});

/* ── 平面截立方体：标准截面 ───────────────────────────────────────────── */

test('标准截面：逐个断言边数与形状名', () => {
  for (const [label, normal, d, expected] of STANDARD_CASES) {
    const polygon = cubeSection(normal, d);
    assert.equal(polygon.length, expected, `${label}：n=[${normal}] d=${d} 期望 ${expected} 边`);
    assert.equal(sectionSideCount(normal, d), expected, `${label}：sectionSideCount 必须一致`);
    assert.equal(sectionName(normal, d), SECTION_SHAPE_NAMES[expected], `${label}：形状名必须一致`);
  }
});

test('标准截面尺寸：正三角形边长 2√2、正方形边 2、正六边形边长 √2', () => {
  const triangle = edgeVectors(cubeSection([1, 1, 1], 1)).map((e) => Math.hypot(...e));
  for (const side of triangle) assert.ok(Math.abs(side - 2 * Math.SQRT2) < 1e-9, '过三个相邻顶点的三角形是等边 2√2');

  // d=2 时平面在顶点 (1,1,1) 的三条棱中点处切过去 → 边长 √2 的等边三角形
  const corner = edgeVectors(cubeSection([1, 1, 1], 2)).map((e) => Math.hypot(...e));
  for (const side of corner) assert.ok(Math.abs(side - Math.SQRT2) < 1e-9, '切角三角形边长 √2');

  for (const side of edgeVectors(cubeSection([0, 0, 1], 0)).map((e) => Math.hypot(...e))) {
    assert.ok(Math.abs(side - 2) < 1e-9, '过中心的水平截面是边长 2 的正方形');
  }
  for (const side of edgeVectors(cubeSection([1, 1, 1], 0)).map((e) => Math.hypot(...e))) {
    assert.ok(Math.abs(side - Math.SQRT2) < 1e-9, '过中心垂直体对角线的截面是正六边形');
  }
});

test('截面必须落在平面上、落在立方体内（边长 2，中心原点 → |坐标| ≤ 1）', () => {
  for (const [label, normal, d] of STANDARD_CASES) {
    for (const point of cubeSection(normal, d)) {
      assert.ok(planeDistance(point, normal, d) < EPS * 100, `${label}：顶点必须落在平面上`);
      for (const axis of point) {
        assert.ok(Math.abs(axis) <= 1 + 1e-9, `${label}：顶点跑出立方体了`);
      }
    }
  }
});

test('截面是从 +n 一侧看逆时针的凸多边形（渲染填充依赖绕向）', () => {
  for (const [label, normal, d] of STANDARD_CASES) {
    assert.ok(isConvexCounterClockwise(cubeSection(normal, d), normal), `${label}：凸性/绕向不对`);
  }
  const sweep = [];
  for (let a = -2; a <= 2.0001; a += 0.5) {
    for (let b = -2; b <= 2.0001; b += 0.5) {
      for (let d = -2; d <= 2.0001; d += 0.5) sweep.push([[1, a, b], d]);
    }
  }
  for (const [normal, d] of sweep) {
    const polygon = cubeSection(normal, d);
    if (polygon.length < 3) continue;
    assert.ok(isConvexCounterClockwise(polygon, normal), `n=[${normal}] d=${d} 不是逆时针凸多边形`);
  }
});

test('四边形截面：n=[0,1,1], d=1.2 实为矩形，不是梯形（任务书此处写错了）', () => {
  const polygon = cubeSection([0, 1, 1], 1.2);
  assert.equal(polygon.length, 4);
  const edges = edgeVectors(polygon);
  assert.ok(isParallel(edges[0], edges[2]) && isParallel(edges[1], edges[3]), '两组对边都平行 → 平行四边形');
  assert.ok(Math.abs(dot(edges[0], edges[1])) < 1e-9, '相邻边垂直 → 矩形');
  // 边长 2 与 0.8√2，正是 2 × 1.1314 的长方形
  const lengths = edges.map((e) => Math.hypot(...e)).sort((x, y) => x - y);
  assert.ok(Math.abs(lengths[0] - 0.8 * Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(lengths[1] - 0.8 * Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(lengths[2] - 2) < 1e-9 && Math.abs(lengths[3] - 2) < 1e-9);
});

test('等腰梯形截面确实存在（n=[1,4,4], d=-1.5）：恰好一对平行边 + 两腰等长', () => {
  const polygon = cubeSection([1, 4, 4], -1.5);
  assert.equal(polygon.length, 4);
  const edges = edgeVectors(polygon);
  const parallelPairs = [[0, 2], [1, 3]].filter(([i, j]) => isParallel(edges[i], edges[j]));
  assert.equal(parallelPairs.length, 1, '严格梯形恰好一对平行边');
  const lengths = edges.map((e) => Math.hypot(...e));
  const legs = parallelPairs[0][0] === 0 ? [lengths[1], lengths[3]] : [lengths[0], lengths[2]];
  assert.ok(Math.abs(legs[0] - legs[1]) < 1e-9, '等腰：两腰必须等长');
});

test('穷举平面参数：截面边数只能是 3~6，**不存在七边形**', () => {
  const seen = new Set();
  let samples = 0;
  let maxSides = 0;
  for (let a = -2; a <= 2.0001; a += 0.17) {
    for (let b = -2; b <= 2.0001; b += 0.17) {
      for (let d = -2; d <= 2.0001; d += 0.13) {
        const normal = [1, a, b];
        if (Math.hypot(...normal) < 1e-12) continue;
        const count = cubeSection(normal, d).length;
        samples += 1;
        maxSides = Math.max(maxSides, count);
        seen.add(count);
        assert.ok(
          count === 0 || (count >= 3 && count <= 6),
          `n=[${normal}] d=${d} 得到 ${count} 边形 —— 立方体只有 6 个面，这不可能`
        );
      }
    }
  }
  assert.ok(samples > 3000, `穷举样本太少（${samples}），断言会失去意义`);
  assert.ok(maxSides <= 6, `最大边数 ${maxSides} > 6`);
  assert.ok(!seen.has(7), '七边形不可能存在 —— 这正是真题最常见的陷阱选项，绝不能生成出来');
  // 反过来的空转检查：这几种边数必须真的被穷举覆盖到，否则上面的断言只是碰巧成立
  assert.ok(seen.has(0), '必须出现过「无截面」');
  for (const sides of [3, 4, 5, 6]) assert.ok(seen.has(sides), `穷举里必须真的出现过 ${sides} 边形`);
});

test('sectionName 与 sectionSideCount 严格一致，且只有 3~6 有名字', () => {
  assert.deepEqual({ ...SECTION_SHAPE_NAMES }, { 3: '三角形', 4: '四边形', 5: '五边形', 6: '六边形' });
  assert.ok(Object.isFrozen(SECTION_SHAPE_NAMES));
  for (let a = -2; a <= 2.0001; a += 0.5) {
    for (let d = -2; d <= 2.0001; d += 0.5) {
      const normal = [1, a, 0.7];
      const count = sectionSideCount(normal, d);
      assert.equal(sectionName(normal, d), SECTION_SHAPE_NAMES[count] ?? null);
    }
  }
});

/* ── 退化情形：不得抛异常 ─────────────────────────────────────────────── */

test('退化：零向量法向 → [] / 0 / null，不抛异常', () => {
  for (const normal of [[0, 0, 0], [0, 0, 0.0], [-0, 0, -0]]) {
    assert.deepEqual(cubeSection(normal, 0), []);
    assert.equal(sectionSideCount(normal, 0), 0);
    assert.equal(sectionName(normal, 0), null);
    assert.equal(planeBasis(normal), null);
    assert.deepEqual(sectionOutline(normal, 0), []);
  }
});

test('退化：d 超出立方体（含超出外接球半径 √3）→ []', () => {
  assert.deepEqual(cubeSection([1, 0, 0], 1.5), []);
  assert.deepEqual(cubeSection([1, 0, 0], -1.5), []);
  assert.deepEqual(cubeSection([0, 0, 1], 2), []);
  // d 一律按法向长度归一后比较，所以「超出」的标准是 d/|n| > √3：
  // n=[1,1,1] 的原始 support 是 3（= √3·√3），n=[2,2,2] 的 support 是 3.5 对应的 1.01 < √3 仍在体内。
  assert.deepEqual(cubeSection([1, 1, 1], 3 + 1e-3), []);
  assert.deepEqual(cubeSection([2, 2, 2], 3.5 + 1e-9).length, 3, 'd/|n| = 1.01 < √3 仍会切出一个三角形');
  assert.deepEqual(cubeSection([2, 3, 4], 100), [], 'd 要按法向长度归一化后再判');
  assert.deepEqual(cubeSection([2, 3, 4], -100), []);
});

test('退化：平面恰好过顶点 / 恰好过棱 → 交集凑不出多边形，返回 [] 且不抛异常', () => {
  assert.deepEqual(cubeSection([1, 1, 1], 3), [], '只擦到顶点 (1,1,1)：d/|n| 正好等于 √3');
  assert.deepEqual(cubeSection([1, 1, 0], 2), [], '只擦到棱 x=y=1');
  assert.deepEqual(cubeSection([1, 0, 0], 1 + 1e-6), [], '差 1e-6 才算真的到了面外（> EPS）');
  assert.equal(cubeSection([1, 0, 0], 1 + 1e-12).length, 4, '差 1e-12 落在 EPS 容差内，按「与面重合」处理');
  assert.deepEqual(cubeSection([1, 1, 1], 3 - 1e-7), [], '宽 1e-7 的亚微观三角形按退化丢弃');
  assert.equal(sectionName([1, 1, 1], 3), null);
  assert.equal(sectionName([1, 1, 0], 2), null);
});

test('退化：平面恰好与某个面重合 → 返回该面本身（正方形），不是 []', () => {
  const polygon = cubeSection([1, 0, 0], 1);
  assert.equal(polygon.length, 4, '切到边界也是有效截面');
  assert.equal(sectionName([1, 0, 0], 1), '四边形');
  for (const point of polygon) assert.equal(point[0], 1, '必须全部落在 x=1 面上');
  for (const edge of edgeVectors(polygon)) assert.ok(Math.abs(Math.hypot(...edge) - 2) < 1e-9);
  assert.equal(cubeSection([0, 0, -1], 1).length, 4, '底面同理');
  // 返回的顶点必须是副本：改它不能污染被冻结的 CUBE_VERTICES
  polygon[0][0] = 42;
  for (const vertex of CUBE_VERTICES) {
    for (const axis of vertex) assert.ok(Math.abs(axis) === 1, '立方体顶点被截面返回值改坏了');
  }
});

test('退化：非法入参（非数组 / NaN / Infinity / 缺 d）一律降级，不抛异常', () => {
  for (const bad of [null, undefined, 'n', 42, [], [1, 2], [1, NaN, 0], [Infinity, 0, 0], {}]) {
    assert.deepEqual(cubeSection(bad, 0), []);
    assert.equal(sectionSideCount(bad, 0), 0);
    assert.equal(sectionName(bad, 0), null);
  }
  assert.deepEqual(cubeSection([1, 0, 0], NaN), []);
  assert.deepEqual(cubeSection([1, 0, 0], Infinity), []);
  assert.deepEqual(cubeSection([1, 0, 0], 'nope'), []);
  assert.deepEqual(cubeSection([1, 0, 0]), [], '缺 d → NaN → 无截面');
});

/* ── 平面内基与 2D 轮廓（section-shape 选项图要用） ───────────────────── */

test('planeBasis：正交单位基、u × v = n，坐标轴法向也不退化', () => {
  const normals = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1],
    [1, 1, 1], [2, 3, 4], [1, 1e-12, 0], [0.577, 0.577, 0.577], [0, 0, 5]
  ];
  for (const normal of normals) {
    const basis = planeBasis(normal);
    assert.ok(basis, `n=[${normal}] 必须有基`);
    for (const vector of [basis.u, basis.v]) {
      assert.ok(vector.every(Number.isFinite), '基向量不能出现 NaN');
      assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-12, '基向量必须是单位向量');
      assert.ok(Math.abs(dot(vector, basis.n)) < 1e-12, '基向量必须躺在平面内');
    }
    assert.ok(Math.abs(dot(basis.u, basis.v)) < 1e-12, '两个基向量必须正交');
    const product = cross(basis.u, basis.v);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(product[i] - basis.n[i]) < 1e-12, 'u × v 必须等于 n（右手系）');
    }
  }
});

test('sectionOutline：2D 轮廓与 3D 截面等距（周长一致）、以质心为原点、y 轴向下', () => {
  for (const [label, normal, d] of STANDARD_CASES) {
    const polygon = cubeSection(normal, d);
    const outline = sectionOutline(normal, d);
    assert.equal(outline.length, polygon.length, `${label}：轮廓点数必须一致`);
    let perimeter3d = 0;
    let perimeter2d = 0;
    for (let i = 0; i < polygon.length; i += 1) {
      const j = (i + 1) % polygon.length;
      perimeter3d += dist(polygon[i], polygon[j]);
      perimeter2d += Math.hypot(outline[i][0] - outline[j][0], outline[i][1] - outline[j][1]);
    }
    assert.ok(Math.abs(perimeter3d - perimeter2d) < 1e-9, `${label}：2D 必须是 3D 的等距像`);
    const centerX = outline.reduce((sum, p) => sum + p[0], 0) / outline.length;
    const centerY = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
    assert.ok(Math.hypot(centerX, centerY) < 1e-9, `${label}：轮廓应以质心为原点`);
  }
  // 平面内基必须躺在平面内：法向为 z 时基向量的 z 分量必须为 0
  const basis = planeBasis([0, 0, 1]);
  assert.equal(basis.u[2], 0);
  assert.equal(basis.v[2], 0);
  for (const point of sectionOutline([0, 0, 1], 0)) assert.ok(point.every(Number.isFinite));
  // y 轴向下：轮廓第二分量取的是 dot(local, v) 的相反数（与 project 同一约定）
  const square = sectionOutline([0, 0, 1], 0);
  assert.ok(square.some((point) => point[1] > 0) && square.some((point) => point[1] < 0));
  assert.deepEqual(sectionOutline([0, 0, 0], 0), []);
  assert.deepEqual(sectionOutline([1, 0, 0], 9), []);
});

/* ── 纯函数与契约面 ───────────────────────────────────────────────────── */

test('导出清单：契约 7.4 与任务书要求的函数一个都不少', () => {
  for (const name of ['cubeSection', 'sectionSideCount', 'sectionName', 'project', 'cubeFaces', 'isBackFacing']) {
    assert.equal(typeof geometry[name], 'function', `缺少契约要求的导出 ${name}`);
  }
  assert.equal(geometry.EPS, 1e-9, 'EPS 必须是 1e-9 量级');
  assert.ok(MERGE_EPS >= EPS && MERGE_EPS < 1e-3, '去重阈值应比 EPS 大一档但仍是微小量');
});

/** 断言源码里不出现某个模式，失败时不把整个文件打进日志（只报命中的片段）。 */
function assertNoMatch(source, pattern, message) {
  const match = pattern.exec(source);
  assert.equal(match, null, `${message}（命中：${match ? JSON.stringify(match[0]) : ''}）`);
}

test('纯函数：源码不 import 任何模块，也不碰 DOM / localStorage / 随机数 / 时钟', async () => {
  const raw = await readFile(GEOMETRY_URL, 'utf8');
  // 去注释后只检查**代码**：注释里说明「不碰 DOM / localStorage」是正常的，
  // 但真在代码里引用就必须拦下。
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assertNoMatch(source, /^\s*import\s/m, '零依赖：不得 import 任何模块');
  assertNoMatch(source, /\brequire\s*\(/, '零依赖：不得使用 require');
  assertNoMatch(source, /\b(document|window|localStorage|navigator)\b/, '不得触碰 DOM / 存储');
  assertNoMatch(source, /Math\.random/, '必须确定性：不得使用随机数');
  assertNoMatch(source, /\bnew Date\b|Date\.now/, '必须确定性：不得读取时钟');
  assertNoMatch(source, /\bexport default\b/, '本模块只提供命名导出，避免与渲染层默认导出混淆');
});

test('纯函数：重复调用互不影响（改上次的返回值不会污染下次）', () => {
  const first = cubeSection([1, 1, 1], 0);
  const snapshot = JSON.stringify(first);
  first.push([99, 99, 99]);
  first[0][0] = 42;
  assert.equal(JSON.stringify(cubeSection([1, 1, 1], 0)), snapshot, '返回值必须是每次新算的');
  assert.equal(cubeSection([1, 1, 1], 0).length, 6);
});
