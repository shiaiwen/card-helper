/**
 * 明牌查询：按引擎归属把候选牌分为手牌/牌堆，供宴戏等面板求交。
 */

import { formatZoneId, type MingpaiEngine } from './mingpai-engine.ts';
import { MINGPAI_ZONE } from './mingpai-zones.ts';

const HAND_ZONE = 5;
const DRAW_PILE_ZONE = 1;
const GLOBAL_OWNER = 0xff;

/**
 * 用明牌引擎按卡号查找归属，把候选牌分成「手牌」与「牌堆」两组（宴戏面板求交用）。
 */
export function partitionCandidatesByMingpai(
  engine: MingpaiEngine,
  candidateIds: readonly number[]
): {
  handCardIds: number[];
  deckCardIds: number[];
} {
  const handZonePrefix = `${HAND_ZONE}-`;
  const deckZoneId = formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE);
  const handCardIds: number[] = [];
  const deckCardIds: number[] = [];

  for (const cardId of uniquePositive(candidateIds)) {
    const { zones } = engine.findKZ(cardId);
    const inHand = zones.some((zone) => zone.startsWith(handZonePrefix));
    const inDeck = zones.includes(deckZoneId)
      || zones.some((zone) => zone.startsWith(`${DRAW_PILE_ZONE}-`));
    if (inHand) handCardIds.push(cardId);
    if (inDeck) deckCardIds.push(cardId);
  }

  // 原版归约
  let hand = handCardIds;
  let deck = deckCardIds;
  const candidates = uniquePositive(candidateIds);
  if (deck.length === 2) {
    hand = candidates.filter((id) => !deck.includes(id));
  } else if (hand.length === 1) {
    deck = candidates.filter((id) => !hand.includes(id));
  }
  return { handCardIds: hand, deckCardIds: deck };
}

/** 兼容旧签名：显式传入已知面 ID 集合。 */
export function partitionCandidatesByKnownFaces(input: {
  candidateIds: readonly number[];
  handCardIds: readonly number[];
  deckCardIds: readonly number[];
}): {
  handCardIds: number[];
  deckCardIds: number[];
} {
  const candidates = uniquePositive(input.candidateIds);
  const handSet = new Set(uniquePositive(input.handCardIds));
  const deckSet = new Set(uniquePositive(input.deckCardIds));
  let handCardIds = candidates.filter((cardId) => handSet.has(cardId));
  let deckCardIds = candidates.filter((cardId) => deckSet.has(cardId));
  if (deckCardIds.length === 2) {
    handCardIds = candidates.filter((cardId) => !deckCardIds.includes(cardId));
  } else if (handCardIds.length === 1) {
    deckCardIds = candidates.filter((cardId) => !handCardIds.includes(cardId));
  }
  return { handCardIds, deckCardIds };
}

export function collectHandAndDeckFaces(engine: MingpaiEngine): {
  handCardIds: number[];
  deckCardIds: number[];
} {
  const snapshot = engine.getSnapshot();
  const handCardIds: number[] = [];
  const deckCardIds: number[] = [];
  for (const [zoneId, cardIds] of Object.entries(snapshot.zones)) {
    if (zoneId.startsWith(`${HAND_ZONE}-`)) handCardIds.push(...cardIds);
    if (zoneId.startsWith(`${DRAW_PILE_ZONE}-`) || zoneId === formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE)) {
      deckCardIds.push(...cardIds);
    }
  }
  // 也并入引擎便捷 API
  deckCardIds.push(...engine.getDrawPileCardIds());
  return {
    handCardIds: uniquePositive(handCardIds),
    deckCardIds: uniquePositive(deckCardIds)
  };
}

function uniquePositive(cardIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const raw of cardIds) {
    const cardId = Number(raw);
    if (!Number.isInteger(cardId) || cardId <= 0 || seen.has(cardId)) continue;
    seen.add(cardId);
    result.push(cardId);
  }
  return result;
}

export { MINGPAI_ZONE };
