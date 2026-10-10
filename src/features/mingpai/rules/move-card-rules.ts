/**
 * PubGsCMoveCard 移牌规则：忽略无效移动、展示性同区移动、整手转移与牌堆位重映射。
 */

import { DRAW_PILE_POSITION } from './reveal-types.ts';

/**
 * PubGsCMoveCard 纠偏规则。
 * 只在明牌控制器内使用；牌堆记录 / 弃牌统计仍吃原始事件，互不影响。
 */

const DRAW_PILE_ZONE = 1;
const IGNORED_TO_ZONE = 11;
const UNTRACKED_DRAW_PILE_CARD_IDS = new Set([4400, 4401]);

export interface MoveCardFields {
  cardCount: number;
  cardIds: readonly number[];
  fromId: number;
  fromZone: number;
  fromPosition: number;
  toId: number;
  toZone: number;
  toPosition: number;
  moveType: number;
  spellId: number;
}

/** 原版对 ToZone=11 的移动整条忽略。 */
export function isIgnoredMove(move: Readonly<MoveCardFields>): boolean {
  return move.toZone === IGNORED_TO_ZONE;
}

/**
 * 个别技能的 CardIDs 带额外前缀，先还原成 cardCount 张。
 * 713 / MoveType 21：[index, ...ids]，去掉 index 本身和 ids[index]。
 */
export function normalizeMoveCardIds(move: Readonly<MoveCardFields>): number[] {
  const ids = [...move.cardIds];
  if (move.spellId === 713 && move.moveType === 21 && move.cardCount === ids.length - 2) {
    const index = ids.splice(0, 1)[0];
    ids.splice(index, 1);
  }
  return ids;
}

/**
 * 半透明 CardIDs：已知数量既不是 0 也不等于 cardCount 时，
 * 协议里的卡号不可信，按原版整组视为暗牌。
 */
export function sanitizeMoveCardIds(cardCount: number, cardIds: readonly number[]): number[] {
  const count = Math.max(0, cardCount);
  const known = cardIds.filter((cardId) => cardId > 0).length;
  if (known !== 0 && known !== count) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, index) => (cardIds[index] > 0 ? cardIds[index] : 0));
}

export interface DrawPileRuleContext {
  nationWar: boolean;
  /** 读不到牌面时返回 0，此时不能套用依赖牌类型的纠偏。 */
  cardType: (cardId: number) => number;
}

/**
 * 离开牌堆且 FromPosition 未指定时的顶 / 底纠偏表。
 * 新技能需要纠偏时在这里加一条 { match, position }。
 */
const DRAW_PILE_FROM_RULES: ReadonlyArray<{
  match: (move: Readonly<MoveCardFields>, context: DrawPileRuleContext) => boolean;
  position: number;
}> = [
  { match: (m) => [3208, 7011, 987, 988, 3903].includes(m.spellId), position: DRAW_PILE_POSITION.TOP },
  /** 3746 智绝（阳）：牌堆顶一张当【火攻】。 */
  { match: (m) => m.spellId === 3746 && m.cardCount === 1 && m.toZone === 3, position: DRAW_PILE_POSITION.TOP },
  /** 3776：牌堆底三张进技能区。 */
  {
    match: (m) => m.spellId === 3776 && m.toZone === 10 && m.cardCount === 3,
    position: DRAW_PILE_POSITION.BOTTOM
  },
  { match: (m) => m.moveType === 13 && m.cardCount === 1, position: DRAW_PILE_POSITION.TOP },
  {
    match: (m) => m.spellId === 795 && m.toZone === 4 && m.moveType === 8 && m.cardCount === 1,
    position: DRAW_PILE_POSITION.TOP
  },
  {
    match: (m) => m.spellId === 3101 && m.toZone === 5 && m.cardCount === 1,
    position: DRAW_PILE_POSITION.BOTTOM
  },
  {
    // 原版这两条只在非国战生效。
    match: (m, context) => !context.nationWar && [7016, 7017].includes(m.spellId) && m.toZone === 5 && m.cardCount === 1,
    position: DRAW_PILE_POSITION.TOP
  }
];

/**
 * 原版：FromPosition = 顶+1、一次进手牌 4 张且全是类型 8（延时类）时，
 * 这些牌不是从已知顶/底顺次抽走，位置按未指定处理，避免把牌堆顺序挤错。
 */
function isUnspecifiedDelayedDraw(move: Readonly<MoveCardFields>, cardType: (cardId: number) => number): boolean {
  return move.fromPosition === DRAW_PILE_POSITION.TOP + 1
    && move.toZone === 5
    && move.spellId === 0
    && move.moveType === 1
    && move.cardCount === 4
    && move.cardIds.length >= 4
    && move.cardIds.slice(0, 4).every((cardId) => cardId > 0 && cardType(cardId) === 8);
}

/** 移牌起点在牌堆时，把位置改成顶、底或未指定。 */
export function remapDrawPileFromPosition(
  move: Readonly<MoveCardFields>,
  options: { nationWar?: boolean; cardType?: (cardId: number) => number } = {}
): number {
  if (move.fromZone !== DRAW_PILE_ZONE) return move.fromPosition;
  const cardType = options.cardType ?? (() => 0);
  if (isUnspecifiedDelayedDraw(move, cardType)) return DRAW_PILE_POSITION.UNSPECIFIED;
  if (move.fromPosition !== DRAW_PILE_POSITION.UNSPECIFIED) return move.fromPosition;
  const context: DrawPileRuleContext = { nationWar: options.nationWar === true, cardType };
  return DRAW_PILE_FROM_RULES.find((rule) => rule.match(move, context))?.position ?? move.fromPosition;
}

/** 整手交出手牌的技能（605 密诏）：暗牌移动时该座位已知牌全部随之离开。 */
const WHOLE_HAND_MOVE_SPELL_IDS = new Set([605]);

/** 这次移动是不是整手牌一起离开。 */
export function isWholeHandMove(move: Readonly<Pick<MoveCardFields, 'spellId' | 'fromZone'>>): boolean {
  return WHOLE_HAND_MOVE_SPELL_IDS.has(move.spellId) && move.fromZone === 5;
}

/** 放回牌堆顶但含不可追踪卡号（4400/4401）时，按位置未指定处理。 */
export function remapDrawPileToPosition(move: Readonly<MoveCardFields>): number {
  if (
    move.toZone === DRAW_PILE_ZONE
    && move.toId === 0xff
    && move.toPosition === DRAW_PILE_POSITION.TOP
    && move.cardIds.some((cardId) => UNTRACKED_DRAW_PILE_CARD_IDS.has(cardId))
  ) {
    return DRAW_PILE_POSITION.UNSPECIFIED;
  }
  return move.toPosition;
}

/** 同区同主人的「移动」多数是展示而非真实换位；个别技能例外需真实重排。 */
const SAME_ZONE_NOT_SHOW = [
  (m: Readonly<MoveCardFields>) => m.spellId === 7011 && m.moveType === 19,
  (m: Readonly<MoveCardFields>) => m.spellId === 3744 && m.moveType === 21
];

/** 牌没有换区，只是在原地被展示。 */
export function isSameZoneShow(move: Readonly<MoveCardFields>): boolean {
  if (move.fromZone !== move.toZone || move.fromId !== move.toId) return false;
  if (!move.cardIds.some((cardId) => cardId > 0)) return false;
  return !SAME_ZONE_NOT_SHOW.some((excluded) => excluded(move));
}
