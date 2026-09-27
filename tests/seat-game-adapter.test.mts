import test from 'node:test';
import assert from 'node:assert/strict';
import { readSeatStateFromGameScene } from '../src/features/seat-display/seat-game-adapter.ts';
import { findGameSceneNear } from '../src/features/seat-display/game-scene-locator.ts';

test('座位适配器复制并翻译游戏对象，不修改原对象', () => {
  const gameScene = {
    seatContainer: {
      seatUIs: [
        // 其他玩家的 HandCards/cards 不可信，不应进入明牌。
        { order: 2, seat: { seatID: 2, playerName: '甲', handCardCount: 3, cards: [{ cardID: 11, name: '杀' }] } },
        { order: 1, seat: { seatID: 1, playerName: '我', isSelf: true, handCardCount: 2, cards: [] } }
      ]
    }
  };
  const before = JSON.stringify(gameScene);

  assert.deepEqual(readSeatStateFromGameScene(gameScene), {
    inGame: true,
    isSpectating: false,
    selfSeatId: 1,
    controlledSeatIds: [1],
    mode: 'identity',
    seats: [
      {
        seatId: 2,
        displayOrder: 2,
        playerName: '甲',
        isSelf: false,
        isAlive: true,
        anchor: null,
        knownCards: [],
        unknownCardCount: 3
      },
      {
        seatId: 1,
        displayOrder: 1,
        playerName: '我',
        isSelf: true,
        isAlive: true,
        anchor: null,
        knownCards: [],
        unknownCardCount: 2
      }
    ]
  });
  assert.equal(JSON.stringify(gameScene), before);
});

test('场景定位只在指定深度内查找 seatContainer', () => {
  const scene = { seatContainer: { seatUIs: [] } };
  assert.equal(findGameSceneNear({ currentScene: scene }), scene);
  assert.equal(findGameSceneNear({ a: { b: { c: scene } } }, 2), null);
});

test('识别游戏 SelfSeatUi、HandCards 和 cardContainer 包装的牌', () => {
  const selfSeatUi = {
    seat: { SeatID: 4, HandCards: [101, { CardId: 102, Name: '闪' }] },
    cardContainer: { cardUis: [{ card: { CardID: 103, name: '桃' } }] }
  };
  const snapshot = readSeatStateFromGameScene({
    SelfSeatUi: selfSeatUi,
    seatContainer: { seatUIs: [selfSeatUi] }
  });

  assert.equal(snapshot.selfSeatId, 4);
  assert.equal(snapshot.seats?.[0]?.isSelf, true);
  assert.deepEqual(snapshot.seats?.[0]?.knownCards, [
    { cardId: 101, name: '', tags: [] },
    { cardId: 102, name: '闪', tags: [] },
    { cardId: 103, name: '桃', tags: [] }
  ]);
});

test('其他座位读取官方 HandShowCardIDs 作为明牌', () => {
  const snapshot = readSeatStateFromGameScene({
    seatContainer: {
      seatUIs: [
        {
          order: 1,
          seat: {
            seatID: 1,
            isSelf: true,
            handCardCount: 1,
            HandCards: [{ CardID: 10, name: '杀' }]
          }
        },
        {
          order: 2,
          seat: {
            seatID: 2,
            playerName: '乙',
            handCardCount: 2,
            HandShowCardIDs: [88, { CardId: 99 }]
          }
        }
      ]
    }
  });

  const other = snapshot.seats?.find((seat) => seat.seatId === 2);
  assert.deepEqual(other?.knownCards, [
    { cardId: 88, name: '', tags: [] },
    { cardId: 99, name: '', tags: [] }
  ]);
  assert.equal(other?.unknownCardCount, 0);
});
