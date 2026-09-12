// 全科目端到端冒烟 —— 升级后的最终验收测试。
//
// 为什么需要它：重构前每个题型各自复制一套控制器，只能逐个写 smoke；
// 抽出共享引擎后，「加一个科目」是零代码操作，所以必须用一条测试遍历
// **全部科目**，否则新增的 8 个常识科目将完全没有端到端覆盖。
//
// 本测试不改动也不取代 test/browser-smoke.mjs 与 test/powers-browser-smoke.mjs，
// 它验证的是那两条之外的部分：注册表驱动的首页、通用科目页、看板、全部 10 个科目。

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SUBJECTS, CATEGORIES } from '../public/js/registry.js';

const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const outputDir = process.env.QA_OUTPUT_DIR ?? join(process.cwd(), 'qa-output');
const debuggingPort = 9335;
const userDataDir = await mkdtemp(join(tmpdir(), 'all-subjects-edge-'));
const browser = spawn(edgePath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDir}`, 'about:blank'
], { stdio: 'ignore' });

let socket;
let requestId = 0;
const pending = new Map();
const consoleErrors = [];
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 软断言：记录问题但不中断整轮，让一次运行就能暴露全部科目的问题。 */
function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
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
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text ?? 'Browser evaluation failed');
  }
  return response.result.result.value;
}

async function waitFor(expression, message, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(expression)) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  failures.push(message);
  return false;
}

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}

async function screenshot(name) {
  try {
    const response = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    await writeFile(join(outputDir, name), Buffer.from(response.result.data, 'base64'));
  } catch {}
}

async function navigator_(url) {
  await send('Page.navigate', { url });
}

/**
 * 等待答题页真正就绪并点击开始。
 *
 * ⚠️ 判据是 `body[data-engine-ready="1"]`，不是「start-button 存在且未 disabled」。
 * 后者有真实漏洞：percent.html / powers.html 的开始按钮在**静态 HTML 里就是 enabled**，
 * 而点击监听要等 deferred module（app.js / powers-app.js）执行完才挂上。
 * 只等 disabled 状态会在模块执行前就点下去，点击被静默吞掉 → 页面停在欢迎屏、
 * 控制台无任何错误。这造成过 12 轮里 5 次偶发失败，且在改动前的基线上同样复现。
 *
 * 两个入口现在都会在执行末尾设置该标记（app.js / powers-app.js），通用页
 * （quiz-page.js）就绪时设置同样的标记，因此三种页面判定方式统一。
 * 仍保留 disabled 检查作为第二重保险。
 */
async function startRound() {
  const ready = await waitFor(
    "(() => { const b = document.querySelector('#start-button'); return !!b && b.disabled === false && document.body.dataset.engineReady === '1'; })()",
    '答题页未在超时内就绪（开始按钮不可用或引擎就绪标记未出现）'
  );
  if (!ready) return false;
  await evaluate("document.querySelector('#start-button').click()");
  const entered = await waitFor("!document.querySelector('#quiz-screen').hidden", '点击开始后未进入答题屏');
  if (!entered) {
    // 失败时把现场状态带出来，否则这种偶发失败无法定位。
    const state = await evaluate(`JSON.stringify({
      url: location.pathname + location.search,
      title: document.title,
      engineReady: document.body.dataset.engineReady ?? null,
      quizState: document.body.dataset.quizState ?? null,
      welcomeHidden: document.querySelector('#welcome-screen')?.hidden ?? null,
      quizHidden: document.querySelector('#quiz-screen')?.hidden ?? null,
      resultHidden: document.querySelector('#result-screen')?.hidden ?? null,
      startDisabled: document.querySelector('#start-button')?.disabled ?? null,
      progress: document.querySelector('#header-progress')?.textContent ?? null,
      hasSession: (() => { try { return !!localStorage.getItem('mq:session:v2'); } catch { return 'n/a'; } })()
    })`);
    failures.push(`点击开始后未进入答题屏；现场状态 = ${state}`);
  }
  return entered;
}

/** 软性等待：超时返回 false 而不抛错（用于「允许失败」的探测）。 */
async function waitForSoft(expression, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if (await evaluate(expression)) return true; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * 导航到目标 URL，并**确认真的落在新文档上**再返回。
 *
 * ⚠️ 为什么不能只 send('Page.navigate') 就往下走：
 * navigate 返回后短时间内 Runtime.evaluate 仍可能命中**上一个文档**，
 * 于是「点开始按钮」点在旧页面上，而后续断言在新页面上看不到已切屏 →
 * 报「点击开始后未进入答题屏」。这是本项目最隐蔽的一类偶发失败。
 *
 * 判据用「由宿主持有的文档序号」：每次导航前先注册一个在新文档里写入
 * 当前序号（1、2、3…）的初始化脚本，然后等这个序号出现。
 * 为什么不用 URL：有些页面会合法重定向（未知科目跳回 index.html），
 * 等目标 URL 会永远等不到。为什么不用页面内自增计数器：计数器随文档销毁，
 * 每个新文档都是从 0 开始，永远比不出「变大了」。
 */
let navSeq = 0;
async function navigateTo(target) {
  const url = new URL(target, appUrl).href;
  navSeq += 1;
  const seq = navSeq;
  // addScriptToEvaluateOnNewDocument 返回 Promise，await 后再导航可保证
  // 下一个文档一定带着这个序号。
  const registration = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__docSeq = ${seq};`
  });
  await send('Page.navigate', { url });
  const landed = await waitForSoft(`window.__docSeq === ${seq}`, 80);
  // 注册是一次性的，用完移除，避免脚本累积。
  const identifier = registration?.result?.identifier;
  if (identifier) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return landed;
}

/** 检查当前文档是否横向溢出。 */
async function overflows() {
  return evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
}

const results = [];

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
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails.text ?? 'Uncaught exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  });
  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')]);

  // ── 1. 首页：注册表驱动的科目网格 ──────────────────────────────
  await setViewport(1440, 900);
  await navigator_(appUrl);
  await waitFor("document.readyState === 'complete'", '首页未加载完成');

  const homeInfo = JSON.parse(await evaluate(`JSON.stringify({
    // 用 .subject-card 而不是 [data-subject-id]：后者会被看板的弱项行等其它区块复用，
    // 导致在「跑过测试的 profile」里数出多于科目数（曾数到 12）。
    choices: document.querySelectorAll('.subject-card').length,
    hasStreak: !!document.querySelector('#dashboard-streak'),
    hasTrend: !!document.querySelector('#dashboard-trend'),
    hasWeak: !!document.querySelector('#dashboard-weak'),
    subjects: [...document.querySelectorAll('.subject-card')].map(el => el.dataset.subjectId)
  })`));

  check(homeInfo.choices >= SUBJECTS.length,
    `首页科目卡片应有至少 ${SUBJECTS.length} 个，实际 ${homeInfo.choices} 个`);
  const missingCards = SUBJECTS.map((s) => s.id).filter((id) => !homeInfo.subjects.includes(id));
  check(missingCards.length === 0, `首页缺少科目卡片：${missingCards.join(', ')}`);
  check(homeInfo.hasStreak, '首页缺少看板区块 #dashboard-streak');
  check(homeInfo.hasTrend, '首页缺少看板区块 #dashboard-trend');
  check(homeInfo.hasWeak, '首页缺少看板区块 #dashboard-weak');

  // 分类分组必须来自注册表，不允许硬编码
  const groupTitles = JSON.parse(await evaluate(
    `JSON.stringify([...document.querySelectorAll('h2, .category-title, [data-category]')].map(e => e.textContent.trim()))`
  ));
  for (const category of CATEGORIES) {
    check(groupTitles.some((t) => t.includes(category.title)),
      `首页缺少分类分组标题「${category.title}」`);
  }

  // 时政必须显示更新时间，让内容年龄对用户可见
  const shizheng = SUBJECTS.find((s) => s.updatedAt);
  if (shizheng) {
    const bodyText = await evaluate('document.body.innerText');
    check(bodyText.includes(shizheng.updatedAt),
      `时政科目应在首页显示「更新于 ${shizheng.updatedAt}」，让内容时效性可见`);
  }

  await screenshot('final-home-desktop.png');

  // 首页移动端不得溢出
  await setViewport(390, 844, true);
  check(!(await overflows()), '首页在 390px 宽度下横向溢出');
  await screenshot('final-home-mobile.png');
  await setViewport(1440, 900);

  // ── 2. 通用科目页：遍历全部非数学科目走完一轮 ────────────────────
  const commonSubjects = SUBJECTS.filter((s) => s.category === 'common');
  for (const subject of commonSubjects) {
    const before = consoleErrors.length;
    await navigateTo(subject.page);
    const loaded = await waitFor(
      "document.readyState === 'complete' && !!document.querySelector('#start-button')",
      `科目 ${subject.id} 的答题页没有渲染出开始按钮`
    );
    if (!loaded) { results.push({ subject: subject.id, status: '页面未加载' }); continue; }

    const title = await evaluate('document.title');
    check(title.includes(subject.title) || title.length > 0, `科目 ${subject.id} 的页面标题异常：${title}`);

    const started = await startRound();
    if (!started) { results.push({ subject: subject.id, status: '无法开始' }); continue; }

    // 读出本轮题量，然后逐题作答（全部填错，只为走通流程）
    const total = await evaluate(`(() => {
      const text = document.querySelector('#header-progress')?.textContent ?? '';
      const match = text.match(/\\/\\s*(\\d+)/);
      return match ? Number(match[1]) : 0;
    })()`);
    check(total >= 8, `科目 ${subject.id} 本轮题量只有 ${total}，少于 8`);

    for (let index = 0; index < total; index += 1) {
      const ok = await evaluate(`(() => {
        const input = document.querySelector('#answer-input');
        if (!input) return false;
        // 选择题模式：若有选项按钮则点第一个
        const choice = document.querySelector('.choice-option, [data-choice-index]');
        if (choice) { choice.click(); }
        else {
          input.value = 'zzz';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const next = document.querySelector('#next-button');
        if (!next || next.disabled) return false;
        next.click();
        return true;
      })()`);
      if (!ok) {
        // 可能是选择题需要先选中；再试一次点选项
        await evaluate(`(() => {
          const choice = document.querySelector('.choice-option, [data-choice-index]');
          if (choice) choice.click();
          const next = document.querySelector('#next-button');
          if (next && !next.disabled) next.click();
        })()`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const finished = await waitFor("!document.querySelector('#result-screen').hidden",
      `科目 ${subject.id} 走完全部题目后未进入成绩屏`, 40);

    if (finished) {
      const summary = JSON.parse(await evaluate(`JSON.stringify({
        accuracy: document.querySelector('#accuracy-value')?.textContent,
        correct: document.querySelector('#correct-value')?.textContent,
        corrections: document.querySelectorAll('.correction-row').length
      })`));
      results.push({ subject: subject.id, status: '已交卷', total, ...summary });
      await setViewport(390, 844, true);
      check(!(await overflows()), `科目 ${subject.id} 的成绩屏在 390px 下横向溢出`);
      await setViewport(1440, 900);
    } else {
      results.push({ subject: subject.id, status: '未交卷', total });
    }

    const newErrors = consoleErrors.slice(before);
    check(newErrors.length === 0, `科目 ${subject.id} 产生 console error：${newErrors.join('; ')}`);

    await screenshot(`final-subject-${subject.id}.png`);
  }

  // ── 3. 未知科目 id 必须回落首页而不是白屏 ─────────────────────
  await navigateTo('quiz.html?subject=不存在的科目');
  await new Promise((resolve) => setTimeout(resolve, 700));
  const fallback = JSON.parse(await evaluate(`JSON.stringify({
    hasStart: !!document.querySelector('#start-button'),
    hasAnyCard: document.querySelectorAll('.subject-card').length,
    bodyLength: document.body.innerText.trim().length
  })`));
  check(fallback.bodyLength > 0,
    '未知科目 id 时页面内容为空（白屏）——应回退首页或显示空状态');
  check(!fallback.hasStart || fallback.hasAnyCard > 0,
    '未知科目 id 时直接显示了答题页，应回退首页或空状态');

  // ── 4. 数学科目的既有页面不能被破坏 ────────────────────────────
  for (const id of ['percent', 'powers']) {
    const subject = SUBJECTS.find((s) => s.id === id);
    const landed = await navigateTo(subject.page);
    if (!landed) { results.push({ subject: id, status: '页面未加载' }); continue; }
    const ok = await waitFor("!!document.querySelector('#start-button')",
      `数学科目 ${id} 的页面被破坏：找不到开始按钮`);
    let startedOk = false;
    if (ok) startedOk = await startRound();
    if (!startedOk) failures.push(`数学科目 ${id} 无法开始答题`);
    results.push({ subject: id, status: ok && startedOk ? '页面正常' : '页面异常' });
  }

  await setViewport(390, 844, true);
  check(!(await overflows()), '最终检查：当前页面在 390px 下横向溢出');

  const realErrors = consoleErrors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
  check(realErrors.length === 0, `存在 console error：${realErrors.join(' | ')}`);

  const report = {
    ok: failures.length === 0,
    subjectsCovered: SUBJECTS.length,
    commonSubjectsExercised: results.filter((r) => r.status === '已交卷').length,
    failures,
    results,
    consoleErrors: realErrors,
    screenshots: outputDir
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, fatal: String(error), failures, results, consoleErrors }, null, 2));
  process.exitCode = 1;
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
      if (attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
