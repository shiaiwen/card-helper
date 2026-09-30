import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';

/** 对照原版阶段文案，下标即 GsCGamephaseNtf.Round。 */
export const PHASE_LABELS = [
  '回合开始时',
  '准备阶段',
  '判定阶段',
  '摸牌阶段',
  '出牌阶段',
  '弃牌阶段',
  '结束阶段',
  '回合结束时',
  '回合结束后'
] as const;

export interface TurnStatusSnapshot {
  currentSeatId: number | null;
  phase: number | null;
  /** 当前行动角色本回合剩余出杀次数；Infinity 表示无限制，null 表示尚未收到数据。 */
  shaRemaining: number | null;
}

export interface TurnStatusStore {
  getSnapshot(): Readonly<TurnStatusSnapshot>;
  handleGameEvent(event: Readonly<GameEvent>): void;
  subscribe(listener: (snapshot: Readonly<TurnStatusSnapshot>) => void): () => void;
  clear(): void;
}

const EMPTY_SNAPSHOT: Readonly<TurnStatusSnapshot> = Object.freeze({
  currentSeatId: null,
  phase: null,
  shaRemaining: null
});

export function createTurnStatusStore(): TurnStatusStore {
  let snapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<(snapshot: Readonly<TurnStatusSnapshot>) => void>();

  function publish(next: TurnStatusSnapshot): void {
    if (
      next.currentSeatId === snapshot.currentSeatId
      && next.phase === snapshot.phase
      && next.shaRemaining === snapshot.shaRemaining
    ) return;
    snapshot = Object.freeze({ ...next });
    listeners.forEach((listener) => listener(snapshot));
  }

  return {
    getSnapshot: () => snapshot,
    handleGameEvent(event) {
      if (event.type === 'game-started' || event.type === 'game-ended') {
        publish(EMPTY_SNAPSHOT);
        return;
      }
      if (event.type === 'phase-changed') {
        const sameTurn = snapshot.currentSeatId === event.seatId && event.phase !== 0;
        publish({
          currentSeatId: event.seatId,
          phase: event.phase,
          shaRemaining: sameTurn ? snapshot.shaRemaining : null
        });
        return;
      }
      if (event.type === 'sha-count-updated') {
        if (snapshot.currentSeatId !== null && snapshot.currentSeatId !== event.seatId) return;
        publish({
          currentSeatId: event.seatId,
          phase: snapshot.phase,
          shaRemaining: remainingSha(event.used, event.limit)
        });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    clear() {
      listeners.clear();
      snapshot = EMPTY_SNAPSHOT;
    }
  };
}

/** 对照原版 TX：上限 <0 或 ≥99 视为无限。 */
export function remainingSha(used: number, limit: number): number {
  if (limit < 0 || limit >= 99) return Infinity;
  return Math.max(0, limit - (Number.isFinite(used) ? used : 0));
}

/** 回合内六阶段：准备(1)～结束(6)；开局后展开/折叠都带序号。 */
export function formatPhase(phase: number | null): string {
  if (phase === null) return '等待开局';
  const label = PHASE_LABELS[phase] ?? `阶段 ${phase}`;
  if (phase >= 1 && phase <= 6) return `${label}（${phase}）`;
  return label;
}

export function formatShaRemaining(remaining: number | null): string {
  if (remaining === null) return '-';
  return remaining === Infinity ? '∞' : String(remaining);
}

export function bindTurnStatusStoreToGameEvents(store: TurnStatusStore, gameEvents: GameEventBus): () => void {
  return gameEvents.subscribe((event) => store.handleGameEvent(event));
}
