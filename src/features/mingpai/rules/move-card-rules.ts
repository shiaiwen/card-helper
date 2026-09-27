import { DRAW_PILE_POSITION } from './reveal-types.ts';

/**
 * PubGsCMoveCard 纠偏规则（对照 app.bak 约 45735–46101）。
 * 只在明牌控制器内使用；牌堆记录 / 弃牌统计仍吃原始事件，互不影响。
 */

const DRAW_PILE_ZONE = 1;

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

/**
 * 离开牌堆且 FromPosition 未指定时的顶 / 底纠偏表。
 * 新技能需要纠偏时在这里加一条 { match, position }。
 */
const DRAW_PILE_FROM_RULES: ReadonlyArray<{
  match: (move: Readonly<MoveCardFields>) => boolean;
  position: number;
}> = [
  { match: (m) => [3208, 7011, 987, 988, 3903].includes(m.spellId), position: DRAW_PILE_POSITION.TOP },
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
    match: (m) => [7016, 7017].includes(m.spellId) && m.toZone === 5 && m.cardCount === 1,
    position: DRAW_PILE_POSITION.TOP
  }
];

export function remapDrawPileFromPosition(move: Readonly<MoveCardFields>): number {
  if (move.fromZone !== DRAW_PILE_ZONE || move.fromPosition !== DRAW_PILE_POSITION.UNSPECIFIED) {
    return move.fromPosition;
  }
  return DRAW_PILE_FROM_RULES.find((rule) => rule.match(move))?.position ?? move.fromPosition;
}

/** 同区同主人的「移动」其实是展示（对照原版 KY.show），排除个别真实重排。 */
const SAME_ZONE_NOT_SHOW = [
  (m: Readonly<MoveCardFields>) => m.spellId === 7011 && m.moveType === 19,
  (m: Readonly<MoveCardFields>) => m.spellId === 3744 && m.moveType === 21
];

export function isSameZoneShow(move: Readonly<MoveCardFields>): boolean {
  if (move.fromZone !== move.toZone || move.fromId !== move.toId) return false;
  if (!move.cardIds.some((cardId) => cardId > 0)) return false;
  return !SAME_ZONE_NOT_SHOW.some((excluded) => excluded(move));
}
