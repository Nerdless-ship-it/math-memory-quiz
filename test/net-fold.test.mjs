// 正方体展开图折叠几何 + 题库唯一答案性 —— 契约 docs/ARCHITECTURE.md 第 7.4 / 7.6 节。
//
// 本文件把关三件事，每一件都能真的出错：
//
//   1. **合法展开图恰好 11 种**（忽略旋转与翻转）。
//      这里不重复抄那 11 张坐标表当判据——判据是折叠算法本身。所以测试用「穷举」来验收：
//      枚举全部 216 种（平移意义下）六格骨牌 → 合并成 35 个自由等价类（与已知事实一致）
//      → 其中被 isValidNet 接受的有且只有 11 个等价类。硬编码坐标表的实现过不了这一关。
//
//   2. **对面关系**：任意合法展开图折叠后，oppositePairs 必须恰好 3 组、两两不重复、
//      恰好覆盖 6 个格子。这是整个题型的地基：干扰项就是靠「两个可见面互为对面」造出来的，
//      对面关系一旦漏一组或多一组，题目会直接失去唯一答案。
//
//   3. **题库唯一答案性**：每条的四个选项逐个跑 validateNetOption，必须恰好 1 项通过。
//      并把每条的通过数打印出来，让「有没有多个正确答案」这件事每次都留下可见证据。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FACE_NAMES,
  OPPOSITE_FACE_PAIRS,
  VISIBLE_SLOTS,
  CELL_LABELS,
  foldNet,
  foldFaces,
  oppositePairs,
  isValidNet,
  isAdjacentInNet,
  isOppositeInCube,
  relativeFaces,
  validateNetOption,
  visibleOptions
} from '../public/js/net-fold.js';
import { ITEMS } from '../public/subjects/cube-net.item.js';

// ── 小工具 ───────────────────────────────────────────────────────────

const parseKey = (key) => key.split(';').map((pair) => pair.split(',').map(Number));

/** 平移到左上角并排序，得到「平移意义下」的规范字形。 */
function normalizeKey(cells) {
  const minCol = Math.min(...cells.map((cell) => cell[0]));
  const minRow = Math.min(...cells.map((cell) => cell[1]));
  return cells
    .map(([col, row]) => [col - minCol, row - minRow])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
    .map(([col, row]) => `${col},${row}`)
    .join(';');
}

/** 二面体群 8 个元素：4 个旋转 × 2 个镜像。 */
const SYMMETRIES = [
  ([c, r]) => [c, r],
  ([c, r]) => [-r, c],
  ([c, r]) => [-c, -r],
  ([c, r]) => [r, -c],
  ([c, r]) => [-c, r],
  ([c, r]) => [c, -r],
  ([c, r]) => [r, c],
  ([c, r]) => [-r, -c]
];

const freeKey = (cells) => SYMMETRIES
  .map((transform) => normalizeKey(cells.map(transform)))
  .sort()[0];

/** 枚举 n 格骨牌（平移意义下去重）。 */
function polyominoes(n) {
  let current = new Set([normalizeKey([[0, 0]])]);
  for (let size = 1; size < n; size += 1) {
    const next = new Set();
    for (const key of current) {
      const cells = parseKey(key);
      const occupied = new Set(key.split(';'));
      for (const [col, row] of cells) {
        for (const [dCol, dRow] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const neighbour = `${col + dCol},${row + dRow}`;
          if (occupied.has(neighbour)) continue;
          next.add(normalizeKey([...cells, [col + dCol, row + dRow]]));
        }
      }
    }
    current = next;
  }
  return [...current].sort();
}

// ── 1. 折叠算法：结构不变量 ───────────────────────────────────────────

test('模块是纯函数：零依赖、不碰 DOM / localStorage', () => {
  const source = readFileSync(new URL('../public/js/net-fold.js', import.meta.url), 'utf8');
  for (const forbidden of ['document.', 'window.', 'globalThis.', 'localStorage.', 'sessionStorage.', 'require(', 'import ']) {
    assert.ok(
      !source.includes(forbidden),
      `net-fold.js 必须是不碰 DOM 的纯函数模块，但出现了 ${forbidden}`
    );
  }
});

test('常量表自洽：6 个面名、3 组对面、3 个可见槽位、6 个格子标签', () => {
  assert.equal(FACE_NAMES.length, 6);
  assert.equal(new Set(FACE_NAMES).size, 6);
  assert.deepEqual([...VISIBLE_SLOTS], ['front', 'top', 'right']);
  assert.deepEqual([...CELL_LABELS], ['1', '2', '3', '4', '5', '6']);
  assert.equal(OPPOSITE_FACE_PAIRS.length, 3);
  const covered = OPPOSITE_FACE_PAIRS.flat();
  assert.equal(covered.length, 6, '三组对面必须恰好覆盖 6 个面');
  assert.equal(new Set(covered).size, 6, '三组对面不得重复覆盖同一个面');
  for (const [a, b] of OPPOSITE_FACE_PAIRS) {
    assert.equal(isOppositeInCube(a, b), true, `${a}/${b} 应互为对面`);
    assert.equal(isOppositeInCube(b, a), true, '对面关系必须对称');
    assert.equal(isOppositeInCube(a, a), false, '自己不是自己的对面');
  }
  assert.equal(isOppositeInCube('front', 'top'), false);
  assert.equal(isOppositeInCube('front', '不存在的面'), false);
  assert.equal(isOppositeInCube(null, undefined), false);
});

test('4 连格：第 0/2 格对面、第 1/3 格对面（滚动算法的标准结论）', () => {
  const strip = [[0, 1], [1, 1], [2, 1], [3, 1], [0, 0], [0, 2]];
  assert.equal(isValidNet(strip), true, '4 连格 + 同列上下各一格 是合法展开图');
  assert.deepEqual(oppositePairs(strip), [[0, 2], [1, 3], [4, 5]]);
  // 第 4 格在第 1 格的上方（row 更小 = -y 方向）→ 折成 back 面；第 5 格在下方 → front 面。
  assert.deepEqual(foldNet(strip).faces, ['bottom', 'right', 'top', 'left', 'back', 'front']);
});

test('向右滚一格再向左滚一格回到原姿态（4 连格的朝向必须是 D→R→U→L）', () => {
  const net = [[0, 1], [1, 1], [2, 1], [3, 1], [0, 0], [0, 2]];
  const faces = foldFaces(net);
  // 滚动一次 = 相邻格换成「原来朝右的面」；连续向右滚，方向循环 (bottom→right→top→left)
  assert.equal(faces[0], 'bottom');
  assert.equal(faces[1], 'right');
  assert.equal(faces[2], 'top');
  assert.equal(faces[3], 'left');
});

// ── 2. 11 种合法展开图（穷举验收，不硬编码坐标表）────────────────────

test('穷举六格骨牌：35 个自由等价类，其中恰好 11 个是合法展开图', () => {
  const fixed = polyominoes(6);
  assert.equal(fixed.length, 216, '平移意义下的六格骨牌应恰好 216 种');

  const freeAll = new Set(fixed.map((key) => freeKey(parseKey(key))));
  assert.equal(freeAll.size, 35, '自由六格骨牌应恰好 35 种（已知事实，用来校验穷举本身没错）');

  const validFixed = fixed.filter((key) => isValidNet(parseKey(key)));
  const validFree = new Set(validFixed.map((key) => freeKey(parseKey(key))));
  assert.equal(validFree.size, 11, `合法展开图必须恰好 11 种等价类，实际 ${validFree.size}`);
  assert.equal(validFixed.length, 64, '含旋转/翻转时，合法展开图应恰好 64 种字形');
});

test('11 个等价类的代表逐个通过 isValidNet（任意旋转/翻折的等价形式都通过）', () => {
  const nets = polyominoes(6)
    .filter((key) => isValidNet(parseKey(key)))
    .filter((key, index, list) => list.indexOf(key) === index);

  const representatives = new Map();
  for (const key of nets) {
    const free = freeKey(parseKey(key));
    if (!representatives.has(free)) representatives.set(free, parseKey(key));
  }
  assert.equal(representatives.size, 11);

  for (const [free, cells] of representatives) {
    assert.equal(isValidNet(cells), true, `${free} 的代表应合法`);
    // 8 个二面体变换后的等价形式必须同样合法——硬编码坐标表的实现会在这里挂掉。
    for (const transform of SYMMETRIES) {
      const transformed = cells.map(transform);
      assert.equal(
        isValidNet(transformed),
        true,
        `${free} 的旋转/翻折等价形式必须也合法：${JSON.stringify(transformed)}`
      );
    }
    assert.equal(oppositePairs(cells).length, 3);
    assert.equal(visibleOptions(cells).length, 24, '每个角 3 种旋转 × 8 个角 = 24 组可见三元组');
  }
});

test('非法布局被拒绝，并给出具体原因', () => {
  const bad = [
    { cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], reason: 'fold-conflict', why: '2×3 长方形（含环）' },
    { cells: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]], reason: 'fold-conflict', why: '2×2 方块再挂两格' },
    { cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]], reason: 'face-overlap', why: '六格一排' },
    { cells: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [3, 1]], reason: 'face-overlap', why: '四连格两端各挂一格' },
    // 任务书 7.2 的示例图（[[0,0],[1,0],[2,0],[0,1],[0,2],[1,2]]）看着像 1-4-1，
    // 实际折起来第 3 格与第 6 格重合（两处 face-overlap），不是合法展开图。
    { cells: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 2]], reason: 'face-overlap', why: '「L 形」伪展开图' },
    { cells: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [3, 1], [0, 2], [3, 2]], reason: 'need-6-cells', why: '格数不是 6' },
    { cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [9, 9]], reason: 'disconnected', why: '有一格脱离连通块' },
    { cells: [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [1, 1]], reason: 'duplicate-cell', why: '同一格写了两遍' },
    { cells: [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [1.5, 2]], reason: 'bad-cell', why: '坐标不是整数' }
  ];
  for (const { cells, reason, why } of bad) {
    assert.equal(isValidNet(cells), false, `${why} 不该被判为合法展开图`);
    assert.equal(foldNet(cells).ok, false, `${why} 折叠不应成功`);
    assert.equal(foldNet(cells).reason, reason, `${why} 的失败原因应为 ${reason}`);
    assert.deepEqual(oppositePairs(cells), [], `${why} 没有对面关系可言`);
    assert.deepEqual(visibleOptions(cells), [], `${why} 折不出任何可见三面组合`);
    assert.equal(validateNetOption(cells, ['1', '2', '3']), false, `${why} 不得接受任何选项`);
  }
});

// ── 3. 对面关系：最重要的不变量 ───────────────────────────────────────

test('全部 64 种合法字形：对面恰好 3 组、互不重复、覆盖全部 6 格', () => {
  const valid = polyominoes(6).filter((key) => isValidNet(parseKey(key)));
  assert.equal(valid.length, 64);
  for (const key of valid) {
    const cells = parseKey(key);
    const pairs = oppositePairs(cells);
    assert.equal(pairs.length, 3, `${key} 的对面必须是 3 组`);
    const flat = pairs.flat();
    assert.equal(flat.length, 6, `${key} 的三组对面必须共 6 个格子`);
    assert.equal(new Set(flat).size, 6, `${key} 的对面不得重复覆盖同一格`);
    assert.deepEqual([...flat].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], `${key} 必须覆盖全部 6 格`);
    for (const [i, j] of pairs) {
      assert.ok(i < j, `${key} 的对面组内应升序`);
      assert.equal(isAdjacentInNet(cells, i, j), false, `${key}: 相对的两格在纸面上不应相邻（否则不是对面）`);
    }
    const faces = foldNet(cells).faces;
    for (const [i, j] of pairs) {
      assert.equal(isOppositeInCube(faces[i], faces[j]), true, `${key}: ${faces[i]} 与 ${faces[j]} 应互为对面`);
    }
  }
});

test('relativeFaces：3 组对面 / 12 组互邻 / 8 组共角 / 24 组可见三元组', () => {
  const cells = [[0, 1], [1, 1], [2, 1], [3, 1], [0, 0], [0, 2]];
  const rel = relativeFaces(cells);
  assert.equal(rel.ok, true);
  assert.deepEqual(rel.opposite.map((pair) => [...pair]), oppositePairs(cells));
  assert.equal(rel.adjacent.length, 12, '立方体上互邻的面共 6×4/2 = 12 组');
  assert.equal(rel.cornerTriples.length, 8, '立方体有 8 个角');
  assert.equal(rel.visibleIndexes.length, 24);
  for (const triple of rel.cornerTriples) {
    assert.equal(triple.length, 3);
    assert.equal(new Set(triple).size, 3);
    const faces = triple.map((i) => rel.faces[i]);
    for (let a = 0; a < 3; a += 1) {
      for (let b = a + 1; b < 3; b += 1) {
        assert.equal(isOppositeInCube(faces[a], faces[b]), false, '共角的三面不能有对面关系');
      }
    }
  }
  for (const pair of rel.adjacent) {
    const [i, j] = pair;
    assert.equal(isOppositeInCube(rel.faces[i], rel.faces[j]), false);
  }
});

test('isAdjacentInNet：纸面相邻（共享一条边），与折叠后的相邻不是一回事', () => {
  const cells = [[0, 1], [1, 1], [2, 1], [3, 1], [0, 0], [0, 2]];
  assert.equal(isAdjacentInNet(cells, 0, 1), true);          // 下标
  assert.equal(isAdjacentInNet(cells, '1', '2'), true);      // 标签
  assert.equal(isAdjacentInNet(cells, [0, 1], [1, 1]), true); // 坐标
  assert.equal(isAdjacentInNet(cells, 0, 2), false);          // 隔着第 1 格
  assert.equal(isAdjacentInNet(cells, 0, 0), false);          // 自己
  assert.equal(isAdjacentInNet(cells, 0, 99), false);         // 越界
  // 第 0 格与第 3 格在纸面上不相邻，折叠后却是相邻面（left/bottom）——两种「相邻」必须分开。
  assert.equal(isAdjacentInNet(cells, 0, 3), false);
  assert.equal(isOppositeInCube(foldFaces(cells)[0], foldFaces(cells)[3]), false);
});

// ── 4. validateNetOption：判据本身 ───────────────────────────────────

test('validateNetOption：四种入参写法等价，且对面/镜像排列必须被拒', () => {
  const cells = [[0, 1], [1, 1], [2, 1], [3, 1], [0, 0], [0, 2]];
  const faces = foldFaces(cells);            // bottom right top left back front
  const good = [0, 5, 1];                    // front=bottom top=front right=right：右手系
  const spec = { visible: ['front', 'top', 'right'], labels: ['1', '6', '2'] };
  assert.equal(validateNetOption(cells, spec), true, '推荐写法（visible 槽位名 + labels 编号）必须通过');
  assert.equal(validateNetOption(cells, good), true);
  assert.deepEqual(good.map((i) => faces[i]), ['bottom', 'front', 'right']);
  assert.equal(validateNetOption(cells, { visible: good.map((i) => String(i + 1)) }), true, '紧凑 spec 写法必须等价');
  assert.equal(validateNetOption(cells, good.map((i) => String(i + 1))), true, '标签字符串必须等价');
  assert.equal(
    validateNetOption(cells, { front: '1', top: '6', right: '2' }),
    true,
    '具名 front/top/right 必须等价'
  );
  // visible 的槽位顺序可以变，labels 跟着 visible 走
  assert.equal(
    validateNetOption(cells, { visible: ['top', 'right', 'front'], labels: ['6', '2', '1'] }),
    true,
    'visible 换序时 labels 按同序给出，含义不变'
  );
  assert.equal(
    validateNetOption(cells, { visible: ['top', 'right', 'front'], labels: ['1', '6', '2'] }),
    validateNetOption(cells, ['2', '1', '6']),
    'visible 换序而 labels 不跟着换，等价于把 labels 重新指派给槽位'
  );
  assert.equal(
    validateNetOption(cells, { visible: ['front', 'top', 'left'], labels: ['1', '6', '2'] }),
    false,
    '槽位必须是 前/上/右 三面，不能是别的面'
  );
  assert.equal(
    validateNetOption(cells, { visible: ['front', 'top', 'right'] }),
    false,
    '只有槽位名没有 labels 时没有任何几何信息，不能判为通过'
  );

  // 循环序仍然成立（整体旋转立方体不改变手性）
  assert.equal(validateNetOption(cells, [5, 1, 0]), true);
  assert.equal(validateNetOption(cells, [1, 0, 5]), true);
  // 镜像序（交换后两位）必须被拒
  assert.equal(validateNetOption(cells, [0, 1, 5]), false, '镜像排列折不出来');
  // 含相对面必须被拒
  assert.equal(validateNetOption(cells, [0, 2, 4]), false, 'bottom 与 top 是相对面，不可能同时可见');
  assert.equal(validateNetOption(cells, [3, 1, 0]), false, 'left 与 right 是相对面');
  // 形状非法
  assert.equal(validateNetOption(cells, [0, 0, 1]), false, '同一格不能占两个槽位');
  assert.equal(validateNetOption(cells, [0, 1]), false, '长度必须为 3');
  assert.equal(validateNetOption(cells, [0, 1, 9]), false, '越界标签');
  assert.equal(validateNetOption(cells, 'nope'), false);
  assert.equal(validateNetOption(cells, null), false);
  // 非法展开图一律拒
  assert.equal(validateNetOption([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], spec), false);
});

test('visibleOptions 与 validateNetOption 完全一致（24 组，互不重复）', () => {
  const cells = [[0, 1], [1, 1], [2, 1], [3, 1], [0, 0], [0, 2]];
  const options = visibleOptions(cells);
  assert.equal(options.length, 24);
  assert.equal(new Set(options.map((triple) => triple.join(','))).size, 24);
  for (const triple of options) {
    assert.equal(validateNetOption(cells, triple), true, `${triple} 应通过`);
    for (const permuted of [[triple[0], triple[2], triple[1]], [triple[1], triple[0], triple[2]]]) {
      assert.equal(validateNetOption(cells, permuted), false, `${permuted} 是镜像排列，应被拒`);
    }
  }
  // 全部 8 个角的代表都在里面
  const corners = new Set(options.map((triple) => [...triple].sort((a, b) => a - b).join(',')));
  assert.equal(corners.size, 8);
});

// ── 5. 题库：结构 + 唯一答案性 ───────────────────────────────────────

test('题库结构：28 条、id/front 唯一、图形字段齐全、choiceFigures 与 choiceTexts 等长', () => {
  assert.ok(ITEMS.length >= 24 && ITEMS.length <= 30, `题量应在 24~30，实际 ${ITEMS.length}`);
  assert.equal(new Set(ITEMS.map((item) => item.id)).size, ITEMS.length, 'id 必须唯一');
  assert.equal(new Set(ITEMS.map((item) => item.front)).size, ITEMS.length, 'front 必须唯一（subjects.test 的硬要求）');

  for (const item of ITEMS) {
    assert.equal(item.figure?.kind, 'figure:cube-net', `${item.id} 的题干必须是展开图`);
    const cells = item.figure.spec.cells;
    assert.equal(Array.isArray(cells), true);
    assert.equal(cells.length, 6, `${item.id} 的展开图必须恰好 6 格`);
    assert.equal(isValidNet(cells), true, `${item.id} 的展开图不是合法展开图`);

    // figure.js 的 renderCubeNet 按「行优先排序后 index + 1」给格子编号，
    // 而 labels 用的是 spec.cells 的下标 + 1。两者只有在 cells 已按 (row, col)
    // 排好序时才一致——所以这里把它变成硬约束，防止后来者随手改乱数据。
    const rowMajor = [...cells].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    assert.deepEqual(
      cells.map((cell) => [...cell]),
      rowMajor.map((cell) => [...cell]),
      `${item.id} 的 cells 必须按 (row, col) 行优先排序，否则题干的编号与选项 labels 对不上`
    );

    assert.ok(Array.isArray(item.choiceFigures), `${item.id} 缺 choiceFigures`);
    assert.ok(Array.isArray(item.choiceTexts), `${item.id} 缺 choiceTexts`);
    assert.equal(item.choiceFigures.length, 4, `${item.id} 必须恰好 4 个选项`);
    assert.equal(
      item.choiceFigures.length,
      item.choiceTexts.length,
      `${item.id} 的 choiceFigures 与 choiceTexts 必须等长（契约 7.2 硬性约定）`
    );
    for (const figure of item.choiceFigures) {
      assert.equal(figure?.kind, 'figure:cube-fold', `${item.id} 的选项必须是折叠后的立体图`);
      assert.deepEqual(
        figure.spec?.visible,
        ['front', 'top', 'right'],
        `${item.id} 的 visible 必须是固定的三个可见槽位名`
      );
      const labels = figure.spec?.labels;
      assert.ok(Array.isArray(labels), `${item.id} 的 cube-fold 必须带 spec.labels`);
      assert.equal(labels.length, 3, `${item.id} 的 labels 必须与 visible 等长（三项）`);
      assert.equal(new Set(labels).size, 3, `${item.id} 的 labels 三项必须互不相同`);
      for (const label of labels) {
        assert.equal(typeof label, 'string', `${item.id} 的 labels 元素必须是字符串`);
        assert.ok(CELL_LABELS.includes(label), `${item.id} 的 labels 元素必须是 '1'..'6'，实际 ${label}`);
      }
    }
  }
});

test('题库唯一答案性：每条恰好 1 个选项通过 validateNetOption', () => {
  const report = [];
  for (const item of ITEMS) {
    const cells = item.figure.spec.cells;
    const passes = item.choiceFigures.map((figure) => validateNetOption(cells, figure.spec));
    const passCount = passes.filter(Boolean).length;
    assert.equal(passCount, 1, `${item.id} 有 ${passCount} 个选项通过 validateNetOption，必须恰好 1 个`);

    const answerIndex = passes.indexOf(true);
    assert.equal(
      item.back,
      item.choiceTexts[answerIndex],
      `${item.id} 的 back 必须是正确选项的文字标签（判分与订正行都靠它）`
    );
    report.push({ id: item.id, passes: passCount, answer: item.back, slot: answerIndex });
  }

  const distribution = report.reduce((acc, row) => {
    acc[row.answer] = (acc[row.answer] ?? 0) + 1;
    return acc;
  }, {});
  console.log('\n题库唯一答案性自检（每条应恰好 1 个选项通过 validateNetOption）：');
  for (const row of report) {
    console.log(`  ✔ ${row.id}  通过选项数=${row.passes}  正确答案=${row.answer}（第 ${row.slot + 1} 项）`);
  }
  console.log(`  合计 ${report.length} 条，全部唯一答案；正确答案分布 ${JSON.stringify(distribution)}\n`);

  assert.deepEqual(
    Object.values(distribution).sort((a, b) => a - b),
    [7, 7, 7, 7],
    '正确答案标签应均匀分布在 A/B/C/D'
  );
});

test('四个选项的 labels 两两不同（否则渲染出来是同一张图，题目无解）', () => {
  for (const item of ITEMS) {
    const keys = item.choiceFigures.map((figure) => figure.spec.labels.join(','));
    assert.equal(new Set(keys).size, 4, `${item.id} 出现了重复的 labels 组合：${keys.join(' | ')}`);
  }
});

test('每个干扰项都有明确几何错误：恰好含一组「展开图上是相对面」的可见面', () => {
  for (const item of ITEMS) {
    const cells = item.figure.spec.cells;
    const rel = relativeFaces(cells);
    const oppositeKeys = new Set(rel.opposite.map(([i, j]) => `${i},${j}`));
    item.choiceFigures.forEach((figure, slot) => {
      const triple = figure.spec.labels.map((label) => Number(label) - 1);
      let hits = 0;
      for (let a = 0; a < triple.length; a += 1) {
        for (let b = a + 1; b < triple.length; b += 1) {
          const key = triple[a] < triple[b] ? `${triple[a]},${triple[b]}` : `${triple[b]},${triple[a]}`;
          if (oppositeKeys.has(key)) hits += 1;
        }
      }
      const isAnswer = item.choiceTexts[slot] === item.back;
      if (isAnswer) {
        assert.equal(hits, 0, `${item.id} 的正确答案不该含相对面`);
      } else {
        assert.equal(hits, 1, `${item.id} 的第 ${slot + 1} 个干扰项应恰好含一组相对面，实际 ${hits}`);
      }
    });
  }
});

test('题库覆盖合法展开图的全部 11 个等价类', () => {
  const used = new Set(ITEMS.map((item) => freeKey(item.figure.spec.cells)));
  assert.equal(used.size, 11, `题库应覆盖 11 个等价类，实际 ${used.size}`);
});

test('合法展开图池与题库自洽：题库里的展开图都来自 11 类，非法字形一个都没有', () => {
  const valid = new Set(
    polyominoes(6).filter((key) => isValidNet(parseKey(key))).map((key) => normalizeKey(parseKey(key)))
  );
  for (const item of ITEMS) {
    const key = normalizeKey(item.figure.spec.cells);
    assert.ok(valid.has(key), `${item.id} 的展开图字形不在合法池里`);
    const faces = foldFaces(item.figure.spec.cells);
    assert.equal(faces.filter(Boolean).length, 6);
    assert.equal(new Set(faces).size, 6);
  }
});
