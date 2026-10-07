/**
 * 明牌「鉴定」描述，作为看牌结果的统一输入。
 * 规则层只产出 CardReveal，不直接改状态；统一由 reveal-sink 写入引擎与座位。
 */

export const DRAW_PILE_OWNER = 0xff;

/** 看牌相对牌堆位置：顶 / 底 / 未指定。 */
export const DRAW_PILE_POSITION = Object.freeze({
  TOP: 0xff00,
  BOTTOM: 0,
  UNSPECIFIED: 0xff02
} as const);

export type RevealZone = 'hand' | 'deck';
export type RevealPosition = 'top' | 'bottom' | 'unspecified';

export interface CardReveal {
  zone: RevealZone;
  /** 手牌座位；牌堆固定 0xff。 */
  ownerId: number;
  cardIds: number[];
  position: RevealPosition;
  /**
   * true：只把这些牌并入该座位已知手牌（部分展示）。
   * false：视为完整手牌（攻心类整段看牌）。
   */
  partial: boolean;
  /** 部分技能看牌时同时投影进 unknown 区（供权变等面板使用）。 */
  packUnknown?: boolean;
}

/** GsCRoleOptTargetNtf 解析后的规则输入。 */
export interface OptTargetContext {
  spellId: number;
  param: number;
  /** 原始 Params（保留 0 与前缀计数，不要预先过滤）。 */
  params: readonly number[];
  srcSeatId: number | null;
  targetSeatId: number | null;
  /** 施法者是否本家 / 受控座位；私有看牌堆必须为 true。 */
  isSelfSrc: boolean;
}

/** CGsRoleSpellOptRep 解析后的规则输入。 */
export interface SpellOptRepContext {
  spellId: number;
  optType: number;
  seatId: number;
  datas: readonly number[];
  isSelfSeat: boolean;
}

export type OptTargetRule = (ctx: Readonly<OptTargetContext>) => CardReveal[];
export type SpellOptRepRule = (ctx: Readonly<SpellOptRepContext>) => CardReveal[];

/** 留下大于 0 的牌号。 */
export function positiveIds(values: readonly number[]): number[] {
  return values.filter((value) => Number.isInteger(value) && value > 0);
}

/** 编号是不是有效座位。 */
export function isSeat(seatId: number | null | undefined): seatId is number {
  return typeof seatId === 'number' && Number.isInteger(seatId) && seatId >= 0 && seatId < 0xff;
}

/** 组装一次手牌公开结果。 */
export function handReveal(ownerId: number, cardIds: number[], partial: boolean): CardReveal[] {
  const ids = positiveIds(cardIds);
  return ids.length ? [{ zone: 'hand', ownerId, cardIds: ids, position: 'unspecified', partial }] : [];
}

/** 组装一次牌堆公开结果。 */
export function deckReveal(
  cardIds: number[],
  position: RevealPosition,
  packUnknown = false
): CardReveal[] {
  const ids = positiveIds(cardIds);
  return ids.length
    ? [{
        zone: 'deck',
        ownerId: DRAW_PILE_OWNER,
        cardIds: ids,
        position,
        partial: true,
        ...(packUnknown ? { packUnknown: true } : {})
      }]
    : [];
}
