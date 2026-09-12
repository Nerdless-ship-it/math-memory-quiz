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

// 就绪标记：本页的开始按钮在静态 HTML 里就是 enabled 的，而点击监听要等本模块
// 执行后才挂上。两者之间有一个「点了没反应」的窗口，自动化测试曾因此偶发失败。
// 这里显式声明模块已执行完毕，让测试/外部可以等到真正可交互再点击。
document.body.dataset.engineReady = '1';
