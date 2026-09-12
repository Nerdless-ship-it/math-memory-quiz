import { compareRecords, formatHistoryDate, historyForType, mistakesForType, removeMistake } from './history.js';
import { formatDuration } from './quiz.js';
import { mountSubjects } from './subjects-page.js';
import { mountDashboard } from './dashboard.js';

const elements = {
  tabs: [...document.querySelectorAll('[data-history-type]')],
  count: document.querySelector('#history-count'),
  best: document.querySelector('#history-best'),
  fastest: document.querySelector('#history-fastest'),
  list: document.querySelector('#history-list'),
  empty: document.querySelector('#history-empty'),
  mistakeTabs: [...document.querySelectorAll('[data-mistake-type]')],
  mistakeCount: document.querySelector('#mistakes-count'),
  mistakeList: document.querySelector('#mistakes-list'),
  mistakeEmpty: document.querySelector('#mistakes-empty'),
  exportButton: document.querySelector('#export-button'),
  importButton: document.querySelector('#import-button'),
  importInput: document.querySelector('#import-input'),
  note: document.querySelector('#dashboard-note')
};

let activeType = 'percent';
let activeMistakeType = 'percent';

function appendTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function comparisonText(current, previous) {
  const comparison = compareRecords(current, previous);
  if (!comparison) return { text: '首次', state: 'neutral' };
  const accuracy = comparison.accuracyDelta === 0
    ? '正确率持平'
    : `正确率 ${comparison.accuracyDelta > 0 ? '+' : ''}${comparison.accuracyDelta}%`;
  let time = '用时持平';
  if (Math.abs(comparison.durationDeltaMs) >= 1000) {
    time = `${comparison.durationDeltaMs < 0 ? '快' : '慢'} ${formatDuration(Math.abs(comparison.durationDeltaMs))}`;
  }
  const improved = comparison.accuracyDelta > 0
    || (comparison.accuracyDelta === 0 && comparison.durationDeltaMs < -999);
  const declined = comparison.accuracyDelta < 0
    || (comparison.accuracyDelta === 0 && comparison.durationDeltaMs > 999);
  return { text: `${accuracy} · ${time}`, state: improved ? 'positive' : declined ? 'negative' : 'neutral' };
}

function renderHistory() {
  const records = historyForType(activeType);
  elements.count.textContent = String(records.length);
  elements.best.textContent = records.length ? `${Math.max(...records.map(({ accuracy }) => accuracy))}%` : '—';
  elements.fastest.textContent = records.length ? formatDuration(Math.min(...records.map(({ durationMs }) => durationMs))) : '—';
  elements.list.replaceChildren();
  elements.empty.hidden = records.length > 0;

  records.map((record, index) => ({ record, previous: records[index - 1] ?? null })).reverse().forEach(({ record, previous }) => {
    const row = document.createElement('article');
    row.className = 'history-row';
    appendTextElement(row, 'time', 'history-date', formatHistoryDate(record.completedAt));
    appendTextElement(row, 'strong', 'history-score', `${record.accuracy}%`);
    appendTextElement(row, 'span', 'history-correct', `${record.correct} / ${record.total}`);
    appendTextElement(row, 'span', 'history-time', formatDuration(record.durationMs));
    const trend = comparisonText(record, previous);
    appendTextElement(row, 'span', `history-trend ${trend.state}`, trend.text);
    elements.list.append(row);
  });
}

function renderMistakes() {
  const mistakes = mistakesForType(activeMistakeType);
  elements.mistakeCount.textContent = String(mistakes.length);
  elements.mistakeList.replaceChildren();
  elements.mistakeEmpty.hidden = mistakes.length > 0;

  [...mistakes].reverse().forEach((mistake) => {
    const row = document.createElement('article');
    row.className = 'mistake-row';
    const content = document.createElement('div');
    appendTextElement(content, 'strong', 'mistake-question', mistake.question);
    appendTextElement(content, 'span', 'mistake-answer', `答案：${mistake.answer}`);
    appendTextElement(content, 'span', 'mistake-meta', `错 ${mistake.wrongCount} 次 · 最近 ${formatHistoryDate(mistake.lastWrongAt)}`);
    const removeButton = document.createElement('button');
    removeButton.className = 'mistake-remove';
    removeButton.type = 'button';
    removeButton.textContent = '移除';
    removeButton.addEventListener('click', () => {
      removeMistake(mistake.id);
      renderMistakes();
    });
    row.append(content, removeButton);
    elements.mistakeList.append(row);
  });
}

for (const tab of elements.tabs) {
  tab.addEventListener('click', () => {
    activeType = tab.dataset.historyType;
    for (const item of elements.tabs) {
      item.setAttribute('aria-selected', String(item === tab));
    }
    renderHistory();
  });
}

for (const tab of elements.mistakeTabs) {
  tab.addEventListener('click', () => {
    activeMistakeType = tab.dataset.mistakeType;
    for (const item of elements.mistakeTabs) {
      item.setAttribute('aria-selected', String(item === tab));
    }
    renderMistakes();
  });
}

// ── 数据导入 / 导出 ───────────────────────────────────────────────
// 用动态 import，storage.js 缺失时按钮只是不工作，不会让整页抛错。

function announce(message, isError = false) {
  if (!elements.note) return;
  elements.note.textContent = message;
  elements.note.classList.toggle('negative', isError);
  elements.note.hidden = false;
  window.setTimeout(() => { elements.note.hidden = true; }, 6000);
}

async function handleExport() {
  try {
    const storage = await import('./storage.js');
    const payload = storage.exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `速算训练-备份-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    announce(`已导出 ${payload.records?.length ?? 0} 条成绩、${payload.mistakes?.length ?? 0} 条错题。`);
  } catch (error) {
    announce(`导出失败：${error?.message ?? error}`, true);
  }
}

async function handleImportFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const storage = await import('./storage.js');
    const result = storage.importData(payload, undefined, { mode: 'merge' });
    if (!result?.ok) throw new Error('数据格式不被识别');
    announce(`导入完成：成绩 ${result.records} 条、错题 ${result.mistakes} 条。`);
    renderHistory();
    renderMistakes();
    dashboardHandle?.refresh?.();
  } catch (error) {
    announce(`导入失败：${error?.message ?? error}`, true);
  }
}

elements.exportButton?.addEventListener('click', handleExport);
elements.importButton?.addEventListener('click', () => elements.importInput?.click());
elements.importInput?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  handleImportFile(file);
});

// ── 科目卡片与看板 ─────────────────────────────────────────────────
// 两者都是 async 且永不 reject；容器各自独立（内部会 replaceChildren）。
let dashboardHandle = null;
mountSubjects(document.querySelector('#subjects'));
mountDashboard(document.querySelector('#dashboard')).then((handle) => {
  dashboardHandle = handle;
});

window.addEventListener('pageshow', () => {
  renderHistory();
  renderMistakes();
  dashboardHandle?.refresh?.();
});
window.addEventListener('storage', () => {
  renderHistory();
  renderMistakes();
  dashboardHandle?.refresh?.();
});
renderHistory();
renderMistakes();
document.body.dataset.historyReady = 'true';
