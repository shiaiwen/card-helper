import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import { installMingpaiController } from '../src/features/mingpai/index.ts';

const moveDefaults = {
  fromPosition: 0xff02, fromZoneParam: 0, toPosition: 0xff00, toZoneParam: 0
};

it('技能交出的牌已按卡号移动后，对方随后的暗牌摸牌不能再套用该技能线索', () => {
  (globalThis as Record<string, unknown>).window ??= {};
  const trace = ((globalThis as any).window.__XIAOCHAO_MINGPAI_TRACE__ = []);
  const bus = createGameEventBus();
  const seats = createSeatStateStore(null as never);
  const { dispose } = installMingpaiController(seats, bus);

  bus.publish({ type: 'spell-targeted', seatId: 0, spellId: 31, targetSeatIds: [4], cardIds: [57, 6] });
  bus.publish({
    type: 'cards-moved', ...moveDefaults, cardCount: 2, cardIds: [57, 6],
    fromId: 0, fromZone: 5, toId: 4, toZone: 5, moveType: 27, spellId: 31
  });
  bus.publish({
    type: 'cards-moved', ...moveDefaults, cardCount: 2, cardIds: [],
    fromId: 255, fromZone: 1, toId: 4, toZone: 5, moveType: 1, spellId: 0
  });

  const draw = trace.filter((entry: any) => entry.kind === 'move').at(-1);
  assert.deepEqual(draw.detail.resolvedIds.filter((cardId: number) => cardId > 0), []);
  dispose();
});
