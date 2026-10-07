import assert from 'node:assert/strict';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createMingpaiEngine } from '../src/features/mingpai/mingpai-engine.ts';
import { installMingpaiController } from '../src/features/mingpai/mingpai-controller.ts';
import { createDrawPileOrder } from '../src/features/mingpai/draw-pile-order.ts';
import { DRAW_PILE_POSITION } from '../src/features/mingpai/rules/reveal-types.ts';
import type { SeatStateSnapshot } from '../src/features/seat-display/seat-state.ts';
import type { SeatStateStore } from '../src/features/seat-display/seat-state-store.ts';

const emptyAnchor = {
  x: 0, y: 0, width: 0, height: 0, stageWidth: 0, stageHeight: 0
};

function seat(seatId: number, cardIds: number[], equipmentIds: number[] = []) {
  return {
    seatId,
    displayOrder: seatId,
    playerName: '',
    isSelf: seatId === 1,
    isAlive: true,
    anchor: emptyAnchor,
    knownCards: cardIds.map((cardId) => ({ cardId, name: '', tags: [] })),
    equipmentCards: equipmentIds.map((cardId) => ({ cardId, name: '', tags: [], hints: [] })),
    unknownCardCount: 0
  };
}

function snapshot(seats: ReturnType<typeof seat>[]): SeatStateSnapshot {
  return {
    inGame: true,
    isSpectating: false,
    selfSeatId: 1,
    controlledSeatIds: [1],
    mode: 'identity',
    playerCount: seats.length,
    seats
  };
}

function store(initial: SeatStateSnapshot): SeatStateStore & { publish(next: SeatStateSnapshot): void } {
  let current = initial;
  const listeners = new Set<(value: SeatStateSnapshot) => void>();
  return {
    getSnapshot: () => current,
    publish(next) {
      current = next;
      listeners.forEach((listener) => listener(current));
    },
    replace() {},
    applyKnownHandMovement() {},
    applyHiddenHandMovement() {},
    revealKnownHand() {},
    mergeKnownHand() {},
    setPersistentKnownCardTags() {},
    hasRestoredKnownHands: () => false,
    resetKnownHands() {},
    clear() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

const engine = createMingpaiEngine(null);
engine.observeKnownHandCard(11, 1);
engine.observeKnownHandCard(22, 2);
engine.observeKnownDrawPileCards([31, 32], DRAW_PILE_POSITION.TOP);
engine.reconcileVisibleHands([{ seatId: 1, cardIds: [11, 13] }, { seatId: 2, cardIds: [] }]);
assert.deepEqual([...engine.getHandCardIds(1)], [11, 13]);
assert.deepEqual([...engine.getHandCardIds(2)], []);
assert.equal(engine.findKZ(22).zones[0], 'unknown');
assert.deepEqual([...engine.getSnapshot().drawPile.top], [31, 32]);

const pile = createDrawPileOrder(null);
pile.reveal(DRAW_PILE_POSITION.TOP, [1, 2, 3]);
pile.add(DRAW_PILE_POSITION.TOP, 2, [0, 8]);
assert.deepEqual(pile.getSnapshot().top, [8, 0, 1, 2, 3]);
pile.invalidate();
assert.deepEqual(pile.getSnapshot().top, []);

const events = createGameEventBus();
const seats = store(snapshot([seat(1, [11, 99], [99]), seat(2, [22])]));
const installed = installMingpaiController(seats, events, { engine: createMingpaiEngine(null) });
installed.engine.observeKnownHandCard(11, 1);
installed.engine.observeKnownHandCard(44, 2);
installed.engine.observeKnownDrawPileCards([7], DRAW_PILE_POSITION.BOTTOM);
events.publish({ type: 'game-reconnected' });
assert.deepEqual([...installed.engine.getHandCardIds(1)], [11]);
assert.deepEqual([...installed.engine.getHandCardIds(2)], [22]);
assert.equal(installed.engine.findKZ(44).zones[0], 'unknown');
assert.deepEqual([...installed.engine.getSnapshot().drawPile.bottom], []);

installed.engine.observeKnownDrawPileCards([9], DRAW_PILE_POSITION.TOP);
events.publish({ type: 'deck-shuffled' });
assert.deepEqual([...installed.engine.getHandCardIds(1)], [11]);
assert.deepEqual([...installed.engine.getSnapshot().drawPile.top], []);

seats.publish({ ...snapshot([]), inGame: false, seats: [] });
events.publish({ type: 'game-reconnected' });
assert.deepEqual([...installed.engine.getHandCardIds(1)], [11]);
seats.publish(snapshot([seat(1, [15])]));
assert.deepEqual([...installed.engine.getHandCardIds(1)], [15]);

installed.dispose();

const stolen = createMingpaiEngine(null);
const stolenSeats = store(snapshot([
  seat(1, [11, 12], [88]),
  seat(2, [])
]));
const stolenBus = createGameEventBus();
const stolenController = installMingpaiController(stolenSeats, stolenBus, { engine: stolen });
stolenBus.publish(move({
  cardCount: 1,
  cardIds: [0],
  fromId: 1,
  fromZone: 4,
  toId: 2,
  toZone: 5
}));
assert.deepEqual([...stolen.getHandCardIds(2)], [88]);

stolenBus.publish(move({
  cardCount: 1,
  cardIds: [0],
  fromId: 1,
  fromZone: 5,
  fromPosition: 0,
  toId: 2,
  toZone: 5
}));
assert.deepEqual([...stolen.getHandCardIds(2)], [88, 11]);

const publicSeat = store(snapshot([
  seat(1, []),
  { ...seat(3, [21, 22]), isSelf: false, unknownCardCount: 0 }
]));
const publicEngine = createMingpaiEngine(null);
const publicBus = createGameEventBus();
const publicController = installMingpaiController(publicSeat, publicBus, { engine: publicEngine });
publicBus.publish(move({
  cardCount: 2,
  cardIds: [0, 0],
  fromId: 3,
  fromZone: 5,
  toId: 1,
  toZone: 5
}));
assert.deepEqual([...publicEngine.getHandCardIds(1)], [21, 22]);

stolenController.dispose();
publicController.dispose();
console.log('mingpai-reconnect: ok');

function move(partial: {
  cardCount: number;
  cardIds: number[];
  fromId: number;
  fromZone: number;
  toId: number;
  toZone: number;
  fromPosition?: number;
}) {
  return {
    type: 'cards-moved' as const,
    cardCount: partial.cardCount,
    cardIds: partial.cardIds,
    fromId: partial.fromId,
    fromZone: partial.fromZone,
    fromPosition: partial.fromPosition ?? 0,
    fromZoneParam: 0,
    toId: partial.toId,
    toZone: partial.toZone,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 4
  };
}
