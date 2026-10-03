/** 权御技能 ID（对照 app.bak Ve）。 */
export const QUANYU_SKILL_ID = 3793;

/** 权御增益位文案（对照 app.bak VP）；bit0 不用，从 bit1 起对应。 */
export const QUANYU_BUFF_LABELS = Object.freeze([
  '伤害+1',
  '目标+1',
  '无视防具',
  '不可响应',
  '额外结算',
  '无次数'
]);

type UnknownRecord = Record<string, unknown>;

/**
 * 对照 app.bak Vk：座位持有权御且 GetSeatState 为真时，
 * 用 GetSkillBuffInfo 的 bitmask 拼出多行增益文案。
 */
export function formatQuanyuTipText(seat: unknown): string {
  const record = asRecord(seat);
  if (!record) return '';
  const getBuff = record.GetSkillBuffInfo;
  const getState = record.GetSeatState;
  if (typeof getBuff !== 'function' || typeof getState !== 'function') return '';
  let buffInfo: unknown;
  let hasState = false;
  try {
    buffInfo = getBuff.call(record, QUANYU_SKILL_ID);
    hasState = Boolean(getState.call(record, QUANYU_SKILL_ID));
  } catch {
    return '';
  }
  if (!hasState) return '';
  const mask = Number(Array.isArray(buffInfo) ? buffInfo[0] : 0) || 0;
  if (!mask) return '';
  return QUANYU_BUFF_LABELS
    .filter((_label, index) => (mask & (1 << (index + 1))) !== 0)
    .join('\n');
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}
