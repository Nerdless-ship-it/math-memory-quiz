// 图解样张预览页控制器。
//
// 目的只有一个：让用户**在自己的浏览器里**看到图解的画法，好判断对不对。
// 之前那些图只在 QA 脚本里渲染过，App 里没有入口，用户根本看不到——
// 一路在报告「画好了」，用户却无从确认，这是流程上的疏漏。

import { renderSolidFigure, SOLID_FIGURE_KINDS } from './solid-figures.js';

const doc = () => globalThis.document;

/** 样例清单：名称 + 说明 + 对应的图解类型与参数。 */
const SAMPLES = Object.freeze([
  { kind: 'cube-reference', title: '立方体（画法样张）', note: '正面为正方形，深度沿 45° 半尺退出' },
  { kind: 'hollow-horizontal-cut', title: '空心圆柱 · 水平切', note: '截面是环，内部没有线（刀切到空心）' },
  { kind: 'oblique-cylinder-cut', title: '圆柱 · 斜切', note: '截面是椭圆，永远不是梯形' },
  { kind: 'cube-with-square-hole', title: '正方体 · 方形通孔', note: '方洞是方的；斜着切才会变其他形状' }
]);

function buildCard(sample) {
  const d = doc();
  const card = d.createElement('figure');
  card.className = 'preview-card';

  const heading = d.createElement('figcaption');
  heading.className = 'preview-card-title';
  heading.textContent = sample.title;

  const stage = d.createElement('div');
  stage.className = 'preview-card-stage';

  let svg = null;
  let error = null;
  try {
    svg = renderSolidFigure(sample.kind, {});
  } catch (e) {
    error = String(e?.message ?? e);
  }

  if (svg) stage.append(svg);
  else {
    const fail = d.createElement('p');
    fail.className = 'preview-card-error';
    fail.textContent = `渲染失败：${error}`;
    stage.append(fail);
  }

  const note = d.createElement('p');
  note.className = 'preview-card-note';
  note.textContent = sample.note;

  card.append(heading, stage, note);
  return card;
}

function main() {
  const d = doc();
  const grid = d.querySelector('#preview-grid');
  for (const sample of SAMPLES) grid.append(buildCard(sample));

  const note = d.querySelector('#preview-note');
  const missing = SAMPLES.filter((s) => !SOLID_FIGURE_KINDS.has(s.kind)).map((s) => s.kind);
  note.textContent = missing.length
    ? `⚠️ 以下图解类型未注册：${missing.join('、')}`
    : `共 ${SAMPLES.length} 张样张。画法确认后再补齐其余易错点图解。`;

  d.body.dataset.previewState = 'ready';
}

if (doc()?.readyState === 'loading') {
  doc().addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
