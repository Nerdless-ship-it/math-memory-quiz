// 切面沙盒页面控制器。
//
// 交互设计的目标只有一个：让人**自己动手发现规则**。
//   · 拖切面角度 → 看到「斜切圆柱得到的是椭圆，不是梯形」
//   · 拖切面高度 → 看到「不同高度切出三角形 / 四边形 / 五边形 / 六边形」
//   · 换成空心体 → 看到「刀切到空心部分，截面上那条线就没有了」
// 这三条正是考公里最容易错的地方，靠背规则记不住，靠拖一次滑块就明白了。
//
// ── 性能设计（关键）────────────────────────────────────────────────
// 逐像素光线步进很贵（一次立体渲染约 60~100ms）。如果每次拖滑块都重算，
// 手感会完全丢掉。所以把渲染拆成两层：
//   1. **立体层**：只在「立体本身或视角改变」时重算。算出每个屏幕采样点对应的
//      世界坐标与法向，缓存起来。
//   2. **切面层**：拖滑块时只做「颜色重排 + 截面 marching squares」——
//      直接用缓存里保存的 p·n 值判断在切面哪一侧，几乎不花时间。
// 实测拖动时只走第 2 层，可以做到跟手。

import { sectionLoops } from './csg.js';
import { renderSectionShape, cacheSurface } from './solid-view.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const doc = () => globalThis.document;
const win = () => globalThis.window ?? globalThis;

/** 立体预设：名字 → 组合描述（真正体现「任意组合」）。 */
const SOLID_PRESETS = Object.freeze([
  { id: 'cube', label: '正方体', build: () => ({ type: 'box', size: 2 }), note: '截面最多 6 条边（6 个面）' },
  { id: 'cylinder', label: '圆柱', build: () => ({ type: 'cylinder', radius: 1, height: 2 }), note: '斜切得到椭圆，永远得不到梯形' },
  { id: 'cone', label: '圆锥', build: () => ({ type: 'cone', radius: 1, height: 2 }), note: '过顶点切出三角形，水平切出圆' },
  { id: 'sphere', label: '球', build: () => ({ type: 'sphere', radius: 1.1 }), note: '怎么切都是圆' },
  { id: 'hollow-cylinder', label: '空心圆柱', build: () => ({
    type: 'subtract',
    base: { type: 'cylinder', radius: 1, height: 2 },
    tool: { type: 'cylinder', radius: 0.5, height: 2.4 }
  }), note: '刀切到空心部分，截面上那条线就没有了' },
  { id: 'cube-hole', label: '方洞正方体', build: () => ({
    type: 'subtract',
    base: { type: 'box', size: 2 },
    tool: { type: 'cylinder', radius: 0.6, height: 2.4 }
  }), note: '挖穿之后，竖直切能看到两条轮廓' },
  { id: 'hollow-cone', label: '空心圆台', build: () => ({
    type: 'subtract',
    // ⚠️ 内圆锥必须是**有限深度**（height 1.0 < 外圆锥 2，底面齐平），才是「圆台」这种
    // 真实存在的空心体：下方有腔、上方是实心的。若把内圆锥也做成穿透（height > 2），
    // 就退化成通孔，于是「往上挪刀避开空腔」这种演示根本做不出来
    // （实测：通孔圆柱无论怎么水平切，截面永远带洞）。
    base: { type: 'cone', radius: 1, height: 2 },
    tool: { type: 'cone', radius: 0.6, height: 1.0 }
  }), note: '下方有腔、上方实心：刀往上挪就切不到空腔了' }
]);

/** 一键到位的演示：把「切面参数 + 立体」一起设好。 */
const DEMOS = Object.freeze([
  { id: 'hollow-hit', label: '① 刀切到空心', solid: 'hollow-cylinder', tilt: 0, spin: 0, d: 0,
    lesson: '切面穿过空腔 ⇒ 截面只有一个外轮廓，内部「没有」那条线。这就是「刀切空心部分不带线」。' },
  { id: 'hollow-miss', label: '② 刀没切到空心', solid: 'hollow-cone', tilt: 0, spin: 0, d: 0.7,
    lesson: '同一个立体，只是把刀往上挪到空腔之上 ⇒ 截面变成实心的完整圆盘，内部没有线。' +
      '「带不带线」只取决于这一刀有没有切到空心，与立体长什么样无关。' },
  { id: 'cylinder-oblique', label: '③ 斜切圆柱', solid: 'cylinder', tilt: 35, spin: 0, d: 0,
    lesson: '斜切圆柱得到的是椭圆。真题里常见的错误选项「梯形」是切不出来的。' },
  { id: 'cylinder-vertical', label: '④ 竖切圆柱', solid: 'cylinder', tilt: 90, spin: 0, d: 0.6,
    lesson: '平行于轴的切法得到矩形。所以圆柱的截面可以是圆、椭圆、矩形——但没有梯形。' },
  { id: 'cube-section', label: '⑤ 正方体斜切', solid: 'cube', tilt: 52, spin: 45, d: 0,
    lesson: '同一个正方体，切面越斜边数越多：三角形 → 四边形 → 五边形 → 六边形，最多 6 条边。' },
  { id: 'cone-sweep', label: '⑥ 水平切圆锥', solid: 'cone', tilt: 0, spin: 0, d: 0,
    lesson: '水平切圆锥得到圆；上下拖动高度看圆怎么变大变小。过顶点切则是三角形。' },
  { id: 'cube-hole-split', label: '⑦ 竖切方洞正方体', solid: 'cube-hole', tilt: 90, spin: 0, d: 0,
    lesson: '切面正好沿着通孔的对称面 ⇒ 截面被挖空部分切成两块互不相连的轮廓。' }
]);

// ── 状态 ────────────────────────────────────────────────────────────
const state = {
  solidId: 'cylinder',
  tilt: 35,
  spin: 0,
  d: 0,
  lesson: ''
};

let surfaceCache = null;
let surfaceKey = '';
let pending = false;

const normalize = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** 由 tilt / spin 求切面法向：tilt=0 水平，tilt=90 竖直。 */
function planeNormal() {
  const tilt = (state.tilt * Math.PI) / 180;
  const spin = (state.spin * Math.PI) / 180;
  return normalize([Math.sin(tilt) * Math.cos(spin), Math.sin(tilt) * Math.sin(spin), Math.cos(tilt)]);
}

function currentSolid() {
  const preset = SOLID_PRESETS.find((p) => p.id === state.solidId) ?? SOLID_PRESETS[0];
  return preset.build();
}

function currentPreset() {
  return SOLID_PRESETS.find((p) => p.id === state.solidId) ?? SOLID_PRESETS[0];
}

// ── 渲染 ────────────────────────────────────────────────────────────

/**
 * 立体层：只在立体或视角变化时重算，并缓存表面点。
 * 返回缓存对象，供切面层复用。
 */
function ensureSurfaceCache() {
  const key = `${state.solidId}|${computeExtent()}`;
  if (surfaceCache && surfaceKey === key) return surfaceCache;
  surfaceCache = cacheSurface(currentSolid(), { extent: computeExtent(), resolution: 150, scale: 62 });
  surfaceKey = key;
  return surfaceCache;
}

/** 采样平面需要覆盖的范围：按立体预设给一个够用的窗口。 */
function computeExtent() {
  switch (state.solidId) {
    case 'cube': return 1.9;
    case 'sphere': return 1.6;
    case 'cube-hole': return 1.9;
    default: return 1.8;
  }
}

function renderSolidView() {
  const host = doc().querySelector('#sandbox-solid');
  const cache = ensureSurfaceCache();
  const svg = cache.toSvg({ planeNormal: planeNormal(), planeD: state.d, showCut: true, width: 300, height: 280 });
  host.replaceChildren(svg);
}

function renderSectionView() {
  const host = doc().querySelector('#sandbox-section');
  const { svg, result } = renderSectionShape(currentSolid(), planeNormal(), state.d, {
    extent: computeExtent() + 0.2,
    resolution: 200,
    width: 280,
    height: 260,
    scale: 62
  });
  host.replaceChildren(svg);
  return result;
}

/** 用截面回路数描述结果——这就是「不带线」的量化表达。 */
function describeSection(result) {
  if (!result.ok) return { text: '这个位置切不到立体', tone: 'empty' };
  const outer = result.outer.length;
  const holes = result.holes.length;
  if (outer > 1) return { text: `截面断成 ${outer} 块（被挖空部分切成互不相连的几块）`, tone: 'split' };
  if (holes > 0) return { text: `截面是 ${outer} 个轮廓 + 内部 ${holes} 处镂空 ⇒ 内部不画线`, tone: 'hollow' };
  return { text: '截面是完整的实心轮廓 ⇒ 内部没有线', tone: 'solid' };
}

function renderAll() {
  renderSolidView();
  const result = renderSectionView();
  const desc = describeSection(result);
  const badge = doc().querySelector('#sandbox-result');
  badge.textContent = desc.text;
  badge.dataset.tone = desc.tone;
  const preset = currentPreset();
  doc().querySelector('#sandbox-solid-note').textContent = preset.note;
  doc().querySelector('#sandbox-lesson').textContent = state.lesson;
  doc().querySelector('#sandbox-lesson').hidden = !state.lesson;
}

// ── 交互 ────────────────────────────────────────────────────────────

/** 合并同一帧内的多次输入，避免拖动时排队卡顿。 */
function scheduleRender(full = true) {
  if (pending) return;
  pending = true;
  const raf = win().requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
  raf(() => {
    pending = false;
    if (full) renderSolidView();
    const result = renderSectionView();
    const desc = describeSection(result);
    const badge = doc().querySelector('#sandbox-result');
    badge.textContent = desc.text;
    badge.dataset.tone = desc.tone;
  });
}

function syncControls() {
  const d = doc();
  d.querySelector('#sandbox-tilt').value = String(state.tilt);
  d.querySelector('#sandbox-spin').value = String(state.spin);
  d.querySelector('#sandbox-d').value = String(state.d);
  d.querySelector('#sandbox-tilt-value').textContent = `${Math.round(state.tilt)}°`;
  d.querySelector('#sandbox-spin-value').textContent = `${Math.round(state.spin)}°`;
  d.querySelector('#sandbox-d-value').textContent = state.d.toFixed(2);
  for (const button of d.querySelectorAll('[data-solid]')) {
    button.setAttribute('aria-pressed', button.dataset.solid === state.solidId ? 'true' : 'false');
  }
}

function buildControls() {
  const d = doc();

  // 立体选择
  const solidRow = d.querySelector('#sandbox-solids');
  for (const preset of SOLID_PRESETS) {
    const button = d.createElement('button');
    button.type = 'button';
    button.className = 'sandbox-chip';
    button.dataset.solid = preset.id;
    button.textContent = preset.label;
    button.setAttribute('aria-pressed', preset.id === state.solidId ? 'true' : 'false');
    button.addEventListener('click', () => {
      state.solidId = preset.id;
      state.lesson = '';
      doc().querySelector('#sandbox-lesson').hidden = true;
      syncControls();
      renderAll();
    });
    solidRow.append(button);
  }

  // 演示按钮
  const demoRow = d.querySelector('#sandbox-demos');
  for (const demo of DEMOS) {
    const button = d.createElement('button');
    button.type = 'button';
    button.className = 'sandbox-demo';
    button.textContent = demo.label;
    button.addEventListener('click', () => {
      state.solidId = demo.solid;
      state.tilt = demo.tilt;
      state.spin = demo.spin;
      state.d = demo.d;
      state.lesson = demo.lesson;
      syncControls();
      renderAll();
    });
    demoRow.append(button);
  }

  // 滑块
  const bind = (id, key, onInput) => {
    const input = d.querySelector(`#${id}`);
    input.addEventListener('input', () => {
      state[key] = Number(input.value);
      state.lesson = '';
      onInput?.();
      syncControls();
      scheduleRender(true);
    });
  };
  bind('sandbox-tilt', 'tilt');
  bind('sandbox-spin', 'spin');
  bind('sandbox-d', 'd');

  // 重置
  d.querySelector('#sandbox-reset').addEventListener('click', () => {
    state.solidId = 'cylinder';
    state.tilt = 35;
    state.spin = 0;
    state.d = 0;
    state.lesson = '';
    syncControls();
    renderAll();
  });
}

function main() {
  buildControls();
  syncControls();
  renderAll();
  doc().body.dataset.sandboxReady = '1';
}

if (doc()?.readyState === 'loading') {
  doc().addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
