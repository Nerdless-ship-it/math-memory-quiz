// 历史常识 —— 考公常识判断的记忆配对数据。
// 每题是一对固定关联，两个方向都成立且反向唯一。
// 覆盖：著作与作者、文学常识、变法改革、成语典故、重大事件与制度、人物称号。

export const ITEMS = Object.freeze([
  { id: 'lishi-01', front: '《史记》的作者', back: '司马迁', tags: ['著作'] },
  { id: 'lishi-02', front: '《资治通鉴》的作者', back: '司马光', tags: ['著作'] },
  { id: 'lishi-03', front: '《本草纲目》的作者', back: '李时珍', tags: ['著作'] },
  { id: 'lishi-04', front: '《天工开物》的作者', back: '宋应星', tags: ['著作'] },
  { id: 'lishi-05', front: '《梦溪笔谈》的作者', back: '沈括', tags: ['著作'] },
  { id: 'lishi-06', front: '《齐民要术》的作者', back: '贾思勰', tags: ['著作'] },
  { id: 'lishi-07', front: '《伤寒杂病论》的作者', back: '张仲景', tags: ['著作'] },
  { id: 'lishi-08', front: '《说文解字》的作者', back: '许慎', tags: ['著作'] },
  { id: 'lishi-09', front: '《文心雕龙》的作者', back: '刘勰', tags: ['著作'] },
  { id: 'lishi-10', front: '《三国志》的作者', back: '陈寿', tags: ['著作'] },
  { id: 'lishi-11', front: '《聊斋志异》的作者', back: '蒲松龄', tags: ['著作'] },
  { id: 'lishi-12', front: '《孙子兵法》的作者', back: '孙武', tags: ['著作'] },

  { id: 'lishi-13', front: '我国第一部纪传体通史', back: '《史记》', tags: ['文学'] },
  { id: 'lishi-14', front: '我国第一部诗歌总集', back: '《诗经》', tags: ['文学'] },
  { id: 'lishi-15', front: '四书指的是', back: '《大学》《中庸》《论语》《孟子》', tags: ['文学'] },
  { id: 'lishi-16', front: '五经指的是', back: '《诗经》《尚书》《礼记》《周易》《春秋》', tags: ['文学'] },

  { id: 'lishi-17', front: '商鞅变法发生于哪个国家', back: '秦国', tags: ['变法'] },
  { id: 'lishi-18', front: '王安石变法发生于哪个朝代', back: '北宋', tags: ['变法'] },
  { id: 'lishi-19', front: '戊戌变法发生于哪一年', back: '1898年', tags: ['变法'] },
  { id: 'lishi-20', front: '庆历新政的主持者', back: '范仲淹', tags: ['变法'] },

  { id: 'lishi-21', front: '成语“四面楚歌”与哪位历史人物有关', back: '项羽', tags: ['典故'] },
  { id: 'lishi-22', front: '成语“卧薪尝胆”与哪位历史人物有关', back: '勾践', tags: ['典故'] },
  { id: 'lishi-23', front: '成语“完璧归赵”与哪位历史人物有关', back: '蔺相如', tags: ['典故'] },
  { id: 'lishi-24', front: '成语“纸上谈兵”与哪位历史人物有关', back: '赵括', tags: ['典故'] },
  { id: 'lishi-25', front: '成语“草木皆兵”出自哪场战役', back: '淝水之战', tags: ['典故'] },
  { id: 'lishi-26', front: '成语“指鹿为马”与哪位历史人物有关', back: '赵高', tags: ['典故'] },
  { id: 'lishi-27', front: '成语“退避三舍”与哪位历史人物有关', back: '晋文公', tags: ['典故'] },

  { id: 'lishi-28', front: '玄武门之变后即位的是', back: '唐太宗李世民', tags: ['事件'] },
  { id: 'lishi-29', front: '陈桥兵变后建立北宋的是', back: '赵匡胤', tags: ['事件'] },
  { id: 'lishi-30', front: '行省制度创立于哪个朝代', back: '元朝', tags: ['制度'] },
  { id: 'lishi-31', front: '科举制创立于哪个朝代', back: '隋朝', tags: ['制度'] },

  { id: 'lishi-32', front: '被誉为“诗圣”的唐代诗人', back: '杜甫', tags: ['人物'] },
  { id: 'lishi-33', front: '被誉为“书圣”的东晋书法家', back: '王羲之', tags: ['人物'] },
  { id: 'lishi-34', front: '被后世尊为“药王”的唐代医学家', back: '孙思邈', tags: ['人物'] },

  // ── 2026-09 内容补充（考公高频；id 只增不改，追加在尾）──────────────
  // 注意：back 全科唯一是硬约束（反向题不能歧义），因此「破釜沉舟 → 项羽」
  // 「医圣 → 张仲景」这类与既有 back 撞车的条目刻意不收。
  { id: 'lishi-35', front: '《红楼梦》的作者', back: '曹雪芹', tags: ['著作'] },
  { id: 'lishi-36', front: '《三国演义》的作者', back: '罗贯中', tags: ['著作'] },
  { id: 'lishi-37', front: '《水浒传》的作者', back: '施耐庵', tags: ['著作'] },
  { id: 'lishi-38', front: '《西游记》的作者', back: '吴承恩', tags: ['著作'] },
  { id: 'lishi-39', front: '我国第一部编年体通史', back: '《资治通鉴》', tags: ['文学'] },
  { id: 'lishi-40', front: '成语“负荆请罪”与哪位历史人物有关', back: '廉颇', tags: ['典故'] },
  { id: 'lishi-41', front: '成语“望梅止渴”与哪位历史人物有关', back: '曹操', tags: ['典故'] },
  { id: 'lishi-42', front: '成语“背水一战”与哪位历史人物有关', back: '韩信', tags: ['典故'] },
  { id: 'lishi-43', front: '成语“乐不思蜀”与哪位历史人物有关', back: '刘禅', tags: ['典故'] },
  { id: 'lishi-44', front: '成语“单刀赴会”与哪位历史人物有关', back: '关羽', tags: ['典故'] },
  { id: 'lishi-45', front: '成语“闻鸡起舞”与哪位历史人物有关', back: '祖逖', tags: ['典故'] },
  { id: 'lishi-46', front: '被誉为“诗仙”的唐代诗人', back: '李白', tags: ['人物'] },
  { id: 'lishi-47', front: '被誉为“画圣”的唐代画家', back: '吴道子', tags: ['人物'] },
  { id: 'lishi-48', front: '被后世尊为“茶圣”的唐代茶学家', back: '陆羽', tags: ['人物'] },
  { id: 'lishi-49', front: '内阁制度设立于哪个朝代', back: '明朝', tags: ['制度'] },

  // ── 2026-09 二轮补充（考公高频；id 只增不改，追加在尾）──────────────
  { id: 'lishi-50', front: '记录孔子及其弟子言行的著作', back: '《论语》', tags: ['著作'] },
  { id: 'lishi-51', front: '相传由孔子修订的编年体史书', back: '《春秋》', tags: ['著作'] },
  { id: 'lishi-52', front: '《汉书》的作者', back: '班固', tags: ['著作'] },
  { id: 'lishi-53', front: '我国第一部纪传体断代史', back: '《汉书》', tags: ['著作'] },
  { id: 'lishi-54', front: '《农政全书》的作者', back: '徐光启', tags: ['著作'] },
  { id: 'lishi-55', front: '《窦娥冤》的作者', back: '关汉卿', tags: ['著作'] },
  { id: 'lishi-56', front: '《诗经》的“六义”', back: '风、雅、颂、赋、比、兴', tags: ['文学'] },
  { id: 'lishi-57', front: '成语“围魏救赵”与哪位军事家有关', back: '孙膑', tags: ['典故'] },
  { id: 'lishi-58', front: '成语“图穷匕见”与哪位历史人物有关', back: '荆轲', tags: ['典故'] },
  { id: 'lishi-59', front: '成语“画龙点睛”与哪位画家有关', back: '张僧繇', tags: ['典故'] },
  { id: 'lishi-60', front: '“胡服骑射”是哪位君主推行的改革', back: '赵武灵王', tags: ['变法'] },
  { id: 'lishi-61', front: '张骞出使西域发生在哪个朝代', back: '西汉', tags: ['事件'] },
  { id: 'lishi-62', front: '被誉为“诗佛”的唐代诗人', back: '王维', tags: ['人物'] },
  { id: 'lishi-63', front: '被誉为“诗鬼”的唐代诗人', back: '李贺', tags: ['人物'] },
  { id: 'lishi-64', front: '被誉为“诗魔”的唐代诗人', back: '白居易', tags: ['人物'] },
  { id: 'lishi-65', front: '发明地动仪的东汉科学家', back: '张衡', tags: ['人物'] },
  { id: 'lishi-66', front: '古代科举考试中级别最高的一级', back: '殿试', tags: ['制度'] }
]);
