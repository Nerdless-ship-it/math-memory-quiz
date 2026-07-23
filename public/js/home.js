import { compareRecords, formatHistoryDate, historyForType, mistakesForType, removeMistake } from './history.js';
import { formatDuration } from './quiz.js';

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
  mistakeEmpty: document.querySelector('#mistakes-empty')
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

window.addEventListener('pageshow', () => {
  renderHistory();
  renderMistakes();
});
window.addEventListener('storage', () => {
  renderHistory();
  renderMistakes();
});
renderHistory();
renderMistakes();
document.body.dataset.historyReady = 'true';
