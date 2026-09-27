import type { GameCardCatalog } from '../cards/game-card-catalog.ts';
import { partitionCandidatesByKnownFaces } from '../mingpai/mingpai-queries.ts';
import { MINGPAI_ZONE } from '../mingpai/mingpai-zones.ts';

export const YANXI_SKILL_IDS = Object.freeze([0x1b68, 0x1b69] as const);
/** @deprecated 使用 MINGPAI_ZONE.YANXI */
export const SHOWN_CARD_ZONE_YANXI = MINGPAI_ZONE.YANXI;

export type YanxiLocation = 'hand' | 'deck';

export interface YanxiCardLine {
  cardId: number;
  name: string;
  locations: readonly YanxiLocation[];
  highlight: boolean;
}

export interface YanxiInference {
  candidateIds: readonly number[];
  handCardIds: readonly number[];
  deckCardIds: readonly number[];
  unknown: boolean;
  summaryNames: readonly string[];
  lines: readonly YanxiCardLine[];
  resultText: string;
}

/**
 * 宴戏结果文案：分区求交交给 mingpai-queries，这里只负责格式化。
 * 不在技能里维护牌位置真相。
 */
export function formatYanxiResult(input: {
  candidateIds: readonly number[];
  handCardIds: readonly number[];
  deckCardIds: readonly number[];
  gameCardCatalog: GameCardCatalog;
}): YanxiInference {
  const candidates = uniquePositive(input.candidateIds);
  const { handCardIds, deckCardIds } = partitionCandidatesByKnownFaces(input);
  const confirmedHand = handCardIds.length === 1 || handCardIds.length === 2;
  const summaryNames = confirmedHand
    ? handCardIds.map((cardId) => resolveCardName(cardId, input.gameCardCatalog))
    : [];
  const unknown = !confirmedHand;

  const lines: YanxiCardLine[] = candidates.map((cardId) => {
    const locations: YanxiLocation[] = [];
    if (handCardIds.includes(cardId)) locations.push('hand');
    if (deckCardIds.includes(cardId)) locations.push('deck');
    return {
      cardId,
      name: resolveCardName(cardId, input.gameCardCatalog),
      locations: Object.freeze(locations),
      highlight: confirmedHand && handCardIds.includes(cardId) && handCardIds.length < 3
    };
  });

  const locationLabel: Record<YanxiLocation, string> = {
    hand: '手牌',
    deck: '牌堆'
  };
  const header = unknown
    ? '【宴戏】未知'
    : `【宴戏】${summaryNames.join('/')}`;
  const body = lines.map((line) => {
    const locs = line.locations.map((location) => locationLabel[location]).join('/');
    return `${line.name}：${locs || '未知'}`;
  });

  return {
    candidateIds: Object.freeze(candidates),
    handCardIds: Object.freeze(handCardIds),
    deckCardIds: Object.freeze(deckCardIds),
    unknown,
    summaryNames: Object.freeze(summaryNames),
    lines: Object.freeze(lines),
    resultText: [header, ...body].join('\n')
  };
}

/** @deprecated 使用 formatYanxiResult */
export const inferYanxi = formatYanxiResult;

export function isYanxiSpellId(spellId: number): boolean {
  return YANXI_SKILL_IDS.includes(spellId as (typeof YANXI_SKILL_IDS)[number]);
}

function resolveCardName(cardId: number, catalog: GameCardCatalog): string {
  return catalog.resolve(cardId).name || `牌${cardId}`;
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
