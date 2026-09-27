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
import {
  formatRanks,
  solveChengxiang,
  solveYanjiao,
  solveYicheng,
  solveZiyuan
} from './point-calculators.ts';
import {
  CHENGXIANG_SKILL_ID,
  HEZHONG_SKILL_ID,
  JIE_CHENGXIANG_SKILL_ID,
  JIZHAN_SKILL_ID,
  LUANJI_SKILL_ID,
  YANJIAO_PANEL_ID,
  YANJIAO_SKILL_ID,
  YICHENG_SKILL_ID,
  ZIYUAN_PANEL_ID
} from './skill-definitions.ts';
import {
  formatHezhong,
  formatJizhan,
  formatQuandao,
  formatShuangxiong,
  rankNumber
} from './panel-texts.ts';
import type { GameCardCatalog, GameCardMetadata } from '../cards/game-card-catalog.ts';
import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';
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
  /** 与 resultOptions 同下标：需要高亮的方案（界称象和为 13）。 */
  highlightedOptions: readonly boolean[];
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
  highlightedOptions: boolean[];
  /** 技能事件算出过结果：本局保持显示，不受座位技能轮询影响。 */
  pinned: boolean;
}

type CardsUsedEvent = Extract<GameEvent, { type: 'cards-used' }>;
type CardsMovedEvent = Extract<GameEvent, { type: 'cards-moved' }>;
type OptTargetEvent = Extract<GameEvent, { type: 'opt-target' }>;
type SpellOptRepEvent = Extract<GameEvent, { type: 'spell-opt-rep' }>;

const DRAW_PILE_ZONE = 1;
const HAND_ZONE = 5;
const JUDGE_SHOW_ZONE = 8;
const EQUIP_ZONES = [4, 6];
const CHENGXIANG_MOVE_TYPE = 6;
const YICHENG_EXCHANGE_TYPE = 28;
/** 吉占 SpellOptRep Type=31：Datas[1] 为亮出的卡号，Datas[3] 为其点数。 */
const JIZHAN_REVEAL_TYPE = 31;
const NO_CARD_LIST_HINT = '未收到本局牌表，无法统计牌堆';
const EQUIP_CARD_TYPE = 3;

const EMPTY_CARD_KNOWLEDGE: SkillAssistCardKnowledge = {
  isSelfSeat: () => false
};

const EMPTY_LABELS: Record<string, string> = {
  quanbian: '权变牌',
  yanxi: '宴戏牌'
};

/**
 * 技能辅助：可见性 + 花色/文案等「展示态」。
 * 牌面真相只读 MingpaiEngine 分区；移动事件只用于读取技能亮出的牌，不推断归属。
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
      resultOptions: [],
      highlightedOptions: [],
      pinned: false
    }])
  );
  let inGame = false;
  let currentSeatId: number | null = null;
  /** 本局全部卡号（MsgGamePlayCardNtf）；吉占 / 和衷据此推算牌堆里可能的牌。 */
  let gameCardIds: readonly number[] = [];
  /** 本回合计数：权变的非装备牌张数与花色、乱击用过的花色。 */
  const turnState = { quanbianCount: 0, quanbianSuits: [] as string[], luanjiSuits: [] as string[] };
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
        if (definition.id === 'quandao' && runtime.visible) refreshQuandao(runtime);
        if (definition.id === 'shuangxiong' && runtime.visible) refreshShuangxiong(runtime);
        return Object.freeze({
          id: definition.id,
          title: definition.title,
          visible: runtime.visible,
          suitTokens: Object.freeze([...runtime.suitTokens]),
          cardIds: Object.freeze([...(zoneId ? mingpaiEngine.getZoneCardIds(zoneId) : [])]),
          resultText: runtime.resultText,
          resultOptions: Object.freeze([...runtime.resultOptions]),
          highlightedOptions: Object.freeze([...runtime.highlightedOptions]),
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

  function clearRuntime(runtime: PanelRuntime): void {
    runtime.suitTokens = [];
    runtime.resultText = null;
    runtime.resultOptions = [];
    runtime.highlightedOptions = [];
  }

  function pin(runtime: PanelRuntime): void {
    runtime.visible = true;
    runtime.pinned = true;
  }

  function resetPanelContent(runtime: PanelRuntime): void {
    clearRuntime(runtime);
    const zoneId = runtime.definition.shownCardZoneId;
    // 权变读的是全局 unknown，隐藏面板时不拆掉其他技能还要用的明牌投影。
    if (zoneId && zoneId !== MINGPAI_ZONE.UNKNOWN) {
      mingpaiEngine.clearZone(zoneId);
    }
  }

  function resetTurnState(): void {
    turnState.quanbianCount = 0;
    turnState.quanbianSuits = [];
    turnState.luanjiSuits = [];
    const jianying = panels.get('jianying');
    if (jianying) jianying.suitTokens = [];
  }

  function resetAll(): void {
    resetTurnState();
    panels.forEach((runtime) => {
      runtime.visible = false;
      runtime.pinned = false;
      clearRuntime(runtime);
    });
  }

  function setVisible(id: string, visible: boolean): void {
    const runtime = panels.get(id);
    if (!runtime || runtime.visible === visible) return;
    runtime.visible = visible;
    if (!visible) resetPanelContent(runtime);
  }

  function setOptions(runtime: PanelRuntime, options: readonly string[], highlights: readonly boolean[] = []): void {
    runtime.resultOptions = [...options];
    runtime.highlightedOptions = options.map((_, index) => Boolean(highlights[index]));
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
          runtime.pinned = false;
          resetPanelContent(runtime);
        });
      }
      publish(buildSnapshot());
    },
    setCurrentSeatId(seatId) {
      if (currentSeatId === seatId) return;
      currentSeatId = seatId;
      resetTurnState();
      publish(buildSnapshot());
    },
    setPanelVisible(id, visible) {
      const runtime = panels.get(id);
      if (runtime && !visible) runtime.pinned = false;
      setVisible(id, visible);
      publish(buildSnapshot());
    },
    refreshVisibility(scene) {
      let changed = false;
      for (const definition of definitions) {
        const runtime = panels.get(definition.id)!;
        const visible = (inGame && runtime.pinned)
          || isSkillAssistVisible(definition, scene, inGame, cardKnowledge.isSelfSeat);
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
        resetAll();
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'game-ended') {
        inGame = false;
        currentSeatId = null;
        gameCardIds = [];
        resetAll();
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'card-list-ready') {
        gameCardIds = event.cardIds;
        return;
      }
      if (event.type === 'turn-started') {
        currentSeatId = event.seatId;
        resetTurnState();
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'cards-used') {
        handleJianyingCardsUsed(event, scene);
        handleQuanbianCardsUsed(event, scene);
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'spell-targeted') {
        handleYanxiSpell(event.seatId, event.spellId, event.cardIds);
        // 乱击暂时停用。
        // if (event.spellId === LUANJI_SKILL_ID) handleLuanji(event.cardIds);
        publish(buildSnapshot());
        return;
      }
      if (event.type === 'cards-moved') {
        if (handleCardsMoved(event)) publish(buildSnapshot());
        return;
      }
      if (event.type === 'spell-opt-rep') {
        if (handleJizhanOptRep(event)) publish(buildSnapshot());
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
        handleYicheng(event);
        handleHezhongOptTarget(event);
        publish(buildSnapshot());
      }
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
      gameCardIds = [];
      resetAll();
      snapshot = buildSnapshot();
    }
  };

  /** 渐营：当前回合角色依次使用的牌的花色点数。 */
  function handleJianyingCardsUsed(event: CardsUsedEvent, scene: GameSceneSeatSource | null): void {
    const runtime = panels.get('jianying');
    if (!runtime?.visible) return;
    if (event.source !== 'use-card') return;
    if (event.useType !== 1 || event.isSend) return;
    if (currentSeatId !== null && event.seatId !== currentSeatId) return;
    if (!seatHasSkill(scene, event.seatId, resolveSkillIds(runtime.definition, scene))) return;
    for (const cardId of event.cardIds) {
      runtime.suitTokens = appendSuitToken(
        runtime.suitTokens,
        cardIdToSuitToken(cardId, gameCardCatalog)
      );
    }
  }

  /** 权变：当前回合角色从手牌使用的牌，统计非装备牌张数与出现过的花色。 */
  function handleQuanbianCardsUsed(event: CardsUsedEvent, scene: GameSceneSeatSource | null): void {
    const runtime = panels.get('quanbian');
    if (!runtime?.visible) return;
    if (event.source !== 'use-card' || event.useType !== 1 || event.isSend) return;
    if (event.fromZone === DRAW_PILE_ZONE) return;
    if (currentSeatId === null || event.seatId !== currentSeatId) return;
    if (!seatHasSkill(scene, event.seatId, resolveSkillIds(runtime.definition, scene))) return;
    for (const cardId of event.cardIds) {
      const card = gameCardCatalog.resolve(cardId);
      if (card.cardType !== EQUIP_CARD_TYPE) turnState.quanbianCount += 1;
      if (card.suitGlyph && !turnState.quanbianSuits.includes(card.suitGlyph)) {
        turnState.quanbianSuits.push(card.suitGlyph);
      }
    }
    runtime.suitTokens = [`[${turnState.quanbianCount}]`, ...turnState.quanbianSuits];
  }

  /** 乱击（2143）：本回合发动乱击已用过的花色。 */
  function handleLuanji(cardIds: readonly number[]): void {
    const runtime = panels.get('luanji');
    if (!runtime) return;
    for (const cardId of cardIds) {
      const glyph = gameCardCatalog.resolve(cardId).suitGlyph;
      if (glyph && !turnState.luanjiSuits.includes(glyph)) turnState.luanjiSuits.push(glyph);
    }
    runtime.suitTokens = [...turnState.luanjiSuits];
  }

  /** 双雄：本家手牌 + 装备的红黑张数，随明牌变化实时刷新。 */
  function refreshShuangxiong(runtime: PanelRuntime): void {
    const selfSeatId = findSelfSeatId();
    if (selfSeatId === undefined) return;
    const cardIds = [HAND_ZONE, ...EQUIP_ZONES]
      .flatMap((zone) => mingpaiEngine.getZoneCardIds(`${zone}-${selfSeatId}`));
    runtime.resultText = formatShuangxiong(resolveCards(cardIds));
  }

  /** 称象 / 吉占 / 和衷都读技能亮出到展示区的牌；返回是否有面板更新。 */
  function handleCardsMoved(event: CardsMovedEvent): boolean {
    const shown = event.cardIds.filter((cardId) => cardId > 0);
    if (
      (event.spellId === CHENGXIANG_SKILL_ID || event.spellId === JIE_CHENGXIANG_SKILL_ID)
      && event.toZone === JUDGE_SHOW_ZONE
      && event.moveType === CHENGXIANG_MOVE_TYPE
    ) {
      const runtime = panels.get('chengxiang');
      if (!runtime || !shown.length) return false;
      const combos = solveChengxiang(
        shown.map((cardId) => rankNumber(gameCardCatalog.resolve(cardId))),
        event.spellId === JIE_CHENGXIANG_SKILL_ID
      );
      pin(runtime);
      setOptions(runtime, combos.map((combo) => formatRanks(combo.ranks)), combos.map((combo) => combo.exact));
      return true;
    }
    if (
      event.spellId === JIZHAN_SKILL_ID
      && event.fromZone === DRAW_PILE_ZONE
      && event.toZone === JUDGE_SHOW_ZONE
      && shown.length === 1
    ) {
      return showJizhan(shown[0], rankNumber(gameCardCatalog.resolve(shown[0])));
    }
    if (event.spellId === HEZHONG_SKILL_ID && currentSeatId !== null && event.fromId === currentSeatId) {
      const pivot = event.cardIds[0] > 0 ? rankNumber(gameCardCatalog.resolve(event.cardIds[0])) : 0;
      return showHezhong(pivot, shown);
    }
    return false;
  }

  /** 吉占亮牌有时不带 MoveCard 卡号，SpellOptRep 的 Datas 里一定有。 */
  function handleJizhanOptRep(event: SpellOptRepEvent): boolean {
    if (event.spellId !== JIZHAN_SKILL_ID || event.optType !== JIZHAN_REVEAL_TYPE) return false;
    const cardId = event.datas[1] ?? 0;
    const rank = rankNumber(gameCardCatalog.resolve(cardId)) || (event.datas[3] ?? 0);
    return showJizhan(cardId, rank);
  }

  /** 和衷：GsCRoleOptTargetNtf 的 Param 为这次要比较的点数。 */
  function handleHezhongOptTarget(event: OptTargetEvent): void {
    if (event.spellId !== HEZHONG_SKILL_ID) return;
    showHezhong(event.param, []);
  }

  function showJizhan(cardId: number, pivot: number): boolean {
    const runtime = panels.get('jizhan');
    if (!runtime || !(pivot >= 1 && pivot <= 13)) return false;
    pin(runtime);
    runtime.resultText = gameCardIds.length
      ? formatJizhan(pivot, resolveCards(possibleDrawPileCardIds(cardId > 0 ? [cardId] : [])))
      : `【吉占】跟${pivot}比\n${NO_CARD_LIST_HINT}`;
    return true;
  }

  function showHezhong(pivot: number, excluded: readonly number[]): boolean {
    const runtime = panels.get('hezhong');
    if (!runtime || !(pivot >= 1 && pivot <= 13)) return false;
    pin(runtime);
    runtime.resultText = gameCardIds.length
      ? formatHezhong(pivot, resolveCards(possibleDrawPileCardIds(excluded)))
      : `【和衷】跟${pivot}比\n${NO_CARD_LIST_HINT}`;
    return true;
  }

  /** 对照原版：GsCRoleOptTargetNtf SpellID=严教且 Param=0 时，Params（或 CardIDs）为亮出的牌。 */
  function handleYanjiaoReveal(event: OptTargetEvent): void {
    if (event.spellId !== YANJIAO_SKILL_ID || event.param !== 0) return;
    const runtime = panels.get(YANJIAO_PANEL_ID);
    if (!runtime) return;
    const fromParams = event.params.filter((cardId) => cardId > 0);
    const cardIds = fromParams.length ? fromParams : (event.cardIds ?? []).filter((cardId) => cardId > 0);
    if (!cardIds.length) return;
    const splits = solveYanjiao(cardIds.map((cardId) => cardRankNumber(cardId, gameCardCatalog)));
    pin(runtime);
    setOptions(runtime, splits.map((split) => `${formatRanks(split.left)}=${formatRanks(split.right)}`));
    runtime.resultText = splits.length ? null : '【严教】无解！';
  }

  /** 易城：本家发动且 Type=28 时，Params 为亮出的牌，与该座位手牌比较可交换方案；其他 Type 清空。 */
  function handleYicheng(event: OptTargetEvent): void {
    if (event.spellId !== YICHENG_SKILL_ID || event.param !== 0) return;
    if (!isControlledSeat(event.seatId)) return;
    const shown = event.params.filter((cardId) => cardId > 0);
    if (!shown.length) return;
    const runtime = panels.get('yicheng');
    if (!runtime) return;
    pin(runtime);
    if (event.optType !== YICHENG_EXCHANGE_TYPE) {
      clearRuntime(runtime);
      return;
    }
    const handRanks = mingpaiEngine.getHandCardIds(event.seatId)
      .filter((cardId) => cardId > 0)
      .map((cardId) => cardRankNumber(cardId, gameCardCatalog));
    const options = solveYicheng(shown.map((cardId) => cardRankNumber(cardId, gameCardCatalog)), handRanks);
    setOptions(runtime, options);
    runtime.resultText = options.length ? null : '【易城】无法交换！';
  }

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
    setOptions(runtime, options);
    runtime.resultText = options.length ? null : '【资援】无解！';
  }

  function findSelfSeatId(): number | undefined {
    const seatIds = cardKnowledge.getControlledSeatIds?.() ?? [];
    return seatIds.find((seatId) => cardKnowledge.isSelfSeat(seatId)) ?? seatIds[0];
  }

  function refreshQuandao(runtime: PanelRuntime): void {
    const selfSeatId = findSelfSeatId();
    if (selfSeatId === undefined) return;
    const handCardIds = mingpaiEngine.getHandCardIds(selfSeatId).filter((cardId) => cardId > 0);
    runtime.resultText = formatQuandao(resolveCards(handCardIds));
  }

  /** 牌堆里可能的牌：本局卡号去掉明牌引擎已知在牌堆以外的牌（对照原版 paidui）。 */
  function possibleDrawPileCardIds(excluded: readonly number[]): number[] {
    const elsewhere = new Set(excluded);
    for (const record of mingpaiEngine.getSnapshot().records) {
      if (record.location && record.location.zone !== DRAW_PILE_ZONE) elsewhere.add(record.cardId);
    }
    return gameCardIds.filter((cardId) => !elsewhere.has(cardId));
  }

  function resolveCards(cardIds: readonly number[]): Readonly<GameCardMetadata>[] {
    return cardIds.map((cardId) => gameCardCatalog.resolve(cardId));
  }

  function isControlledSeat(seatId: number): boolean {
    return cardKnowledge.isSelfSeat(seatId)
      || (cardKnowledge.getControlledSeatIds?.() ?? []).includes(seatId);
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
    pin(runtime);
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
      && sameList(panel.resultOptions, other.resultOptions)
      && sameList(panel.highlightedOptions, other.highlightedOptions)
      && sameList(panel.suitTokens, other.suitTokens)
      && sameList(panel.cardIds, other.cardIds);
  });
}

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** 卡牌点数 1–13；牌面未知或非普通点数时返回 0，由计算器过滤。 */
function cardRankNumber(cardId: number, gameCardCatalog: GameCardCatalog): number {
  return rankNumber(gameCardCatalog.resolve(cardId));
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
