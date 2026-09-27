import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createDeckRecordStore } from '../src/features/deck-record/deck-record-store.ts';
import { translateGameMessage } from '../src/adapters/game-message-adapter.ts';

function memoryStorage(): Storage {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    key() { return null; }
  };
}

function moveToDiscard(...cardIds) {
  return {
    type: 'cards-moved',
    cardCount: cardIds.length,
    cardIds,
    fromId: 1,
    fromZone: 4,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 0xff,
    toZone: 2,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0
  };
}

test('clears current-turn discards when TurnCnt advances', () => {
  const events = createGameEventBus();
  const store = createDeckRecordStore(events, memoryStorage());

  events.publish({ type: 'turn-started', seatId: 1, turnCount: 1, round: 0 });
  events.publish(moveToDiscard(101, 102));
  assert.deepEqual(store.getSnapshot().currentTurnDiscardCardIds, [101, 102]);
  assert.equal(store.getSnapshot().currentTurnCount, 1);

  events.publish({ type: 'turn-started', seatId: 2, turnCount: 2, round: 0 });
  assert.deepEqual(store.getSnapshot().currentTurnDiscardCardIds, []);
  assert.equal(store.getSnapshot().currentTurnCount, 2);

  events.publish(moveToDiscard(201));
  assert.deepEqual(store.getSnapshot().currentTurnDiscardCardIds, [201]);
  assert.deepEqual(store.getSnapshot().discardCardIds, [101, 102, 201]);
});

test('clears current-turn discards when a new player phase starts (Round=0)', () => {
  const events = createGameEventBus();
  const store = createDeckRecordStore(events, memoryStorage());

  events.publish({ type: 'turn-started', seatId: 1, turnCount: 1, round: 0 });
  events.publish(moveToDiscard(101, 102));
  assert.equal(store.getSnapshot().currentTurnDiscardCardIds.length, 2);

  // GsCGamephaseNtf Round=0 → turnCount 0：新行动角色，必须清空。
  events.publish({ type: 'turn-started', seatId: 2, turnCount: 0, round: 0 });
  assert.deepEqual(store.getSnapshot().currentTurnDiscardCardIds, []);

  events.publish(moveToDiscard(201));
  assert.deepEqual(store.getSnapshot().currentTurnDiscardCardIds, [201]);
});

test('translates GsCGamephaseNtf Round=0 into turn-started', () => {
  const event = translateGameMessage([{
    ClassName: 'GsCGamephaseNtf',
    SeatID: 3,
    Round: 0
  }]);
  assert.deepEqual(event, {
    type: 'turn-started',
    seatId: 3,
    turnCount: 0,
    round: 0
  });

  assert.deepEqual(translateGameMessage([{
    ClassName: 'GsCGamephaseNtf',
    SeatID: 3,
    Round: 1
  }]), { type: 'phase-changed', seatId: 3, phase: 1 });
});

test('does not restore current-turn discards from session storage', () => {
  const storage = memoryStorage();
  const firstEvents = createGameEventBus();
  const firstStore = createDeckRecordStore(firstEvents, storage);
  firstEvents.publish({ type: 'turn-started', seatId: 1, turnCount: 1, round: 0 });
  firstEvents.publish(moveToDiscard(11, 12, 13));
  assert.equal(firstStore.getSnapshot().currentTurnDiscardCardIds.length, 3);

  const secondEvents = createGameEventBus();
  const secondStore = createDeckRecordStore(secondEvents, storage);
  assert.deepEqual(secondStore.getSnapshot().currentTurnDiscardCardIds, []);
  assert.deepEqual(secondStore.getSnapshot().discardCardIds, [11, 12, 13]);
});
