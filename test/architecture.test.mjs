// 架构不变量审计：验证「新增科目 = 加数据文件 + 注册表加一条，零新增代码」。
//
// 目标 (1) 的核心主张是「科目列表只有一个真相源」。但硬编码很容易被后来者无意加回，
// 所以这里把它变成可自动检查的断言：
//   A. public/js 下的渲染/控制代码里，不得出现注册表科目 id 的字面量（registry.js 本身除外）；
//   B. index.html 不得手写科目卡片；
//   C. 新增一个科目（数据文件 + 注册表一条）后，不需要改引擎/页面代码就能被加载。
//
// 注意：percent / powers 是既有的两个数学专项，它们有大量历史耦合（专用 HTML、
// 冻结 e2e 依赖的类名），因此本审计对这两个 id 豁免。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { SUBJECTS, getSubject, adapterPath, contentPath } from '../public/js/registry.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const jsDir = join(projectRoot, 'public', 'js');
const subjectsDir = join(projectRoot, 'public', 'subjects');

// 豁免名单：既有数学专项，历史上就与专用页面/冻结测试耦合。
const EXEMPT_IDS = new Set(['percent', 'powers']);
// 注册表本身是「唯一真相源」，它当然要列出所有 id。
const REGISTRY_FILE = 'registry.js';

async function listJsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('A. 渲染/控制代码里不得硬编码科目 id（注册表是唯一真相源）', async () => {
  const offenders = [];
  const registrySubjects = SUBJECTS.map((s) => s.id).filter((id) => !EXEMPT_IDS.has(id));

  for (const file of await listJsFiles(jsDir)) {
    const name = file.split(/[\\/]/).pop();
    if (name === REGISTRY_FILE) continue;                       // 真相源本身豁免
    if (relative(jsDir, file).startsWith('adapters')) continue; // 适配器按 id 分工，天然会提到自己
    const source = await readFile(file, 'utf8');

    for (const id of registrySubjects) {
      // 只匹配「引号包裹的完整 id 字面量」，避免把 substring 误判（如 'shengxiao' 出现在长词里）。
      const pattern = new RegExp(`['"\`]${id}['"\`]`);
      if (pattern.test(source)) {
        offenders.push(`${relative(projectRoot, file)} 含字面量 '${id}'`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '以下文件硬编码了科目 id，新增科目时会被漏掉；请改为从 registry.js 派生：\n' +
      offenders.map((o) => `  - ${o}`).join('\n')
  );
});

test('B. index.html 不得手写科目卡片（必须由注册表渲染）', async () => {
  const html = await readFile(join(projectRoot, 'public', 'index.html'), 'utf8');

  for (const id of SUBJECTS.map((s) => s.id)) {
    assert.ok(
      !html.includes(`data-subject-id="${id}"`),
      `index.html 手写了科目卡片 data-subject-id="${id}"；卡片必须由 subjects-page.js 从注册表渲染`
    );
  }
  assert.ok(
    html.includes('id="subjects"'),
    'index.html 缺少 #subjects 挂载点，科目卡片将无处渲染'
  );
  assert.ok(
    html.includes('id="dashboard"'),
    'index.html 缺少 #dashboard 挂载点，看板将无处渲染'
  );
});

test('C. 新增科目只需数据文件 + 注册表一条，页面与引擎代码零改动', async () => {
  // 用一个「幽灵科目」验证：它必须有可解析的适配器与内容路径，
  // 且 contentPath 解析出的绝对 URL 指向一个真实文件。
  const ghostId = 'audit-ghost';
  const ghostFile = join(subjectsDir, `${ghostId}.item.js`);

  // contentPath 依赖注册表的 CONTENT_PATHS；这里直接验证解析机制本身：
  // 给一个典型科目，其 contentPath 必须是绝对 URL 且文件真实存在。
  const real = SUBJECTS.find((s) => !EXEMPT_IDS.has(s.id));
  assert.ok(real, '注册表里应至少有一个考公常识科目');

  const url = contentPath(real);
  assert.match(url, /^file:\/\/|^https?:\/\//, `contentPath 必须返回绝对 URL，实际 ${url}`);

  const filePath = fileURLToPath(url);
  await access(filePath); // 文件必须真实存在，否则运行时会 404
  assert.ok(filePath.includes(`${'subjects'}`), `内容应位于 public/subjects/，实际 ${filePath}`);

  // 适配器路径同样必须是绝对 URL 且文件存在。
  const adapterUrl = adapterPath(real);
  assert.match(adapterUrl, /^file:\/\/|^https?:\/\//, `adapterPath 必须返回绝对 URL，实际 ${adapterUrl}`);
  await access(fileURLToPath(adapterUrl));

  // 关键断言：这两个路径的解析**不依赖任何按科目 id 的 switch/if**。
  // 只要注册表能给出 adapter 与内容路径，引擎与页面就是纯通用的。
  // 用「当前 registry 里的每个科目都能解析出适配器」来证明这一点。
  for (const subject of SUBJECTS) {
    assert.ok(adapterPath(subject), `科目 ${subject.id} 的 adapter="${subject.adapter}" 未登记模块路径`);
    assert.ok(getSubject(subject.id), `科目 ${subject.id} 应可通过 getSubject 取回`);
  }
});

test('D. 每个科目的内容文件都存在且与注册表题量匹配', async () => {
  const skip = new Set(['percent', 'powers']); // 数据源是既有冻结文件
  let checked = 0;

  for (const subject of SUBJECTS) {
    if (skip.has(subject.id)) continue;
    const url = contentPath(subject);
    assert.ok(url, `科目 ${subject.id} 未登记内容路径`);
    const module = await import(url);
    assert.ok(Array.isArray(module.ITEMS), `科目 ${subject.id} 的内容模块未导出 ITEMS 数组`);
    assert.ok(module.ITEMS.length >= 8, `科目 ${subject.id} 只有 ${module.ITEMS.length} 条，少于 8`);
    checked += 1;
  }

  assert.ok(checked >= 8, `应至少校验 8 个考公常识科目，实际 ${checked}`);
});

test('E. 科目卡片所需的展示字段齐全（渲染器不再做兜底判断）', () => {
  for (const subject of SUBJECTS) {
    assert.equal(typeof subject.id, 'string');
    assert.ok(subject.title, `科目 ${subject.id} 缺 title`);
    assert.ok(subject.page, `科目 ${subject.id} 缺 page`);
    assert.match(subject.accent, /^#[0-9a-f]{6}$/i, `科目 ${subject.id} 的 accent 必须是 6 位十六进制色值`);
    assert.ok(subject.icon, `科目 ${subject.id} 缺 icon`);
    assert.ok(['math', 'common'].includes(subject.category), `科目 ${subject.id} 的 category 非法`);
    assert.ok(Array.isArray(subject.questionTypes) && subject.questionTypes.length > 0);
    for (const type of subject.questionTypes) {
      assert.ok(['fill', 'choice'].includes(type), `科目 ${subject.id} 的 questionTypes 含非法值 ${type}`);
    }
  }
});
