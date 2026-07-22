import { shuffle } from './quiz.js';

const SUPERSCRIPTS = Object.freeze({ 2: '²', 3: '³', 4: '⁴' });

export function exponentSymbol(exponent) {
  return SUPERSCRIPTS[exponent] ?? String(exponent);
}

export function powerExpression(question) {
  return `${question.base}${exponentSymbol(question.exponent)}`;
}

export function createPowerQuiz(pairs, random = Math.random) {
  const midpoint = Math.floor(pairs.length / 2);
  const directions = shuffle([
    ...Array(midpoint).fill('base-to-result'),
    ...Array(pairs.length - midpoint).fill('result-to-base')
  ], random);

  return shuffle(pairs, random).map((pair, index) => ({
    ...pair,
    direction: directions[index],
    answer: ''
  }));
}

export function normalizeNumber(value) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[。．]/g, '.')
    .replace(/^约/, '')
    .replace(/[≈=]/g, '');
}

function sameNumber(left, right) {
  const leftNumber = Number(normalizeNumber(left));
  const rightNumber = Number(normalizeNumber(right));
  return Number.isFinite(leftNumber)
    && Number.isFinite(rightNumber)
    && Math.abs(leftNumber - rightNumber) < 0.0000001;
}

export function isPowerCorrect(question) {
  if (question.direction === 'result-to-base') {
    return sameNumber(question.answer, question.base);
  }
  return question.acceptedResults.some((answer) => sameNumber(question.answer, answer));
}

export function correctionEquation(question) {
  const operator = question.approximate ? '≈' : '=';
  return `${powerExpression(question)} ${operator} ${question.result}`;
}
