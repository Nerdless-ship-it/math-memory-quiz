import { compareRecords, formatHistoryDate, historyForType } from './history.js';
import { formatDuration } from './quiz.js';

const elements = {
  tabs: [...document.querySelectorAll('[data-history-type]')],
  count: document.querySelector('#history-count'),
  best: document.querySelector('#history-best'),
  fastest: document.querySelector('#history-fastest'),
  list: document.querySelector('#history-list'),
  empty: document.querySelector('#history-empty')
};

let activeType = 'percent';

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

for (const tab of elements.tabs) {
  tab.addEventListener('click', () => {
    activeType = tab.dataset.historyType;
    for (const item of elements.tabs) {
      item.setAttribute('aria-selected', String(item === tab));
    }
    renderHistory();
  });
}

window.addEventListener('pageshow', renderHistory);
window.addEventListener('storage', renderHistory);
renderHistory();
document.body.dataset.historyReady = 'true';
