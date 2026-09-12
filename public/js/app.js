// 百分快练 —— 引擎 + percent 适配器的薄封装（原来 235 行的 app.js 全部沉到 engine.js）。
import { createEngine, collectElements } from './engine.js';
import { getSubject } from './registry.js';
import percentAdapter from './adapters/percent.js';

const subject = getSubject('percent') ?? { id: 'percent', questionTypes: ['fill'] };

const engine = createEngine({
  adapter: percentAdapter,
  subject,
  elements: collectElements(),
  mode: 'test'
});

// 有未完成的测试就直接续答；没有则停留在欢迎页，等用户点「开始测试」。
if (engine.hasSession()) engine.resume();
