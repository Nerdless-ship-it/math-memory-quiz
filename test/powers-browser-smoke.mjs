import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POWER_PAIRS } from '../public/js/powers-data.js';
import { powerExpression } from '../public/js/powers-quiz.js';

const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const appUrl = process.env.POWERS_APP_URL ?? 'http://127.0.0.1:4173/';
const outputDir = process.env.QA_OUTPUT_DIR ?? join(process.cwd(), 'qa-output');
const debuggingPort = 9334;
const userDataDir = await mkdtemp(join(tmpdir(), 'powers-quiz-edge-'));
const browser = spawn(edgePath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDir}`, 'about:blank'
], { stdio: 'ignore' });

let socket;
let requestId = 0;
const pending = new Map();
const consoleErrors = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Edge debugging endpoint did not start');
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text ?? 'Browser evaluation failed');
  return response.result.result.value;
}

async function waitFor(expression, message) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}

async function screenshot(name) {
  const response = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  await writeFile(join(outputDir, name), Buffer.from(response.result.data, 'base64'));
}

try {
  await mkdir(outputDir, { recursive: true });
  socket = new WebSocket(await waitForTarget());
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message);
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text ?? 'Uncaught exception');
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(message.params.entry.text);
  });

  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')]);
  await setViewport(1440, 900);
  await send('Page.navigate', { url: appUrl });
  await waitFor("document.readyState === 'complete' && !!document.querySelector('#powers-choice')", 'Selection screen did not load');
  assert(await evaluate("document.title === '速算训练'"), 'Unexpected selection page title');
  await evaluate(`(() => {
    localStorage.setItem('math-memory-quiz-history:v1', JSON.stringify([{
      id: 'previous-powers', quizType: 'powers', completedAt: Date.now() - 86400000,
      accuracy: 83, correct: 20, total: 24, durationMs: 110000
    }]));
    location.reload();
  })()`);
  await waitFor("document.body?.dataset.historyReady === 'true'", 'History module did not initialize');
  await evaluate("document.querySelector('#history-powers-tab').click()");
  await waitFor("document.querySelector('#history-count').textContent === '1'", 'Saved powers history did not render');
  await evaluate("document.querySelector('#powers-choice').click()");
  await waitFor("document.title === '平方幂次速记' && !!document.querySelector('#start-button')", 'Powers test did not open from selection page');
  assert(await evaluate("!!document.querySelector('.home-link')"), 'Powers test is missing the return link');
  assert(await evaluate("document.querySelector('.home-link').getAttribute('href') === './index.html'"), 'Powers return link must target index.html');
  await evaluate("document.querySelector('.home-link').click()");
  await waitFor("document.title === '速算训练' && !!document.querySelector('#powers-choice')", 'Return link did not open the selection page');
  await evaluate("document.querySelector('#powers-choice').click()");
  await waitFor("document.title === '平方幂次速记' && !!document.querySelector('#start-button')", 'Powers test did not reopen');
  assert(await evaluate("document.title === '平方幂次速记'"), 'Unexpected title');
  await screenshot('powers-quiz-welcome-desktop.png');

  await evaluate("document.querySelector('#start-button').click()");
  await waitFor("!document.querySelector('#quiz-screen').hidden", 'Quiz screen did not open');
  assert(await evaluate("document.querySelector('#input-hint').textContent === '只需填写数字'"), 'Power quiz should not reveal approximate answers');
  await setViewport(390, 844, true);
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile question overflows horizontally');
  await screenshot('powers-quiz-question-mobile.png');

  const byExpression = new Map(POWER_PAIRS.map((pair) => [powerExpression(pair), pair.result]));
  const byResultAndTopic = new Map(POWER_PAIRS.map((pair) => [`${pair.result}|${pair.topic}`, pair.base]));
  for (let index = 0; index < POWER_PAIRS.length; index += 1) {
    const state = JSON.parse(await evaluate(`JSON.stringify({
      direction: document.querySelector('#direction-label').textContent,
      topic: document.querySelector('#topic-label').textContent,
      prompt: document.querySelector('#prompt-value').textContent
    })`));
    const expected = state.direction === '由常数求幂值'
      ? byExpression.get(state.prompt)
      : byResultAndTopic.get(`${state.prompt}|${state.topic}`);
    assert(expected, `Could not resolve ${state.topic}: ${state.prompt}`);
    const answer = index === 0 ? '0' : expected;
    await evaluate(`(() => {
      const input = document.querySelector('#answer-input');
      input.value = ${JSON.stringify(answer)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#next-button').click();
    })()`);
  }

  await waitFor("!document.querySelector('#result-screen').hidden", 'Result screen did not open');
  await setViewport(1440, 1000);
  const result = JSON.parse(await evaluate(`JSON.stringify({
    accuracy: document.querySelector('#accuracy-value').textContent,
    correct: document.querySelector('#correct-value').textContent,
    corrections: document.querySelectorAll('.correction-row').length,
    heading: document.querySelector('#correction-title').textContent,
    comparison: document.querySelector('#comparison-label').textContent,
    savedRecords: JSON.parse(localStorage.getItem('math-memory-quiz-history:v1')).filter(record => record.quizType === 'powers').length
  })`));
  assert(result.accuracy === '96%', `Expected 96%, received ${result.accuracy}`);
  assert(result.correct === '23 / 24', `Expected 23 / 24, received ${result.correct}`);
  assert(result.corrections === 1, `Expected one correction, received ${result.corrections}`);
  assert(result.heading.includes('1 题'), `Unexpected heading: ${result.heading}`);
  assert(result.comparison === '对比上一次', `Unexpected comparison label: ${result.comparison}`);
  assert(result.savedRecords === 2, `Expected two saved powers records, received ${result.savedRecords}`);
  assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join('; ')}`);
  await screenshot('powers-quiz-result-desktop.png');
  await setViewport(390, 844, true);
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile result overflows horizontally');
  await screenshot('powers-quiz-result-mobile.png');
  console.log(JSON.stringify({ ok: true, result, screenshots: outputDir }, null, 2));
} finally {
  socket?.close();
  if (browser.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(userDataDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
