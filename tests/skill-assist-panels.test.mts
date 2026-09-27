import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createMingpaiEngine } from '../src/features/mingpai/index.ts';
import { createSkillAssistStore } from '../src/features/skill-assist/skill-assist-store.ts';
import { solveChengxiang, solveYicheng } from '../src/features/skill-assist/point-calculators.ts';
import { formatHezhong, formatQuandao } from '../src/features/skill-assist/panel-texts.ts';
import { translateGameMessages } from '../src/adapters/game-message-adapter.ts';

type Face = { name: string; suit: string; glyph: string; rank: string; type: number };
const FACES: Record<number, Face> = {
  101: { name: '杀', suit: 'spade', glyph: '♠', rank: '3', type: 1 },
  102: { name: '闪', suit: 'heart', glyph: '♥', rank: '5', type: 1 },
  103: { name: '无中生有', suit: 'heart', glyph: '♥', rank: '8', type: 2 },
  104: { name: '诸葛连弩', suit: 'club', glyph: '♣', rank: 'K', type: 3 },
  201: { name: '乐不思蜀', suit: 'spade', glyph: '♠', rank: 'A', type: 2 },
  202: { name: '过河拆桥', suit: 'diamond', glyph: '♦', rank: 'Q', type: 2 }
};
const catalog = {
  resolve: (cardId: number) => {
    const face = FACES[cardId];
    return {
      cardId,
      name: face?.name ?? '',
      suit: face?.suit ?? '',
      suitGlyph: face?.glyph ?? '',
      rank: face?.rank ?? '',
      isRed: face?.suit === 'heart' || face?.suit === 'diamond',
      cardType: face?.type ?? 0,
      artworkUrl: ''
    };
  },
  clear() {}
} as never;

function findPanel(store: ReturnType<typeof createSkillAssistStore>, id: string) {
  return store.getSnapshot().panels.find((panel) => panel.id === id)!;
}

function sceneWithSkill(seatId: number, skillId: number) {
  return {
    seatContainer: {
      seatUIs: [{ seat: { seatID: seatId, HasSkill: (id: number) => id === skillId } }]
    }
  } as never;
}

it('称象列出点数和不超过 13 的极大组合，界称象和为 13 的优先并高亮', () => {
  assert.deepEqual(
    solveChengxiang([3, 5, 8, 13], false).map((combo) => combo.ranks),
    [[5, 8], [3, 8], [3, 5], [13]]
  );
  const jie = solveChengxiang([3, 5, 8, 13], true);
  assert.deepEqual(jie.map((combo) => combo.ranks), [[5, 8], [13], [3, 8], [3, 5]]);
  assert.deepEqual(jie.map((combo) => combo.exact), [true, true, false, false]);
});

it('易城给出多张交换与单张交换方案', () => {
  assert.deepEqual(solveYicheng([3, 9], [5, 10]), ['5,10→3,9', '5→3', '10→3/9']);
  assert.deepEqual(solveYicheng([10], [5]), []);
});

it('和衷先比第一组锦囊，平了再比第二组；权道统计杀与普通锦囊', () => {
  const faces = [103, 202, 201].map((id) => catalog.resolve(id));
  assert.equal(formatHezhong(9, faces), '【和衷】平\n1.0大 1.0小');
  assert.equal(formatQuandao([101, 103, 201, 202].map((id) => catalog.resolve(id))), '【权道】杀：普通锦囊\n1：2');
});

it('称象亮牌后面板列出可复制组合', () => {
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog);
  store.handleGameEvent({
    type: 'cards-moved', cardCount: 4, cardIds: [101, 102, 103, 104],
    fromId: 255, fromZone: 1, fromPosition: 0xff00, fromZoneParam: 0,
    toId: 255, toZone: 8, toPosition: 0, toZoneParam: 0, moveType: 6, spellId: 3492
  }, null);
  const panel = findPanel(store, 'chengxiang');
  assert.equal(panel.visible, true);
  assert.deepEqual(panel.resultOptions, ['5+8', 'K', '3+8', '3+5']);
  assert.deepEqual(panel.highlightedOptions, [true, true, false, false]);
});

it('吉占用本局牌表减去已知在别处的牌来比较点数', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(201, 0, []);
  const store = createSkillAssistStore(engine, catalog);
  store.handleGameEvent({ type: 'card-list-ready', cardIds: [101, 102, 103, 104, 201, 202] }, null);
  store.handleGameEvent({
    type: 'cards-moved', cardCount: 1, cardIds: [103],
    fromId: 255, fromZone: 1, fromPosition: 0xff00, fromZoneParam: 0,
    toId: 255, toZone: 8, toPosition: 0, toZoneParam: 0, moveType: 6, spellId: 3033
  }, null);
  assert.equal(findPanel(store, 'jizhan').resultText, '【吉占】猜小\n跟8比，2张大 2张小 0平');
});

it('双雄只在本家拥有时显示，实时统计本家手牌与装备的红黑张数', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(102, 0, []);
  engine.observeKnownHandCard(103, 0, []);
  const store = createSkillAssistStore(engine, catalog, {
    isSelfSeat: (seatId) => seatId === 0,
    getControlledSeatIds: () => [0]
  });
  store.setInGame(true);
  store.refreshVisibility(sceneWithSkill(1, 3269));
  assert.equal(findPanel(store, 'shuangxiong').visible, false);
  store.refreshVisibility(sceneWithSkill(0, 3269));
  assert.equal(findPanel(store, 'shuangxiong').resultText, '【双雄】弃 黑\n2红 0黑');
  engine.observeKnownHandCard(101, 0, []);
  assert.equal(findPanel(store, 'shuangxiong').resultText, '【双雄】弃 黑\n2红 1黑');
});

it('称象不随座位技能显示；标准版双雄（101）不显示', () => {
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog, {
    isSelfSeat: (seatId) => seatId === 0,
    getControlledSeatIds: () => [0]
  });
  store.setInGame(true);
  store.refreshVisibility(sceneWithSkill(0, 3492));
  assert.equal(findPanel(store, 'chengxiang').visible, false);
  store.refreshVisibility(sceneWithSkill(0, 101));
  assert.equal(findPanel(store, 'shuangxiong').visible, false);
  store.refreshVisibility(sceneWithSkill(0, 3269));
  assert.equal(findPanel(store, 'shuangxiong').visible, true);
});

it('技能事件算出结果后，座位技能轮询不会把面板隐藏清空', () => {
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog);
  store.setInGame(true);
  store.handleGameEvent({
    type: 'cards-moved', cardCount: 2, cardIds: [101, 102],
    fromId: 255, fromZone: 1, fromPosition: 0xff00, fromZoneParam: 0,
    toId: 255, toZone: 8, toPosition: 0, toZoneParam: 0, moveType: 6, spellId: 3492
  }, null);
  store.refreshVisibility(sceneWithSkill(0, 1));
  const panel = findPanel(store, 'chengxiang');
  assert.equal(panel.visible, true);
  assert.deepEqual(panel.resultOptions, ['3+5']);
  store.handleGameEvent({ type: 'game-ended' }, null);
  assert.equal(findPanel(store, 'chengxiang').visible, false);
});

it('权变统计当前回合角色从手牌使用的非装备牌与花色，换回合重新计数；乱击、渐营不跟着显示', () => {
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog);
  const scene = sceneWithSkill(2, 7011);
  store.handleGameEvent({ type: 'game-started' }, scene);
  store.refreshVisibility(scene);
  assert.equal(findPanel(store, 'quanbian').visible, true);
  assert.equal(findPanel(store, 'luanji'), undefined);
  assert.equal(findPanel(store, 'jianying').visible, false);
  store.handleGameEvent({ type: 'turn-started', seatId: 2, turnCount: 1, round: 0 }, scene);
  const use = (cardId: number, fromZone: number) => store.handleGameEvent({
    type: 'cards-used', seatId: 2, cardIds: [cardId], source: 'use-card', useType: 1, isSend: false, fromZone
  }, scene);
  use(101, 5);
  use(104, 5);
  use(102, 1);
  assert.deepEqual(findPanel(store, 'quanbian').suitTokens, ['[1]', '♠', '♣']);
  store.handleGameEvent({ type: 'turn-started', seatId: 3, turnCount: 2, round: 0 }, scene);
  use(102, 5);
  assert.deepEqual(findPanel(store, 'quanbian').suitTokens, ['[1]', '♠', '♣']);
  store.handleGameEvent({ type: 'turn-started', seatId: 2, turnCount: 3, round: 0 }, scene);
  use(102, 5);
  assert.deepEqual(findPanel(store, 'quanbian').suitTokens, ['[1]', '♥']);
});

it.skip('乱击只记录本回合发动乱击用过的花色（乱击暂时停用）', () => {
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog);
  const scene = sceneWithSkill(2, 2143);
  store.handleGameEvent({ type: 'game-started' }, scene);
  store.refreshVisibility(scene);
  assert.equal(findPanel(store, 'luanji').visible, true);
  assert.equal(findPanel(store, 'quanbian').visible, false);
  const luanji = (cardIds: number[]) => store.handleGameEvent({
    type: 'spell-targeted', seatId: 2, spellId: 2143, targetSeatIds: [], cardIds
  }, scene);
  luanji([101, 102]);
  luanji([103, 104]);
  assert.deepEqual(findPanel(store, 'luanji').suitTokens, ['♠', '♥', '♣']);
  store.handleGameEvent({ type: 'turn-started', seatId: 2, turnCount: 2, round: 0 }, scene);
  luanji([102]);
  assert.deepEqual(findPanel(store, 'luanji').suitTokens, ['♥']);
});

it('易城仅在 Type=28 时计算交换方案', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(102, 0, []);
  const store = createSkillAssistStore(engine, catalog, {
    isSelfSeat: (seatId) => seatId === 0,
    getControlledSeatIds: () => [0]
  });
  const optTarget = (spellId: number, srcSeatId: number, params: number[], optType: number) => store.handleGameEvent({
    type: 'opt-target', seatId: srcSeatId, srcSeatId, targetSeatId: 255, spellId, param: 0, params, optType
  }, null);
  optTarget(3440, 0, [101], 28);
  assert.deepEqual(findPanel(store, 'yicheng').resultOptions, ['5→3']);
  optTarget(3440, 0, [101], 27);
  assert.deepEqual(findPanel(store, 'yicheng').resultOptions, []);
  assert.equal(findPanel(store, 'duanzao'), undefined);
});

it('吉占 SpellOptRep Type=31 也能出结果；没收到牌表时直接说明', () => {
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog);
  const optRep = (datas: number[]) => store.handleGameEvent({
    type: 'spell-opt-rep', seatId: 3, spellId: 3033, optType: 31, datas
  }, null);
  optRep([1, 103, 1, 8, 0]);
  assert.equal(findPanel(store, 'jizhan').resultText, '【吉占】跟8比\n未收到本局牌表，无法统计牌堆');
  store.handleGameEvent({ type: 'card-list-ready', cardIds: [101, 102, 103, 104, 201, 202] }, null);
  optRep([1, 103, 1, 8, 0]);
  assert.equal(findPanel(store, 'jizhan').resultText, '【吉占】猜小\n跟8比，2张大 3张小 0平');
});

it('和衷用 OptTarget 的 Param 作为比较点数', () => {
  const store = createSkillAssistStore(createMingpaiEngine(null), catalog);
  store.handleGameEvent({ type: 'card-list-ready', cardIds: [103, 201, 202] }, null);
  const optTarget = (param: number) => store.handleGameEvent({
    type: 'opt-target', seatId: 6, srcSeatId: 6, targetSeatId: 255, spellId: 3329, param, params: []
  }, null);
  optTarget(0);
  assert.equal(findPanel(store, 'hezhong').visible, false);
  optTarget(9);
  assert.equal(findPanel(store, 'hezhong').resultText, '【和衷】平\n1.0大 1.0小');
});

it('权道只在本家是神孙权时显示，武将名读座位上的武将对象', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(101, 0, []);
  const store = createSkillAssistStore(engine, catalog, {
    isSelfSeat: (seatId) => seatId === 0,
    getControlledSeatIds: () => [0]
  });
  store.setInGame(true);
  const scene = (seatId: number) => ({
    seatContainer: { seatUIs: [{ seat: { seatID: seatId, HasSkill: () => false, General: { cardName: '神孙权' } } }] }
  }) as never;
  store.refreshVisibility(scene(1));
  assert.equal(findPanel(store, 'quandao').visible, false);
  store.refreshVisibility(scene(0));
  assert.equal(findPanel(store, 'quandao').resultText, '【权道】杀：普通锦囊\n1：0');
});

it('协议解析：触发技能、本局牌表、OptTarget 的 Type、用牌的 fromZone', () => {
  assert.deepEqual(translateGameMessages([{
    ClassName: 'GsCTriggerSpellNew', TriggerSeatId: 1, TriggerSpellData: [{ SpellId: 3269 }]
  }]), [{ type: 'spell-triggered', seatId: 1, spellIds: [3269] }]);
  assert.deepEqual(translateGameMessages([{ ClassName: 'MsgGamePlayCardNtf', CardList: [0, 101, 102] }]),
    [{ type: 'card-list-ready', cardIds: [101, 102] }]);
  assert.deepEqual(translateGameMessages([{ ClassName: 'MsgGamePlayCardNtf', ProtoObj: { CardList: new Uint16Array([7, 8]) } }]),
    [{ type: 'card-list-ready', cardIds: [7, 8] }]);
  const [optTarget] = translateGameMessages([{
    ClassName: 'GsCRoleOptTargetNtf', SeatID: 0, SpellID: 3440, Param: 0, Params: [101], Type: 28
  }]);
  assert.equal((optTarget as { optType?: number }).optType, 28);
  const [used] = translateGameMessages([{
    ClassName: 'PubGsCUseCard', SeatID: 2, CardID: 101, UseType: 1, fromZone: 5
  }]);
  assert.equal((used as { fromZone?: number }).fromZone, 5);
});
