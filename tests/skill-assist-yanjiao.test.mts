import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createMingpaiEngine } from '../src/features/mingpai/index.ts';
import { createSkillAssistStore } from '../src/features/skill-assist/skill-assist-store.ts';

const RANKS: Record<number, string> = { 101: '3', 102: '5', 103: '8', 104: 'K', 201: 'A', 202: 'Q' };
const catalog = {
  resolve: (cardId: number) => ({ cardId, name: '', suit: '', suitGlyph: '', rank: RANKS[cardId] ?? '', isRed: false, cardType: 0, artworkUrl: '' }),
  clear() {}
} as never;

function findPanel(store: ReturnType<typeof createSkillAssistStore>, id: string) {
  return store.getSnapshot().panels.find((panel) => panel.id === id)!;
}

it('严教亮牌协议触发分组计算，Params 为空时读 CardIDs', () => {
  const store = createSkillAssistStore(createMingpaiEngine(), catalog);
  store.handleGameEvent({
    type: 'opt-target', seatId: 2, srcSeatId: 2, targetSeatId: 0,
    spellId: 0x3b1, param: 0, params: [], cardIds: [101, 102, 103, 104]
  }, null);
  const panel = findPanel(store, 'yanjiao');
  assert.equal(panel.visible, true);
  assert.equal(panel.resultOptions[0], 'K=5+8');
  assert.equal(panel.resultText, null);
});

it('资援面板只在本家拥有资援时显示', () => {
  const scene = (selfHasSkill: boolean) => ({
    seatContainer: {
      seatUIs: [
        { seat: { seatID: 0, HasSkill: (id: number) => selfHasSkill && id === 291 } },
        { seat: { seatID: 1, HasSkill: (id: number) => id === 291 } }
      ]
    }
  }) as never;
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog, {
    isSelfSeat: (seatId) => seatId === 0,
    getControlledSeatIds: () => [0]
  });
  store.setInGame(true);
  store.refreshVisibility(scene(false));
  assert.equal(findPanel(store, 'mizhu').visible, false);
  store.refreshVisibility(scene(true));
  assert.equal(findPanel(store, 'mizhu').visible, true);
});

it('资援按受控座位手牌列出和为 13 的组合', () => {
  const engine = createMingpaiEngine();
  engine.observeKnownHandCard(201, 0, []);
  engine.observeKnownHandCard(202, 0, []);
  const store = createSkillAssistStore(engine, catalog, {
    isSelfSeat: (seatId) => seatId === 0,
    getControlledSeatIds: () => [0]
  });
  store.setPanelVisible('mizhu', true);
  assert.deepEqual(findPanel(store, 'mizhu').resultOptions, ['1+Q']);
});
