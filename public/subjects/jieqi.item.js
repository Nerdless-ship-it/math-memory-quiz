// 二十四节气 —— 考公常识固定配对（双向回忆）。
//
// 覆盖两个关联维度：
//   节气 ↔ 顺序编号（24 条，tags: 节气顺序）：立春第 1 … 大寒第 24；
//   节气含义（8 条，tags: 节气含义）：front 写释义、back 写节气名。
//
// 唯一性说明：节气名在顺序组里是 front、在含义组里是 back，若含义组也把节气名放
//   front，就会与顺序组的 front 直接重复（硬性约束要求同科目 front 唯一）。
//   故含义组统一「释义 → 节气名」，节气名只出现在 back 一侧；
//   释义与「第 N 个节气」两类字面互不相同，back 全部唯一。

export const ITEMS = Object.freeze([
  // ── 二十四节气顺序（立春起、大寒止）────────────────────────────
  { id: 'jieqi-01', front: '立春', back: '第1个节气', tags: ['节气顺序'] },
  { id: 'jieqi-02', front: '雨水', back: '第2个节气', tags: ['节气顺序'] },
  { id: 'jieqi-03', front: '惊蛰', back: '第3个节气', tags: ['节气顺序'] },
  { id: 'jieqi-04', front: '春分', back: '第4个节气', tags: ['节气顺序'] },
  { id: 'jieqi-05', front: '清明', back: '第5个节气', tags: ['节气顺序'] },
  { id: 'jieqi-06', front: '谷雨', back: '第6个节气', tags: ['节气顺序'] },
  { id: 'jieqi-07', front: '立夏', back: '第7个节气', tags: ['节气顺序'] },
  { id: 'jieqi-08', front: '小满', back: '第8个节气', tags: ['节气顺序'] },
  { id: 'jieqi-09', front: '芒种', back: '第9个节气', tags: ['节气顺序'] },
  { id: 'jieqi-10', front: '夏至', back: '第10个节气', tags: ['节气顺序'] },
  { id: 'jieqi-11', front: '小暑', back: '第11个节气', tags: ['节气顺序'] },
  { id: 'jieqi-12', front: '大暑', back: '第12个节气', tags: ['节气顺序'] },
  { id: 'jieqi-13', front: '立秋', back: '第13个节气', tags: ['节气顺序'] },
  { id: 'jieqi-14', front: '处暑', back: '第14个节气', tags: ['节气顺序'] },
  { id: 'jieqi-15', front: '白露', back: '第15个节气', tags: ['节气顺序'] },
  { id: 'jieqi-16', front: '秋分', back: '第16个节气', tags: ['节气顺序'] },
  { id: 'jieqi-17', front: '寒露', back: '第17个节气', tags: ['节气顺序'] },
  { id: 'jieqi-18', front: '霜降', back: '第18个节气', tags: ['节气顺序'] },
  { id: 'jieqi-19', front: '立冬', back: '第19个节气', tags: ['节气顺序'] },
  { id: 'jieqi-20', front: '小雪', back: '第20个节气', tags: ['节气顺序'] },
  { id: 'jieqi-21', front: '大雪', back: '第21个节气', tags: ['节气顺序'] },
  { id: 'jieqi-22', front: '冬至', back: '第22个节气', tags: ['节气顺序'] },
  { id: 'jieqi-23', front: '小寒', back: '第23个节气', tags: ['节气顺序'] },
  { id: 'jieqi-24', front: '大寒', back: '第24个节气', tags: ['节气顺序'] },

  // ── 节气名称含义（释义 → 节气名）────────────────────────────────
  { id: 'jieqi-25', front: '春雷始鸣，蛰虫惊醒', back: '惊蛰', tags: ['节气含义'] },
  { id: 'jieqi-26', front: '天气晴朗，草木繁茂', back: '清明', tags: ['节气含义'] },
  { id: 'jieqi-27', front: '雨生百谷', back: '谷雨', tags: ['节气含义'] },
  { id: 'jieqi-28', front: '麦粒渐满', back: '小满', tags: ['节气含义'] },
  { id: 'jieqi-29', front: '麦类等有芒作物成熟', back: '芒种', tags: ['节气含义'] },
  { id: 'jieqi-30', front: '天气转凉，露凝而白', back: '白露', tags: ['节气含义'] },
  { id: 'jieqi-31', front: '天气渐冷，开始降霜', back: '霜降', tags: ['节气含义'] },
  { id: 'jieqi-32', front: '白昼最短，开始数九', back: '冬至', tags: ['节气含义'] },

  // ── 2026-09 内容补充：再收 4 个释义无歧义的节气（id 只增不改，追加在尾）。
  // 小/大对（小暑大暑、小雪大雪、小寒大寒）的释义彼此难分，刻意不收，与既有口径一致。
  { id: 'jieqi-33', front: '冰雪消融，降水渐多', back: '雨水', tags: ['节气含义'] },
  { id: 'jieqi-34', front: '一年中白昼最长的一天', back: '夏至', tags: ['节气含义'] },
  { id: 'jieqi-35', front: '暑热至此而止', back: '处暑', tags: ['节气含义'] },
  { id: 'jieqi-36', front: '露气寒冷，将要结冰', back: '寒露', tags: ['节气含义'] },

  // ── 2026-09 二轮补充：四立（四季之始，考公高频；id 只增不改，追加在尾）
  { id: 'jieqi-37', front: '春季的开始', back: '立春', tags: ['节气含义'] },
  { id: 'jieqi-38', front: '夏季的开始', back: '立夏', tags: ['节气含义'] },
  { id: 'jieqi-39', front: '秋季的开始', back: '立秋', tags: ['节气含义'] },
  { id: 'jieqi-40', front: '冬季的开始', back: '立冬', tags: ['节气含义'] }
]);
