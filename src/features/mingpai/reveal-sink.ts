import type { SeatStateStore } from '../seat-display/seat-state-store.ts';
import type { MingpaiEngine } from './mingpai-engine.ts';
import { MINGPAI_ZONE } from './mingpai-zones.ts';
import { DRAW_PILE_POSITION, type CardReveal } from './rules/reveal-types.ts';
import { traceMingpai } from '../../runtime/mingpai-trace.ts';

/**
 * 唯一的「鉴定」写入口，对照 app.bak `nb.show`。
 * OptTarget / SpellOptRep / 同区展示 / 好友手牌都汇到这里，
 * 保证引擎分区与座位明牌条永远同步。
 */
export function applyCardReveals(
  reveals: readonly CardReveal[],
  engine: MingpaiEngine,
  seatStateStore: SeatStateStore,
  source = 'unknown'
): void {
  for (const reveal of reveals) {
    if (!reveal.cardIds.length) continue;
    traceMingpai('reveal', { source, ...reveal, cardIds: [...reveal.cardIds] });
    if (reveal.zone === 'hand') {
      reveal.cardIds.forEach((cardId) => engine.observeKnownHandCard(cardId, reveal.ownerId, []));
      if (reveal.partial) seatStateStore.mergeKnownHand(reveal.ownerId, reveal.cardIds);
      else seatStateStore.revealKnownHand(reveal.ownerId, reveal.cardIds);
    } else {
      engine.observeKnownDrawPileCards(reveal.cardIds, toDrawPilePosition(reveal.position));
    }
    if (reveal.packUnknown) engine.addZoneCardIds(MINGPAI_ZONE.UNKNOWN, reveal.cardIds);
  }
}

function toDrawPilePosition(position: CardReveal['position']): number {
  if (position === 'top') return DRAW_PILE_POSITION.TOP;
  if (position === 'bottom') return DRAW_PILE_POSITION.BOTTOM;
  return DRAW_PILE_POSITION.UNSPECIFIED;
}
