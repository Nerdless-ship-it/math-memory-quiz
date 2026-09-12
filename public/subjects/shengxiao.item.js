// 十二生肖 —— 考公常识固定配对（双向回忆）。
//
// 覆盖两个关联维度：
//   生肖 ↔ 地支（12 条，tags: 生肖地支）—— front 用生肖、back 用地支，
//     这样「生肖排序」那组的 back 可以放心用生肖本身，不会与地支组的 back 重复；
//   生肖排序（6 条，tags: 生肖排序）—— 取前五位与末位共 6 个锚点。
//
// 唯一性说明：本文件 front 共 18 个互不相同，back 共 18 个互不相同
//   （地支 12 个 + 生肖 6 个，两组字面不重叠）。生肖名在一组里当 front、
//   在排序组里当 back，属于「同一字面承担两个不同维度」的设计，
//   依赖题面方向标签（tags）区分，改数据时请一并保留 tags。

export const ITEMS = Object.freeze([
  // ── 生肖 ↔ 地支 ─────────────────────────────────────────────
  { id: 'shengxiao-01', front: '鼠', back: '子', tags: ['生肖地支'] },
  { id: 'shengxiao-02', front: '牛', back: '丑', tags: ['生肖地支'] },
  { id: 'shengxiao-03', front: '虎', back: '寅', tags: ['生肖地支'] },
  { id: 'shengxiao-04', front: '兔', back: '卯', tags: ['生肖地支'] },
  { id: 'shengxiao-05', front: '龙', back: '辰', tags: ['生肖地支'] },
  { id: 'shengxiao-06', front: '蛇', back: '巳', tags: ['生肖地支'] },
  { id: 'shengxiao-07', front: '马', back: '午', tags: ['生肖地支'] },
  { id: 'shengxiao-08', front: '羊', back: '未', tags: ['生肖地支'] },
  { id: 'shengxiao-09', front: '猴', back: '申', tags: ['生肖地支'] },
  { id: 'shengxiao-10', front: '鸡', back: '酉', tags: ['生肖地支'] },
  { id: 'shengxiao-11', front: '狗', back: '戌', tags: ['生肖地支'] },
  { id: 'shengxiao-12', front: '猪', back: '亥', tags: ['生肖地支'] },

  // ── 十二生肖排序（鼠牛虎兔龙蛇马羊猴鸡狗猪）──────────────────────
  { id: 'shengxiao-13', front: '生肖排序第一位', back: '鼠', tags: ['生肖排序'] },
  { id: 'shengxiao-14', front: '生肖排序第二位', back: '牛', tags: ['生肖排序'] },
  { id: 'shengxiao-15', front: '生肖排序第三位', back: '虎', tags: ['生肖排序'] },
  { id: 'shengxiao-16', front: '生肖排序第四位', back: '兔', tags: ['生肖排序'] },
  { id: 'shengxiao-17', front: '生肖排序第五位', back: '龙', tags: ['生肖排序'] },
  { id: 'shengxiao-18', front: '生肖排序第十二位', back: '猪', tags: ['生肖排序'] },

  // ── 2026-09 内容补充：第 6–11 位锚点（此前完全考不到；id 只增不改，追加在尾）
  { id: 'shengxiao-19', front: '生肖排序第六位', back: '蛇', tags: ['生肖排序'] },
  { id: 'shengxiao-20', front: '生肖排序第七位', back: '马', tags: ['生肖排序'] },
  { id: 'shengxiao-21', front: '生肖排序第八位', back: '羊', tags: ['生肖排序'] },
  { id: 'shengxiao-22', front: '生肖排序第九位', back: '猴', tags: ['生肖排序'] },
  { id: 'shengxiao-23', front: '生肖排序第十位', back: '鸡', tags: ['生肖排序'] },
  { id: 'shengxiao-24', front: '生肖排序第十一位', back: '狗', tags: ['生肖排序'] }
]);
