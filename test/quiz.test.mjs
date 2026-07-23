import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS } from '../public/js/data.js';
import { createQuiz, denominatorFromFraction, formatDuration, fractionFromDenominator, isCorrect, normalizeFraction, normalizePercent } from '../public/js/quiz.js';

test('题库包含图片中的 30 对且没有重复', () => {
  assert.equal(PAIRS.length, 30);
  assert.equal(new Set(PAIRS.map(({ percent }) => percent)).size, 30);
  assert.equal(new Set(PAIRS.map(({ fraction }) => fraction)).size, 30);
});

test('每轮测试完整覆盖 30 对，并平衡两种方向', () => {
  const quiz = createQuiz(PAIRS, () => 0.42);
  assert.equal(quiz.length, 30);
  assert.equal(new Set(quiz.map(({ percent }) => percent)).size, 30);
  assert.equal(quiz.filter(({ direction }) => direction === 'percent-to-fraction').length, 15);
  assert.equal(quiz.filter(({ direction }) => direction === 'fraction-to-percent').length, 15);
});

test('答案兼容全角符号、除号、空格和百分号', () => {
  assert.equal(normalizeFraction(' 1 ／ 6.25 '), '1/6.25');
  assert.equal(normalizeFraction('1÷6。25'), '1/6.25');
  assert.equal(normalizePercent(' 16．7％ '), '16.7');
  assert.equal(isCorrect({ direction: 'percent-to-fraction', answer: '1 ÷ 19', fraction: '1/19' }), true);
  assert.equal(isCorrect({ direction: 'fraction-to-percent', answer: '5.3%', percent: '5.3' }), true);
});

test('分数题只填写分母时会按分子 1 判题', () => {
  assert.equal(denominatorFromFraction('1／6。25'), '6.25');
  assert.equal(fractionFromDenominator(' 8 '), '1/8');
  assert.equal(fractionFromDenominator('1/19'), '1/19');
  assert.equal(isCorrect({ direction: 'percent-to-fraction', answer: '19', fraction: '1/19' }), true);
});

test('错误答案不会误判为正确', () => {
  assert.equal(isCorrect({ direction: 'percent-to-fraction', answer: '1/18', fraction: '1/19' }), false);
  assert.equal(isCorrect({ direction: 'fraction-to-percent', answer: '5.4', percent: '5.3' }), false);
});

test('用时格式固定为分:秒', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(65_999), '01:05');
});
