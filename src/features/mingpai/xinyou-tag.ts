/** 谢灵毓「心幽」：只给她通过该技能拿到手的牌打标签。 */

export const XINYOU_TAG = '心幽';
const HAND_ZONE = 5;
/** GsCGamephaseNtf.Round：5 是弃牌阶段，更大的值表示弃牌已经结束。 */
const DISCARD_PHASE = 5;

export function xinyouTagExpires(phase: number): boolean {
  return Number.isInteger(phase) && phase > DISCARD_PHASE;
}

export function isXinyouCardGain(input: {
  spellMatched: boolean;
  toZone: number;
  toId: number;
  srcSeatId: number | null;
  casterSeatId: number | null;
}): boolean {
  if (!input.spellMatched || input.toZone !== HAND_ZONE) return false;
  if (input.casterSeatId !== null) return input.toId === input.casterSeatId;
  return input.srcSeatId === null || input.srcSeatId === input.toId;
}
