// 平方幂次速记 —— 引擎 + powers 适配器的薄封装（原来 244 行的 powers-app.js 全部沉到 engine.js）。
import { createEngine, collectElements } from './engine.js';
import { getSubject } from './registry.js';
import powersAdapter from './adapters/powers.js';

const subject = getSubject('powers') ?? { id: 'powers', questionTypes: ['fill'] };

const engine = createEngine({
  adapter: powersAdapter,
  subject,
  elements: collectElements(),
  mode: 'test'
});

// 有未完成的测试就直接续答；没有则停留在欢迎页，等用户点「开始测试」。
if (engine.hasSession()) engine.resume();
