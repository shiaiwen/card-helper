import type { MingpaiEngine } from '../mingpai/mingpai-engine.ts';
import { MINGPAI_ZONE } from '../mingpai/mingpai-zones.ts';
import { collectHandAndDeckFaces, partitionCandidatesByMingpai } from '../mingpai/mingpai-queries.ts';
import {
  SKILL_ASSIST_DEFINITIONS,
  type SkillAssistDefinition
} from './skill-definitions.ts';
import { appendSuitToken, cardIdToSuitToken } from './quanbian.ts';
import {
  isSkillAssistVisible,
  resolveSkillIds,
  seatHasSkill
} from './skill-visibility.ts';
import { formatYanxiResult, isYanxiSpellId } from './yanxi.ts';
import { formatRanks, solveYanjiao, solveZiyuan } from './point-calculators.ts';
import { YANJIAO_PANEL_ID, YANJIAO_SKILL_ID, ZIYUAN_PANEL_ID } from './skill-definitions.ts';
import type { GameCardCatalog } from '../cards/game-card-catalog.ts';import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';
import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';

export interface SkillAssistPanelSnapshot {
  id: string;
  title: string;
  visible: boolean;
  suitTokens: readonly string[];
  cardIds: readonly number[];
  resultText: string | null;
  /** 可点击复制的计算结果（严教分组、资援组合）。 */
  resultOptions: readonly string[];
  showSuitSequence: boolean;
  showResult: boolean;
  shownCardZoneId: string | null;
  emptyCardLabel: string | null;
}

export interface SkillAssistSnapshot {
  inGame: boolean;
  currentSeatId: number | null;
  panels: readonly SkillAssistPanelSnapshot[];
}

/**
 * 技能只读的「已知面」快照来源（本家座位判断等）。
 * 牌位置真相一律走 MingpaiEngine.findKZ / 分区投影。
 */
export interface SkillAssistCardKnowledge {
  isSelfSeat(seatId: number): boolean;
  /** 本家与全部受控座位；资援按这些座位的手牌计算。 */
  getControlledSeatIds?(): readonly number[];
  getSeatLabel?(seatId: number): string;
}

export interface SkillAssistStore {
  getSnapshot(): Readonly<SkillAssistSnapshot>;
  setInGame(inGame: boolean): void;
  setCurrentSeatId(seatId: number | null): void;
  setPanelVisible(id: string, visible: boolean): void;
  refreshVisibility(scene: GameSceneSeatSource | null): void;
  handleGameEvent(event: Readonly<GameEvent>, scene: GameSceneSeatSource | null): void;
  subscribe(listener: (snapshot: Readonly<SkillAssistSnapshot>) => void): () => void;
  clear(): void;
}

interface PanelRuntime {
  definition: SkillAssistDefinition;
  visible: boolean;
  suitTokens: string[];
  resultText: string | null;
  resultOptions: string[];
}

const EMPTY_CARD_KNOWLEDGE: SkillAssistCardKnowledge = {
  isSelfSeat: () => false
};

const EMPTY_LABELS: Record<string, string> = {
  quanbian: '权变牌',
  yanxi: '宴戏牌'
};

/**
 * 技能辅助：可见性 + 花色/文案等「展示态」。
 * 牌面真相只读 MingpaiEngine 分区；禁止在此监听移动猜归属。
 */
export function createSkillAssistStore(
  mingpaiEngine: MingpaiEngine,
  gameCardCatalog: GameCardCatalog,
  cardKnowledge: SkillAssistCardKnowledge = EMPTY_CARD_KNOWLEDGE,
  definitions: readonly SkillAssistDefinition[] = SKILL_ASSIST_DEFINITIONS
): SkillAssistStore {
  const panels = new Map<string, PanelRuntime>(
    definitions.map((definition) => [definition.id, {
      definition,
      visible: false,
      suitTokens: [],
      resultText: null,
      resultOptions: []
    }])
  );
  let inGame = false;
  let currentSeatId: number | null = null;
  let snapshot = buildSnapshot();
  const listeners = new Set<(snapshot: Readonly<SkillAssistSnapshot>) => void>();
  const stopMingpai = mingpaiEngine.subscribe(() => publish(buildSnapshot()));

  function buildSnapshot(): Readonly<SkillAssistSnapshot> {
    return Object.freeze({
      inGame,
      currentSeatId,
      panels: Object.freeze(definitions.map((definition) => {
        const runtime = panels.get(definition.id)!;
        const zoneId = definition.shownCardZoneId ?? null;
        if (definition.id === ZIYUAN_PANEL_ID && runtime.visible) refreshZiyuan(runtime);
        return Object.freeze({
          id: definition.id,
          title: definition.title,
          visible: runtime.visible,
          suitTokens: Object.freeze([...runtime.suitTokens]),
          cardIds: Object.freeze([...(zoneId ? mingpaiEngine.getZoneCardIds(zoneId) : [])]),
          resultText: runtime.resultText,
          resultOptions: Object.freeze([...runtime.resultOptions]),
          showSuitSequence: Boolean(definition.showSuitSequence),
          showResult: Boolean(definition.showResult),
          shownCardZoneId: zoneId,
          emptyCardLabel: EMPTY_LABELS[definition.id] ?? null
        });
      }))
    });
  }

  function publish(next: Readonly<SkillAssistSnapshot>): void {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  function resetPanelContent(runtime: PanelRuntime): void {
    runtime.suitTokens = [];
    runtime.resultText = null;
    runtime.resultOptions = [];
    const zoneId = runtime.definition.shownCardZoneId;
    // 权变读的是全局 unknown，隐藏面板时不拆掉其他技能还要用的明牌投影。
    if (zoneId && zoneId !== MINGPAI_ZONE.UNKNOWN) {
      mingpaiEngine.clearZone(zoneId);
    }
  }

  function setVisible(id: string, visible: boolean): void {
    const runtime = panels.get(id);
    if (!runtime || runtime.visible === visible) return;
    runtime.visible = visible;
    if (!visible) resetPanelContent(runtime);
  }

  return {
    getSnapshot: () => snapshot,
    setInGame(nextInGame) {
      if (inGame === nextInGame) return;
      inGame = nextInGame;
      if (!inGame) {
        currentSeatId = null;
        panels.forEach((runtime) => {
          runtime.visible = false;
          resetPanelContent(runtime);
        });
      }
      publish(buildSnapshot());
    },
    setCurrentSeatId(seatId) {
      if (currentSeatId === seatId) return;
      currentSeatId = seatId;
      const quanbian = panels.get('quanbian');
      if (quanbian) quanbian.suitTokens = [];
      publish(buildSnapshot());
    },
    setPanelVisible(id, visible) {
      setVisible(id, visible);
      publish(buildSnapshot());
    },
    refreshVisibility(scene) {
      let changed = false;
      for (const definition of definitions) {
        const runtime = panels.get(definition.id)!;
        const visible = isSkillAssistVisible(definition, scene, inGame);
        if (runtime.visible === visible) continue;
        runtime.visible = visible;
        if (!visible) resetPanelContent(runtime);
        changed = true;
      }
      if (changed) publish(buildSnapshot());
    },
    handleGameEvent(event, scene) {
      if (event.type === 'game-started') {
        inGame = true;
        panels.forEach((runtime) => {
          runtime.visible = false;
          runtime.suitTokens = [];
          runtime.resultText = null;
          runtime.resultOptions = [];
        });
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'game-ended') {
        inGame = false;
        currentSeatId = null;
        panels.forEach((runtime) => {
          runtime.visible = false;
          runtime.suitTokens = [];
          runtime.resultText = null;
          runtime.resultOptions = [];
        });
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'turn-started') {
        currentSeatId = event.seatId;
        const quanbian = panels.get('quanbian');
        if (quanbian) quanbian.suitTokens = [];
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'cards-used') {
        handleQuanbianCardsUsed(event, scene);
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'spell-targeted') {
        handleYanxiSpell(event.seatId, event.spellId, event.cardIds);
        publish(buildSnapshot());
        return;
      }
      // 原版宴戏候选走 GsCRoleOptTargetNtf：Params = 候选卡号。
      if (event.type === 'opt-target') {
        handleYanjiaoReveal(event);
        handleYanxiSpell(
          event.srcSeatId ?? event.seatId,
          event.spellId,
          event.params.filter((cardId) => cardId > 0)
        );
        publish(buildSnapshot());
      }
      // cards-moved 的明牌投影由 mingpai-controller 维护，这里不处理。
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    clear() {
      stopMingpai();
      listeners.clear();
      inGame = false;
      currentSeatId = null;
      panels.forEach((runtime) => {
        runtime.visible = false;
        runtime.suitTokens = [];
        runtime.resultText = null;
        runtime.resultOptions = [];
      });
      snapshot = buildSnapshot();
    }
  };

  function handleQuanbianCardsUsed(
    event: Extract<GameEvent, { type: 'cards-used' }>,
    scene: GameSceneSeatSource | null
  ): void {
    const runtime = panels.get('quanbian');
    if (!runtime?.visible) return;
    if (event.source !== 'use-card') return;
    if (event.useType !== 1 || event.isSend) return;
    if (currentSeatId !== null && event.seatId !== currentSeatId) return;
    const skillIds = resolveSkillIds(runtime.definition, scene);
    if (!seatHasSkill(scene, event.seatId, skillIds)) return;
    for (const cardId of event.cardIds) {
      runtime.suitTokens = appendSuitToken(
        runtime.suitTokens,
        cardIdToSuitToken(cardId, gameCardCatalog)
      );
    }
  }

  /** 对照原版：GsCRoleOptTargetNtf SpellID=严教且 Param=0 时，Params（或 CardIDs）为亮出的牌。 */
  function handleYanjiaoReveal(event: Extract<GameEvent, { type: 'opt-target' }>): void {
    if (event.spellId !== YANJIAO_SKILL_ID || event.param !== 0) return;
    const runtime = panels.get(YANJIAO_PANEL_ID);
    if (!runtime) return;
    const fromParams = event.params.filter((cardId) => cardId > 0);
    const cardIds = fromParams.length ? fromParams : (event.cardIds ?? []).filter((cardId) => cardId > 0);
    if (!cardIds.length) return;
    const splits = solveYanjiao(cardIds.map((cardId) => cardRankNumber(cardId, gameCardCatalog)));
    runtime.visible = true;
    runtime.resultOptions = splits.map((split) => `${formatRanks(split.left)}=${formatRanks(split.right)}`);
    runtime.resultText = splits.length ? null : '【严教】无解！';  }

  function refreshZiyuan(runtime: PanelRuntime): void {
    const seatIds = cardKnowledge.getControlledSeatIds?.() ?? [];
    const withLabel = seatIds.length > 1;
    const options: string[] = [];
    for (const seatId of seatIds) {
      const ranks = mingpaiEngine.getHandCardIds(seatId)
        .filter((cardId) => cardId > 0)
        .map((cardId) => cardRankNumber(cardId, gameCardCatalog));
      const prefix = withLabel ? `${cardKnowledge.getSeatLabel?.(seatId) || `座位${seatId + 1}`}：` : '';
      solveZiyuan(ranks).forEach((combo) => options.push(`${prefix}${formatRanks(combo)}`));
    }
    runtime.resultOptions = options;
    runtime.resultText = options.length ? null : '【资援】无解！';
  }

  function handleYanxiSpell(
    casterSeatId: number,
    spellId: number,
    candidateIds: readonly number[]
  ): void {
    if (!isYanxiSpellId(spellId) || !candidateIds.length) return;
    if (!cardKnowledge.isSelfSeat(casterSeatId)) return;
    const runtime = panels.get('yanxi');
    if (!runtime) return;
    runtime.visible = true;
    const inferenceFaces = partitionCandidatesByMingpai(mingpaiEngine, candidateIds);
    // 本家手牌面优先：若 findKZ 尚无手牌命中，再并入引擎已登记手牌区
    const faces = collectHandAndDeckFaces(mingpaiEngine);
    const inference = formatYanxiResult({
      candidateIds: [...candidateIds],
      handCardIds: inferenceFaces.handCardIds.length
        ? inferenceFaces.handCardIds
        : faces.handCardIds,
      deckCardIds: inferenceFaces.deckCardIds.length
        ? inferenceFaces.deckCardIds
        : faces.deckCardIds,
      gameCardCatalog
    });
    runtime.resultText = inference.resultText;
    mingpaiEngine.projectSkillCards(MINGPAI_ZONE.YANXI, inference.candidateIds);
  }
}

function sameSnapshot(
  left: Readonly<SkillAssistSnapshot>,
  right: Readonly<SkillAssistSnapshot>
): boolean {
  if (left.inGame !== right.inGame || left.currentSeatId !== right.currentSeatId) return false;
  if (left.panels.length !== right.panels.length) return false;
  return left.panels.every((panel, index) => {
    const other = right.panels[index];
    return panel.id === other.id
      && panel.visible === other.visible
      && panel.resultText === other.resultText
      && panel.resultOptions.length === other.resultOptions.length
      && panel.resultOptions.every((option, optionIndex) => option === other.resultOptions[optionIndex])
      && panel.suitTokens.length === other.suitTokens.length
      && panel.suitTokens.every((token, tokenIndex) => token === other.suitTokens[tokenIndex])
      && panel.cardIds.length === other.cardIds.length
      && panel.cardIds.every((cardId, cardIndex) => cardId === other.cardIds[cardIndex]);
  });
}

const RANK_BY_LABEL: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };

/** 卡牌点数 1–13；牌面未知或非普通点数时返回 0，由计算器过滤。 */
function cardRankNumber(cardId: number, gameCardCatalog: GameCardCatalog): number {
  const rank = gameCardCatalog.resolve(cardId).rank;
  return RANK_BY_LABEL[rank] ?? (Number.parseInt(rank, 10) || 0);
}

export function bindSkillAssistStoreToGameEvents(
  store: SkillAssistStore,
  gameEvents: GameEventBus,
  getScene: () => GameSceneSeatSource | null
): () => void {
  return gameEvents.subscribe((event) => {
    store.handleGameEvent(event, getScene());
  });
}
