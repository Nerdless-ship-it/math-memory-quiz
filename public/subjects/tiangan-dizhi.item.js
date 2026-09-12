// 天干地支 —— 考公常识固定配对（双向回忆）。
//
// 覆盖三个关联维度：
//   十天干 → 阴阳五行（10 条，tags: 天干）
//   十二地支 → 阴阳五行（12 条，tags: 地支）
//   十二地支 → 十二时辰（12 条，tags: 时辰）
//
// 唯一性说明（本文件的设计约束，改动前请先读）：
//   1. 天干五行的 back（如「阳木」）与地支五行的 back 天然撞车（甲/寅同为阳木）；
//   2. 地支内部还有第二重撞车：辰、戌同属阳土，丑、未同属阴土。
//   故地支的五行 back 统一附生肖作上下文（「阳土（龙）」/「阳土（狗）」），
//   既让每条 back 唯一、可反向提问，又顺带巩固「地支—生肖」这一高频对照。
//   改任何一条 back 前，请确认全文件 front/back 仍各自唯一。

export const ITEMS = Object.freeze([
  // ── 十天干的阴阳五行 ──────────────────────────────────────────
  { id: 'tiangan-01', front: '甲', back: '阳木', tags: ['天干'] },
  { id: 'tiangan-02', front: '乙', back: '阴木', tags: ['天干'] },
  { id: 'tiangan-03', front: '丙', back: '阳火', tags: ['天干'] },
  { id: 'tiangan-04', front: '丁', back: '阴火', tags: ['天干'] },
  { id: 'tiangan-05', front: '戊', back: '阳土', tags: ['天干'] },
  { id: 'tiangan-06', front: '己', back: '阴土', tags: ['天干'] },
  { id: 'tiangan-07', front: '庚', back: '阳金', tags: ['天干'] },
  { id: 'tiangan-08', front: '辛', back: '阴金', tags: ['天干'] },
  { id: 'tiangan-09', front: '壬', back: '阳水', tags: ['天干'] },
  { id: 'tiangan-10', front: '癸', back: '阴水', tags: ['天干'] },

  // ── 十二地支的阴阳五行（按地支序数定阴阳：子阳、丑阴、寅阳…）──────
  { id: 'tiangan-11', front: '子', back: '阳水（鼠）', tags: ['地支'] },
  { id: 'tiangan-12', front: '丑', back: '阴土（牛）', tags: ['地支'] },
  { id: 'tiangan-13', front: '寅', back: '阳木（虎）', tags: ['地支'] },
  { id: 'tiangan-14', front: '卯', back: '阴木（兔）', tags: ['地支'] },
  { id: 'tiangan-15', front: '辰', back: '阳土（龙）', tags: ['地支'] },
  { id: 'tiangan-16', front: '巳', back: '阴火（蛇）', tags: ['地支'] },
  { id: 'tiangan-17', front: '午', back: '阳火（马）', tags: ['地支'] },
  { id: 'tiangan-18', front: '未', back: '阴土（羊）', tags: ['地支'] },
  { id: 'tiangan-19', front: '申', back: '阳金（猴）', tags: ['地支'] },
  { id: 'tiangan-20', front: '酉', back: '阴金（鸡）', tags: ['地支'] },
  { id: 'tiangan-21', front: '戌', back: '阳土（狗）', tags: ['地支'] },
  { id: 'tiangan-22', front: '亥', back: '阴水（猪）', tags: ['地支'] },

  // ── 十二时辰（一个时辰两小时，子时跨夜）──────────────────────────
  { id: 'tiangan-23', front: '子时', back: '23点至1点', tags: ['时辰'] },
  { id: 'tiangan-24', front: '丑时', back: '1点至3点', tags: ['时辰'] },
  { id: 'tiangan-25', front: '寅时', back: '3点至5点', tags: ['时辰'] },
  { id: 'tiangan-26', front: '卯时', back: '5点至7点', tags: ['时辰'] },
  { id: 'tiangan-27', front: '辰时', back: '7点至9点', tags: ['时辰'] },
  { id: 'tiangan-28', front: '巳时', back: '9点至11点', tags: ['时辰'] },
  { id: 'tiangan-29', front: '午时', back: '11点至13点', tags: ['时辰'] },
  { id: 'tiangan-30', front: '未时', back: '13点至15点', tags: ['时辰'] },
  { id: 'tiangan-31', front: '申时', back: '15点至17点', tags: ['时辰'] },
  { id: 'tiangan-32', front: '酉时', back: '17点至19点', tags: ['时辰'] },
  { id: 'tiangan-33', front: '戌时', back: '19点至21点', tags: ['时辰'] },
  { id: 'tiangan-34', front: '亥时', back: '21点至23点', tags: ['时辰'] }
]);
