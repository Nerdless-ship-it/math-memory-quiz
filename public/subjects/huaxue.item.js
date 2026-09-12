// 化学元素 —— 考公常识题库
//
// 关联维度（三个维度各自承担不同的 front/back，互不重复）：
//   元素名称 → 元素符号   front='氢'          back='H'
//   元素名称 → 原子序数   front='氢的原子序数' back='1'
//   符号释义 → 元素名称   front='H'          back='氢'        ← 必须反向出题
//
// 关于方向锁：第三个维度是「反向」的（提示是符号，作答是元素名）。
// registry.js 的 DIMENSION_LOCKS 已把 `huaxue:符号释义` 锁为 backward，
// 否则会出现「H → ？」这种无解题。详见 docs/ARCHITECTURE.md 与 registry.js。
//
// 关于元素符号大小写：符号严格按 IUPAC 规范书写（首字母大写、第二字母小写），
// 如 Cl / Na / Mg / Mn / Hg。判题时 adapters/generic.js 的 normalizeText 会
// 统一转小写，因此用户输入 'cl' 或 'CL' 均判对。

export const ITEMS = Object.freeze([
  // ── 元素名称 → 元素符号 ─────────────────────────────────────────
  { id: 'huaxue-01', front: '氢', back: 'H', tags: ['元素名称'] },
  { id: 'huaxue-02', front: '氦', back: 'He', tags: ['元素名称'] },
  { id: 'huaxue-03', front: '锂', back: 'Li', tags: ['元素名称'] },
  { id: 'huaxue-04', front: '铍', back: 'Be', tags: ['元素名称'] },
  { id: 'huaxue-05', front: '硼', back: 'B', tags: ['元素名称'] },
  { id: 'huaxue-06', front: '碳', back: 'C', tags: ['元素名称'] },
  { id: 'huaxue-07', front: '氮', back: 'N', tags: ['元素名称'] },
  { id: 'huaxue-08', front: '氧', back: 'O', tags: ['元素名称'] },
  { id: 'huaxue-09', front: '氟', back: 'F', tags: ['元素名称'] },
  { id: 'huaxue-10', front: '氖', back: 'Ne', tags: ['元素名称'] },
  { id: 'huaxue-11', front: '钠', back: 'Na', tags: ['元素名称'] },
  { id: 'huaxue-12', front: '镁', back: 'Mg', tags: ['元素名称'] },
  { id: 'huaxue-13', front: '铝', back: 'Al', tags: ['元素名称'] },
  { id: 'huaxue-14', front: '硅', back: 'Si', tags: ['元素名称'] },
  { id: 'huaxue-15', front: '磷', back: 'P', tags: ['元素名称'] },
  { id: 'huaxue-16', front: '硫', back: 'S', tags: ['元素名称'] },
  { id: 'huaxue-17', front: '氯', back: 'Cl', tags: ['元素名称'] },
  { id: 'huaxue-18', front: '氩', back: 'Ar', tags: ['元素名称'] },
  { id: 'huaxue-19', front: '钾', back: 'K', tags: ['元素名称'] },
  { id: 'huaxue-20', front: '钙', back: 'Ca', tags: ['元素名称'] },
  { id: 'huaxue-21', front: '铁', back: 'Fe', tags: ['元素名称'] },
  { id: 'huaxue-22', front: '铜', back: 'Cu', tags: ['元素名称'] },
  { id: 'huaxue-23', front: '锌', back: 'Zn', tags: ['元素名称'] },
  { id: 'huaxue-24', front: '银', back: 'Ag', tags: ['元素名称'] },
  { id: 'huaxue-25', front: '碘', back: 'I', tags: ['元素名称'] },
  { id: 'huaxue-26', front: '汞', back: 'Hg', tags: ['元素名称'] },

  // ── 元素名称 → 原子序数 ─────────────────────────────────────────
  { id: 'huaxue-27', front: '氢的原子序数', back: '1', tags: ['原子序数'] },
  { id: 'huaxue-28', front: '氦的原子序数', back: '2', tags: ['原子序数'] },
  { id: 'huaxue-29', front: '锂的原子序数', back: '3', tags: ['原子序数'] },
  { id: 'huaxue-30', front: '铍的原子序数', back: '4', tags: ['原子序数'] },
  { id: 'huaxue-31', front: '硼的原子序数', back: '5', tags: ['原子序数'] },
  { id: 'huaxue-32', front: '碳的原子序数', back: '6', tags: ['原子序数'] },
  { id: 'huaxue-33', front: '氮的原子序数', back: '7', tags: ['原子序数'] },
  { id: 'huaxue-34', front: '氧的原子序数', back: '8', tags: ['原子序数'] },
  { id: 'huaxue-35', front: '氟的原子序数', back: '9', tags: ['原子序数'] },
  { id: 'huaxue-36', front: '氖的原子序数', back: '10', tags: ['原子序数'] },
  { id: 'huaxue-37', front: '钠的原子序数', back: '11', tags: ['原子序数'] },
  { id: 'huaxue-38', front: '镁的原子序数', back: '12', tags: ['原子序数'] },
  { id: 'huaxue-39', front: '铝的原子序数', back: '13', tags: ['原子序数'] },
  { id: 'huaxue-40', front: '硅的原子序数', back: '14', tags: ['原子序数'] },
  { id: 'huaxue-41', front: '磷的原子序数', back: '15', tags: ['原子序数'] },
  { id: 'huaxue-42', front: '硫的原子序数', back: '16', tags: ['原子序数'] },
  { id: 'huaxue-43', front: '氯的原子序数', back: '17', tags: ['原子序数'] },
  { id: 'huaxue-44', front: '氩的原子序数', back: '18', tags: ['原子序数'] },
  { id: 'huaxue-45', front: '钾的原子序数', back: '19', tags: ['原子序数'] },
  { id: 'huaxue-46', front: '钙的原子序数', back: '20', tags: ['原子序数'] },

  // ── 元素符号 → 元素名称（反向出题，见文件头说明）────────────────
  { id: 'huaxue-47', front: 'H', back: '氢', tags: ['符号释义'] },
  { id: 'huaxue-48', front: 'He', back: '氦', tags: ['符号释义'] },
  { id: 'huaxue-49', front: 'Li', back: '锂', tags: ['符号释义'] },
  { id: 'huaxue-50', front: 'Be', back: '铍', tags: ['符号释义'] },
  { id: 'huaxue-51', front: 'B', back: '硼', tags: ['符号释义'] },
  { id: 'huaxue-52', front: 'C', back: '碳', tags: ['符号释义'] },
  { id: 'huaxue-53', front: 'N', back: '氮', tags: ['符号释义'] },
  { id: 'huaxue-54', front: 'O', back: '氧', tags: ['符号释义'] },
  { id: 'huaxue-55', front: 'F', back: '氟', tags: ['符号释义'] },
  { id: 'huaxue-56', front: 'Ne', back: '氖', tags: ['符号释义'] },
  { id: 'huaxue-57', front: 'Na', back: '钠', tags: ['符号释义'] },
  { id: 'huaxue-58', front: 'Mg', back: '镁', tags: ['符号释义'] },
  { id: 'huaxue-59', front: 'Al', back: '铝', tags: ['符号释义'] },
  { id: 'huaxue-60', front: 'Si', back: '硅', tags: ['符号释义'] },
  { id: 'huaxue-61', front: 'P', back: '磷', tags: ['符号释义'] },
  { id: 'huaxue-62', front: 'S', back: '硫', tags: ['符号释义'] },
  { id: 'huaxue-63', front: 'Cl', back: '氯', tags: ['符号释义'] },
  { id: 'huaxue-64', front: 'Ar', back: '氩', tags: ['符号释义'] },
  { id: 'huaxue-65', front: 'K', back: '钾', tags: ['符号释义'] },
  { id: 'huaxue-66', front: 'Ca', back: '钙', tags: ['符号释义'] },
  { id: 'huaxue-67', front: 'Fe', back: '铁', tags: ['符号释义'] },
  { id: 'huaxue-68', front: 'Cu', back: '铜', tags: ['符号释义'] },
  { id: 'huaxue-69', front: 'Zn', back: '锌', tags: ['符号释义'] },
  { id: 'huaxue-70', front: 'Ag', back: '银', tags: ['符号释义'] },
  { id: 'huaxue-71', front: 'I', back: '碘', tags: ['符号释义'] },
  { id: 'huaxue-72', front: 'Hg', back: '汞', tags: ['符号释义'] }
]);
