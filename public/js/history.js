const STORAGE_KEY = 'math-memory-quiz-history:v1';
const MISTAKES_STORAGE_KEY = 'math-memory-quiz-mistakes:v1';
const QUIZ_TYPES = new Set(['percent', 'powers']);

function getStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeRecord(record) {
  if (!record || !QUIZ_TYPES.has(record.quizType)) return null;
  const normalized = {
    id: String(record.id ?? ''),
    quizType: record.quizType,
    completedAt: Number(record.completedAt),
    accuracy: Number(record.accuracy),
    correct: Number(record.correct),
    total: Number(record.total),
    durationMs: Number(record.durationMs)
  };
  const numericValues = [
    normalized.completedAt,
    normalized.accuracy,
    normalized.correct,
    normalized.total,
    normalized.durationMs
  ];
  if (!normalized.id || numericValues.some((value) => !Number.isFinite(value))) return null;
  if (normalized.total <= 0 || normalized.correct < 0 || normalized.correct > normalized.total) return null;
  if (normalized.accuracy < 0 || normalized.accuracy > 100 || normalized.durationMs < 0) return null;
  return normalized;
}

function normalizeMistake(mistake) {
  if (!mistake || !QUIZ_TYPES.has(mistake.quizType)) return null;
  const normalized = {
    id: String(mistake.id ?? ''),
    quizType: mistake.quizType,
    question: String(mistake.question ?? ''),
    answer: String(mistake.answer ?? ''),
    wrongCount: Number(mistake.wrongCount),
    lastWrongAt: Number(mistake.lastWrongAt)
  };
  if (!normalized.id || !normalized.question || !normalized.answer) return null;
  if (!Number.isInteger(normalized.wrongCount) || normalized.wrongCount < 1) return null;
  if (!Number.isFinite(normalized.lastWrongAt)) return null;
  return normalized;
}

export function readHistory(storage) {
  const target = getStorage(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecord).filter(Boolean).sort((left, right) => left.completedAt - right.completedAt);
  } catch {
    return [];
  }
}

export function historyForType(quizType, storage) {
  return readHistory(storage).filter((record) => record.quizType === quizType);
}

export function readMistakes(storage) {
  const target = getStorage(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(MISTAKES_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeMistake).filter(Boolean).sort((left, right) => left.lastWrongAt - right.lastWrongAt);
  } catch {
    return [];
  }
}

export function mistakesForType(quizType, storage) {
  return readMistakes(storage).filter((mistake) => mistake.quizType === quizType);
}

export function saveMistakes(quizType, mistakes, storage) {
  if (!QUIZ_TYPES.has(quizType)) throw new Error(`Unsupported quiz type: ${quizType}`);
  const target = getStorage(storage);
  const existing = readMistakes(target);
  const byId = new Map(existing.map((mistake) => [mistake.id, mistake]));
  const now = Date.now();

  for (const mistake of mistakes) {
    const current = normalizeMistake({ ...mistake, quizType, wrongCount: 1, lastWrongAt: now });
    if (!current) continue;
    const previous = byId.get(current.id);
    byId.set(current.id, previous
      ? { ...current, wrongCount: previous.wrongCount + 1, lastWrongAt: now }
      : current);
  }

  const saved = [...byId.values()].sort((left, right) => left.lastWrongAt - right.lastWrongAt);
  if (target) {
    try {
      target.setItem(MISTAKES_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // The test result remains available when local storage is unavailable or full.
    }
  }
  return saved;
}

export function removeMistake(id, storage) {
  const target = getStorage(storage);
  const next = readMistakes(target).filter((mistake) => mistake.id !== id);
  if (target) {
    try {
      target.setItem(MISTAKES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The UI can still render the current in-memory state after a storage failure.
    }
  }
  return next;
}

export function saveTestResult(quizType, metrics, storage) {
  if (!QUIZ_TYPES.has(quizType)) throw new Error(`Unsupported quiz type: ${quizType}`);
  const target = getStorage(storage);
  const history = readHistory(target);
  const previous = [...history].reverse().find((record) => record.quizType === quizType) ?? null;
  const completedAt = Number(metrics.completedAt ?? Date.now());
  const record = normalizeRecord({
    id: metrics.id ?? `${completedAt}-${Math.random().toString(36).slice(2, 10)}`,
    quizType,
    completedAt,
    accuracy: metrics.accuracy,
    correct: metrics.correct,
    total: metrics.total,
    durationMs: metrics.durationMs
  });
  if (!record) throw new Error('Invalid test result');

  if (target) {
    try {
      target.setItem(STORAGE_KEY, JSON.stringify([...history, record]));
    } catch {
      // The result page still works when storage is unavailable or full.
    }
  }
  return { record, previous };
}

export function compareRecords(current, previous) {
  if (!previous) return null;
  return {
    accuracyDelta: current.accuracy - previous.accuracy,
    durationDeltaMs: current.durationMs - previous.durationMs
  };
}

export function formatHistoryDate(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
}
