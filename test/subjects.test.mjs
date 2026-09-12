// 题库数据质量校验 —— 覆盖全部科目（数学 2 科 + 考公常识 8 科）。
//
// 这是防止「内容出错害人」的第一道自动化闸门。它只做结构性与一致性校验，
// 无法校验事实正确性（那需要人工抽查），但能拦住最致命的一类错误：
// 重复的 front 导致同一题被问两次、空答案、id 冲突、数据量不足撑不起一轮测试。
//
// 契约依据：docs/ARCHITECTURE.md 第 3.2 节「数据质量硬性要求」。

import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SUBJECTS, contentPath } from '../public/js/registry.js';
import { exponentSymbol } from '../public/js/powers-quiz.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const MIN_ITEMS = 8;

function toFileUrl(path) {
  return new URL(path, import.meta.url).href;
}

/** 读取科目内容。返回 null 表示「内容尚未落地」，由调用方跳过。 */
async function loadSubjectItems(subject) {
  const url = contentPath(subject);
  if (!url) {
    // percent / powers 的数据源是既有冻结文件，由各自适配器提供。
    const legacy = {
      percent: '../public/js/data.js',
      powers: '../public/js/powers-data.js'
    }[subject.id];
    if (!legacy) return null;

    if (subject.id === 'percent') {
      const module = await import(toFileUrl(legacy));
      return module.PAIRS.map((row, index) => ({
        id: `percent-${index + 1}`,
        front: `${row.percent}%`,
        back: row.fraction
      }));
    }

    // powers 的 front 必须是「底数 + 上标」。
    // 早期版本误用裸底数 row.base，导致 1.2 / 1.3 / 1.4 被误报为重复 front
    // —— 它们是同一个底数的不同次幂，加上上标后并不重复。
    const module = await import(toFileUrl(legacy));
    return module.POWER_PAIRS.map((row) => ({
      id: row.id,
      front: `${row.base}${exponentSymbol(row.exponent)}`,
      back: row.result
    }));
  }

  // contentPath 返回的是绝对 URL（以 public/js/ 为基准解析），直接用它定位文件。
  const filePath = fileURLToPath(url);
  try {
    await access(filePath);
  } catch {
    return null; // 内容文件还没写，跳过（由集成阶段补齐）
  }
  const module = await import(url);
  return module.ITEMS ?? null;
}

const loaded = new Map();
for (const subject of SUBJECTS) {
  loaded.set(subject.id, await loadSubjectItems(subject));
}

/** 只对已有内容的科目断言；内容未落地的科目在报告里显式标出。 */
function eachLoadedSubject(fn) {
  for (const subject of SUBJECTS) {
    const items = loaded.get(subject.id);
    if (!items) continue;
    fn(subject, items);
  }
}

test('每个科目都有内容，且达到最小题量', () => {
  const missing = SUBJECTS.filter((subject) => {
    const items = loaded.get(subject.id);
    return !items || items.length === 0;
  }).map((subject) => subject.id);

  // 内容生成是分阶段落地的，这里给出明确的可读诊断而不是让后续断言莫名失败。
  assert.deepEqual(missing, [], `以下科目还没有任何内容：${missing.join(', ')}`);

  for (const subject of SUBJECTS) {
    const items = loaded.get(subject.id);
    assert.ok(
      items.length >= MIN_ITEMS,
      `科目 ${subject.id} 只有 ${items.length} 条内容，少于最小值 ${MIN_ITEMS}，撑不起一轮完整测试`
    );
  }
});

test('科目内 id 唯一', () => {
  eachLoadedSubject((subject, items) => {
    const ids = new Set(items.map((item) => String(item?.id ?? '')));
    assert.equal(
      ids.size,
      items.length,
      `科目 ${subject.id} 存在重复 id：${items.length - ids.size} 个冲突`
    );
  });
});

/** 条目在某个维度上的「身份键」：图形题用整张图，文字题用字段值。 */
function identityKey(item, field) {
  if (field === 'figure') return JSON.stringify(item?.figure ?? null);
  if (field === 'choices') return JSON.stringify(item?.choiceFigures ?? item?.choiceTexts ?? null);
  return normalizeForCompare(String(item?.[field] ?? ''));
}

function normalizeForCompare(value) {
  return value.replace(/\s+/g, '');
}

/**
 * 重复项检查的通用实现。
 *
 * 放行规则（`allowDuplicateFront` / `allowDuplicateBack`）**不是「跳过检查」**：
 * 而是把唯一性判据换成科目声明的身份键（`uniqueBy`）。
 * 图形题的 front 是固定题干文案、back 是选项标签，文字上重复是内容特性；
 * 但**每道题本身必须仍然可区分**，否则就是真的在重复出同一道题。
 */
function checkDuplicates(subject, items, field, allowFlag, uniqueBy) {
  const keyField = uniqueBy ?? field;
  const keys = items.map((item) => identityKey(item, keyField));
  const uniqueCount = new Set(keys).size;
  assert.equal(
    uniqueCount,
    items.length,
    `科目 ${subject.id} 放行了重复 ${field}，但按「${keyField}」判定的题目身份必须唯一：` +
      `${items.length} 条里只有 ${uniqueCount} 个不同身份，存在真正重复的题`
  );
}

test('科目内 front 不重复（否则同一道题会被问两次）', () => {
  eachLoadedSubject((subject, items) => {
    // 图形题的题干是**固定文案**（如「该立方体被平面所截，截面不可能是」），
    // 各题差别在图上，不在文字上 —— 这类科目显式放行重复 front，
    // 但要求每条题的身份键唯一（见 checkDuplicates）。
    if (subject.allowDuplicateFront) {
      checkDuplicates(subject, items, 'front', true, subject.uniqueBy);
      return;
    }
    const seen = new Map();
    const duplicates = [];
    for (const item of items) {
      const key = String(item?.front ?? '');
      if (seen.has(key)) duplicates.push(key);
      else seen.set(key, item.id);
    }
    assert.deepEqual(
      duplicates,
      [],
      `科目 ${subject.id} 存在重复 front，会导致同一题重复出现：${[...new Set(duplicates)].join(' / ')}` +
        `（若题干文案本就固定、差异在图上，请在 registry.js 里为该科设 allowDuplicateFront: true + uniqueBy）`
    );
  });
});

test('科目内 back 不重复（除非科目显式允许）', () => {
  eachLoadedSubject((subject, items) => {
    if (subject.allowDuplicateBack) {
      checkDuplicates(subject, items, 'back', true, subject.uniqueBy);
      return;
    }
    const seen = new Map();
    const duplicates = [];
    for (const item of items) {
      const key = String(item?.back ?? '');
      if (seen.has(key)) duplicates.push(key);
      else seen.set(key, item.id);
    }
    assert.deepEqual(
      duplicates,
      [],
      `科目 ${subject.id} 存在重复 back，会让「由 back 反查 front」出现多解：` +
        `${[...new Set(duplicates)].join(' / ')}（若属内容特性，请在 registry.js 里为该科设 allowDuplicateBack: true + uniqueBy）`
    );
  });
});

test('front / back 非空且已 trim，不含首尾空白', () => {
  eachLoadedSubject((subject, items) => {
    for (const item of items) {
      const label = `${subject.id}/${item?.id ?? '?'}`;
      for (const field of ['front', 'back']) {
        const value = item?.[field];
        assert.equal(typeof value, 'string', `${label} 的 ${field} 必须是字符串`);
        assert.ok(value.length > 0, `${label} 的 ${field} 不能为空`);
        assert.equal(value, value.trim(), `${label} 的 ${field} 含首尾空白：${JSON.stringify(value)}`);
      }
    }
  });
});

test('id 非空且格式合规', () => {
  eachLoadedSubject((subject, items) => {
    for (const item of items) {
      const id = String(item?.id ?? '');
      assert.ok(id.length > 0, `科目 ${subject.id} 存在空 id`);
      // 允许点号：powers-data.js 里冻结的 id 形如 cube-1.2 / fourth-1.3，
      // 那是底数的小数点，不是非法字符（契约第 8.2 节禁止改动该文件）。
      // 真正要禁的是空白、冒号与斜杠——它们会破坏 mistakes id 的分段解析。
      assert.match(
        id,
        /^[a-z0-9][a-z0-9.\-]*$/i,
        `科目 ${subject.id} 的 id "${id}" 含非法字符，只允许字母数字、连字符与点号`
      );
      assert.ok(
        !/[\s:/]/.test(id),
        `科目 ${subject.id} 的 id "${id}" 不得含空白、冒号或斜杠（会破坏错题 id 解析）`
      );
    }
  });
});

test('tags 若存在必须是非空字符串数组', () => {
  eachLoadedSubject((subject, items) => {
    for (const item of items) {
      if (item?.tags === undefined) continue;
      assert.ok(Array.isArray(item.tags), `科目 ${subject.id}/${item.id} 的 tags 必须是数组`);
      for (const tag of item.tags) {
        assert.equal(typeof tag, 'string', `科目 ${subject.id}/${item.id} 的 tag 必须是字符串`);
        assert.ok(tag.trim().length > 0, `科目 ${subject.id}/${item.id} 存在空白 tag`);
      }
    }
  });
});

test('时政等时效性科目的 updatedAt 必须是合法 YYYY-MM-DD', () => {
  for (const subject of SUBJECTS) {
    if (subject.updatedAt === null || subject.updatedAt === undefined) continue;
    assert.match(
      subject.updatedAt,
      /^\d{4}-\d{2}-\d{2}$/,
      `科目 ${subject.id} 的 updatedAt 格式非法：${subject.updatedAt}`
    );
    const parsed = new Date(`${subject.updatedAt}T00:00:00Z`);
    assert.ok(
      !Number.isNaN(parsed.getTime()),
      `科目 ${subject.id} 的 updatedAt 不是真实日期：${subject.updatedAt}`
    );
    assert.ok(
      parsed.getTime() <= Date.now() + 86_400_000,
      `科目 ${subject.id} 的 updatedAt 在未来：${subject.updatedAt}`
    );
  }
});

test('内容完整性报告（诊断用，不设阈值）', () => {
  const report = SUBJECTS.map((subject) => {
    const items = loaded.get(subject.id);
    return {
      科目: subject.id,
      题量: items ? items.length : 0,
      状态: items && items.length > 0 ? '已就绪' : '待补内容'
    };
  });
  console.log('\n题库内容完整性：');
  for (const row of report) {
    console.log(`  ${row.状态 === '已就绪' ? '✔' : '○'} ${row.科目.padEnd(16)} ${String(row.题量).padStart(3)} 题  ${row.状态}`);
  }
  const ready = report.filter((row) => row.状态 === '已就绪').length;
  console.log(`  合计：${ready}/${report.length} 个科目已就绪\n`);
  assert.ok(report.length > 0, '注册表里至少应有一个科目');
});
