/**
 * 权变花色序列：按本回合用牌累积花色与点数，供技能辅助面板展示。
 */

import type { GameCardCatalog } from '../cards/game-card-catalog.ts';

/** 权变花色序列：按本回合已用牌累积花色与点数。 */
export function cardIdToSuitToken(
  cardId: number,
  gameCardCatalog: GameCardCatalog
): string {
  const card = gameCardCatalog.resolve(cardId);
  if (!card.suitGlyph && !card.rank) return '';
  return `${card.suitGlyph || ''}${card.rank || ''}`;
}

export function appendSuitToken(existing: readonly string[], token: string): string[] {
  const normalized = String(token || '').trim();
  if (!normalized) return [...existing];
  return [...existing, normalized];
}

export function parseSuitToken(token: string): {
  glyph: string;
  rank: string;
  suitClass: string;
  isRed: boolean;
} {
  const match = String(token || '').match(/^([♥♦♠♣])(.*)$/);
  if (!match) {
    return { glyph: '', rank: token, suitClass: '', isRed: false };
  }
  const glyph = match[1];
  return {
    glyph,
    rank: match[2] || '',
    suitClass: glyph === '♥'
      ? 'suit-heart'
      : glyph === '♦'
        ? 'suit-diamond'
        : glyph === '♠'
          ? 'suit-spade'
          : glyph === '♣'
            ? 'suit-club'
            : '',
    isRed: glyph === '♥' || glyph === '♦'
  };
}
