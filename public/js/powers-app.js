import { POWER_PAIRS } from './powers-data.js';
import { compareRecords, saveMistakes, saveTestResult } from './history.js';
import { formatDuration } from './quiz.js';
import {
  correctionEquation,
  createPowerQuiz,
  exponentSymbol,
  isPowerCorrect,
  powerExpression
} from './powers-quiz.js';

const elements = {
  welcome: document.querySelector('#welcome-screen'),
  quiz: document.querySelector('#quiz-screen'),
  result: document.querySelector('#result-screen'),
  testMeta: document.querySelector('#test-meta'),
  startButton: document.querySelector('#start-button'),
  restartButton: document.querySelector('#restart-button'),
  previousButton: document.querySelector('#previous-button'),
  nextButton: document.querySelector('#next-button'),
  nextButtonText: document.querySelector('#next-button-text'),
  answerInput: document.querySelector('#answer-input'),
  answerSuffix: document.querySelector('#answer-suffix'),
  answerLabel: document.querySelector('#answer-label'),
  inputHint: document.querySelector('#input-hint'),
  promptValue: document.querySelector('#prompt-value'),
  equationOperator: document.querySelector('#equation-operator'),
  questionNumber: document.querySelector('#question-number'),
  topicLabel: document.querySelector('#topic-label'),
  directionLabel: document.querySelector('#direction-label'),
  questionInstruction: document.querySelector('#question-instruction'),
  progressFill: document.querySelector('#progress-fill'),
  headerProgress: document.querySelector('#header-progress'),
  headerTime: document.querySelector('#header-time'),
  scoreValue: document.querySelector('#score-value'),
  accuracyValue: document.querySelector('#accuracy-value'),
  correctValue: document.querySelector('#correct-value'),
  durationValue: document.querySelector('#duration-value'),
  comparisonLabel: document.querySelector('#comparison-label'),
  accuracyComparison: document.querySelector('#accuracy-comparison'),
  timeComparison: document.querySelector('#time-comparison'),
  correctionTitle: document.querySelector('#correction-title'),
  correctionList: document.querySelector('#correction-list')
};

let questions = [];
let currentIndex = 0;
let startedAt = 0;
let elapsed = 0;
let timerId = 0;

function switchScreen(active) {
  for (const screen of [elements.welcome, elements.quiz, elements.result]) {
    screen.hidden = screen !== active;
  }
  elements.testMeta.hidden = active !== elements.quiz;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function updateTimer() {
  elements.headerTime.textContent = formatDuration(Date.now() - startedAt);
}

function startQuiz() {
  questions = createPowerQuiz(POWER_PAIRS);
  currentIndex = 0;
  startedAt = Date.now();
  elapsed = 0;
  window.clearInterval(timerId);
  timerId = window.setInterval(updateTimer, 250);
  elements.headerTime.textContent = '00:00';
  switchScreen(elements.quiz);
  renderQuestion();
}

function instructionFor(question) {
  if (question.direction === 'base-to-result') {
    if (question.exponent === 2) return '写出这个常数的平方数';
    if (question.exponent === 3) return '写出这个常数的立方近似值';
    return '写出这个常数的四次幂近似值';
  }
  if (question.exponent === 2) return '这个平方数对应哪个常数？';
  if (question.exponent === 3) return '这个立方近似值对应哪个常数？';
  return '这个四次幂近似值对应哪个常数？';
}

function renderQuestion() {
  const question = questions[currentIndex];
  const baseToResult = question.direction === 'base-to-result';
  const position = currentIndex + 1;

  elements.questionNumber.textContent = String(position).padStart(2, '0');
  elements.headerProgress.textContent = `${position} / ${questions.length}`;
  elements.progressFill.style.width = `${(position / questions.length) * 100}%`;
  elements.topicLabel.textContent = question.topic;
  elements.directionLabel.textContent = baseToResult ? '由常数求幂值' : '由幂值找常数';
  elements.questionInstruction.textContent = instructionFor(question);
  elements.promptValue.textContent = baseToResult ? powerExpression(question) : question.result;
  elements.equationOperator.textContent = question.approximate ? '≈' : '=';
  elements.answerSuffix.textContent = baseToResult ? '' : exponentSymbol(question.exponent);
  elements.answerInput.value = question.answer;
  elements.answerInput.placeholder = baseToResult ? question.result.replace(/\d/g, '·') : '0';
  elements.answerLabel.textContent = baseToResult ? `请输入${question.topic}结果` : '请输入对应常数';
  elements.inputHint.textContent = '只需填写数字';
  elements.previousButton.disabled = currentIndex === 0;
  elements.nextButton.disabled = question.answer.trim() === '';
  elements.nextButtonText.textContent = position === questions.length ? '交卷' : '下一题';
  window.requestAnimationFrame(() => elements.answerInput.focus());
}

function saveCurrentAnswer() {
  questions[currentIndex].answer = elements.answerInput.value.trim();
  elements.nextButton.disabled = questions[currentIndex].answer === '';
}

function goNext() {
  saveCurrentAnswer();
  if (!questions[currentIndex].answer) return;
  if (currentIndex === questions.length - 1) {
    finishQuiz();
    return;
  }
  currentIndex += 1;
  renderQuestion();
}

function goPrevious() {
  saveCurrentAnswer();
  if (currentIndex === 0) return;
  currentIndex -= 1;
  renderQuestion();
}

function finishQuiz() {
  elapsed = Date.now() - startedAt;
  window.clearInterval(timerId);
  const results = questions.map((question) => ({ ...question, correct: isPowerCorrect(question) }));
  const correctCount = results.filter((result) => result.correct).length;
  const mistakes = results.filter((result) => !result.correct);
  const accuracy = Math.round((correctCount / results.length) * 100);

  elements.scoreValue.textContent = String(accuracy);
  elements.accuracyValue.textContent = `${accuracy}%`;
  elements.correctValue.textContent = `${correctCount} / ${results.length}`;
  elements.durationValue.textContent = formatDuration(elapsed);
  const saved = saveTestResult('powers', {
    accuracy,
    correct: correctCount,
    total: results.length,
    durationMs: elapsed
  });
  saveMistakes('powers', mistakes.map((question) => {
    const baseToResult = question.direction === 'base-to-result';
    const operator = question.approximate ? '≈' : '=';
    return {
      id: `powers:${question.direction}:${question.id}`,
      question: baseToResult
        ? `${powerExpression(question)} ${operator} ?`
        : `${question.result} ${operator} ?${exponentSymbol(question.exponent)}`,
      answer: baseToResult ? question.result : question.base
    };
  }));
  renderComparison(saved.record, saved.previous);
  renderCorrections(mistakes);
  switchScreen(elements.result);
}

function renderComparison(record, previous) {
  const comparison = compareRecords(record, previous);
  elements.accuracyComparison.className = '';
  elements.timeComparison.className = '';
  if (!comparison) {
    elements.comparisonLabel.textContent = '首次记录';
    elements.accuracyComparison.textContent = '本次成绩已保存';
    elements.timeComparison.textContent = '下次完成后即可对比';
    return;
  }

  elements.comparisonLabel.textContent = '对比上一次';
  if (comparison.accuracyDelta === 0) {
    elements.accuracyComparison.textContent = '正确率持平';
  } else {
    const sign = comparison.accuracyDelta > 0 ? '+' : '';
    elements.accuracyComparison.textContent = `正确率 ${sign}${comparison.accuracyDelta}%`;
    elements.accuracyComparison.className = comparison.accuracyDelta > 0 ? 'positive' : 'negative';
  }

  if (Math.abs(comparison.durationDeltaMs) < 1000) {
    elements.timeComparison.textContent = '用时持平';
  } else {
    const faster = comparison.durationDeltaMs < 0;
    elements.timeComparison.textContent = `用时${faster ? '快' : '慢'} ${formatDuration(Math.abs(comparison.durationDeltaMs))}`;
    elements.timeComparison.className = faster ? 'positive' : 'negative';
  }
}

function appendTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderCorrections(mistakes) {
  elements.correctionList.replaceChildren();
  if (mistakes.length === 0) {
    elements.correctionTitle.textContent = '全部答对';
    const empty = document.createElement('div');
    empty.className = 'perfect-result';
    appendTextElement(empty, 'strong', '', '24 组平方与幂次全部正确');
    appendTextElement(empty, 'span', '', '保持这个速度，再测一次巩固记忆。');
    elements.correctionList.append(empty);
    return;
  }

  elements.correctionTitle.textContent = `错题回顾 · ${mistakes.length} 题`;
  mistakes.forEach((question, index) => {
    const row = document.createElement('article');
    row.className = 'correction-row';
    appendTextElement(row, 'span', 'correction-index', String(index + 1).padStart(2, '0'));

    const equation = document.createElement('div');
    equation.className = 'correction-equation';
    appendTextElement(equation, 'strong', '', correctionEquation(question));
    appendTextElement(equation, 'span', '', `${question.topic} · ${question.direction === 'base-to-result' ? '由常数求幂值' : '由幂值找常数'}`);

    const wrongAnswer = document.createElement('div');
    wrongAnswer.className = 'wrong-answer';
    appendTextElement(wrongAnswer, 'span', '', '你的答案');
    appendTextElement(wrongAnswer, 'del', '', question.answer);
    row.append(equation, wrongAnswer);
    elements.correctionList.append(row);
  });
}

elements.startButton.addEventListener('click', startQuiz);
elements.restartButton.addEventListener('click', startQuiz);
elements.answerInput.addEventListener('input', saveCurrentAnswer);
elements.nextButton.addEventListener('click', goNext);
elements.previousButton.addEventListener('click', goPrevious);
elements.answerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !elements.nextButton.disabled) goNext();
});
