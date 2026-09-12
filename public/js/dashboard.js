// 首页看板：连续打卡 / 正确率趋势（内联 SVG 折线）/ 各科弱项分布。
//
// 用法（Lead 在 index.html / home.js 里接线）：
//   import { mountDashboard } from './js/dashboard.js';
//   await mountDashboard(document.querySelector('#dashboard'));
//
// 数据来源优先级（全部只读，绝不写 localStorage）：
//   1. ./storage.js —— 契约 3.6 的 v2 存储层（首选）
//   2. ./history.js —— 兼容外观（v1 形状，storage.js 未就绪时的过渡）
//   3. 直接读 mq:*:v2 / math-memory-quiz-*:v1 键 —— storage.js 与 history.js 都不可用时的只读兜底
//
// 硬约束：图表必须是内联 SVG，禁止任何图表库 / 外链。
// 降级：任何一环缺失都渲染空状态，mountDashboard 永不 reject。

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLESHEET_HREF = './quiz.css';
const TREND_LIMIT = 12;
const WEAK_LIMIT = 6;

const BLOCK_IDS = Object.freeze({
  streak: 'dashboard-streak',
  trend: 'dashboard-trend',
  weak: 'dashboard-weak'
});

/* ── 小工具 ───────────────────────────────────────────────────────────── */

function ensureStylesheet(href = STYLESHEET_HREF) {
  if (typeof document === 'undefined') return null;
  const existing = document.querySelector(`link[rel="stylesheet"][href$="${href.replace('./', '')}"]`);
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.dashboardStyles = 'true';
  document.head.append(link);
  return link;
}

function resolveContainer(container) {
  if (!container) return null;
  if (typeof container === 'string') {
    try {
      return document.querySelector(container);
    } catch {
      return null;
    }
  }
  return typeof container === 'object' && typeof container.append === 'function' ? container : null;
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function svgElement(tagName, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 'YYYY-MM-DD'（本地时区），用于打卡日期展示。 */
function formatDay(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 'MM-DD'，用于趋势图横轴。 */
function formatShortDay(value) {
  const day = formatDay(value);
  return day ? day.slice(5) : '';
}

function safeArray(fn) {
  try {
    const value = fn();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function safeObject(fn) {
  try {
    const value = fn();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/* ── 数据装载：storage.js → history.js → 裸 localStorage ──────────────── */

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    subjectId: String(record.subjectId ?? record.quizType ?? ''),
    accuracy: clamp(record.accuracy, 0, 100),
    completedAt: Number(record.completedAt) || 0,
    correct: Number(record.correct) || 0,
    total: Number(record.total) || 0,
    mode: record.mode === 'mistakes' ? 'mistakes' : 'test'
  };
}

function normalizeMistake(mistake) {
  if (!mistake || typeof mistake !== 'object') return null;
  return {
    subjectId: String(mistake.subjectId ?? mistake.quizType ?? ''),
    itemId: String(mistake.itemId ?? mistake.id ?? ''),
    wrongCount: Number(mistake.wrongCount) || 1
  };
}

function readLocalStorageJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed ?? null;
  } catch {
    return null;
  }
}

function readFallbackKeys() {
  let storage = null;
  try {
    storage = window.localStorage;
    storage.getItem('mq:probe');
  } catch {
    storage = null;
  }
  if (!storage) return { records: [], mistakes: [], profile: null, mastery: {} };

  const v2Records = readLocalStorageJson(storage, 'mq:records:v2');
  const v1Records = readLocalStorageJson(storage, 'math-memory-quiz-history:v1');
  const v2Mistakes = readLocalStorageJson(storage, 'mq:mistakes:v2');
  const v1Mistakes = readLocalStorageJson(storage, 'math-memory-quiz-mistakes:v1');
  const profile = readLocalStorageJson(storage, 'mq:profile:v2');
  const mastery = readLocalStorageJson(storage, 'mq:mastery:v2');

  const records = Array.isArray(v2Records) && v2Records.length
    ? v2Records
    : Array.isArray(v1Records) ? v1Records : [];
  const mistakes = Array.isArray(v2Mistakes) && v2Mistakes.length
    ? v2Mistakes
    : Array.isArray(v1Mistakes) ? v1Mistakes : [];

  return {
    records,
    mistakes,
    profile: profile && typeof profile === 'object' ? profile : null,
    mastery: mastery && typeof mastery === 'object' && !Array.isArray(mastery) ? mastery : {}
  };
}

/** 统一数据快照；任何来源失败都会退化成空数据，绝不抛错。 */
async function loadDashboardData() {
  // 1) 契约存储层
  try {
    const storage = await import(/* @vite-ignore */ './storage.js');
    if (typeof storage.readRecords === 'function') {
      const records = safeArray(() => storage.readRecords()).map(normalizeRecord).filter(Boolean);
      const mistakes = safeArray(() => storage.readMistakes()).map(normalizeMistake).filter(Boolean);
      const profile = typeof storage.readProfile === 'function'
        ? (() => {
          try {
            return storage.readProfile();
          } catch {
            return null;
          }
        })()
        : null;
      const mastery = typeof storage.readMastery === 'function' ? safeObject(() => storage.readMastery()) : {};
      return { source: 'storage', records, mistakes, profile, mastery };
    }
  } catch {
    // storage.js 未就绪或加载失败，继续降级。
  }

  // 2) history.js 兼容外观（v1 → v2 形状）
  try {
    const history = await import(/* @vite-ignore */ './history.js');
    const readRecords = typeof history.getRecords === 'function'
      ? history.getRecords
      : typeof history.readHistory === 'function' ? history.readHistory : null;
    if (readRecords) {
      const records = safeArray(() => readRecords()).map(normalizeRecord).filter(Boolean);
      const mistakes = safeArray(() => history.readMistakes?.()).map(normalizeMistake).filter(Boolean);
      return { source: 'history', records, mistakes, profile: null, mastery: {} };
    }
  } catch {
    // 继续降级到裸键读取。
  }

  // 3) 只读兜底
  const fallback = readFallbackKeys();
  return {
    source: 'localStorage',
    records: fallback.records.map(normalizeRecord).filter(Boolean),
    mistakes: fallback.mistakes.map(normalizeMistake).filter(Boolean),
    profile: fallback.profile,
    mastery: fallback.mastery
  };
}

/* ── 各科弱项统计 ─────────────────────────────────────────────────────── */

/**
 * @returns {{subjectId: string, mistakes: number, weak: number, total: number, wrongCount: number}[]}
 *          按 total 降序。
 */
function computeWeakness(data) {
  const rows = new Map();
  const ensure = (subjectId) => {
    const key = subjectId || 'unknown';
    if (!rows.has(key)) rows.set(key, { subjectId: key, mistakeItems: new Set(), weakItems: new Set(), wrongCount: 0 });
    return rows.get(key);
  };

  for (const mistake of data.mistakes) {
    const row = ensure(mistake.subjectId);
    row.mistakeItems.add(mistake.itemId || `${row.mistakeItems.size}`);
    row.wrongCount += mistake.wrongCount;
  }

  // mastery 键形如 `${subjectId}:${itemId}`；答错且回到 level 0 的条目也算弱项。
  for (const [key, value] of Object.entries(data.mastery)) {
    if (!value || typeof value !== 'object') continue;
    const separator = key.indexOf(':');
    const subjectId = separator > 0 ? key.slice(0, separator) : 'unknown';
    const itemId = separator > 0 ? key.slice(separator + 1) : key;
    const wrong = Number(value.wrong) || 0;
    const level = Number(value.level) || 0;
    if (wrong <= 0 || level > 0) continue;
    ensure(subjectId).weakItems.add(itemId);
  }

  return [...rows.values()]
    .map((row) => {
      const union = new Set([...row.mistakeItems, ...row.weakItems]);
      return {
        subjectId: row.subjectId,
        mistakes: row.mistakeItems.size,
        weak: row.weakItems.size,
        total: union.size,
        wrongCount: row.wrongCount
      };
    })
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || right.wrongCount - left.wrongCount);
}

function subjectLabelMap(registry) {
  const map = new Map();
  const subjects = Array.isArray(registry?.SUBJECTS) ? registry.SUBJECTS : [];
  for (const subject of subjects) {
    map.set(subject.id, { title: subject.title ?? subject.id, accent: subject.accent ?? null });
  }
  return map;
}

/* ── 三个区块的渲染 ───────────────────────────────────────────────────── */

function renderStreak(body, data) {
  body.replaceChildren();
  const profile = data.profile;
  if (!profile) {
    const empty = element('div', 'dashboard-empty');
    empty.append(
      element('strong', null, '还没有打卡记录'),
      element('span', null, '完成一次测试后，这里会记录连续练习的天数。')
    );
    body.append(empty);
    return;
  }

  const streakDays = Math.max(0, Number(profile.streakDays) || 0);
  const bestStreakDays = Math.max(streakDays, Number(profile.bestStreakDays) || 0);

  const line = element('div', 'streak-line');
  line.append(element('strong', 'streak-value', String(streakDays)), element('span', 'streak-unit', '天'));
  body.append(line);

  const meta = element('div', 'streak-meta');
  meta.append(element('span', null, `最长连续 ${bestStreakDays} 天`));
  const lastDay = formatDay(profile.lastActiveDate);
  if (lastDay) meta.append(element('span', null, `最近打卡 ${lastDay}`));
  body.append(meta);

  if (streakDays === 0) {
    body.append(element('p', 'dashboard-hint', '今天还没有练习，完成一轮即可开启连续打卡。'));
  } else {
    body.append(element('p', 'dashboard-hint', '每天完成任一科目的一轮测试即算打卡。'));
  }
}

function renderTrend(body, data, accent) {
  body.replaceChildren();
  const records = [...data.records]
    .filter((record) => record.completedAt > 0)
    .sort((left, right) => left.completedAt - right.completedAt)
    .slice(-TREND_LIMIT);

  if (!records.length) {
    const empty = element('div', 'dashboard-empty');
    empty.append(
      element('strong', null, '还没有正确率数据'),
      element('span', null, '交卷后这里会画出最近若干次的正确率折线。')
    );
    body.append(empty);
    return;
  }

  const width = 340;
  const height = 168;
  const pad = { top: 18, right: 16, bottom: 30, left: 40 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const pointX = (index) => (records.length === 1
    ? pad.left + innerWidth / 2
    : pad.left + (innerWidth * index) / (records.length - 1));
  const pointY = (accuracy) => pad.top + innerHeight * (1 - clamp(accuracy, 0, 100) / 100);

  const svg = svgElement('svg', {
    class: 'trend-chart',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `最近 ${records.length} 次测试的正确率趋势`,
    'data-points': records.length
  });

  for (const value of [100, 50, 0]) {
    const y = pointY(value);
    svg.append(svgElement('line', {
      class: value === 0 ? 'trend-axis' : 'trend-grid',
      x1: pad.left, x2: width - pad.right, y1: y, y2: y
    }));
    svg.append(svgElement('text', {
      class: 'trend-axis-label', x: pad.left - 8, y: y + 4, 'text-anchor': 'end'
    }, `${value}%`));
  }

  const points = records.map((record, index) => ({ x: pointX(index), y: pointY(record.accuracy), record }));
  const coordinates = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

  if (points.length > 1) {
    svg.append(svgElement('polygon', {
      class: 'trend-area',
      points: `${pad.left},${pointY(0)} ${coordinates} ${points[points.length - 1].x.toFixed(1)},${pointY(0)}`,
      fill: accent,
      'fill-opacity': '0.1'
    }));
    svg.append(svgElement('polyline', {
      class: 'trend-line',
      points: coordinates,
      fill: 'none',
      stroke: accent,
      'stroke-width': '2',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    }));
  }

  points.forEach((point, index) => {
    const latest = index === points.length - 1;
    const circle = svgElement('circle', {
      class: latest ? 'trend-point trend-point-latest' : 'trend-point',
      cx: point.x.toFixed(1),
      cy: point.y.toFixed(1),
      r: latest ? 4 : 2.6,
      fill: latest ? accent : '#ffffff',
      stroke: accent,
      'stroke-width': latest ? 2 : 1.6
    });
    circle.append(svgElement('title', {}, `${formatDay(point.record.completedAt)} · ${Math.round(point.record.accuracy)}%`));
    svg.append(circle);
  });

  const first = points[0];
  const last = points[points.length - 1];
  if (first.record.completedAt) {
    svg.append(svgElement('text', {
      class: 'trend-x-label', x: first.x.toFixed(1), y: height - 10, 'text-anchor': 'start'
    }, formatShortDay(first.record.completedAt)));
  }
  if (last !== first && last.record.completedAt) {
    svg.append(svgElement('text', {
      class: 'trend-x-label', x: last.x.toFixed(1), y: height - 10, 'text-anchor': 'end'
    }, formatShortDay(last.record.completedAt)));
  }

  const wrapper = element('div', 'trend-wrap');
  wrapper.append(svg);

  const average = Math.round(records.reduce((sum, record) => sum + record.accuracy, 0) / records.length);
  const best = Math.max(...records.map((record) => Math.round(record.accuracy)));
  const previous = records.length > 1 ? records[records.length - 2] : null;
  const delta = previous ? Math.round(last.record.accuracy) - Math.round(previous.accuracy) : null;

  const caption = element('div', 'trend-caption');
  caption.append(element('span', null, `最近 ${records.length} 次 · 平均 ${average}% · 最高 ${best}%`));
  if (delta !== null) {
    const deltaText = delta === 0 ? '与上次持平' : `较上次 ${delta > 0 ? '+' : ''}${delta}%`;
    const deltaNode = element('strong', `trend-delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral'}`, deltaText);
    caption.append(deltaNode);
  }
  wrapper.append(caption);
  body.append(wrapper);
}

function renderWeak(body, data, labels) {
  body.replaceChildren();
  const rows = computeWeakness(data);
  if (!rows.length) {
    const empty = element('div', 'dashboard-empty');
    empty.append(
      element('strong', null, '暂时没有弱项'),
      element('span', null, '答错的题会自动进入错题集，并在这里按科目汇总。')
    );
    body.append(empty);
    return;
  }

  const max = rows[0].total;
  const visible = rows.slice(0, WEAK_LIMIT);
  const list = element('div', 'weak-list');

  for (const row of visible) {
    const meta = labels.get(row.subjectId) ?? { title: row.subjectId, accent: null };
    const item = element('div', 'weak-row');
    // 刻意用 data-weak-subject 而不是 data-subject-id：后者是「科目卡片」的标识，
    // 看板的弱项行复用同名属性会让 `document.querySelectorAll('[data-subject-id]')`
    // 同时数到卡片与弱项行（曾因此在首页数出 12 个科目）。命名空间分开，两边都稳。
    item.dataset.weakSubject = row.subjectId;
    item.dataset.count = String(row.total);

    const name = element('span', 'weak-name', meta.title);
    const bar = element('span', 'weak-bar');
    const fill = element('span', 'weak-bar-fill');
    fill.style.width = `${Math.max(6, Math.round((row.total / max) * 100))}%`;
    if (meta.accent) fill.style.background = meta.accent;
    bar.append(fill);
    const count = element('span', 'weak-count', `${row.total} 题`);
    count.title = `错题 ${row.mistakes} 题 · 未掌握 ${row.weak} 题 · 累计答错 ${row.wrongCount} 次`;
    item.append(name, bar, count);
    list.append(item);
  }
  list.dataset.total = String(rows.length);
  body.append(list);

  const totalItems = rows.reduce((sum, row) => sum + row.total, 0);
  const hiddenSubjects = rows.length - visible.length;
  const hint = element('p', 'dashboard-hint',
    `共 ${rows.length} 科 · ${totalItems} 题待巩固${hiddenSubjects > 0 ? `（图中显示前 ${visible.length} 科）` : ''}`);
  body.append(hint);
}

/* ── 区块容器 ─────────────────────────────────────────────────────────── */

const BLOCK_META = Object.freeze({
  streak: { label: '连续打卡', note: '每天完成任一科目的一轮测试即算打卡' },
  trend: { label: '正确率趋势', note: '最近 12 次交卷成绩' },
  weak: { label: '各科弱项', note: '错题与未掌握条目的科目分布' }
});

function buildBlock(id, meta) {
  const section = element('section', 'dashboard-block');
  section.id = id;
  const heading = element('div', 'dashboard-block-heading');
  heading.append(
    element('p', 'dashboard-block-label', meta.label),
    element('span', 'dashboard-block-note', meta.note)
  );
  const body = element('div', 'dashboard-body');
  section.append(heading, body);
  return section;
}

/* ── 入口 ─────────────────────────────────────────────────────────────── */

/**
 * 渲染看板三个区块（#dashboard-streak / #dashboard-trend / #dashboard-weak）。
 *
 * @param {Element|string} container 容器元素或选择器；容器内若已有同名 id 的区块会被复用。
 * @param {{ stylesheetHref?: string, accent?: string }} [options]
 * @returns {Promise<{root: Element, refresh: () => Promise<object>, destroy: () => void, data: object}|null>}
 *          容器找不到时 resolve(null)。任何读取/渲染失败都退化成空状态，绝不 reject。
 */
export async function mountDashboard(container, options = {}) {
  const target = resolveContainer(container);
  if (!target) return null;

  ensureStylesheet(options.stylesheetHref ?? STYLESHEET_HREF);

  const root = element('div', 'dashboard');
  target.replaceChildren(root);

  const blocks = {};
  for (const [key, id] of Object.entries(BLOCK_IDS)) {
    const reused = target.querySelector(`#${id}`);
    if (reused) {
      // 复用页面里已手写的同名区块：只接管其内容，避免出现重复 id。
      reused.classList.add('dashboard-block');
      root.append(reused);
    } else {
      root.append(buildBlock(id, BLOCK_META[key]));
    }
    blocks[key] = root.querySelector(`#${id}`);
  }

  // 科目名与配色来自注册表；注册表不可用时退化成 subjectId 文本。
  let registry = null;
  try {
    registry = await import(/* @vite-ignore */ './registry.js');
  } catch {
    registry = null;
  }
  const labels = subjectLabelMap(registry);
  const DEFAULT_ACCENT = '#126b52';

  let current = { source: 'none', records: [], mistakes: [], profile: null, mastery: {} };

  async function refresh() {
    let data;
    try {
      data = await loadDashboardData();
    } catch {
      data = { source: 'none', records: [], mistakes: [], profile: null, mastery: {} };
    }
    current = data;
    root.dataset.source = data.source;
    root.dataset.records = String(data.records.length);

    const bodyOf = (key) => blocks[key]?.querySelector('.dashboard-body') ?? null;
    try {
      const streakBody = bodyOf('streak');
      if (streakBody) renderStreak(streakBody, data);
      const trendBody = bodyOf('trend');
      if (trendBody) {
        // 折线颜色取最近一次测试所属科目的主色，取不到就用默认绿。
        const latestRecord = [...data.records].reverse().find((record) => labels.has(record.subjectId));
        renderTrend(trendBody, data, labels.get(latestRecord?.subjectId)?.accent ?? DEFAULT_ACCENT);
      }
      const weakBody = bodyOf('weak');
      if (weakBody) renderWeak(weakBody, data, labels);
    } catch {
      // 渲染异常不应影响首页其他部分。
    }
    return data;
  }

  const onRefresh = () => {
    refresh();
  };
  window.addEventListener('pageshow', onRefresh);
  window.addEventListener('storage', onRefresh);

  await refresh();

  return {
    root,
    blocks,
    get data() {
      return current;
    },
    refresh,
    destroy() {
      window.removeEventListener('pageshow', onRefresh);
      window.removeEventListener('storage', onRefresh);
      if (root.parentNode === target) root.remove();
    }
  };
}

export default { mountDashboard };
