import test from 'node:test';
import assert from 'node:assert/strict';
import { POWER_PAIRS } from '../public/js/powers-data.js';
import {
  correctionEquation,
  createPowerQuiz,
  isPowerCorrect,
  normalizeNumber,
  powerExpression
} from '../public/js/powers-quiz.js';

test('幂次题库包含图片中的 24 对且标识不重复', () => {
  assert.equal(POWER_PAIRS.length, 24);
  assert.equal(new Set(POWER_PAIRS.map(({ id }) => id)).size, 24);
  assert.equal(POWER_PAIRS.filter(({ exponent }) => exponent === 2).length, 18);
  assert.equal(POWER_PAIRS.filter(({ exponent }) => exponent === 3).length, 3);
  assert.equal(POWER_PAIRS.filter(({ exponent }) => exponent === 4).length, 3);
});

test('每轮完整覆盖 24 对并均衡两种方向', () => {
  const quiz = createPowerQuiz(POWER_PAIRS, () => 0.42);
  assert.equal(new Set(quiz.map(({ id }) => id)).size, 24);
  assert.equal(quiz.filter(({ direction }) => direction === 'base-to-result').length, 12);
  assert.equal(quiz.filter(({ direction }) => direction === 'result-to-base').length, 12);
});

test('平方、立方和四次幂数据与图片一致', () => {
  assert.equal(powerExpression(POWER_PAIRS.find(({ id }) => id === 'square-29')), '29²');
  assert.equal(correctionEquation(POWER_PAIRS.find(({ id }) => id === 'square-29')), '29² = 841');
  assert.equal(correctionEquation(POWER_PAIRS.find(({ id }) => id === 'cube-1.3')), '1.3³ ≈ 2.2');
  assert.equal(correctionEquation(POWER_PAIRS.find(({ id }) => id === 'fourth-1.4')), '1.4⁴ ≈ 3.8');
});

test('小数幂接受图片近似值和精确值', () => {
  const cube = { ...POWER_PAIRS.find(({ id }) => id === 'cube-1.2'), direction: 'base-to-result' };
  assert.equal(isPowerCorrect({ ...cube, answer: '1.7' }), true);
  assert.equal(isPowerCorrect({ ...cube, answer: '1.728' }), true);
  assert.equal(isPowerCorrect({ ...cube, answer: '1.8' }), false);
});

test('反向题只接受对应常数并兼容全角小数点', () => {
  const fourth = { ...POWER_PAIRS.find(({ id }) => id === 'fourth-1.3'), direction: 'result-to-base' };
  assert.equal(isPowerCorrect({ ...fourth, answer: '1．3' }), true);
  assert.equal(isPowerCorrect({ ...fourth, answer: '2.9' }), false);
  assert.equal(normalizeNumber(' 约 2。9 '), '2.9');
});
