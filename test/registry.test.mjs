// 科目注册表契约测试（docs/ARCHITECTURE.md 第 3.1 节）。
//
// 把关点：新增科目只改 registry.js + 加一个数据文件，别的什么都不用动；
// 因此注册表本身必须自洽——id 唯一、字段齐全、page 指向真实文件、时效标注格式合法。
// 一旦这里红了，说明「新增科目零新增代码」的前提被破坏。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { CATEGORIES, SUBJECTS, getSubject, subjectIds, subjectsByCategory } from '../public/js/registry.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const REQUIRED_FIELDS = Object.freeze([
  'id', 'title', 'subtitle', 'category', 'accent', 'page',
  'icon', 'model', 'questionTypes', 'adapter', 'tags', 'updatedAt'
]);

const QUESTION_TYPES = Object.freeze(['fill', 'choice']);
// 'assoc'  = 双向关联模型（文字配对，常识科与速算科）
// 'figure' = 图形题模型（题面与选项都是图，走 figure-choice 适配器）
const MODELS = Object.freeze(['assoc', 'figure']);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 'YYYY-MM-DD' 必须是真实存在的日历日期（拒绝 2026-02-30 / 2026-13-01）。 */
function isValidCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** 把 `./quiz.html?subject=x#y` 解析成 { file, query }；不接受任何绝对/协议地址。 */
function resolvePage(page) {
  const withoutHash = page.split('#')[0];
  const queryIndex = withoutHash.indexOf('?');
  const file = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);
  return {
    file: file.replace(/^\.\//, ''),
    query: new URLSearchParams(query)
  };
}

test('registry: CATEGORIES 是非空的合法分组表', () => {
  assert.ok(Array.isArray(CATEGORIES), 'CATEGORIES 必须是数组');
  assert.ok(CATEGORIES.length > 0, 'CATEGORIES 不能为空');
  const ids = CATEGORIES.map((category) => category.id);
  for (const category of CATEGORIES) {
    assert.ok(isPlainObject(category), 'CATEGORIES 每一项必须是对象');
    assert.equal(typeof category.id, 'string', 'category.id 必须是字符串');
    assert.ok(ID_PATTERN.test(category.id), `category.id 非法：${category.id}`);
    assert.equal(typeof category.title, 'string', `category ${category.id} 缺少 title`);
    assert.ok(category.title.trim(), `category ${category.id} 的 title 不能为空`);
  }
  assert.equal(new Set(ids).size, ids.length, 'CATEGORIES 的 id 必须唯一');
});

test('registry: SUBJECTS 非空且冻结', () => {
  assert.ok(Array.isArray(SUBJECTS), 'SUBJECTS 必须是数组');
  assert.ok(SUBJECTS.length > 0, 'SUBJECTS 不能为空');
  assert.ok(Object.isFrozen(SUBJECTS), 'SUBJECTS 必须 Object.freeze，避免运行期被就地修改');
});

test('registry: 必填字段齐全且类型正确', () => {
  for (const subject of SUBJECTS) {
    assert.ok(isPlainObject(subject), '每个科目必须是对象');
    const label = subject?.id ?? '<缺少 id>';
    for (const field of REQUIRED_FIELDS) {
      assert.ok(Object.hasOwn(subject, field), `科目 ${label} 缺少字段 ${field}`);
    }
    assert.equal(typeof subject.id, 'string', `科目 ${label} 的 id 必须是字符串`);
    assert.equal(typeof subject.title, 'string', `科目 ${label} 的 title 必须是字符串`);
    assert.ok(subject.title.trim(), `科目 ${label} 的 title 不能为空`);
    assert.equal(typeof subject.subtitle, 'string', `科目 ${label} 的 subtitle 必须是字符串`);
    assert.equal(typeof subject.category, 'string', `科目 ${label} 的 category 必须是字符串`);
    assert.equal(typeof subject.accent, 'string', `科目 ${label} 的 accent 必须是字符串`);
    assert.equal(typeof subject.page, 'string', `科目 ${label} 的 page 必须是字符串`);
    assert.equal(typeof subject.icon, 'string', `科目 ${label} 的 icon 必须是字符串`);
    assert.equal(typeof subject.model, 'string', `科目 ${label} 的 model 必须是字符串`);
    assert.equal(typeof subject.adapter, 'string', `科目 ${label} 的 adapter 必须是字符串`);
    assert.ok(subject.adapter.trim(), `科目 ${label} 的 adapter 不能为空`);
    assert.ok(Array.isArray(subject.questionTypes), `科目 ${label} 的 questionTypes 必须是数组`);
    assert.ok(Array.isArray(subject.tags), `科目 ${label} 的 tags 必须是数组`);
  }
});

test('registry: 科目 id 唯一且格式合法', () => {
  const seen = new Map();
  for (const subject of SUBJECTS) {
    assert.ok(ID_PATTERN.test(subject.id), `科目 id 非法（只允许小写字母/数字/连字符）：${subject.id}`);
    assert.ok(!seen.has(subject.id), `科目 id 重复：${subject.id}`);
    seen.set(subject.id, subject);
  }
});

test('registry: category 必须是 CATEGORIES 里登记的分组', () => {
  const known = new Set(CATEGORIES.map((category) => category.id));
  for (const subject of SUBJECTS) {
    assert.ok(known.has(subject.category), `科目 ${subject.id} 的 category 未在 CATEGORIES 登记：${subject.category}`);
  }
});

test('registry: accent 是合法十六进制颜色', () => {
  for (const subject of SUBJECTS) {
    assert.match(subject.accent, HEX_COLOR_PATTERN, `科目 ${subject.id} 的 accent 非法：${subject.accent}`);
  }
});

test('registry: icon 是 1~2 个字符的纯文本角标', () => {
  for (const subject of SUBJECTS) {
    const length = [...subject.icon].length;
    assert.ok(length >= 1 && length <= 2, `科目 ${subject.id} 的 icon 必须是 1~2 个字符：${subject.icon}`);
    assert.equal(subject.icon.trim(), subject.icon, `科目 ${subject.id} 的 icon 不能有首尾空格`);
  }
});

test('registry: tags 是非空的非空字符串数组', () => {
  for (const subject of SUBJECTS) {
    assert.ok(subject.tags.length > 0, `科目 ${subject.id} 至少要有一个 tag`);
    for (const tag of subject.tags) {
      assert.equal(typeof tag, 'string', `科目 ${subject.id} 的 tag 必须是字符串`);
      assert.ok(tag.trim(), `科目 ${subject.id} 存在空 tag`);
    }
  }
});

test('registry: model 在允许的取值内', () => {
  for (const subject of SUBJECTS) {
    assert.ok(MODELS.includes(subject.model), `科目 ${subject.id} 的 model 非法：${subject.model}`);
  }
});

test('registry: questionTypes 取值合法且不重复', () => {
  for (const subject of SUBJECTS) {
    const types = subject.questionTypes;
    assert.ok(types.length > 0, `科目 ${subject.id} 的 questionTypes 不能为空`);
    for (const type of types) {
      assert.ok(QUESTION_TYPES.includes(type), `科目 ${subject.id} 的题型非法：${type}`);
    }
    assert.equal(new Set(types).size, types.length, `科目 ${subject.id} 的 questionTypes 存在重复项`);
  }
});

test('registry: page 指向真实存在的页面文件', () => {
  for (const subject of SUBJECTS) {
    assert.ok(!subject.page.includes('://'), `科目 ${subject.id} 的 page 不得使用绝对地址：${subject.page}`);
    assert.ok(subject.page.startsWith('./'), `科目 ${subject.id} 的 page 必须是相对 public/ 的 ./ 路径：${subject.page}`);

    const { file, query } = resolvePage(subject.page);
    assert.ok(file, `科目 ${subject.id} 的 page 解析不出文件名：${subject.page}`);
    assert.ok(existsSync(join(PUBLIC_DIR, file)), `科目 ${subject.id} 的 page 文件不存在：public/${file}`);

    // `?subject=<id>` 形式的通用页，query 必须与科目自身 id 一致，否则会跳到别的科目。
    if (query.has('subject')) {
      assert.equal(query.get('subject'), subject.id, `科目 ${subject.id} 的 page query 与自身 id 不一致：${subject.page}`);
    }
  }
});

test('registry: updatedAt 为 null 或合法的 YYYY-MM-DD', () => {
  for (const subject of SUBJECTS) {
    const value = subject.updatedAt;
    if (value === null) continue;
    assert.equal(typeof value, 'string', `科目 ${subject.id} 的 updatedAt 必须是 null 或字符串`);
    assert.ok(isValidCalendarDate(value), `科目 ${subject.id} 的 updatedAt 不是合法日期：${value}`);
  }
});

test('registry: 至少有一个时效性科目带 updatedAt（首页「更新于」能力不允许被删掉）', () => {
  const dated = SUBJECTS.filter((subject) => subject.updatedAt !== null);
  assert.ok(dated.length > 0, '没有任何科目维护 updatedAt，「更新于 YYYY-MM-DD」将永远不显示');
});

test('registry: 查询 API 与 SUBJECTS 完全一致', () => {
  assert.deepEqual(subjectIds(), SUBJECTS.map((subject) => subject.id), 'subjectIds() 必须与 SUBJECTS 顺序一致');
  for (const subject of SUBJECTS) {
    assert.equal(getSubject(subject.id), subject, `getSubject(${subject.id}) 必须返回同一个对象引用`);
  }
  assert.equal(getSubject('__not-a-subject__'), undefined, '未知 id 必须返回 undefined（调用方据此回首页）');

  const grouped = CATEGORIES.flatMap((category) => subjectsByCategory(category.id));
  assert.equal(grouped.length, SUBJECTS.length, 'subjectsByCategory 必须覆盖全部科目，不能漏也不能重');
});
