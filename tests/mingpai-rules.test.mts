import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import {
  createMingpaiEngine,
  DRAW_PILE_POSITION,
  installMingpaiController,
  isIgnoredMove,
  isSameZoneShow,
  normalizeMoveCardIds,
  remapDrawPileFromPosition,
  remapDrawPileToPosition,
  resolveOptTargetReveals,
  resolveSpellOptRepReveals,
  sanitizeMoveCardIds
} from '../src/features/mingpai/index.ts';
import { translateGameMessages } from '../src/adapters/game-message-adapter.ts';

const ctx = (over: Partial<Parameters<typeof resolveOptTargetReveals>[0]>) => ({
  spellId: 0,
  param: 0,
  params: [],
  srcSeatId: 1,
  targetSeatId: 2,
  isSelfSrc: true,
  ...over
});

describe('OptTarget 规则表', () => {
  it('攻心类整段 Params → 目标完整手牌', () => {
    const [reveal] = resolveOptTargetReveals(ctx({ spellId: 921, params: [11, 12, 0] }));
    assert.deepEqual(reveal, {
      zone: 'hand', ownerId: 2, cardIds: [11, 12], position: 'unspecified', partial: false
    });
  });

  it('Param=0 限定的技能在 Param≠0 时不揭示', () => {
    assert.equal(resolveOptTargetReveals(ctx({ spellId: 851, param: 1, params: [11] })).length, 0);
    assert.equal(resolveOptTargetReveals(ctx({ spellId: 851, param: 0, params: [11] })).length, 1);
  });

  it('898 前缀计数 → 施法者手牌', () => {
    const [reveal] = resolveOptTargetReveals(ctx({ spellId: 898, params: [2, 31, 32, 99] }));
    assert.equal(reveal.ownerId, 1);
    assert.deepEqual(reveal.cardIds, [31, 32]);
    assert.equal(reveal.partial, true);
  });

  it('987 尾部 N 张 → 目标手牌', () => {
    const [reveal] = resolveOptTargetReveals(ctx({ spellId: 987, param: 1, params: [5, 2, 41, 42] }));
    assert.deepEqual(reveal.cardIds, [41, 42]);
  });

  it('私有看牌堆只对本家生效', () => {
    const base = { spellId: 3903, targetSeatId: 0xff, params: [2, 0, 51, 52] };
    assert.deepEqual(resolveOptTargetReveals(ctx({ ...base, isSelfSrc: false })), []);
    const [reveal] = resolveOptTargetReveals(ctx(base));
    assert.equal(reveal.zone, 'deck');
    assert.equal(reveal.position, 'top');
    assert.deepEqual(reveal.cardIds, [51, 52]);
  });

  it('7010 牌堆顶并 pack 进 unknown', () => {
    const [reveal] = resolveOptTargetReveals(ctx({ spellId: 7010, targetSeatId: 0xff, params: [61] }));
    assert.equal(reveal.packUnknown, true);
  });

  it('未登记技能不揭示', () => {
    assert.deepEqual(resolveOptTargetReveals(ctx({ spellId: 123456, params: [1] })), []);
  });
});

describe('SpellOptRep 规则表', () => {
  it('3336 Type=50 → 牌堆底倒序', () => {
    const [reveal] = resolveSpellOptRepReveals({
      spellId: 3336, optType: 50, seatId: 1, datas: [1, 2, 3], isSelfSeat: true
    });
    assert.equal(reveal.position, 'bottom');
    assert.deepEqual(reveal.cardIds, [3, 2, 1]);
  });

  it('3744 Type=73 不揭示', () => {
    assert.deepEqual(resolveSpellOptRepReveals({
      spellId: 3744, optType: 73, seatId: 1, datas: [1], isSelfSeat: true
    }), []);
  });
});

describe('MoveCard 纠偏', () => {
  it('半透明卡号整组清空', () => {
    assert.deepEqual(sanitizeMoveCardIds(3, [5, 0, 0]), [0, 0, 0]);
    assert.deepEqual(sanitizeMoveCardIds(2, [5, 6]), [5, 6]);
  });

  it('离开牌堆未指定位置按技能纠成顶', () => {
    const move = {
      cardCount: 1, cardIds: [0], fromId: 0xff, fromZone: 1,
      fromPosition: DRAW_PILE_POSITION.UNSPECIFIED,
      toId: 1, toZone: 5, toPosition: 0, moveType: 1, spellId: 987
    };
    assert.equal(remapDrawPileFromPosition(move), DRAW_PILE_POSITION.TOP);
    assert.equal(remapDrawPileFromPosition({ ...move, spellId: 1 }), DRAW_PILE_POSITION.UNSPECIFIED);
  });

  it('同区同主人且有卡号视为展示', () => {
    const move = {
      cardCount: 1, cardIds: [7], fromId: 2, fromZone: 5, fromPosition: 0,
      toId: 2, toZone: 5, toPosition: 0, moveType: 1, spellId: 1
    };
    assert.equal(isSameZoneShow(move), true);
    assert.equal(isSameZoneShow({ ...move, toId: 3 }), false);
  });

  it('713 / MoveType 21 去掉下标前缀和被指向的卡号', () => {
    const move = {
      cardCount: 2, cardIds: [1, 11, 12, 13], fromId: 2, fromZone: 5, fromPosition: 0,
      toId: 2, toZone: 2, toPosition: 0, moveType: 21, spellId: 713
    };
    assert.deepEqual(normalizeMoveCardIds(move), [11, 13]);
    assert.deepEqual(normalizeMoveCardIds({ ...move, spellId: 1 }), [1, 11, 12, 13]);
  });

  it('ToZone 11 的移动整条忽略', () => {
    const move = {
      cardCount: 1, cardIds: [7], fromId: 2, fromZone: 2, fromPosition: 0,
      toId: 2, toZone: 11, toPosition: 0, moveType: 1, spellId: 0
    };
    assert.equal(isIgnoredMove(move), true);
    assert.equal(isIgnoredMove({ ...move, toZone: 5 }), false);
  });

  it('放回牌堆顶含 4400/4401 时按未指定位置处理', () => {
    const move = {
      cardCount: 2, cardIds: [4400, 9], fromId: 2, fromZone: 2, fromPosition: 0,
      toId: 0xff, toZone: 1, toPosition: DRAW_PILE_POSITION.TOP, moveType: 1, spellId: 0
    };
    assert.equal(remapDrawPileToPosition(move), DRAW_PILE_POSITION.UNSPECIFIED);
    assert.equal(remapDrawPileToPosition({ ...move, cardIds: [8, 9] }), DRAW_PILE_POSITION.TOP);
  });
});

describe('明牌控制器接入', () => {
  function setup() {
    const bus = createGameEventBus();
    const seats = createSeatStateStore(null as never);
    const engine = createMingpaiEngine(null);
    const { dispose } = installMingpaiController(seats, bus, { engine });
    seats.replace({
      inGame: true,
      selfSeatId: 1,
      controlledSeatIds: [1],
      seats: [1, 2].map((seatId) => ({
        seatId,
        displayOrder: seatId,
        playerName: `P${seatId}`,
        isSelf: seatId === 1,
        isAlive: true,
        knownCards: [],
        unknownCardCount: 3
      }))
    });
    const publishRaw = (payload: Record<string, unknown>) => {
      translateGameMessages([payload]).forEach((event) => bus.publish(event));
    };
    const knownOf = (seatId: number) => seats.getSnapshot().seats
      .find((seat) => seat.seatId === seatId)?.knownCards.map((card) => card.cardId) ?? [];
    const possibleOf = (seatId: number) => (seats.getSnapshot().seats
      .find((seat) => seat.seatId === seatId)?.possibleCards ?? []).map((card) => card.cardId);
    return { engine, dispose, publishRaw, knownOf, possibleOf };
  }

  it('GsCRoleOptTargetNtf 攻心 → 目标座位明牌', () => {
    const { engine, dispose, publishRaw, knownOf } = setup();
    publishRaw({
      ClassName: 'GsCRoleOptTargetNtf',
      SeatID: 1, SrcSeatID: 1, targetSeatID: 2, SpellID: 921, Param: 0, Params: [21, 22]
    });
    assert.deepEqual(knownOf(2), [21, 22]);
    assert.deepEqual(engine.getHandCardIds(2), [21, 22]);
    dispose();
  });

  it('密诏暗牌整手交出后，原座位明牌清空', () => {
    const { engine, dispose, publishRaw, knownOf } = setup();
    publishRaw({
      ClassName: 'GsCRoleOptTargetNtf',
      SeatID: 1, SrcSeatID: 1, targetSeatID: 2, SpellID: 921, Param: 0, Params: [21, 22]
    });
    publishRaw({
      ClassName: 'PubGsCMoveCard', SpellID: 605, MoveType: 27, CardCount: 3, CardIDs: [],
      FromID: 2, FromZone: 5, FromPosition: 0xff02, ToID: 1, ToZone: 5, ToPosition: 0xff00
    });
    assert.deepEqual(knownOf(2), []);
    assert.deepEqual(engine.getHandCardIds(2), []);
    dispose();
  });

  describe('暗牌部分移走 → 可能牌', () => {
    const giveOneHidden = (publishRaw: (payload: Record<string, unknown>) => void, from: number, to: number) => {
      publishRaw({
        ClassName: 'PubGsCMoveCard', SpellID: 1, MoveType: 27, CardCount: 1, CardIDs: [],
        FromID: from, FromZone: 5, FromPosition: 0xff02, ToID: to, ToZone: 5, ToPosition: 0xff00
      });
    };
    const reveal = (publishRaw: (payload: Record<string, unknown>) => void, cardIds: number[]) => {
      publishRaw({
        ClassName: 'GsCRoleOptTargetNtf',
        SeatID: 1, SrcSeatID: 1, targetSeatID: 2, SpellID: 921, Param: 0, Params: cardIds
      });
    };

    it('原座位与接收方都显示为可能牌', () => {
      const { dispose, publishRaw, knownOf, possibleOf } = setup();
      reveal(publishRaw, [21, 22]);
      giveOneHidden(publishRaw, 2, 1);
      assert.deepEqual(knownOf(2), []);
      assert.deepEqual(possibleOf(2), [21, 22]);
      assert.deepEqual(possibleOf(1), [21, 22]);
      dispose();
    });

    it('可能牌以明确卡号进入弃牌堆后两边都清除', () => {
      const { dispose, publishRaw, possibleOf } = setup();
      reveal(publishRaw, [21, 22]);
      giveOneHidden(publishRaw, 2, 1);
      publishRaw({
        ClassName: 'PubGsCMoveCard', SpellID: 0, MoveType: 16, CardCount: 1, CardIDs: [21],
        FromID: 1, FromZone: 5, FromPosition: 0xff02, ToID: 0, ToZone: 2, ToPosition: 0xff00
      });
      assert.deepEqual(possibleOf(2), [22]);
      assert.deepEqual(possibleOf(1), [22]);
      dispose();
    });

    it('接收方整手交出后，可能牌随之转移', () => {
      const { dispose, publishRaw, possibleOf } = setup();
      reveal(publishRaw, [21]);
      giveOneHidden(publishRaw, 2, 1);
      publishRaw({
        ClassName: 'PubGsCMoveCard', SpellID: 605, MoveType: 27, CardCount: 3, CardIDs: [],
        FromID: 1, FromZone: 5, FromPosition: 0xff02, ToID: 3, ToZone: 5, ToPosition: 0xff00
      });
      assert.deepEqual(possibleOf(1), []);
      assert.deepEqual(possibleOf(2), [21]);
      dispose();
    });

    it('原座位整手被看且没有该牌 → 确定在接收方', () => {
      const { dispose, publishRaw, knownOf, possibleOf } = setup();
      reveal(publishRaw, [21, 22]);
      giveOneHidden(publishRaw, 2, 1);
      reveal(publishRaw, [22]);
      assert.deepEqual(knownOf(2), [22]);
      assert.deepEqual(possibleOf(2), []);
      assert.deepEqual(possibleOf(1), []);
      assert.ok(knownOf(1).includes(21));
      dispose();
    });
  });

  it('CGsRoleSpellOptRep 牌堆鉴定写入引擎牌堆区', () => {
    const { engine, dispose, publishRaw } = setup();
    publishRaw({ ClassName: 'CGsRoleSpellOptRep', SeatID: 1, SpellID: 3868, Type: 50, Datas: [81, 82] });
    assert.deepEqual([...engine.getDrawPileCardIds()].sort(), [81, 82]);
    dispose();
  });

  it('同区展示并入明牌而非覆盖', () => {
    const { dispose, publishRaw, knownOf } = setup();
    publishRaw({
      ClassName: 'GsCRoleOptTargetNtf',
      SeatID: 1, SrcSeatID: 1, targetSeatID: 2, SpellID: 921, Param: 0, Params: [21]
    });
    publishRaw({
      ClassName: 'PubGsCMoveCard', CardCount: 1, CardIDs: [23],
      FromID: 2, FromZone: 5, ToID: 2, ToZone: 5, MoveType: 1, SpellID: 1
    });
    assert.deepEqual(knownOf(2).sort(), [21, 23]);
    dispose();
  });
});
