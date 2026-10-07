/**
 * 座位状态仓：各座位已知手牌、未知数量、控制座位与是否在局。
 */

import {
  createEmptySeatState,
  normalizeSeatState,
  type SeatStateSnapshot
} from './seat-state.ts';

export type SeatStateSubscriber = (snapshot: Readonly<SeatStateSnapshot>) => void;

export interface SeatStateStore {
  getSnapshot(): Readonly<SeatStateSnapshot>;
  replace(candidate: Partial<SeatStateSnapshot>): void;
  applyKnownHandMovement(movement: KnownHandMovement): void;
  /** 暗牌离开手牌：部分移走时已知牌降为可能牌，整手移走时可能牌随之转移。 */
  applyHiddenHandMovement(movement: HiddenHandMovement): void;
  revealKnownHand(seatId: number, cardIds: readonly number[]): void;
  /** 部分展示：并入该座位已知手牌，不覆盖已有明牌。 */
  mergeKnownHand(seatId: number, cardIds: readonly number[]): void;
  setPersistentKnownCardTags(cardId: number, tags: readonly string[]): void;
  hasRestoredKnownHands(): boolean;
  resetKnownHands(): void;
  clear(): void;
  subscribe(subscriber: SeatStateSubscriber): () => void;
}

export interface KnownHandMovement {
  cardCount: number;
  cardIds: readonly number[];
  fromSeatId: number;
  fromZone: number;
  toSeatId: number;
  toZone: number;
}

export interface HiddenHandMovement {
  fromSeatId: number;
  /** 目标不是座位手牌（牌堆、武将牌上等暗区）时为 null。 */
  toSeatId: number | null;
  wholeHand: boolean;
}

const HAND_ZONE = 5;
/** 可能位置里的「座位手牌以外的暗区」。 */
const ELSEWHERE = -1;
const KNOWN_HAND_STORAGE_KEY = 'XC::knownHands';
const KNOWN_HAND_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** 游戏适配器写入、Vue 订阅的单向座位快照仓库。 */
export function createSeatStateStore(storage: Storage | null = getSessionStorage()): SeatStateStore {
  let baseSnapshot = freezeSnapshot(createEmptySeatState());
  let snapshot = freezeSnapshot(createEmptySeatState());
  const trackedHands = new Map<number, { cardIds: number[] }>();
  const trackedOccupants = new Map<number, string>();
  const suppressedCardsBySeat = new Map<number, Set<number>>();
  const persistentTagsByCardId = new Map<number, string[]>();
  /** cardId → 可能所在的座位（ELSEWHERE 表示其它暗区）。 */
  const possibleLocations = new Map<number, Set<number>>();
  const restored = restoreKnownHands(storage, trackedHands, trackedOccupants, persistentTagsByCardId, possibleLocations);
  let hasRestoredState = restored;
  const subscribers = new Set<SeatStateSubscriber>();

  function publish(nextSnapshot: SeatStateSnapshot): void {
    if (JSON.stringify(snapshot) === JSON.stringify(nextSnapshot)) return;
    snapshot = freezeSnapshot(nextSnapshot);
    persistKnownHands(storage, trackedHands, trackedOccupants, persistentTagsByCardId, possibleLocations);
    subscribers.forEach((subscriber) => subscriber(snapshot));
  }

  function publishMerged(): void {
    publish(mergeTrackedHands(baseSnapshot, trackedHands, suppressedCardsBySeat, persistentTagsByCardId, possibleLocations));
  }

  /** 牌以明确卡号出现后，位置已确定，不再是任何座位的可能牌。 */
  function resolvePossible(cardIds: readonly number[]): void {
    cardIds.forEach((cardId) => { if (cardId > 0) possibleLocations.delete(cardId); });
  }

  function settlePossible(cardId: number, locations: Set<number>): void {
    const seats = [...locations].filter((location) => location !== ELSEWHERE);
    if (!seats.length) {
      possibleLocations.delete(cardId);
    } else if (locations.size === 1) {
      possibleLocations.delete(cardId);
      addTrackedCards(trackedHands, seats[0], [cardId], 1);
      rememberTrackedOccupant(trackedOccupants, baseSnapshot, seats[0]);
    }
  }

  function clearAllTracking(): void {
    trackedHands.clear();
    trackedOccupants.clear();
    suppressedCardsBySeat.clear();
    persistentTagsByCardId.clear();
    possibleLocations.clear();
    hasRestoredState = false;
    // 即使当前快照已是空场景，也要删除缓存，不能依赖 publish 的快照变化判断。
    persistKnownHands(storage, trackedHands, trackedOccupants, persistentTagsByCardId, possibleLocations);
  }

  return {
    getSnapshot: () => snapshot,
    hasRestoredKnownHands: () => hasRestoredState,
    replace: (candidate) => {
      const nextBaseSnapshot = normalizeSeatState(candidate);
      // 场景消失即视为本局结束，避免缺失 game-ended 消息时把明牌带入下一局。
      if (baseSnapshot.inGame && !nextBaseSnapshot.inGame) {
        clearAllTracking();
      } else {
        remapTrackedHandsAfterSeatChange(
          trackedHands,
          trackedOccupants,
          baseSnapshot,
          nextBaseSnapshot
        );
        remapSeatCardSetsAfterSeatChange(suppressedCardsBySeat, baseSnapshot, nextBaseSnapshot);
        confirmSuppressedCardsRemoved(suppressedCardsBySeat, nextBaseSnapshot);
      }
      baseSnapshot = freezeSnapshot(nextBaseSnapshot);
      publishMerged();
    },
    applyKnownHandMovement(movement) {
      resolvePossible(movement.cardIds);
      if (movement.fromZone === HAND_ZONE) {
        removeTrackedCards(trackedHands, movement.fromSeatId, movement.cardIds, movement.cardCount);
        suppressDepartedKnownCards(suppressedCardsBySeat, movement.fromSeatId, movement.cardIds);
        if (!trackedHands.has(movement.fromSeatId)) trackedOccupants.delete(movement.fromSeatId);
      }
      if (movement.toZone === HAND_ZONE) {
        restoreReturnedKnownCards(suppressedCardsBySeat, movement.toSeatId, movement.cardIds);
        addTrackedCards(trackedHands, movement.toSeatId, movement.cardIds, movement.cardCount);
        rememberTrackedOccupant(trackedOccupants, baseSnapshot, movement.toSeatId);
      }
      publishMerged();
    },
    applyHiddenHandMovement({ fromSeatId, toSeatId, wholeHand }) {
      if (!Number.isInteger(fromSeatId) || fromSeatId < 0 || fromSeatId >= 0xff) return;
      const destination = toSeatId !== null && Number.isInteger(toSeatId) && toSeatId >= 0 && toSeatId < 0xff
        ? toSeatId
        : ELSEWHERE;
      if (destination === fromSeatId) return;
      const departedKnown = trackedHands.get(fromSeatId)?.cardIds ?? [];
      trackedHands.delete(fromSeatId);
      trackedOccupants.delete(fromSeatId);
      if (wholeHand) {
        if (destination !== ELSEWHERE && departedKnown.length) {
          addTrackedCards(trackedHands, destination, departedKnown, departedKnown.length);
          rememberTrackedOccupant(trackedOccupants, baseSnapshot, destination);
        }
        for (const [cardId, locations] of possibleLocations) {
          if (!locations.delete(fromSeatId)) continue;
          locations.add(destination);
          settlePossible(cardId, locations);
        }
      } else {
        departedKnown.forEach((cardId) => possibleLocations.set(cardId, new Set([fromSeatId, destination])));
        for (const locations of possibleLocations.values()) {
          if (locations.has(fromSeatId)) locations.add(destination);
        }
      }
      publishMerged();
    },
    revealKnownHand(seatId, cardIds) {
      if (!Number.isInteger(seatId) || seatId < 0 || seatId >= 0xff) return;
      const uniqueCardIds = [...new Set(cardIds.filter((cardId) => cardId > 0))];
      if (!uniqueCardIds.length) return;
      resolvePossible(uniqueCardIds);
      trackedHands.set(seatId, { cardIds: uniqueCardIds });
      rememberTrackedOccupant(trackedOccupants, baseSnapshot, seatId);
      // 整手已知：没出现的可能牌一定不在这里。
      for (const [cardId, locations] of possibleLocations) {
        if (locations.delete(seatId)) settlePossible(cardId, locations);
      }
      publishMerged();
    },
    mergeKnownHand(seatId, cardIds) {
      if (!Number.isInteger(seatId) || seatId < 0 || seatId >= 0xff) return;
      const knownIds = cardIds.filter((cardId) => cardId > 0);
      if (!knownIds.length) return;
      resolvePossible(knownIds);
      restoreReturnedKnownCards(suppressedCardsBySeat, seatId, knownIds);
      addTrackedCards(trackedHands, seatId, knownIds, knownIds.length);
      rememberTrackedOccupant(trackedOccupants, baseSnapshot, seatId);
      publishMerged();
    },
    setPersistentKnownCardTags(cardId, tags) {
      if (!(cardId > 0)) return;
      const normalizedTags = [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
      const previousTags = persistentTagsByCardId.get(cardId) ?? [];
      if (JSON.stringify(previousTags) === JSON.stringify(normalizedTags)) return;
      if (normalizedTags.length) persistentTagsByCardId.set(cardId, normalizedTags);
      else persistentTagsByCardId.delete(cardId);
      publishMerged();
    },
    resetKnownHands() {
      clearAllTracking();
      publishMerged();
    },
    clear: () => {
      clearAllTracking();
      baseSnapshot = freezeSnapshot(createEmptySeatState());
      publish(createEmptySeatState());
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      subscriber(snapshot);
      return () => subscribers.delete(subscriber);
    }
  };
}

function persistKnownHands(
  storage: Storage | null,
  hands: Map<number, { cardIds: number[] }>,
  occupants: Map<number, string>,
  persistentTags: Map<number, string[]>,
  possible: Map<number, Set<number>>
): void {
  if (!storage) return;
  try {
    if (!hands.size && !persistentTags.size && !possible.size) {
      storage.removeItem(KNOWN_HAND_STORAGE_KEY);
      return;
    }
    storage.setItem(KNOWN_HAND_STORAGE_KEY, JSON.stringify({
      savedAt: Date.now(),
      hands: [...hands],
      occupants: [...occupants],
      persistentTags: [...persistentTags],
      possible: [...possible].map(([cardId, locations]) => [cardId, [...locations]])
    }));
  } catch { /* 存储失败不影响实时状态。 */ }
}

function restoreKnownHands(
  storage: Storage | null,
  hands: Map<number, { cardIds: number[] }>,
  occupants: Map<number, string>,
  persistentTags: Map<number, string[]>,
  possible: Map<number, Set<number>>
): boolean {
  if (!storage) return false;
  try {
    const document = JSON.parse(storage.getItem(KNOWN_HAND_STORAGE_KEY) || 'null');
    if (!document || Date.now() - Number(document.savedAt) > KNOWN_HAND_MAX_AGE_MS) return false;
    for (const [seatId, hand] of Array.isArray(document.hands) ? document.hands : []) {
      const id = Number(seatId);
      const cardIds = Array.isArray(hand?.cardIds)
        ? [...new Set<number>(hand.cardIds.map(Number).filter((cardId: number) => Number.isInteger(cardId) && cardId > 0))]
        : [];
      if (Number.isInteger(id) && id >= 0 && id < 0xff && cardIds.length) hands.set(id, { cardIds });
    }
    for (const [seatId, name] of Array.isArray(document.occupants) ? document.occupants : []) {
      if (Number.isInteger(Number(seatId)) && typeof name === 'string') occupants.set(Number(seatId), name);
    }
    for (const [cardId, tags] of Array.isArray(document.persistentTags) ? document.persistentTags : []) {
      const normalized = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
      if (Number(cardId) > 0 && normalized.length) persistentTags.set(Number(cardId), normalized);
    }
    for (const [cardId, locations] of Array.isArray(document.possible) ? document.possible : []) {
      const normalized = Array.isArray(locations)
        ? locations.map(Number).filter((location: number) => Number.isInteger(location) && location >= ELSEWHERE && location < 0xff)
        : [];
      if (Number(cardId) > 0 && normalized.length) possible.set(Number(cardId), new Set(normalized));
    }
    return hands.size > 0 || persistentTags.size > 0 || possible.size > 0;
  } catch { return false; }
}

function getSessionStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

function rememberTrackedOccupant(
  occupants: Map<number, string>,
  state: Readonly<SeatStateSnapshot>,
  seatId: number
): void {
  const playerName = state.seats.find((seat) => seat.seatId === seatId)?.playerName.trim();
  if (playerName) occupants.set(seatId, playerName);
}

/** 换座时明牌应跟随玩家，而不是继续挂在旧的协议座位 ID 上。 */
function remapTrackedHandsAfterSeatChange(
  hands: Map<number, { cardIds: number[] }>,
  occupants: Map<number, string>,
  previous: Readonly<SeatStateSnapshot>,
  next: Readonly<SeatStateSnapshot>
): void {
  if (!previous.inGame || !next.inGame || hands.size === 0) return;
  const nextSeatsByPlayerName = new Map<string, number[]>();
  next.seats.forEach((seat) => {
    const playerName = seat.playerName.trim();
    if (!playerName) return;
    const seatIds = nextSeatsByPlayerName.get(playerName) ?? [];
    seatIds.push(seat.seatId);
    nextSeatsByPlayerName.set(playerName, seatIds);
  });

  const remappedHands = new Map<number, { cardIds: number[] }>();
  const remappedOccupants = new Map<number, string>();
  for (const [oldSeatId, hand] of hands) {
    const playerName = occupants.get(oldSeatId)
      ?? previous.seats.find((seat) => seat.seatId === oldSeatId)?.playerName.trim();
    const matchingSeatIds = playerName ? nextSeatsByPlayerName.get(playerName) : undefined;
    // 重名或名称缺失时不猜测，继续使用原协议座位 ID。
    const newSeatId = matchingSeatIds?.length === 1 ? matchingSeatIds[0] : oldSeatId;
    const destination = remappedHands.get(newSeatId) ?? { cardIds: [] };
    destination.cardIds = [...new Set([...destination.cardIds, ...hand.cardIds])];
    remappedHands.set(newSeatId, destination);
    if (playerName) remappedOccupants.set(newSeatId, playerName);
  }
  hands.clear();
  remappedHands.forEach((hand, seatId) => hands.set(seatId, hand));
  occupants.clear();
  remappedOccupants.forEach((playerName, seatId) => occupants.set(seatId, playerName));
}

function addTrackedCards(
  hands: Map<number, { cardIds: number[] }>,
  seatId: number,
  cardIds: readonly number[],
  cardCount: number
): void {
  if (!Number.isInteger(seatId) || seatId < 0 || seatId >= 0xff) return;
  const hand = hands.get(seatId) ?? { cardIds: [] };
  const knownIds = cardIds.filter((cardId) => cardId > 0);
  for (const cardId of knownIds) if (!hand.cardIds.includes(cardId)) hand.cardIds.push(cardId);
  hands.set(seatId, hand);
}

function removeTrackedCards(
  hands: Map<number, { cardIds: number[] }>,
  seatId: number,
  cardIds: readonly number[],
  cardCount: number
): void {
  const hand = hands.get(seatId);
  if (!hand) return;
  for (const cardId of cardIds) {
    const index = hand.cardIds.indexOf(cardId);
    if (cardId <= 0 || index < 0) continue;
    hand.cardIds.splice(index, 1);
  }
  if (hand.cardIds.length === 0) hands.delete(seatId);
}

function mergeTrackedHands(
  state: SeatStateSnapshot,
  hands: Map<number, { cardIds: number[] }>,
  suppressedCardsBySeat: Map<number, Set<number>> = new Map(),
  persistentTagsByCardId: Map<number, string[]> = new Map(),
  possibleLocations: Map<number, Set<number>> = new Map()
): SeatStateSnapshot {
  if (!state.inGame) return state;
  // 任何座位上确定可见的牌都不再作为可能牌展示。
  const certainCardIds = new Set<number>([
    ...state.seats.flatMap((seat) => seat.knownCards.map((card) => card.cardId)),
    ...state.seats.flatMap((seat) => (seat.equipmentCards ?? []).map((card) => card.cardId)),
    ...[...hands.values()].flatMap((hand) => hand.cardIds)
  ]);
  const possibleBySeat = new Map<number, number[]>();
  for (const [cardId, locations] of possibleLocations) {
    if (certainCardIds.has(cardId)) continue;
    locations.forEach((seatId) => {
      if (seatId < 0) return;
      possibleBySeat.set(seatId, [...(possibleBySeat.get(seatId) ?? []), cardId]);
    });
  }
  return normalizeSeatState({
    ...state,
    seats: state.seats.map((seat) => {
      const equipmentIds = new Set(
        (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
      );
      const tracked = hands.get(seat.seatId);
      const possibleCards = (possibleBySeat.get(seat.seatId) ?? [])
        .filter((cardId) => !equipmentIds.has(cardId))
        .map((cardId) => ({
          cardId,
          name: '',
          tags: [...(persistentTagsByCardId.get(cardId) ?? [])]
        }));
      const suppressedCardIds = suppressedCardsBySeat.get(seat.seatId);
      const visibleSceneCards = (suppressedCardIds
        ? seat.knownCards.filter((card) => !suppressedCardIds.has(card.cardId))
        : seat.knownCards)
        .filter((card) => !equipmentIds.has(card.cardId));
      const hasPersistentTags = visibleSceneCards.some((card) => persistentTagsByCardId.has(card.cardId));
      if (!tracked && visibleSceneCards.length === seat.knownCards.length && !hasPersistentTags) {
        return possibleCards.length ? { ...seat, possibleCards } : seat;
      }
      const knownCardIds = new Set(visibleSceneCards.map((card) => card.cardId));
      const mergedKnownCards = [
        ...visibleSceneCards.map((card) => ({
          ...card,
          tags: [...new Set([...card.tags, ...(persistentTagsByCardId.get(card.cardId) ?? [])])]
        })),
        ...(tracked?.cardIds ?? [])
          .filter((cardId) => !knownCardIds.has(cardId) && !equipmentIds.has(cardId))
          .map((cardId) => ({
            cardId,
            name: '',
            tags: [...(persistentTagsByCardId.get(cardId) ?? [])]
          }))
      ];
      // 游戏场景提供的总手牌数优先；新增明牌占用原先的未知牌名额。
      const sceneHandCount = seat.knownCards.length + seat.unknownCardCount;
      return {
        ...seat,
        knownCards: mergedKnownCards,
        ...(possibleCards.length ? { possibleCards } : {}),
        unknownCardCount: Math.max(0, sceneHandCount - mergedKnownCards.length)
      };
    })
  });
}

function suppressDepartedKnownCards(
  suppressedCardsBySeat: Map<number, Set<number>>,
  seatId: number,
  cardIds: readonly number[]
): void {
  const knownCardIds = cardIds.filter((cardId) => cardId > 0);
  if (!knownCardIds.length) return;
  const suppressed = suppressedCardsBySeat.get(seatId) ?? new Set<number>();
  knownCardIds.forEach((cardId) => suppressed.add(cardId));
  suppressedCardsBySeat.set(seatId, suppressed);
}

function restoreReturnedKnownCards(
  suppressedCardsBySeat: Map<number, Set<number>>,
  seatId: number,
  cardIds: readonly number[]
): void {
  const suppressed = suppressedCardsBySeat.get(seatId);
  if (!suppressed) return;
  cardIds.forEach((cardId) => suppressed.delete(cardId));
  if (!suppressed.size) suppressedCardsBySeat.delete(seatId);
}

/** 场景已不再包含该牌后，移除短暂的抑制标记，允许它未来再次公开。 */
function confirmSuppressedCardsRemoved(
  suppressedCardsBySeat: Map<number, Set<number>>,
  state: Readonly<SeatStateSnapshot>
): void {
  for (const [seatId, suppressed] of suppressedCardsBySeat) {
    const sceneCardIds = new Set(
      state.seats.find((seat) => seat.seatId === seatId)?.knownCards.map((card) => card.cardId) ?? []
    );
    for (const cardId of suppressed) if (!sceneCardIds.has(cardId)) suppressed.delete(cardId);
    if (!suppressed.size) suppressedCardsBySeat.delete(seatId);
  }
}

function remapSeatCardSetsAfterSeatChange(
  cardSets: Map<number, Set<number>>,
  previous: Readonly<SeatStateSnapshot>,
  next: Readonly<SeatStateSnapshot>
): void {
  if (!previous.inGame || !next.inGame || !cardSets.size) return;
  const remapped = new Map<number, Set<number>>();
  for (const [oldSeatId, cardIds] of cardSets) {
    const playerName = previous.seats.find((seat) => seat.seatId === oldSeatId)?.playerName.trim();
    const matches = playerName
      ? next.seats.filter((seat) => seat.playerName.trim() === playerName)
      : [];
    const newSeatId = matches.length === 1 ? matches[0].seatId : oldSeatId;
    const destination = remapped.get(newSeatId) ?? new Set<number>();
    cardIds.forEach((cardId) => destination.add(cardId));
    remapped.set(newSeatId, destination);
  }
  cardSets.clear();
  remapped.forEach((cardIds, seatId) => cardSets.set(seatId, cardIds));
}

function freezeSnapshot(snapshot: SeatStateSnapshot): Readonly<SeatStateSnapshot> {
  snapshot.seats.forEach((seat) => {
    [...seat.knownCards, ...(seat.possibleCards ?? [])].forEach((card) => {
      Object.freeze(card.tags);
      Object.freeze(card);
    });
    Object.freeze(seat.knownCards);
    if (seat.possibleCards) Object.freeze(seat.possibleCards);
    Object.freeze(seat);
  });
  Object.freeze(snapshot.seats);
  return Object.freeze(snapshot);
}
