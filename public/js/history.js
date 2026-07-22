const STORAGE_KEY = 'math-memory-quiz-history:v1';
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
