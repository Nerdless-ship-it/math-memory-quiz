// 选择题干扰项生成 —— 契约 docs/ARCHITECTURE.md 第 5 节。
//
//   buildChoices(item, direction, pool, options) → { choices: string[], answerIndex: number }
//
// 纯函数：不碰 DOM、不读写 localStorage（契约第 8 节第 6 条），random 可注入以便确定性测试。
//
// 下面每条规则都对应一个会真实出错的地方，不是纸面洁癖：
//
//   1. 干扰项必须与正确答案「同类」——正向题的答案是 back，干扰项就只从其它条目的 back 里取；
//      反向题的答案是 front，就只从其它条目的 front 里取。方向与取字段是绑定的，不能混用。
//
//   2. 干扰项不得等于正确答案，**也不得等于题面提示**。
//      ⚠️ 这是最容易漏掉的一条。shengxiao / jieqi / chaodai / huaxue 里，同一段文字
//      既可能是某条的 front（题面），又是另一条的 back（其它题的答案）：
//        chaodai-04  front='秦'  back='秦始皇嬴政'   ← 出正向题：题面「秦」
//        chaodai-19  front='咸阳' back='秦'          ← 「秦」在这里是 back
//      出 chaodai-04 的正向题时，若只排除「等于正确答案」的候选，
//      「秦」会被当成合法干扰项选进来——它确实不等于正确答案，
//      却与题面一字不差，用户看到的就是「秦 = 秦」这种荒谬选项。
//      huaxue 同理：front='氢' back='H' 与 front='H' back='氢' 互为交叉。
//      所以候选值必须同时与答案、与题面做同义判断。
//
//   3. 去重按 normalizeText 而不是字符串相等：'1.7' 与 '1.7 ' 是同一个选项，
//      两者同时出现等于把一道题变成送分题。
//
//   4. 池子不足时**减量**（少给几个选项），绝不重复填充凑数：重复选项会让题目无解。
//      选项数下限是 2（1 个正确答案 + 1 个干扰项）；连 2 个都凑不齐时由调用方降级为填空。
//
//   5. 同科目的 tags 相同的条目优先，保证干扰项难度同构；同 tags 不够再从全池补齐。
//      tags 缺失的科目直接走全池。

import { normalizeText } from './adapters/generic.js';
import { shuffle } from './quiz.js';

/** 默认每题 4 个选项（与 storage.js 的 DEFAULT_PREFS.choicesPerQuestion 一致）。 */
export const DEFAULT_CHOICES_PER_QUESTION = 4;
/** 选项数下限：正确答案 + 至少 1 个干扰项，否则不成其为选择题。 */
export const MIN_CHOICES = 2;
/** 选项数上限：再多既超出屏幕，也不再考察记忆。 */
export const MAX_CHOICES = 8;

/** 该方向下「答案」所在的字段；干扰项也从同一个字段里取。 */
export function choiceField(direction) {
  return direction === 'backward' ? 'front' : 'back';
}

/** 题面提示：正向用 front，反向用 back（与 adapters/generic.js 的 promptOf 同义）。 */
export function promptOf(item, direction) {
  return direction === 'backward' ? item?.back : item?.front;
}

/** 正确答案：正向用 back，反向用 front。 */
export function answerOf(item, direction) {
  return direction === 'backward' ? item?.front : item?.back;
}

/** 把选项数夹到 [MIN_CHOICES, MAX_CHOICES]；非法值回退 fallback。 */
export function normalizeChoicesPerQuestion(value, fallback = DEFAULT_CHOICES_PER_QUESTION) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_CHOICES, Math.max(MIN_CHOICES, number));
}

/**
 * 生成一道选择题的选项。
 *
 * @param {object} item      当前条目 { id, front, back, tags? }
 * @param {string} direction 'forward'（题面 front、答案 back）| 'backward'（题面 back、答案 front）
 * @param {object[]} pool    候选条目池（通常是全科目题库；错题重练时应传全库以便补齐）
 * @param {object} [options]
 * @param {number} [options.choicesPerQuestion=4] 选项总数，夹到 2..8
 * @param {Function} [options.random=Math.random] 可注入的随机源
 * @param {string} [options.prompt] 题面覆盖（适配器自定义题面时用）
 * @param {string} [options.answer] 正确答案覆盖（适配器自定义答案时用）
 * @returns {{choices: string[], answerIndex: number}}
 *          选项乱序后的数组与正确项下标；答案为空串时返回 { choices: [], answerIndex: -1 }。
 *          choices.length 可能小于 choicesPerQuestion（池子不足时减量），但绝不会重复。
 */
export function buildChoices(item, direction, pool, options = {}) {
  const field = choiceField(direction);
  const limit = normalizeChoicesPerQuestion(options.choicesPerQuestion);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const answerText = String(options.answer ?? answerOf(item, direction) ?? '').trim();
  const promptText = String(options.prompt ?? promptOf(item, direction) ?? '').trim();

  const answerKey = normalizeText(answerText);
  // 没有答案就没有选择题可言，交给调用方降级。
  if (!answerKey) return { choices: [], answerIndex: -1 };

  // blocked 同时承担「排除答案」「排除题面」「去重」三件事：
  // 命中过的 key 不再进入候选，于是每个文本只会出现一次。
  const blocked = new Set([answerKey]);
  const promptKey = normalizeText(promptText);
  if (promptKey) blocked.add(promptKey);

  const ownTags = Array.isArray(item?.tags) ? item.tags.filter(Boolean) : [];
  const ownId = item?.id === undefined || item?.id === null ? null : String(item.id);
  const sameTags = [];
  const others = [];

  for (const candidate of Array.isArray(pool) ? pool : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (candidate === item) continue;
    // 同 id 视为条目自身，不能拿自己的另一面当干扰项。
    if (ownId !== null && candidate.id !== undefined && candidate.id !== null
      && String(candidate.id) === ownId) continue;
    const value = candidate[field];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;
    const key = normalizeText(text);
    if (!key || blocked.has(key)) continue;
    blocked.add(key);
    const shared = ownTags.length > 0
      && Array.isArray(candidate.tags)
      && candidate.tags.some((tag) => ownTags.includes(tag));
    (shared ? sameTags : others).push(text);
  }

  const needed = limit - 1;
  const distractors = [];
  // 先同 tags，再全池；两组都用 Fisher-Yates 洗过，顺序不偏向题库书写顺序。
  for (const group of [sameTags, others]) {
    if (distractors.length >= needed) break;
    for (const text of shuffle(group, random)) {
      if (distractors.length >= needed) break;
      distractors.push(text);
    }
  }

  const choices = shuffle([answerText, ...distractors], random);
  let answerIndex = choices.indexOf(answerText);
  if (answerIndex < 0) {
    answerIndex = choices.findIndex((choice) => normalizeText(choice) === answerKey);
  }
  return { choices, answerIndex };
}

export default { buildChoices, choiceField, promptOf, answerOf, normalizeChoicesPerQuestion };
