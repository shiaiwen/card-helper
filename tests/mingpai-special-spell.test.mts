import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSpecialSpellRecovery } from '../src/features/mingpai/special-spell-recovery.ts';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import { createMingpaiEngine, installMingpaiController } from '../src/features/mingpai/index.ts';

const TOP = 0xff00;
const UNSPECIFIED = 0xff02;
const RED = new Set([1, 2, 3]);

function move(over: Record<string, unknown>) {
  return {
    type: 'cards-moved' as const,
    cardCount: 1, cardIds: [0], fromId: 0, fromZone: 5, fromPosition: UNSPECIFIED, fromZoneParam: 0,
    toId: 0, toZone: 5, toPosition: TOP, toZoneParam: 0, moveType: 1, spellId: 0, srcSeatId: null,
    ...over
  };
}

function setup(hands: Record<number, { known: number[]; unknownCount: number }> = {}, zones: Record<string, number[]> = {}) {
  return createSpecialSpellRecovery({
    hand: (seatId) => hands[seatId] ?? { known: [], unknownCount: 0 },
    zoneCardIds: (seatId, zone) => zones[`${zone}-${seatId}`] ?? [],
    isControlledSeat: (seatId) => seatId === 0,
    isRedCard: (cardId) => RED.has(cardId)
  });
}

describe('特殊技能暗牌还原', () => {
  it('3065 周旋：亮出的牌暗置武将牌上', () => {
    const recovery = setup();
    recovery.observe({ type: 'spell-targeted', seatId: 2, spellId: 3065, targetSeatIds: [], cardIds: [41, 42], effectIndex: 1 });
    assert.deepEqual(recovery.recover(move({
      cardCount: 2, cardIds: [0, 0], fromId: 2, toId: 2, toZone: 4, toZoneParam: 3065, moveType: 15, spellId: 3065
    })), [41, 42]);
  });

  it('3157：亮出的牌从弃牌堆暗置入手', () => {
    const recovery = setup();
    recovery.observe({ type: 'spell-targeted', seatId: 3, spellId: 3157, targetSeatIds: [], cardIds: [51] });
    assert.deepEqual(recovery.recover(move({ fromId: 255, fromZone: 2, toId: 3, spellId: 3157 })), [51]);
  });

  it('3750：EffectIndex=2 亮出的牌暗置牌堆顶', () => {
    const recovery = setup();
    recovery.observe({ type: 'spell-targeted', seatId: 4, spellId: 3750, targetSeatIds: [], cardIds: [61], effectIndex: 2 });
    assert.deepEqual(recovery.recover(move({
      fromId: 255, fromZone: 2, toId: 255, toZone: 1, toPosition: TOP, moveType: 15, spellId: 3750, srcSeatId: 4
    })), [61]);
  });

  it('361 狭书：选择拿走展示牌', () => {
    const recovery = setup({ 5: { known: [71, 72], unknownCount: 2 } });
    recovery.observe({ type: 'spell-targeted', seatId: 1, spellId: 361, targetSeatIds: [5], cardIds: [] });
    recovery.recover(move({ cardCount: 2, cardIds: [71, 72], fromId: 5, toId: 5, moveType: 21, spellId: 361 }));
    recovery.observe({ type: 'spell-opt-rep', seatId: 1, spellId: 361, optType: 22, datas: [1] });
    assert.deepEqual(recovery.recover(move({
      cardCount: 2, cardIds: [0, 0], fromId: 5, toId: 1, moveType: 18, spellId: 361
    })), [71, 72]);
  });

  it('3488：展示 → 技能区 → 牌堆，全程补回同一张', () => {
    const recovery = setup();
    const shown = move({ cardIds: [81], fromId: 2, toId: 2, moveType: 21, spellId: 3488 });
    recovery.record(shown, [81]);
    assert.deepEqual(recovery.recover(move({ fromId: 2, toId: 2, toZone: 10, moveType: 11, spellId: 3488 })), [81]);
    assert.deepEqual(recovery.recover(move({
      fromId: 2, fromZone: 10, toId: 255, toZone: 1, moveType: 11, spellId: 3488
    })), [81]);
  });

  it('3543：从弃牌堆暗置牌堆的是最近的红色牌', () => {
    const recovery = setup();
    recovery.record(move({ cardCount: 4, toId: 255, toZone: 2 }), [1, 90, 2, 91]);
    assert.deepEqual(recovery.recover(move({
      cardCount: 2, cardIds: [0, 0], fromId: 255, fromZone: 2, toId: 255, toZone: 1, spellId: 3543
    })), [2, 1]);
  });

  it('3571：判定牌按座位颜色回到手牌', () => {
    const recovery = setup({}, { '8-6': [3, 95] });
    recovery.observe({ type: 'spell-targeted', seatId: 6, spellId: 3571, targetSeatIds: [6], cardIds: [], effectIndex: 1 });
    recovery.observe({ type: 'spell-data-updated', seatId: 6, dataId: 3571, datas: [1] });
    recovery.record(move({
      cardCount: 2, fromId: 255, fromZone: 3, toId: 6, toZone: 8, moveType: 6, spellId: 3571, srcSeatId: 6
    }), [3, 95]);
    assert.deepEqual(recovery.recover(move({
      fromId: 6, fromZone: 8, toId: 6, toZone: 5, moveType: 8, spellId: 3571
    })), [3]);
  });

  it('780：当前角色交出的牌被对方暗放回牌堆', () => {
    const recovery = setup({ 3: { known: [99], unknownCount: 2 } });
    recovery.observe({ type: 'phase-changed', seatId: 1, phase: 4 });
    recovery.record(move({ cardIds: [99], fromId: 1, toId: 3, spellId: 780 }), [99]);
    assert.deepEqual(recovery.recover(move({ fromId: 3, toId: 255, toZone: 1, spellId: 780 })), [99]);
  });

  it('3511：本家亮出的牌从弃牌堆暗置入手', () => {
    const recovery = setup();
    recovery.observe({ type: 'spell-targeted', seatId: 0, spellId: 3511, targetSeatIds: [], cardIds: [11, 12] });
    assert.deepEqual(recovery.recover(move({
      cardCount: 2, cardIds: [0, 0], fromId: 255, fromZone: 2, toId: 0, spellId: 3511
    })), [11, 12]);
  });

  it('数量不符时不补', () => {
    const recovery = setup();
    recovery.observe({ type: 'spell-targeted', seatId: 3, spellId: 3157, targetSeatIds: [], cardIds: [51, 52] });
    assert.equal(recovery.recover(move({ fromId: 255, fromZone: 2, toId: 3, spellId: 3157 })), null);
  });
});

it('MoveType 24 整手展示：未展示的已知牌不再算该座位手牌', () => {
  (globalThis as Record<string, unknown>).window ??= {};
  const bus = createGameEventBus();
  const seats = createSeatStateStore(null as never);
  const { dispose } = installMingpaiController(seats, bus, { engine: createMingpaiEngine(null) });
  seats.replace({
    inGame: true,
    selfSeatId: 1,
    controlledSeatIds: [1],
    seats: [1, 2].map((seatId) => ({
      seatId, displayOrder: seatId, playerName: `P${seatId}`, isSelf: seatId === 1,
      isAlive: true, knownCards: [], unknownCardCount: 3
    }))
  });
  bus.publish({ type: 'hand-cards-revealed', seatId: 2, cardIds: [31, 32, 33] });
  bus.publish(move({ cardCount: 2, cardIds: [31, 32], fromId: 2, toId: 2, moveType: 24 }));
  const seat = seats.getSnapshot().seats.find((entry) => entry.seatId === 2);
  assert.deepEqual(seat?.knownCards.map((card) => card.cardId).sort(), [31, 32]);
  dispose();
});

it('协议解析带出 EffectIndex / SrcSeatID / 技能数据', async () => {
  const { translateGameMessages } = await import('../src/adapters/game-message-adapter.ts');
  const [spell] = translateGameMessages([{
    ClassName: 'PubGsCUseSpell', SeatID: 2, SpellID: 3065, EffectIndex: 1, CardIDs: [41], DestSeatIDs: []
  }]);
  assert.equal((spell as { effectIndex?: number }).effectIndex, 1);
  const [moved] = translateGameMessages([{
    ClassName: 'PubGsCMoveCard', CardCount: 1, CardIDs: [0], MoveType: 15, FromZone: 2, ToZone: 1, SrcSeatID: 4
  }]);
  assert.equal((moved as { srcSeatId?: number }).srcSeatId, 4);
  const events = translateGameMessages([{
    ClassName: 'GsCUpdateRoleDataExNtf', SeatID: 6, IsSpell: true, DataID: 3571, Datas: [2]
  }]);
  assert.deepEqual(events.find((event) => event.type === 'spell-data-updated'), {
    type: 'spell-data-updated', seatId: 6, dataId: 3571, datas: [2]
  });
});
