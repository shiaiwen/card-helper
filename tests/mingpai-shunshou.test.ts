import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import { installMingpaiController } from '../src/features/mingpai/index.ts';
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

describe('顺手牵羊明牌', () => {
  it('解析单张 CardID 的 PubGsCMoveCard', () => {
    const event = translateGameMessage([{
      ClassName: 'PubGsCMoveCard',
      CardCount: 1,
      CardID: 501,
      FromID: 1,
      FromZone: 5,
      FromPosition: 0,
      FromZoneParam: 0,
      ToID: 2,
      ToZone: 5,
      ToPosition: 0,
      ToZoneParam: 0,
      MoveType: 10,
      SpellID: 83
    }]);
    assert.equal(event?.type, 'cards-moved');
    if (event?.type !== 'cards-moved') return;
    assert.deepEqual(event.cardIds, [501]);
  });

  it('别人从本家手牌顺走时跟踪到对方明牌', () => {
    const bus = createGameEventBus();
    const seats = createSeatStateStore(memoryStorage());
    const { dispose } = installMingpaiController(seats, bus);

    seats.replace({
      inGame: true,
      selfSeatId: 1,
      controlledSeatIds: [1],
      seats: [
        {
          seatId: 1,
          displayOrder: 1,
          playerName: '我',
          isSelf: true,
          isAlive: true,
          knownCards: [
            { cardId: 201, name: '杀' },
            { cardId: 202, name: '闪' },
            { cardId: 203, name: '桃' }
          ],
          unknownCardCount: 0
        },
        {
          seatId: 2,
          displayOrder: 2,
          playerName: '敌',
          isSelf: false,
          isAlive: true,
          knownCards: [],
          unknownCardCount: 4
        }
      ]
    });

    bus.publish({
      type: 'cards-moved',
      cardCount: 1,
      cardIds: [202],
      fromId: 1,
      fromZone: 5,
      fromPosition: 1,
      fromZoneParam: 0,
      toId: 2,
      toZone: 5,
      toPosition: 0,
      toZoneParam: 0,
      moveType: 10,
      spellId: 83
    });

    const thief = seats.getSnapshot().seats.find((seat) => seat.seatId === 2);
    assert.ok(thief?.knownCards.some((card) => card.cardId === 202));
    dispose();
  });

  it('协议藏卡号时仍能按本家手牌位置补回明牌', () => {
    const bus = createGameEventBus();
    const seats = createSeatStateStore(memoryStorage());
    const { dispose } = installMingpaiController(seats, bus);

    seats.replace({
      inGame: true,
      selfSeatId: 1,
      controlledSeatIds: [1],
      seats: [
        {
          seatId: 1,
          displayOrder: 1,
          playerName: '我',
          isSelf: true,
          isAlive: true,
          knownCards: [
            { cardId: 301, name: '杀' },
            { cardId: 302, name: '闪' },
            { cardId: 303, name: '桃' }
          ],
          unknownCardCount: 0
        },
        {
          seatId: 2,
          displayOrder: 2,
          playerName: '敌',
          isSelf: false,
          isAlive: true,
          knownCards: [],
          unknownCardCount: 3
        }
      ]
    });

    bus.publish({
      type: 'cards-moved',
      cardCount: 1,
      cardIds: [0],
      fromId: 1,
      fromZone: 5,
      fromPosition: 1,
      fromZoneParam: 0,
      toId: 2,
      toZone: 5,
      toPosition: 0,
      toZoneParam: 0,
      moveType: 10,
      spellId: 83
    });

    const thief = seats.getSnapshot().seats.find((seat) => seat.seatId === 2);
    assert.deepEqual(
      thief?.knownCards.map((card) => card.cardId),
      [302]
    );
    dispose();
  });
});
