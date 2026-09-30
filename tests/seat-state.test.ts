import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSeatState } from '../src/features/seat-display/seat-state.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';

test('normalizes game seat snapshots without inventing missing game data', () => {
  assert.deepEqual(normalizeSeatState({
    inGame: true,
    selfSeatId: 2,
    seats: [
      {
        seatId: 2,
        displayOrder: 1,
        playerName: '自己',
        isSelf: false,
        isAlive: true,
        knownCards: [
          { cardId: 11, name: '杀' },
          { cardId: 11, name: '重复数据' },
          { cardId: 0, name: '未知牌' }
        ],
        unknownCardCount: -3
      },
      {
        seatId: 9,
        displayOrder: 2,
        playerName: '无效座位',
        isSelf: false,
        isAlive: true,
        knownCards: [],
        unknownCardCount: 0
      }
    ]
  }), {
    inGame: true,
    isSpectating: false,
    selfSeatId: 2,
    controlledSeatIds: [2],
    mode: 'unknown',
    playerCount: 1,
    seats: [{
      seatId: 2,
      displayOrder: 1,
      playerName: '自己',
      isSelf: true,
      isAlive: true,
      anchor: null,
      knownCards: [{ cardId: 11, name: '杀', tags: [] }],
      unknownCardCount: 0
    }]
  });
});

test('publishes immutable snapshots once and clears them when leaving the game', () => {
  const store = createSeatStateStore();
  const snapshots: unknown[] = [];
  const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot));
  const gameSnapshot = {
    inGame: true,
    selfSeatId: 1,
    seats: [{
      seatId: 1,
      displayOrder: 1,
      playerName: '',
      isSelf: true,
      isAlive: true,
      knownCards: [],
      unknownCardCount: 4
    }]
  };

  store.replace(gameSnapshot);
  store.replace(gameSnapshot);
  store.clear();
  unsubscribe();

  assert.equal(snapshots.length, 3);
  assert.equal(Object.isFrozen(snapshots[1]), true);
  assert.deepEqual(store.getSnapshot(), {
    inGame: false,
    isSpectating: false,
    selfSeatId: null,
    controlledSeatIds: [],
    mode: 'unknown',
    playerCount: 0,
    seats: []
  });
});
