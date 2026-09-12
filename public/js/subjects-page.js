// 首页科目卡片渲染器（注册表驱动）。
//
// 契约（docs/ARCHITECTURE.md 第 3.1 / 6 节）：科目卡片必须由 registry.SUBJECTS 派生，
// 按 CATEGORIES 分组；本文件之外不得再硬编码任何科目 id 列表。
//
// 用法（Lead 在 index.html / home.js 里接线）：
//   import { mountSubjects } from './js/subjects-page.js';
//   await mountSubjects(document.querySelector('#subjects'));
//
// 设计约束：
//   - 以 Promise 返回句柄，**永不 reject**；容器不存在时 resolve(null)。
//   - 数据缺失（registry 加载失败 / SUBJECTS 为空）时渲染空状态而不是抛错。
//   - 样式在 quiz.css 里；若页面没有链接 quiz.css，本模块会幂等补一个 <link>。

const STYLESHEET_HREF = './quiz.css';

/** 幂等确保 quiz.css 已加载（Lead 也可以在 index.html 里自己加 <link>，二者不冲突）。 */
function ensureStylesheet(href = STYLESHEET_HREF) {
  if (typeof document === 'undefined') return null;
  const existing = document.querySelector(`link[rel="stylesheet"][href$="${href.replace('./', '')}"]`);
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.subjectStyles = 'true';
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

const TYPE_LABELS = Object.freeze({ fill: '填空', choice: '选择题' });

function typeText(questionTypes) {
  if (!Array.isArray(questionTypes)) return '';
  return questionTypes.map((type) => TYPE_LABELS[type]).filter(Boolean).join(' · ');
}

/**
 * 按 CATEGORIES 分组；注册表里出现未登记的 category 时兜底成一组，绝不丢科目。
 */
function groupSubjects(subjects, categories) {
  const groups = [];
  const known = new Set();
  for (const category of categories) {
    if (!category || typeof category.id !== 'string') continue;
    known.add(category.id);
    const list = subjects.filter((subject) => subject.category === category.id);
    if (list.length) {
      groups.push({ id: category.id, title: category.title ?? category.id, subtitle: category.subtitle ?? '', subjects: list });
    }
  }
  const unknown = new Map();
  for (const subject of subjects) {
    if (known.has(subject.category)) continue;
    const key = subject.category ?? 'other';
    if (!unknown.has(key)) unknown.set(key, []);
    unknown.get(key).push(subject);
  }
  for (const [id, list] of unknown) {
    groups.push({ id, title: id, subtitle: '', subjects: list });
  }
  return groups;
}

function createCard(subject, groupTitle) {
  const card = document.createElement('a');
  // legacyClass / legacyId 由注册表登记（见 registry.js 的注释）：冻结的 e2e 测试
  // 断言首页恰好有两个 .test-choice 并点击 #percent-choice。这里只是把数据落到
  // DOM 上，不在这里判断科目 id。
  card.className = subject.legacyClass ? `subject-card ${subject.legacyClass}` : 'subject-card';
  if (subject.legacyId) card.id = subject.legacyId;
  card.setAttribute('href', subject.page);
  card.dataset.subjectId = subject.id;
  if (subject.category) card.dataset.subjectCategory = subject.category;
  if (subject.accent) card.style.setProperty('--subject-accent', subject.accent);
  if (subject.updatedAt) card.dataset.updatedAt = subject.updatedAt;
  card.setAttribute('aria-label', `${subject.title}${subject.subtitle ? `，${subject.subtitle}` : ''}`);

  const top = element('div', 'subject-card-top');
  const icon = element('span', 'subject-card-icon', subject.icon ?? '·');
  icon.setAttribute('aria-hidden', 'true');
  top.append(icon, element('span', 'subject-card-category', groupTitle || ''));
  card.append(top);

  const body = element('div', 'subject-card-body');
  body.append(
    element('span', 'subject-card-title', subject.title ?? ''),
    element('span', 'subject-card-subtitle', subject.subtitle ?? '')
  );
  card.append(body);

  const tags = Array.isArray(subject.tags) ? subject.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
  if (tags.length) {
    const tagRow = element('div', 'subject-card-tags');
    for (const tag of tags.slice(0, 3)) tagRow.append(element('span', 'subject-tag', tag));
    card.append(tagRow);
  }

  const foot = element('div', 'subject-card-foot');
  // 时效性科目必须显式标注内容年龄，用户不该靠猜。
  if (subject.updatedAt) {
    foot.append(element('span', 'subject-updated', `更新于 ${subject.updatedAt}`));
  } else {
    const types = typeText(subject.questionTypes);
    foot.append(element('span', 'subject-card-types', types));
  }
  const action = element('span', 'subject-card-action', '开始');
  action.append(element('span', 'subject-card-arrow', '→'));
  foot.append(action);
  card.append(foot);

  return card;
}

function renderEmptyState(root, message) {
  const panel = element('div', 'subject-empty');
  panel.append(
    element('strong', null, '科目列表暂时为空'),
    element('span', null, message ?? '注册表里还没有登记任何科目，稍后重试。')
  );
  root.append(panel);
}

/**
 * 渲染科目卡片（按 CATEGORIES 分组）。
 *
 * @param {Element|string} container 容器元素，或它的 CSS 选择器（例如 '#subjects'）
 * @param {{ emptyMessage?: string, stylesheetHref?: string }} [options]
 * @returns {Promise<{root: Element, groups: object[], cards: Element[], subjects: object[], destroy: () => void}|null>}
 *          容器找不到时 resolve(null)；任何内部错误都降级为空状态，绝不 reject。
 */
export async function mountSubjects(container, options = {}) {
  const target = resolveContainer(container);
  if (!target) return null;

  ensureStylesheet(options.stylesheetHref ?? STYLESHEET_HREF);

  const root = element('div', 'subjects');
  target.replaceChildren(root);

  const destroy = () => {
    if (root.parentNode === target) root.remove();
  };

  let registry = null;
  try {
    registry = await import(/* @vite-ignore */ './registry.js');
  } catch {
    registry = null;
  }

  const subjects = Array.isArray(registry?.SUBJECTS) ? registry.SUBJECTS : [];
  const categories = Array.isArray(registry?.CATEGORIES) ? registry.CATEGORIES : [];
  if (!subjects.length) {
    renderEmptyState(root, options.emptyMessage);
    return { root, groups: [], cards: [], subjects: [], destroy };
  }

  const groups = groupSubjects(subjects, categories);
  const cards = [];

  for (const group of groups) {
    const section = element('section', 'subject-group');
    section.dataset.category = group.id;
    section.setAttribute('aria-label', group.title);

    const heading = element('div', 'subject-group-heading');
    heading.append(
      element('h2', 'subject-group-title', group.title),
      element('p', 'subject-group-subtitle', group.subtitle)
    );
    section.append(heading);

    const grid = element('div', 'subject-grid');
    for (const subject of group.subjects) {
      const card = createCard(subject, group.title);
      cards.push(card);
      grid.append(card);
    }
    section.append(grid);
    root.append(section);
  }

  return { root, groups, cards, subjects, destroy };
}

export default { mountSubjects };
