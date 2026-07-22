import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PAIRS } from '../public/js/data.js';

const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const outputDir = process.env.QA_OUTPUT_DIR ?? join(process.cwd(), 'qa-output');
const debuggingPort = 9333;
const userDataDir = await mkdtemp(join(tmpdir(), 'percent-quiz-edge-'));
const browser = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank'
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
    } catch {
      // Edge needs a moment to expose its debugging endpoint.
    }
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
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text ?? 'Browser evaluation failed');
  }
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
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile
  });
}

async function screenshot(name) {
  const response = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  });
  await writeFile(join(outputDir, name), Buffer.from(response.result.data, 'base64'));
}

try {
  await mkdir(outputDir, { recursive: true });
  const webSocketUrl = await waitForTarget();
  socket = new WebSocket(webSocketUrl);
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
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails.text ?? 'Uncaught exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  });

  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')]);
  await setViewport(1440, 900);
  await send('Page.navigate', { url: appUrl });
  await waitFor("document.readyState === 'complete' && !!document.querySelector('#percent-choice')", 'Selection screen did not load');
  assert(await evaluate("document.title === '速算训练'"), 'Unexpected selection page title');
  assert(await evaluate("document.querySelectorAll('.test-choice').length === 2"), 'Selection page should show two tests');
  await screenshot('math-quiz-home-desktop.png');
  await setViewport(390, 844, true);
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile selection screen overflows horizontally');
  await screenshot('math-quiz-home-mobile.png');
  await setViewport(1440, 900);
  await evaluate(`(() => {
    localStorage.setItem('math-memory-quiz-history:v1', JSON.stringify([{
      id: 'previous-percent', quizType: 'percent', completedAt: Date.now() - 86400000,
      accuracy: 90, correct: 27, total: 30, durationMs: 120000
    }]));
    location.reload();
  })()`);
  await waitFor("document.querySelector('#history-count')?.textContent === '1'", 'Saved percent history did not render');
  await evaluate("document.querySelector('#history-title').scrollIntoView()");
  await screenshot('math-quiz-history-desktop.png');
  await evaluate("window.scrollTo(0, 0)");
  await evaluate("document.querySelector('#percent-choice').click()");
  await waitFor("document.title === '百分快练' && !!document.querySelector('#start-button')", 'Percent test did not open from selection page');
  assert(await evaluate("!!document.querySelector('.home-link')"), 'Percent test is missing the return link');
  assert(await evaluate("document.querySelector('.home-link').getAttribute('href') === './index.html'"), 'Percent return link must target index.html');
  await evaluate("document.querySelector('.home-link').click()");
  await waitFor("document.title === '速算训练' && !!document.querySelector('#percent-choice')", 'Return link did not open the selection page');
  await evaluate("document.querySelector('#percent-choice').click()");
  await waitFor("document.title === '百分快练' && !!document.querySelector('#start-button')", 'Percent test did not reopen');

  assert(await evaluate("document.title === '百分快练'"), 'Unexpected document title');
  assert(await evaluate("!document.querySelector('#welcome-screen').hidden"), 'Welcome screen should be visible');
  await screenshot('percent-quiz-welcome-desktop.png');

  await evaluate("document.querySelector('#start-button').click()");
  await waitFor("!document.querySelector('#quiz-screen').hidden", 'Quiz screen did not open');
  await setViewport(390, 844, true);
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile question screen overflows horizontally');
  await screenshot('percent-quiz-question-mobile.png');

  const byPercent = new Map(PAIRS.map((pair) => [pair.percent, pair.fraction]));
  const byFraction = new Map(PAIRS.map((pair) => [pair.fraction, pair.percent]));

  for (let index = 0; index < PAIRS.length; index += 1) {
    const state = JSON.parse(await evaluate(`JSON.stringify({
      direction: document.querySelector('#direction-label').textContent,
      prompt: document.querySelector('#prompt-value').textContent
    })`));
    const expected = state.direction === '百分数转分数'
      ? byPercent.get(state.prompt.replace('%', ''))
      : byFraction.get(state.prompt);
    assert(expected, `Could not resolve answer for ${state.prompt}`);
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
    savedRecords: JSON.parse(localStorage.getItem('math-memory-quiz-history:v1')).filter(record => record.quizType === 'percent').length
  })`));
  assert(result.accuracy === '97%', `Expected 97% accuracy, received ${result.accuracy}`);
  assert(result.correct === '29 / 30', `Expected 29 / 30, received ${result.correct}`);
  assert(result.corrections === 1, `Expected one correction, received ${result.corrections}`);
  assert(result.heading.includes('1 题'), `Unexpected correction heading: ${result.heading}`);
  assert(result.comparison === '对比上一次', `Unexpected comparison label: ${result.comparison}`);
  assert(result.savedRecords === 2, `Expected two saved percent records, received ${result.savedRecords}`);
  assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join('; ')}`);
  await screenshot('percent-quiz-result-desktop.png');
  await setViewport(390, 844, true);
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile result screen overflows horizontally');
  await screenshot('percent-quiz-result-mobile.png');

  console.log(JSON.stringify({ ok: true, result, screenshots: outputDir }, null, 2));
} finally {
  socket?.close();
  if (browser.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
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
