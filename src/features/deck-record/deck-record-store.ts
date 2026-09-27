import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';

export interface CardMovementRecord {
  sequence: number;
  cardCount: number;
  cardIds: number[];
  fromId: number;
  fromZone: number;
  fromPosition: number;
  fromZoneParam: number;
  toId: number;
  toZone: number;
  toPosition: number;
  toZoneParam: number;
  moveType: number;
}

interface TurnTaggedCard {
  cardId: number;
  turnCount: number;
  round: number;
}

export interface DeckRecordSnapshot {
  movements: CardMovementRecord[];
  discardCardIds: number[];
  hiddenDiscardCount: number;
  currentTurnDiscardCardIds: number[];
  currentTurnHiddenDiscardCount: number;
  currentTurnCount: number;
  currentRound: number;
  /** 从牌堆顶开始排列；0 表示该位置的牌尚不可见。 */
  deckTopCardIds: number[];
  /** 按靠近牌堆中部到牌堆底排列，最后一张是最底部。 */
  deckBottomCardIds: number[];
}

export interface DeckRecordStore {
  getSnapshot(): Readonly<DeckRecordSnapshot>;
  subscribe(listener: (snapshot: Readonly<DeckRecordSnapshot>) => void): () => void;
  clear(): void;
}

const DRAW_PILE_OWNER_ID = 0xff;
const DRAW_PILE_ZONE = 1;
const DISCARD_ZONE = 2;
const DRAW_PILE_TOP_POSITION = 0xff00;
const DRAW_PILE_BOTTOM_POSITION = 0;
const UNSPECIFIED_POSITION = 0xff02;
const MAX_MOVEMENT_HISTORY = 120;
const MAX_DISCARD_HISTORY = 160;
const PERSISTED_SNAPSHOT_KEY = 'XC::vueDeckRecordSnapshot';
const PERSISTED_SNAPSHOT_MAX_AGE = 3 * 60 * 60 * 1000;

/**
 * 保存原始移动记录并维护可靠的弃牌集合。
 * 本回合弃牌在行动角色切换（TurnCnt / GsCGamephaseNtf Round=0）时清空。
 */
export function createDeckRecordStore(
  gameEvents: GameEventBus,
  storage: Storage | null = getSessionStorage()
): DeckRecordStore {
  const restoredSnapshot = readPersistedSnapshot(storage);
  let keepSnapshotOnFirstGameStart = Boolean(restoredSnapshot);
  let sequence = restoredSnapshot?.movements.at(-1)?.sequence ?? 0;
  let turnCount = 0;
  let round = 0;
  let taggedCurrentTurnDiscards: TurnTaggedCard[] = [];
  let currentTurnHiddenDiscardCount = 0;
  let snapshot = freezeSnapshot(
    restoredSnapshot
      ? {
          ...restoredSnapshot,
          // 本回合弃牌不跨会话恢复，避免刷新后把上回合牌当面值。
          currentTurnDiscardCardIds: [],
          currentTurnHiddenDiscardCount: 0,
          currentTurnCount: 0,
          currentRound: 0
        }
      : createEmptySnapshot()
  );
  const listeners = new Set<(snapshot: Readonly<DeckRecordSnapshot>) => void>();

  const publishFromParts = (parts: {
    movements?: CardMovementRecord[];
    discardCardIds?: number[];
    hiddenDiscardCount?: number;
    deckTopCardIds?: number[];
    deckBottomCardIds?: number[];
  } = {}) => {
    snapshot = freezeSnapshot({
      movements: parts.movements ?? [...snapshot.movements],
      discardCardIds: parts.discardCardIds ?? [...snapshot.discardCardIds],
      hiddenDiscardCount: parts.hiddenDiscardCount ?? snapshot.hiddenDiscardCount,
      currentTurnDiscardCardIds: taggedCurrentTurnDiscards
        .filter((card) => card.turnCount === turnCount && card.round === round)
        .map((card) => card.cardId),
      currentTurnHiddenDiscardCount,
      currentTurnCount: turnCount,
      currentRound: round,
      deckTopCardIds: parts.deckTopCardIds ?? [...snapshot.deckTopCardIds],
      deckBottomCardIds: parts.deckBottomCardIds ?? [...snapshot.deckBottomCardIds]
    });
    persistSnapshot(storage, snapshot);
    listeners.forEach((listener) => listener(snapshot));
  };

  const clearCurrentTurnDiscards = () => {
    taggedCurrentTurnDiscards = [];
    currentTurnHiddenDiscardCount = 0;
  };

  const stopGameEvents = gameEvents.subscribe((event) => {
    if (event.type === 'game-started' && keepSnapshotOnFirstGameStart) {
      keepSnapshotOnFirstGameStart = false;
      return;
    }
    if (event.type === 'game-started' || event.type === 'game-ended') {
      keepSnapshotOnFirstGameStart = false;
      sequence = 0;
      turnCount = 0;
      round = 0;
      clearCurrentTurnDiscards();
      snapshot = freezeSnapshot(createEmptySnapshot());
      persistSnapshot(storage, snapshot);
      listeners.forEach((listener) => listener(snapshot));
      return;
    }
    if (event.type === 'turn-started') {
      // MsgGameTurnNtf：更新大局 TurnCnt 并重置 round。
      // GsCGamephaseNtf(Round=0)：新行动角色开始，round 递增。
      // 两种情况都清空本回合弃牌。
      if (event.turnCount > 0) {
        turnCount = event.turnCount;
        round = 0;
      } else {
        round += 1;
      }
      clearCurrentTurnDiscards();
      publishFromParts();
      return;
    }
    if (event.type !== 'cards-moved') return;
    const movement = createMovementRecord(++sequence, event);
    const discardCardIds = [...snapshot.discardCardIds];
    let hiddenDiscardCount = snapshot.hiddenDiscardCount;
    const deckTopCardIds = [...snapshot.deckTopCardIds];
    const deckBottomCardIds = [...snapshot.deckBottomCardIds];

    if (event.fromId === DRAW_PILE_OWNER_ID && event.fromZone === DRAW_PILE_ZONE) {
      removeCardsFromDrawPile(
        deckTopCardIds,
        deckBottomCardIds,
        event.fromPosition,
        event.cardCount,
        event.cardIds
      );
    }

    if (event.fromId === DRAW_PILE_OWNER_ID && event.fromZone === DISCARD_ZONE) {
      const removedKnownCount = removeKnownCards(discardCardIds, event.cardIds);
      hiddenDiscardCount = Math.max(
        0,
        hiddenDiscardCount - Math.max(0, event.cardCount - removedKnownCount)
      );
      const removedCurrentTurnKnownCount = removeTaggedCards(
        taggedCurrentTurnDiscards,
        event.cardIds,
        turnCount,
        round
      );
      currentTurnHiddenDiscardCount = Math.max(
        0,
        currentTurnHiddenDiscardCount - Math.max(0, event.cardCount - removedCurrentTurnKnownCount)
      );
    }
    if (event.toId === DRAW_PILE_OWNER_ID && event.toZone === DISCARD_ZONE) {
      const knownCardIds = event.cardIds.filter((cardId) => cardId > 0);
      discardCardIds.push(...knownCardIds);
      hiddenDiscardCount += Math.max(0, event.cardCount - knownCardIds.length);
      for (const cardId of knownCardIds) {
        taggedCurrentTurnDiscards.push({ cardId, turnCount, round });
      }
      currentTurnHiddenDiscardCount += Math.max(0, event.cardCount - knownCardIds.length);
      taggedCurrentTurnDiscards = taggedCurrentTurnDiscards.slice(-MAX_DISCARD_HISTORY);
    }
    if (event.toId === DRAW_PILE_OWNER_ID && event.toZone === DRAW_PILE_ZONE) {
      addCardsToDrawPile(
        deckTopCardIds,
        deckBottomCardIds,
        event.toPosition,
        event.cardCount,
        event.cardIds
      );
    }

    publishFromParts({
      movements: [...snapshot.movements, movement].slice(-MAX_MOVEMENT_HISTORY),
      discardCardIds: discardCardIds.slice(-MAX_DISCARD_HISTORY),
      hiddenDiscardCount,
      deckTopCardIds,
      deckBottomCardIds
    });
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    clear() {
      stopGameEvents();
      listeners.clear();
      sequence = 0;
      turnCount = 0;
      round = 0;
      clearCurrentTurnDiscards();
      snapshot = freezeSnapshot(createEmptySnapshot());
      try {
        storage?.removeItem(PERSISTED_SNAPSHOT_KEY);
      } catch {
        // 忽略存储清理失败。
      }
    }
  };
}

function createMovementRecord(
  sequence: number,
  event: Extract<GameEvent, { type: 'cards-moved' }>
): CardMovementRecord {
  return {
    sequence,
    cardCount: event.cardCount,
    cardIds: [...event.cardIds],
    fromId: event.fromId,
    fromZone: event.fromZone,
    fromPosition: event.fromPosition,
    fromZoneParam: event.fromZoneParam,
    toId: event.toId,
    toZone: event.toZone,
    toPosition: event.toPosition,
    toZoneParam: event.toZoneParam,
    moveType: event.moveType
  };
}

function removeKnownCards(discardCardIds: number[], movedCardIds: readonly number[]): number {
  let removedCount = 0;
  for (const cardId of movedCardIds) {
    if (cardId <= 0) continue;
    const index = discardCardIds.lastIndexOf(cardId);
    if (index < 0) continue;
    discardCardIds.splice(index, 1);
    removedCount += 1;
  }
  return removedCount;
}

function removeTaggedCards(
  taggedCards: TurnTaggedCard[],
  movedCardIds: readonly number[],
  turnCount: number,
  round: number
): number {
  let removedCount = 0;
  for (const cardId of movedCardIds) {
    if (cardId <= 0) continue;
    for (let index = taggedCards.length - 1; index >= 0; index -= 1) {
      const card = taggedCards[index];
      if (card.cardId !== cardId || card.turnCount !== turnCount || card.round !== round) continue;
      taggedCards.splice(index, 1);
      removedCount += 1;
      break;
    }
  }
  return removedCount;
}

function freezeSnapshot(snapshot: DeckRecordSnapshot): Readonly<DeckRecordSnapshot> {
  snapshot.movements.forEach((movement) => {
    Object.freeze(movement.cardIds);
    Object.freeze(movement);
  });
  Object.freeze(snapshot.movements);
  Object.freeze(snapshot.discardCardIds);
  Object.freeze(snapshot.currentTurnDiscardCardIds);
  Object.freeze(snapshot.deckTopCardIds);
  Object.freeze(snapshot.deckBottomCardIds);
  return Object.freeze(snapshot);
}

function createEmptySnapshot(): DeckRecordSnapshot {
  return {
    movements: [],
    discardCardIds: [],
    hiddenDiscardCount: 0,
    currentTurnDiscardCardIds: [],
    currentTurnHiddenDiscardCount: 0,
    currentTurnCount: 0,
    currentRound: 0,
    deckTopCardIds: [],
    deckBottomCardIds: []
  };
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function persistSnapshot(storage: Storage | null, snapshot: Readonly<DeckRecordSnapshot>): void {
  if (!storage) return;
  try {
    // 本回合弃牌不落盘，只保留牌堆顶/底与历史弃牌，避免刷新后串回合。
    storage.setItem(PERSISTED_SNAPSHOT_KEY, JSON.stringify({
      savedAt: Date.now(),
      snapshot: {
        ...snapshot,
        currentTurnDiscardCardIds: [],
        currentTurnHiddenDiscardCount: 0
      }
    }));
  } catch {
    // 禁用存储或空间不足不影响牌局内实时记录。
  }
}

function readPersistedSnapshot(storage: Storage | null): DeckRecordSnapshot | null {
  if (!storage) return null;
  try {
    const record = JSON.parse(storage.getItem(PERSISTED_SNAPSHOT_KEY) || 'null');
    if (!record || Date.now() - Number(record.savedAt) > PERSISTED_SNAPSHOT_MAX_AGE) return null;
    const value = record.snapshot;
    if (!value || !Array.isArray(value.movements)) return null;
    return {
      movements: value.movements
        .filter((movement: unknown) => movement && typeof movement === 'object')
        .slice(-MAX_MOVEMENT_HISTORY)
        .map((movement: CardMovementRecord) => ({
          sequence: nonNegativeInteger(movement.sequence),
          cardCount: nonNegativeInteger(movement.cardCount),
          cardIds: numericArray(movement.cardIds),
          fromId: nonNegativeInteger(movement.fromId),
          fromZone: nonNegativeInteger(movement.fromZone),
          fromPosition: nonNegativeInteger(movement.fromPosition),
          fromZoneParam: nonNegativeInteger(movement.fromZoneParam),
          toId: nonNegativeInteger(movement.toId),
          toZone: nonNegativeInteger(movement.toZone),
          toPosition: nonNegativeInteger(movement.toPosition),
          toZoneParam: nonNegativeInteger(movement.toZoneParam),
          moveType: nonNegativeInteger(movement.moveType)
        })),
      discardCardIds: numericArray(value.discardCardIds).slice(-MAX_DISCARD_HISTORY),
      hiddenDiscardCount: nonNegativeInteger(value.hiddenDiscardCount),
      currentTurnDiscardCardIds: [],
      currentTurnHiddenDiscardCount: 0,
      currentTurnCount: 0,
      currentRound: 0,
      deckTopCardIds: numericArray(value.deckTopCardIds),
      deckBottomCardIds: numericArray(value.deckBottomCardIds)
    };
  } catch {
    return null;
  }
}

function numericArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isInteger(item) && item >= 0)
    : [];
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function normalizeMovedCards(cardCount: number, cardIds: readonly number[]): number[] {
  return Array.from({ length: Math.max(0, cardCount) }, (_, index) => (
    Number(cardIds[index]) > 0 ? Number(cardIds[index]) : 0
  ));
}

function addCardsToDrawPile(
  topCards: number[],
  bottomCards: number[],
  position: number,
  cardCount: number,
  cardIds: readonly number[]
): void {
  const movedCards = normalizeMovedCards(cardCount, cardIds);
  if (position === DRAW_PILE_TOP_POSITION) {
    topCards.unshift(...movedCards.reverse());
  } else if (position === DRAW_PILE_BOTTOM_POSITION) {
    bottomCards.push(...movedCards);
  }
}

function removeCardsFromDrawPile(
  topCards: number[],
  bottomCards: number[],
  position: number,
  cardCount: number,
  cardIds: readonly number[]
): void {
  if (position === DRAW_PILE_TOP_POSITION) {
    topCards.splice(0, Math.max(0, cardCount));
    return;
  }
  if (position === DRAW_PILE_BOTTOM_POSITION) {
    bottomCards.splice(Math.max(0, bottomCards.length - cardCount), cardCount);
    return;
  }
  if (position !== UNSPECIFIED_POSITION) return;
  removeKnownCards(topCards, cardIds);
  removeKnownCards(bottomCards, cardIds);
}
