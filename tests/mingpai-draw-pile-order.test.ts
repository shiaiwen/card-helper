import assert from 'node:assert/strict';
import test from 'node:test';
import { createMingpaiEngine } from '../src/features/mingpai/mingpai-engine.ts';

const TOP = 0xff00;
const BOTTOM = 0;
const UNSPECIFIED = 0xff02;

function move(fields: Partial<Parameters<ReturnType<typeof createMingpaiEngine>['applyMovement']>[0]>) {
  return {
    cardCount: 0, cardIds: [], fromId: 0xff, fromZone: 1, fromPosition: TOP, fromZoneParam: 0,
    toId: 0xff, toZone: 1, toPosition: TOP, toZoneParam: 0, ...fields
  };
}

function apply(engine: ReturnType<typeof createMingpaiEngine>, movement: ReturnType<typeof move>) {
  const resolved = engine.resolveHiddenMovement(movement);
  engine.applyMovement(movement, resolved);
  return resolved;
}

test('观星放回牌堆顶后，他人暗摸按顺序推算出摸到的牌（消息最后一张在最上面）', () => {
  const engine = createMingpaiEngine(null);
  // 实机 03:54:21：观星放回 [五谷丰登#30, 杀♣5#57, 杀♠9#100]，随后 6 号暗摸 2 张并打出杀♣5。
  apply(engine, move({ cardCount: 3, cardIds: [30, 57, 100], fromId: 0xff, fromZone: 8, fromPosition: UNSPECIFIED, toPosition: TOP }));
  const drawn = apply(engine, move({ cardCount: 2, cardIds: [], toId: 6, toZone: 5, toPosition: TOP }));
  assert.deepEqual(drawn, [100, 57]);
  assert.deepEqual([...engine.getHandCardIds(6)].sort((a, b) => a - b), [57, 100]);
  // 下一次观星看到五谷丰登仍在最上面。
  assert.deepEqual(engine.resolveHiddenMovement(move({ cardCount: 1, cardIds: [], toId: 3, toZone: 5 })), [30]);
});

test('摸牌数量少于已知牌堆顶时不再要求数量完全相等', () => {
  const engine = createMingpaiEngine(null);
  apply(engine, move({ cardCount: 3, cardIds: [138, 28, 119], fromZone: 8, fromPosition: UNSPECIFIED, toPosition: TOP }));
  assert.deepEqual(apply(engine, move({ cardCount: 2, cardIds: [], toId: 4, toZone: 5 })), [119, 28]);
  assert.deepEqual(apply(engine, move({ cardCount: 1, cardIds: [], toId: 4, toZone: 5 })), [138]);
});

test('放到牌堆底的牌不会被当成牌堆顶摸走', () => {
  const engine = createMingpaiEngine(null);
  apply(engine, move({ cardCount: 3, cardIds: [84, 15, 22], fromZone: 8, fromPosition: UNSPECIFIED, toPosition: BOTTOM }));
  assert.deepEqual(apply(engine, move({ cardCount: 3, cardIds: [], toId: 4, toZone: 5 })), [0, 0, 0]);
  assert.deepEqual(engine.getHandCardIds(4), []);
});

test('明摸同样推进牌堆顶顺序', () => {
  const engine = createMingpaiEngine(null);
  apply(engine, move({ cardCount: 3, cardIds: [1, 2, 3], fromZone: 8, fromPosition: UNSPECIFIED, toPosition: TOP }));
  apply(engine, move({ cardCount: 1, cardIds: [3], toId: 0, toZone: 5 }));
  assert.deepEqual(apply(engine, move({ cardCount: 2, cardIds: [], toId: 2, toZone: 5 })), [2, 1]);
});
