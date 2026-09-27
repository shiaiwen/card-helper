import type { GameEventBus } from '../../runtime/game-event-bus.ts';

export type RecentCardDisplayMode = 'player' | 'current';

export interface RecentCardSnapshot {
  displayMode: RecentCardDisplayMode;
  activeSeatId: number | null;
  lastPlayerCardId: number | null;
  currentTurnCardId: number | null;
  displayedCardId: number | null;
}

export interface RecentCardStore {
  getSnapshot(): Readonly<RecentCardSnapshot>;
  setDisplayMode(mode: RecentCardDisplayMode): void;
  subscribe(listener: (snapshot: Readonly<RecentCardSnapshot>) => void): () => void;
  clear(): void;
}

/** 将“玩家最近用牌”和“当前回合最近用牌”从 Laya 展示对象中分离出来。 */
export function createRecentCardStore(
  gameEvents: GameEventBus,
  initialMode: RecentCardDisplayMode = 'current'
): RecentCardStore {
  let snapshot = freezeSnapshot(createSnapshot(initialMode));
  const listeners = new Set<(snapshot: Readonly<RecentCardSnapshot>) => void>();

  const publish = (candidate: Omit<RecentCardSnapshot, 'displayedCardId'>) => {
    const nextSnapshot = freezeSnapshot(candidate);
    if (sameSnapshot(snapshot, nextSnapshot)) return;
    snapshot = nextSnapshot;
    listeners.forEach((listener) => listener(snapshot));
  };
  const stopGameEvents = gameEvents.subscribe((event) => {
    if (event.type === 'game-started' || event.type === 'game-ended') {
      publish(createSnapshot(snapshot.displayMode));
      return;
    }
    if (event.type === 'turn-started') {
      publish({
        ...snapshot,
        activeSeatId: event.seatId,
        currentTurnCardId: null
      });
      return;
    }
    if (event.type === 'cards-used' || (event.type === 'spell-targeted' && event.cardIds.length)) {
      const latestCardId = event.cardIds[event.cardIds.length - 1];
      publish({
        ...snapshot,
        lastPlayerCardId: latestCardId,
        currentTurnCardId: event.seatId === snapshot.activeSeatId
          ? latestCardId
          : snapshot.currentTurnCardId
      });
    }
  });

  return {
    getSnapshot: () => snapshot,
    setDisplayMode(mode) {
      if (mode !== 'player' && mode !== 'current') return;
      publish({ ...snapshot, displayMode: mode });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    clear() {
      stopGameEvents();
      listeners.clear();
      snapshot = freezeSnapshot(createSnapshot(snapshot.displayMode));
    }
  };
}

function createSnapshot(displayMode: RecentCardDisplayMode): Omit<RecentCardSnapshot, 'displayedCardId'> {
  return {
    displayMode,
    activeSeatId: null,
    lastPlayerCardId: null,
    currentTurnCardId: null
  };
}

function freezeSnapshot(
  candidate: Omit<RecentCardSnapshot, 'displayedCardId'>
): Readonly<RecentCardSnapshot> {
  return Object.freeze({
    ...candidate,
    displayedCardId: candidate.displayMode === 'current'
      ? candidate.currentTurnCardId
      : candidate.lastPlayerCardId
  });
}

function sameSnapshot(left: Readonly<RecentCardSnapshot>, right: Readonly<RecentCardSnapshot>): boolean {
  return left.displayMode === right.displayMode
    && left.activeSeatId === right.activeSeatId
    && left.lastPlayerCardId === right.lastPlayerCardId
    && left.currentTurnCardId === right.currentTurnCardId;
}
