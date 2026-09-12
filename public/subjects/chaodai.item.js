// 历史朝代 —— 考公常识固定配对（双向回忆）。
//
// 覆盖两个关联维度：
//   朝代 → 开国君主（18 条，tags: 开国君主）
//   都城 → 朝代（10 条，tags: 都城）
//
// 为什么要给朝代名加限定词、为什么都城那一组要「都城在前、朝代在后」：
//   1. 「汉」「宋」「晋」「周」在本表出现不止一次，故统一写成「西汉」「东汉」
//      「北宋」「南宋」「西晋」「西周」，保证 front 唯一；
//   2. 若「朝代→开国君主」与「朝代→都城」都把朝代名放 front，front 必然重复
//      （同一朝代会出现两条），因此都城组反向写成「都城 → 朝代」：
//      「咸阳 → 秦」「临安 → 南宋」，两组的 front（政权名 / 都城名）与
//      back（君主名 / 政权名）各自互不重复。
//
// 史实口径：
//   - 清：努尔哈赤 1616 年建后金；皇太极 1636 年改国号为清。故本表
//     「清 → 皇太极」，并单列「后金 → 努尔哈赤」，两者不混用；
//   - 元：1206 年成吉思汗建大蒙古国，1271 年忽必烈定国号大元，
//     本表按考公通行口径取「元 → 忽必烈」；
//   - 夏：取「夏 → 禹」（夏朝建立者，考公通行口径）；
//   - 明：明初定都南京（洪武），永乐十九年迁都北京；本表首都城组记
//     「南京 → 明」；北京因需与清共用同一字面，只保留「北京 → 清」；
//   - 长安：西汉、隋、唐均以此为都，为避免同科目 front 重复，本表只保留
//     「长安 → 西汉」；同理洛阳只保留东汉（未收西晋）。

export const ITEMS = Object.freeze([
  // ── 朝代 → 开国君主 ──────────────────────────────────────────
  { id: 'chaodai-01', front: '夏', back: '禹', tags: ['开国君主'] },
  { id: 'chaodai-02', front: '商', back: '汤', tags: ['开国君主'] },
  { id: 'chaodai-03', front: '西周', back: '周武王姬发', tags: ['开国君主'] },
  { id: 'chaodai-04', front: '秦', back: '秦始皇嬴政', tags: ['开国君主'] },
  { id: 'chaodai-05', front: '西汉', back: '刘邦', tags: ['开国君主'] },
  { id: 'chaodai-06', front: '新', back: '王莽', tags: ['开国君主'] },
  { id: 'chaodai-07', front: '东汉', back: '刘秀', tags: ['开国君主'] },
  { id: 'chaodai-08', front: '曹魏', back: '曹丕', tags: ['开国君主'] },
  { id: 'chaodai-09', front: '蜀汉', back: '刘备', tags: ['开国君主'] },
  { id: 'chaodai-10', front: '东吴', back: '孙权', tags: ['开国君主'] },
  { id: 'chaodai-11', front: '西晋', back: '司马炎', tags: ['开国君主'] },
  { id: 'chaodai-12', front: '隋', back: '杨坚', tags: ['开国君主'] },
  { id: 'chaodai-13', front: '唐', back: '李渊', tags: ['开国君主'] },
  { id: 'chaodai-14', front: '北宋', back: '赵匡胤', tags: ['开国君主'] },
  { id: 'chaodai-15', front: '元', back: '忽必烈', tags: ['开国君主'] },
  { id: 'chaodai-16', front: '明', back: '朱元璋', tags: ['开国君主'] },
  { id: 'chaodai-17', front: '清', back: '皇太极', tags: ['开国君主'] },
  { id: 'chaodai-18', front: '后金', back: '努尔哈赤', tags: ['开国君主'] },

  // ── 2026-09 内容补充：东晋 / 南宋 / 辽 / 金（id 只增不改，追加在尾）。
  // 南宋此前只有都城条目（临安 → 南宋）却没有君主条目，属明显缺口。
  { id: 'chaodai-29', front: '东晋', back: '司马睿', tags: ['开国君主'] },
  { id: 'chaodai-30', front: '南宋', back: '赵构', tags: ['开国君主'] },
  { id: 'chaodai-31', front: '辽', back: '耶律阿保机', tags: ['开国君主'] },
  { id: 'chaodai-32', front: '金', back: '完颜阿骨打', tags: ['开国君主'] },

  // ── 都城 → 朝代 ────────────────────────────────────────────
  { id: 'chaodai-19', front: '咸阳', back: '秦', tags: ['都城'] },
  { id: 'chaodai-20', front: '长安', back: '西汉', tags: ['都城'] },
  { id: 'chaodai-21', front: '洛阳', back: '东汉', tags: ['都城'] },
  { id: 'chaodai-22', front: '成都', back: '蜀汉', tags: ['都城'] },
  { id: 'chaodai-23', front: '建业', back: '东吴', tags: ['都城'] },
  { id: 'chaodai-24', front: '开封', back: '北宋', tags: ['都城'] },
  { id: 'chaodai-25', front: '临安', back: '南宋', tags: ['都城'] },
  { id: 'chaodai-26', front: '大都', back: '元', tags: ['都城'] },
  { id: 'chaodai-27', front: '南京', back: '明', tags: ['都城'] },
  { id: 'chaodai-28', front: '北京', back: '清', tags: ['都城'] },

  // ── 2026-09 内容补充：建康 → 东晋（与「建业 → 东吴」「临安 → 南宋」同型）──
  { id: 'chaodai-33', front: '建康', back: '东晋', tags: ['都城'] }
]);
