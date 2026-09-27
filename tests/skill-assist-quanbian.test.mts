import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import {
  createMingpaiEngine,
  formatZoneId,
  installMingpaiController,
  MINGPAI_ZONE,
  partitionCandidatesByMingpai
} from '../src/features/mingpai/index.ts';
import { createSkillAssistStore } from '../src/features/skill-assist/skill-assist-store.ts';
import { appendSuitToken, cardIdToSuitToken, parseSuitToken } from '../src/features/skill-assist/quanbian.ts';
import { formatYanxiResult } from '../src/features/skill-assist/yanxi.ts';
import type { GameCardCatalog } from '../src/features/cards/game-card-catalog.ts';

function createFakeCatalog(): GameCardCatalog {
  const names: Record<number, string> = { 1: '杀', 2: '闪', 3: '桃', 5: '酒', 11: '无中', 12: '过河' };
  return {
    resolve(cardId) {
      const suits = [
        { suit: 'heart', glyph: '♥', red: true },
        { suit: 'diamond', glyph: '♦', red: true },
        { suit: 'spade', glyph: '♠', red: false },
        { suit: 'club', glyph: '♣', red: false }
      ] as const;
      const suit = suits[(cardId - 1) % 4];
      return Object.freeze({
        cardId,
        name: names[cardId] || `牌${cardId}`,
        suit: suit.suit,
        suitGlyph: suit.glyph,
        rank: String(((cardId - 1) % 13) + 1),
        isRed: suit.red,
        cardType: 1,
        artworkUrl: ''
      });
    },
    clear() {}
  };
}

function createSeatScene(skillIdsBySeat: Record<number, number[]>) {
  return {
    seatContainer: {
      seatUIs: Object.entries(skillIdsBySeat).map(([seatId, skillIds]) => ({
        seat: {
          seatID: Number(seatId),
          HasSkill(skillId: number) {
            return skillIds.includes(skillId);
          }
        }
      }))
    }
  };
}

describe('mingpai engine', () => {
  it('tracks hand location, findKZ zones, and unknown from temporary moves', () => {
    const engine = createMingpaiEngine(null);
    const seats = createSeatStateStore(null);
    const bus = createGameEventBus();
    const { dispose } = installMingpaiController(seats, bus, { engine });

    bus.publish({ type: 'game-started' });
    bus.publish({
      type: 'cards-moved',
      cardCount: 1,
      cardIds: [11],
      fromId: 0xff,
      fromZone: 1,
      fromPosition: 0xff00,
      fromZoneParam: 0,
      toId: 2,
      toZone: 5,
      toPosition: 0,
      toZoneParam: 0,
      moveType: 1,
      spellId: 0
    });
    assert.deepEqual(engine.getHandCardIds(2), [11]);
    assert.deepEqual(engine.findKZ(11).zones, [formatZoneId(2, 5)]);

    bus.publish({
      type: 'cards-moved',
      cardCount: 1,
      cardIds: [11],
      fromId: 2,
      fromZone: 5,
      fromPosition: 0,
      fromZoneParam: 0,
      toId: 2,
      toZone: 8,
      toPosition: 0,
      toZoneParam: 0,
      moveType: 1,
      spellId: 100
    });
    assert.ok(engine.getZoneCardIds(MINGPAI_ZONE.UNKNOWN).includes(11));
    assert.ok(engine.findKZ(11).zones.includes(MINGPAI_ZONE.UNKNOWN));

    dispose();
  });

  it('partitions yanxi candidates via findKZ', () => {
    const engine = createMingpaiEngine(null);
    engine.observeKnownHandCard(1, 1, []);
    engine.applyMovement({
      cardCount: 1,
      cardIds: [2],
      fromId: 0xff,
      fromZone: 1,
      fromPosition: 0,
      fromZoneParam: 0,
      toId: 0xff,
      toZone: 1,
      toPosition: 0,
      toZoneParam: 0,
      moveType: 1
    }, [2]);
    engine.applyMovement({
      cardCount: 1,
      cardIds: [3],
      fromId: 0xff,
      fromZone: 1,
      fromPosition: 0,
      fromZoneParam: 0,
      toId: 0xff,
      toZone: 1,
      toPosition: 0,
      toZoneParam: 0,
      moveType: 1
    }, [3]);
    const part = partitionCandidatesByMingpai(engine, [1, 2, 3]);
    assert.deepEqual(part.handCardIds, [1]);
    assert.ok(part.deckCardIds.includes(2));
  });
});

describe('skill-assist', () => {
  it('quanbian suits and reads unknown zone from mingpai', () => {
    const catalog = createFakeCatalog();
    const engine = createMingpaiEngine(null);
    const store = createSkillAssistStore(engine, catalog);
    const scene = createSeatScene({ 1: [0x1eb] });
    store.handleGameEvent({ type: 'game-started' }, scene);
    store.refreshVisibility(scene);
    store.handleGameEvent({ type: 'turn-started', seatId: 1, turnCount: 1, round: 0 }, scene);
    store.handleGameEvent({
      type: 'cards-used',
      seatId: 1,
      cardIds: [1],
      source: 'use-card',
      useType: 1,
      isSend: false
    }, scene);
    assert.deepEqual(
      store.getSnapshot().panels.find((p) => p.id === 'quanbian')?.suitTokens,
      [cardIdToSuitToken(1, catalog)]
    );
    engine.projectSkillCards(MINGPAI_ZONE.UNKNOWN, [9]);
    assert.deepEqual(
      store.getSnapshot().panels.find((p) => p.id === 'quanbian')?.cardIds,
      [9]
    );
    assert.deepEqual(parseSuitToken('♥A').suitClass, 'suit-heart');
    assert.deepEqual(appendSuitToken([], '♠2'), ['♠2']);
  });

  it('yanxi writes skill zone using mingpai faces', () => {
    const catalog = createFakeCatalog();
    const engine = createMingpaiEngine(null);
    engine.observeKnownHandCard(1, 1, []);
    const store = createSkillAssistStore(engine, catalog, {
      isSelfSeat: (id) => id === 1
    });
    store.handleGameEvent({ type: 'game-started' }, null);
    store.handleGameEvent({
      type: 'spell-targeted',
      seatId: 1,
      spellId: 0x1b68,
      targetSeatIds: [],
      cardIds: [1, 2, 3]
    }, null);
    const panel = store.getSnapshot().panels.find((p) => p.id === 'yanxi');
    assert.ok(panel?.visible);
    assert.match(panel?.resultText || '', /【宴戏】/);
    assert.deepEqual(engine.getZoneCardIds(MINGPAI_ZONE.YANXI), [1, 2, 3]);
    assert.match(
      formatYanxiResult({
        candidateIds: [1, 2, 3],
        handCardIds: [],
        deckCardIds: [],
        gameCardCatalog: catalog
      }).resultText,
      /未知/
    );
  });
});
