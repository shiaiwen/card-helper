/**
 * 谢灵毓「心幽」标签。
 * 只标记她通过该技能拿到手的牌；本回合弃牌阶段结束后去掉。
 * 她交出去的牌不标记。
 */

export const XINYOU_TAG = '心幽';
const HAND_ZONE = 5;
/** GsCGamephaseNtf.Round：5 是弃牌阶段，更大的值表示弃牌已经结束。 */
const DISCARD_PHASE = 5;

/** 阶段号大于弃牌阶段时，本回合的心幽标记应清除。 */
export function xinyouTagExpires(phase: number): boolean {
  return Number.isInteger(phase) && phase > DISCARD_PHASE;
}

/**
 * 这次移牌是不是心幽获得的手牌。
 * 知道发动者时，只有进入发动者手牌才算；她交给别人的牌不算。
 */
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
