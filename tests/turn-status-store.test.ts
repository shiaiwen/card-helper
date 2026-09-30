import assert from 'node:assert/strict';
import test from 'node:test';
import { translateGameMessages } from '../src/adapters/game-message-adapter.ts';
import {
  createTurnStatusStore,
  formatPhase,
  formatShaRemaining,
  remainingSha
} from '../src/features/turn-status/turn-status-store.ts';

test('回合开始的阶段消息同时产生 turn-started 与 phase-changed', () => {
  assert.deepEqual(translateGameMessages([{ ClassName: 'GsCGamephaseNtf', SeatID: 2, Round: 0 }]), [
    { type: 'turn-started', seatId: 2, turnCount: 0, round: 0 },
    { type: 'phase-changed', seatId: 2, phase: 0 }
  ]);
});

test('GsCUpdateRoleDataExNtf DataID=1 翻译为出杀次数', () => {
  assert.deepEqual(
    translateGameMessages([{ ClassName: 'GsCUpdateRoleDataExNtf', SeatID: 1, DataID: 1, Datas: [0, 1, 2] }]),
    [{ type: 'sha-count-updated', seatId: 1, used: 1, limit: 2 }]
  );
  assert.deepEqual(
    translateGameMessages([{ ClassName: 'GsCUpdateRoleDataExNtf', SeatID: 1, DataID: 2, Datas: [0, 1, 2] }]),
    []
  );
});

test('剩余出杀：上限 <0 或 ≥99 视为无限', () => {
  assert.equal(remainingSha(0, 1), 1);
  assert.equal(remainingSha(3, 1), 0);
  assert.equal(remainingSha(0, -1), Infinity);
  assert.equal(remainingSha(0, 99), Infinity);
  assert.equal(formatShaRemaining(null), '-');
  assert.equal(formatShaRemaining(Infinity), '∞');
  assert.equal(formatPhase(null), '等待开局');
  assert.equal(formatPhase(0), '回合开始时');
  assert.equal(formatPhase(4), '出牌阶段（4）');
  assert.equal(formatPhase(6), '结束阶段（6）');
});

test('同一回合内保留出杀次数，换人或新回合时清空', () => {
  const store = createTurnStatusStore();
  store.handleGameEvent({ type: 'phase-changed', seatId: 1, phase: 0 });
  store.handleGameEvent({ type: 'sha-count-updated', seatId: 1, used: 0, limit: 1 });
  store.handleGameEvent({ type: 'phase-changed', seatId: 1, phase: 4 });
  assert.deepEqual(store.getSnapshot(), { currentSeatId: 1, phase: 4, shaRemaining: 1 });

  store.handleGameEvent({ type: 'sha-count-updated', seatId: 3, used: 0, limit: 5 });
  assert.equal(store.getSnapshot().shaRemaining, 1);

  store.handleGameEvent({ type: 'phase-changed', seatId: 2, phase: 0 });
  assert.deepEqual(store.getSnapshot(), { currentSeatId: 2, phase: 0, shaRemaining: null });

  store.handleGameEvent({ type: 'game-ended' } as never);
  assert.deepEqual(store.getSnapshot(), { currentSeatId: null, phase: null, shaRemaining: null });
});
