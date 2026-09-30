import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import { installSeatStateController } from '../src/features/seat-display/seat-state-controller.ts';

test('座位控制器跟随进入、重连和离开牌局，并在销毁时清空状态', () => {
  let tick: (() => void) | undefined;
  let clearedInterval: unknown;
  const runtime = {
    __XIAOCHAO_GAME_SCENE__: undefined as unknown,
    setInterval(callback: () => void) {
      tick = callback;
      return 17;
    },
    clearInterval(intervalId: unknown) {
      clearedInterval = intervalId;
    }
  };
  const store = createSeatStateStore();
  const stop = installSeatStateController(store, runtime as never, { sceneMissingGraceMs: 0 });
  assert.equal(store.getSnapshot().inGame, false);

  runtime.__XIAOCHAO_GAME_SCENE__ = createScene(1);
  tick?.();
  assert.equal(store.getSnapshot().selfSeatId, 1);

  runtime.__XIAOCHAO_GAME_SCENE__ = createScene(3);
  tick?.();
  assert.equal(store.getSnapshot().selfSeatId, 3);

  runtime.__XIAOCHAO_GAME_SCENE__ = undefined;
  tick?.();
  assert.equal(store.getSnapshot().inGame, false);

  stop();
  assert.equal(clearedInterval, 17);
  assert.equal(store.getSnapshot().inGame, false);
});

function createScene(seatID: number) {
  return {
    seatContainer: {
      seatUIs: [{ seat: { seatID, isSelf: true } }]
    }
  };
}
