export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createQuiz(pairs, random = Math.random) {
  const midpoint = Math.floor(pairs.length / 2);
  const directions = shuffle([
    ...Array(midpoint).fill('percent-to-fraction'),
    ...Array(pairs.length - midpoint).fill('fraction-to-percent')
  ], random);

  return shuffle(pairs, random).map((pair, index) => ({
    ...pair,
    direction: directions[index],
    answer: ''
  }));
}

export function normalizeFraction(value) {
  return value
    .trim()
    .replace(/[／÷]/g, '/')
    .replace(/\s+/g, '')
    .replace(/[。．]/g, '.');
}

export function normalizePercent(value) {
  return value
    .trim()
    .replace(/[％%]/g, '')
    .replace(/\s+/g, '')
    .replace(/[。．]/g, '.');
}

export function denominatorFromFraction(value) {
  const normalized = normalizeFraction(value);
  return normalized.startsWith('1/') ? normalized.slice(2) : normalized;
}

export function fractionFromDenominator(value) {
  const denominator = denominatorFromFraction(value);
  return denominator ? `1/${denominator}` : '';
}

export function isCorrect(question) {
  if (question.direction === 'percent-to-fraction') {
    return normalizeFraction(fractionFromDenominator(question.answer)) === normalizeFraction(question.fraction);
  }

  const answer = Number(normalizePercent(question.answer));
  const expected = Number(question.percent);
  return Number.isFinite(answer) && Math.abs(answer - expected) < 0.000001;
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
