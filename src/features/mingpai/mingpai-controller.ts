/**
 * 明牌控制器：订阅游戏事件，驱动明牌引擎更新手牌/牌堆/临时区等分区，
 * 并把看牌、移牌规则解析后的揭示结果写入统一鉴定汇点。
 */

import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';
import type { SeatStateStore } from '../seat-display/seat-state-store.ts';
import {
  createMingpaiEngine,
  formatZoneId,
  DISCARD_ZONE,
  DRAW_PILE_ZONE,
  HAND_ZONE,
  TEMPORARY_CARD_ZONES,
  type MingpaiEngine
} from './mingpai-engine.ts';
import { MINGPAI_ZONE } from './mingpai-zones.ts';
import { applyCardReveals } from './reveal-sink.ts';
import { resolveOptTargetReveals } from './rules/opt-target-rules.ts';
import { traceMingpai } from '../../runtime/mingpai-trace.ts';
import { resolveSpellOptRepReveals } from './rules/spell-opt-rep-rules.ts';
import {
  isIgnoredMove,
  isSameZoneShow,
  isWholeHandMove,
  normalizeMoveCardIds,
  remapDrawPileFromPosition,
  remapDrawPileToPosition,
  sanitizeMoveCardIds
} from './rules/move-card-rules.ts';
import { DRAW_PILE_OWNER } from './rules/reveal-types.ts';
import { createSpecialSpellRecovery } from './special-spell-recovery.ts';

type MoveCardEvent = Extract<GameEvent, { type: 'cards-moved' }>;

export interface MingpaiControllerOptions {
  /** 兼容旧调用：未传入时内部自建引擎。 */
  engine?: MingpaiEngine;
  /** 红色 true、黑色 false、未知 null；按颜色还原的技能（3543 / 3571）需要。 */
  isRedCard?: (cardId: number) => boolean | null;
}

/**
 * 明牌控制器：吸收原 known-hand-card-controller 全部协议路径，
 * 并维护分区投影（unknown / 手牌区 / 技能条）。运行时不依赖 legacy。
 */
export function installMingpaiController(
  seatStateStore: SeatStateStore,
  gameEvents: GameEventBus,
  { engine: injected, isRedCard = () => null }: MingpaiControllerOptions = {}
): { dispose: () => void; engine: MingpaiEngine } {
  const engine = injected ?? createMingpaiEngine();
  const specialRecovery = createSpecialSpellRecovery({
    hand(seatId) {
      const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === seatId);
      return {
        known: seat?.knownCards.map((card) => card.cardId).filter((cardId) => cardId > 0) ?? [],
        unknownCount: seat?.unknownCardCount ?? 0
      };
    },
    zoneCardIds: (seatId, zone) => engine.getZoneCardIds(formatZoneId(seatId, zone)),
    isControlledSeat: (seatId) => isControlledSeat(seatId),
    isRedCard
  });
  const temporaryCardZones = new Map<string, TemporaryCardZone>();
  let temporaryZoneSequence = 0;
  const activeQiSeats = new Set<number>();
  const pendingSpellCardClues: SpellCardClue[] = [];
  const eligibleQiKillersByVictim = new Map<number, Set<number>>();
  let pendingQiDeath: { victimSeatId: number; killerSeatId: number | null } | null = null;
  let pendingQiTransfer: {
    originalOwnerSeatId: number;
    recipientSeatId: number;
    expiresAfterMovement: number;
  } | null = null;
  let movementSequence = 0;
  let qiStateObserved = false;
  let synchronizingPersistentTags = false;

  const unsubscribeSeatState = seatStateStore.subscribe((snapshot) => {
    if (synchronizingPersistentTags) return;
    synchronizingPersistentTags = true;
    try {
      snapshot.seats.forEach((seat) => {
        const equipmentIds = new Set(
          (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
        );
        seat.knownCards.forEach((card) => {
          if (equipmentIds.has(card.cardId)) return;
          engine.observeKnownHandCard(card.cardId, seat.seatId, card.tags);
          const persistentTags = engine.getPersistentTags(card.cardId);
          if (persistentTags.length) {
            seatStateStore.setPersistentKnownCardTags(card.cardId, persistentTags);
          }
        });
      });
    } finally {
      synchronizingPersistentTags = false;
    }
  });

  const unsubscribe = gameEvents.subscribe((rawEvent) => {
    if (rawEvent.type === 'cards-moved') {
      handleCardsMoved(rawEvent);
      return;
    }
    const event = rawEvent;
    specialRecovery.observe(event);
    if (event.type === 'game-reconnected' || event.type === 'deck-shuffled') {
      temporaryCardZones.clear();
      temporaryZoneSequence = 0;
      pendingSpellCardClues.length = 0;
      specialRecovery.clear();
      engine.clearKnownDrawPileOrder();
      return;
    }
    if (event.type === 'game-ended') {
      // 同房间结算/再开不切场景，只能靠协议清空；不要 store.clear() 把 inGame 打成 false，
      // 否则下一帧场景轮询又会当成新的 game-started，并把残留 CardUi 写回引擎。
      temporaryCardZones.clear();
      temporaryZoneSequence = 0;
      engine.clear();
      resetQiTransferState();
      seatStateStore.resetKnownHands();
      return;
    }
    if (event.type === 'game-started') {
      // 开局一律丢掉上一局缓存。热重载恢复只留给 game-reconnected。
      temporaryCardZones.clear();
      temporaryZoneSequence = 0;
      resetQiTransferState();
      engine.clear();
      seatStateStore.resetKnownHands();
      return;
    }
    if (event.type === 'card-list-ready') {
      traceMingpai('card-list', { count: event.cardIds.length, maxId: Math.max(...event.cardIds) });
      return;
    }
    if (event.type === 'hand-cards-revealed') {
      traceMingpai('reveal', {
        source: 'hand-cards-revealed', zone: 'hand', ownerId: event.seatId, cardIds: [...event.cardIds]
      });
      event.cardIds.forEach((cardId) => {
        engine.observeKnownHandCard(cardId, event.seatId, []);
      });
      seatStateStore.revealKnownHand(event.seatId, event.cardIds);
      return;
    }
    if (event.type === 'temporary-cards-reordered') {
      applyTemporaryCardReorder(event, temporaryCardZones);
      return;
    }
    // 看牌协议 → 规则表解析 → 统一鉴定汇点
    if (event.type === 'opt-target') {
      const srcSeatId = event.srcSeatId ?? event.seatId;
      const reveals = resolveOptTargetReveals({
        spellId: event.spellId,
        param: event.param,
        params: event.params,
        srcSeatId,
        targetSeatId: event.targetSeatId,
        isSelfSrc: isControlledSeat(srcSeatId)
      });
      traceMingpai('opt-target', {
        spellId: event.spellId, param: event.param, params: [...event.params], optType: event.optType ?? null,
        srcSeatId, targetSeatId: event.targetSeatId, matchedReveals: reveals.length
      });
      applyCardReveals(reveals, engine, seatStateStore, `opt-target:${event.spellId}`);
      return;
    }
    if (event.type === 'spell-opt-rep') {
      const reveals = resolveSpellOptRepReveals({
        spellId: event.spellId,
        optType: event.optType,
        seatId: event.seatId,
        datas: event.datas,
        isSelfSeat: isControlledSeat(event.seatId)
      });
      traceMingpai('spell-opt-rep', {
        spellId: event.spellId, optType: event.optType, seatId: event.seatId,
        datas: [...event.datas], matchedReveals: reveals.length
      });
      applyCardReveals(reveals, engine, seatStateStore, `spell-opt-rep:${event.spellId}`);
      return;
    }
    if (event.type === 'seat-state-changed' && event.stateId === QI_STATE_ID) {
      updateQiSeatState(event.seatId, event.value);
      return;
    }
    if (event.type === 'player-died') {
      recordQiPlayerDeath(event.seatId, event.killerSeatId);
      return;
    }
    if (event.type === 'spell-targeted' && QI_TRANSFER_SPELL_IDS.has(event.spellId)) {
      recordQiTransferSpell(event.seatId, event.targetSeatIds);
    }
    if (event.type === 'spell-targeted') {
      rememberSpellCardClue(event);
    }
  });

  function isControlledSeat(seatId: number | null): boolean {
    if (seatId === null) return false;
    const snapshot = seatStateStore.getSnapshot();
    return seatId === snapshot.selfSeatId || snapshot.controlledSeatIds.includes(seatId);
  }

  /** 同区同主人：手牌 / 牌堆按展示鉴定处理；其它区返回 false 走正常移动。 */
  function applySameZoneShow(event: MoveCardEvent): boolean {
    const cardIds = event.cardIds.filter((cardId) => cardId > 0);
    if (event.fromZone === HAND_ZONE) {
      // MoveType 24：整手展示，未展示的已知牌不再在该手牌里。
      const wholeHand = event.moveType === WHOLE_HAND_SHOW_MOVE_TYPE && cardIds.length === event.cardCount;
      applyCardReveals([{
        zone: 'hand', ownerId: event.fromId, cardIds, position: 'unspecified', partial: !wholeHand
      }], engine, seatStateStore, `same-zone-show:${event.spellId}`);
      return true;
    }
    if (event.fromZone === DRAW_PILE_ZONE && event.fromId === DRAW_PILE_OWNER) {
      traceMingpai('reveal', {
        source: `same-zone-show:${event.spellId}`, zone: 'deck', ownerId: event.fromId,
        cardIds, position: event.toPosition
      });
      engine.observeKnownDrawPileCards(cardIds, event.toPosition);
      return true;
    }
    return false;
  }

  function handleCardsMoved(rawEvent: MoveCardEvent): void {
    // 明牌专用纠偏：半透明卡号清空 + 牌堆顶/底纠偏。只影响明牌，不改总线原事件。
    if (isIgnoredMove(rawEvent)) return;
    const normalizedEvent: MoveCardEvent = {
      ...rawEvent,
      cardIds: sanitizeMoveCardIds(rawEvent.cardCount, normalizeMoveCardIds(rawEvent)),
      fromPosition: remapDrawPileFromPosition(rawEvent, {
        nationWar: seatStateStore.getSnapshot().mode === 'nation-war'
      }),
      toPosition: remapDrawPileToPosition(rawEvent)
    };
    const specialCardIds = specialRecovery.recover(normalizedEvent);
    const event: MoveCardEvent = specialCardIds ? { ...normalizedEvent, cardIds: specialCardIds } : normalizedEvent;
    if (isSameZoneShow(event) && applySameZoneShow(event)) {
      specialRecovery.record(event, event.cardIds);
      return;
    }

    movementSequence += 1;
    discardExpiredSpellCardClues();
    consumeSpellCluesFor(event.cardIds);
    if (pendingQiTransfer && movementSequence > pendingQiTransfer.expiresAfterMovement) {
      pendingQiTransfer = null;
    }
    const temporaryZoneCardIds = recoverCardsFromTemporaryZone(
      takesFromTemporaryZoneBottom(event) ? { ...event, fromPosition: DRAW_PILE_BOTTOM_POSITION } : event,
      temporaryCardZones
    );
    const movementWithTemporaryCards = { ...event, cardIds: temporaryZoneCardIds };
    const preferredQiOwner = resolvePreferredQiOwner(event);
    const clueCardIds = recoverCardsFromSpellClue(movementWithTemporaryCards);
    // 手牌区的已知牌不是整手，暗牌部分移走时不能按「候选数 = 张数」认定。
    const partialHandDeparture = event.fromZone === HAND_ZONE
      && !isWholeHandDeparture(movementWithTemporaryCards, seatStateStore);
    const resolvedCardIds = clueCardIds.some((cardId) => cardId > 0)
      ? clueCardIds
      : partialHandDeparture
        ? [...movementWithTemporaryCards.cardIds]
        : engine.resolveHiddenMovement(movementWithTemporaryCards, preferredQiOwner);
    // 本家手牌被顺手等技能拿走时，协议可能藏卡号；用控座位已知牌按位置补回。
    const controlledSeatCardIds = resolvedCardIds.some((cardId) => cardId > 0)
      ? resolvedCardIds
      : recoverCardsFromControlledSeat(movementWithTemporaryCards, seatStateStore);
    const hiddenHandDeparture = event.fromZone === HAND_ZONE
      && !controlledSeatCardIds.some((cardId) => cardId > 0);
    const wholeHand = hiddenHandDeparture && isWholeHandDeparture(movementWithTemporaryCards, seatStateStore);
    const recoveredCardIds = wholeHand
      ? recoverWholeHandMovement(movementWithTemporaryCards, seatStateStore)
      : controlledSeatCardIds;
    if (preferredQiOwner !== null && recoveredCardIds.some((cardId) => cardId > 0)) {
      recoveredCardIds.filter((cardId) => cardId > 0).forEach((cardId) => {
        engine.rememberPersistentCardTag(cardId, '炁', preferredQiOwner);
      });
      pendingQiTransfer = null;
      pendingQiDeath = null;
    }
    traceMingpai('move', {
      spellId: event.spellId,
      moveType: event.moveType,
      from: [event.fromZone, event.fromId, rawEvent.fromPosition],
      to: [event.toZone, event.toId, event.toPosition],
      count: event.cardCount,
      rawIds: [...rawEvent.cardIds],
      resolvedIds: [...recoveredCardIds],
      remappedFromPosition: event.fromPosition !== rawEvent.fromPosition ? event.fromPosition : undefined
    });
    trackTemporaryZoneMovement(event, recoveredCardIds, temporaryCardZones, () => ++temporaryZoneSequence);
    engine.applyMovement(event, recoveredCardIds);
    specialRecovery.record(event, recoveredCardIds);

    // 临时区进出时刷新 unknown 投影
    const known = recoveredCardIds.filter((id) => id > 0);
    if (TEMPORARY_CARD_ZONES.has(event.toZone) && known.length) {
      engine.addZoneCardIds(MINGPAI_ZONE.UNKNOWN, known);
    }
    if (TEMPORARY_CARD_ZONES.has(event.fromZone) && known.length) {
      engine.removeZoneCardIds(MINGPAI_ZONE.UNKNOWN, known);
    }

    recoveredCardIds.forEach((cardId) => {
      const persistentTags = engine.getPersistentTags(cardId);
      if (persistentTags.length) seatStateStore.setPersistentKnownCardTags(cardId, persistentTags);
    });
    seatStateStore.applyKnownHandMovement({
      cardCount: event.cardCount,
      cardIds: recoveredCardIds,
      fromSeatId: event.fromId,
      fromZone: event.fromZone,
      toSeatId: event.toId,
      toZone: event.toZone
    });
    if (hiddenHandDeparture) {
      seatStateStore.applyHiddenHandMovement({
        fromSeatId: event.fromId,
        toSeatId: event.toZone === HAND_ZONE ? event.toId : null,
        wholeHand
      });
    }
  }

  function resetQiTransferState(): void {
    activeQiSeats.clear();
    pendingSpellCardClues.length = 0;
    eligibleQiKillersByVictim.clear();
    pendingQiDeath = null;
    pendingQiTransfer = null;
    movementSequence = 0;
    qiStateObserved = false;
  }

  function updateQiSeatState(seatId: number, value: number): void {
    qiStateObserved = true;
    if (value > 0) {
      activeQiSeats.add(seatId);
      return;
    }
    if (!activeQiSeats.has(seatId)) return;
    eligibleQiKillersByVictim.set(
      seatId,
      new Set([...activeQiSeats].filter((activeSeatId) => activeSeatId !== seatId))
    );
    activeQiSeats.delete(seatId);
  }

  function recordQiPlayerDeath(victimSeatId: number, killerSeatId: number | null): void {
    const eligible = !qiStateObserved
      || (activeQiSeats.has(victimSeatId)
        ? killerSeatId !== null && activeQiSeats.has(killerSeatId)
        : killerSeatId !== null
          && eligibleQiKillersByVictim.get(victimSeatId)?.has(killerSeatId) === true);
    if (!eligible) {
      pendingQiDeath = null;
      eligibleQiKillersByVictim.delete(victimSeatId);
      return;
    }
    pendingQiDeath = { victimSeatId, killerSeatId };
    eligibleQiKillersByVictim.delete(victimSeatId);
  }

  function recordQiTransferSpell(casterSeatId: number, targetSeatIds: readonly number[]): void {
    const uniqueTargets = [...new Set(targetSeatIds)].filter((seatId) => seatId !== casterSeatId);
    if (uniqueTargets.length !== 1) return;
    pendingQiTransfer = {
      originalOwnerSeatId: uniqueTargets[0],
      recipientSeatId: casterSeatId,
      expiresAfterMovement: movementSequence + 2
    };
  }

  function resolvePreferredQiOwner(event: TemporaryZoneMovement): number | null {
    const isHiddenDiscardToHand = event.fromZone === DISCARD_ZONE
      && event.toZone === HAND_ZONE
      && !event.cardIds.some((cardId) => cardId > 0);
    if (!isHiddenDiscardToHand) return null;
    if (pendingQiTransfer?.recipientSeatId === event.toId) {
      return pendingQiTransfer.originalOwnerSeatId;
    }
    if (pendingQiDeath
      && (pendingQiDeath.killerSeatId === null || pendingQiDeath.killerSeatId === event.toId)) {
      return pendingQiDeath.victimSeatId;
    }
    return null;
  }

  function rememberSpellCardClue(event: {
    seatId: number;
    spellId: number;
    targetSeatIds: readonly number[];
    cardIds: readonly number[];
  }): void {
    const cardIds = [...new Set(event.cardIds.filter((cardId) => cardId > 0))];
    if (!cardIds.length) return;
    pendingSpellCardClues.push({
      spellId: event.spellId,
      casterSeatId: event.seatId,
      targetSeatIds: [...event.targetSeatIds],
      cardIds,
      expiresAfterMovement: movementSequence + 6
    });
    if (pendingSpellCardClues.length > 12) {
      pendingSpellCardClues.splice(0, pendingSpellCardClues.length - 12);
    }
  }

  function discardExpiredSpellCardClues(): void {
    for (let index = pendingSpellCardClues.length - 1; index >= 0; index -= 1) {
      if (movementSequence > pendingSpellCardClues[index].expiresAfterMovement) {
        pendingSpellCardClues.splice(index, 1);
      }
    }
  }

  /** 线索里的牌已经以明确卡号移动过，就不能再用来补后续的暗牌移动。 */
  function consumeSpellCluesFor(cardIds: readonly number[]): void {
    const moved = new Set(cardIds.filter((cardId) => cardId > 0));
    if (!moved.size) return;
    for (let index = pendingSpellCardClues.length - 1; index >= 0; index -= 1) {
      if (pendingSpellCardClues[index].cardIds.some((cardId) => moved.has(cardId))) {
        pendingSpellCardClues.splice(index, 1);
      }
    }
  }

  function recoverCardsFromSpellClue(movement: TemporaryZoneMovement): number[] {
    if (movement.cardIds.some((cardId) => cardId > 0)) return [...movement.cardIds];
    // 摸牌来自牌堆，不可能是技能已经打出 / 交出的那几张。
    if (movement.fromZone === DRAW_PILE_ZONE) return [...movement.cardIds];
    const candidates = pendingSpellCardClues.filter((clue) => (
      clue.cardIds.length === movement.cardCount
      && (!movement.spellId || !clue.spellId || movement.spellId === clue.spellId)
      && (clue.casterSeatId === movement.fromId
        || clue.casterSeatId === movement.toId
        || clue.targetSeatIds.includes(movement.fromId)
        || clue.targetSeatIds.includes(movement.toId))
    ));
    if (candidates.length !== 1) return [...movement.cardIds];
    const [match] = candidates;
    pendingSpellCardClues.splice(pendingSpellCardClues.indexOf(match), 1);
    return [...match.cardIds];
  }

  return {
    engine,
    dispose() {
      unsubscribe();
      unsubscribeSeatState();
      temporaryCardZones.clear();
      temporaryZoneSequence = 0;
      resetQiTransferState();
      specialRecovery.clear();
    }
  };
}

/** 3208：暗牌从技能区（10）进手牌时拿的是最底下一张。 */
function takesFromTemporaryZoneBottom(movement: TemporaryZoneMovement): boolean {
  return movement.spellId === 3208 && movement.fromZone === 10 && movement.toZone === HAND_ZONE
    && !movement.cardIds.some((cardId) => cardId > 0);
}

const QI_STATE_ID = 0xe92;
const QI_TRANSFER_SPELL_IDS = new Set([0xe92, 0xe93]);
const DRAW_PILE_BOTTOM_POSITION = 0;
const WHOLE_HAND_SHOW_MOVE_TYPE = 24;

interface TemporaryZoneMovement {
  cardCount: number;
  cardIds: readonly number[];
  fromId: number;
  fromZone: number;
  fromPosition: number;
  fromZoneParam: number;
  toId: number;
  toZone: number;
  toPosition: number;
  toZoneParam: number;
  spellId: number;
}

interface TemporaryCardZone {
  cardIds: number[];
  logicalCardIds: number[];
  gridByCardId: Map<number, number>;
  topGridCount: number;
  traceClosed: boolean;
  sequence: number;
}

interface SpellCardClue {
  spellId: number;
  casterSeatId: number;
  targetSeatIds: number[];
  cardIds: number[];
  expiresAfterMovement: number;
}

/**
 * 控座位（本家）手牌离开时，协议常藏 CardIDs；座位快照里仍有完整已知手牌。
 * 数量恰好匹配时整手拿走；否则按 FromPosition 与数量切片移除。
 */
function recoverCardsFromControlledSeat(
  movement: TemporaryZoneMovement,
  seatStateStore: SeatStateStore
): number[] {
  if (movement.cardIds.some((cardId) => cardId > 0)) return [...movement.cardIds];
  // 仅手牌区有完整已知列表；装备区依赖协议 CardID / CardIDs。
  if (movement.fromZone !== HAND_ZONE) return [...movement.cardIds];
  const snapshot = seatStateStore.getSnapshot();
  if (!snapshot.controlledSeatIds.includes(movement.fromId)) {
    return [...movement.cardIds];
  }
  const seat = snapshot.seats.find((entry) => entry.seatId === movement.fromId);
  if (!seat) return [...movement.cardIds];
  const knownIds = seat.knownCards.map((card) => card.cardId).filter((cardId) => cardId > 0);
  if (!knownIds.length || movement.cardCount <= 0) return [...movement.cardIds];
  if (knownIds.length === movement.cardCount) return knownIds;
  const start = movement.fromPosition;
  if (!Number.isInteger(start) || start < 0 || start + movement.cardCount > knownIds.length) {
    return [...movement.cardIds];
  }
  return knownIds.slice(start, start + movement.cardCount);
}

/** 暗牌整手移走：密诏类技能，或张数 ≥ 当前手牌数。 */
function isWholeHandDeparture(movement: TemporaryZoneMovement, seatStateStore: SeatStateStore): boolean {
  if (movement.fromZone !== HAND_ZONE) return false;
  if (isWholeHandMove(movement)) return true;
  const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === movement.fromId);
  if (!seat) return false;
  const handCount = seat.knownCards.length + seat.unknownCardCount;
  return handCount > 0 && movement.cardCount >= handCount;
}

/** 整手移走时该座位已知牌必然全部随之离开。 */
function recoverWholeHandMovement(
  movement: TemporaryZoneMovement,
  seatStateStore: SeatStateStore
): number[] {
  const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === movement.fromId);
  const knownIds = seat?.knownCards.map((card) => card.cardId).filter((cardId) => cardId > 0) ?? [];
  if (!knownIds.length || knownIds.length > movement.cardCount) return [...movement.cardIds];
  return [...knownIds, ...Array.from({ length: movement.cardCount - knownIds.length }, () => 0)];
}

function recoverCardsFromTemporaryZone(
  movement: TemporaryZoneMovement,
  temporaryCardZones: Map<string, TemporaryCardZone>
): number[] {
  const suppliedCardIds = movement.cardIds.filter((cardId) => cardId > 0);
  if (suppliedCardIds.length || !TEMPORARY_CARD_ZONES.has(movement.fromZone)) {
    return [...movement.cardIds];
  }
  const exactKey = temporaryZoneKey(
    movement.fromId,
    movement.fromZone,
    movement.fromPosition,
    movement.fromZoneParam,
    movement.spellId
  );
  const exactZone = temporaryCardZones.get(exactKey);
  if (exactZone && exactZone.cardIds.length >= movement.cardCount) {
    return selectDepartingTemporaryCards(exactZone, movement);
  }
  const keyPrefix = `${movement.fromId}:${movement.fromZone}:`;
  const candidates = [...temporaryCardZones.entries()]
    .filter(([key, zone]) => {
      if (!key.startsWith(keyPrefix) || !key.endsWith(`:${movement.spellId}`)
        || zone.cardIds.length < movement.cardCount) return false;
      const [, , , zoneParam] = key.split(':').map(Number);
      return !movement.fromZoneParam || zoneParam === movement.fromZoneParam;
    });
  return candidates.length === 1
    ? selectDepartingTemporaryCards(candidates[0][1], movement)
    : [...movement.cardIds];
}

function selectDepartingTemporaryCards(
  zone: TemporaryCardZone,
  movement: TemporaryZoneMovement
): number[] {
  const count = movement.cardCount;
  if (count <= 0 || count > zone.logicalCardIds.length) return [...movement.cardIds];
  if (count === zone.logicalCardIds.length) return [...zone.logicalCardIds];
  return movement.fromPosition === DRAW_PILE_BOTTOM_POSITION
    ? zone.logicalCardIds.slice(-count)
    : zone.logicalCardIds.slice(0, count);
}

function trackTemporaryZoneMovement(
  movement: TemporaryZoneMovement,
  effectiveCardIds: readonly number[],
  temporaryCardZones: Map<string, TemporaryCardZone>,
  nextSequence: () => number
): void {
  const knownCardIds = effectiveCardIds.filter((cardId) => cardId > 0);
  if (TEMPORARY_CARD_ZONES.has(movement.fromZone)) {
    removeTemporaryCards(temporaryCardZones, movement, knownCardIds, nextSequence);
  }
  if (!TEMPORARY_CARD_ZONES.has(movement.toZone) || !knownCardIds.length) return;
  const key = temporaryZoneKey(
    movement.toId,
    movement.toZone,
    movement.toPosition,
    movement.toZoneParam,
    movement.spellId
  );
  const existing = temporaryCardZones.get(key);
  const cardIds = [...new Set([...(existing?.cardIds ?? []), ...knownCardIds])];
  temporaryCardZones.delete(key);
  temporaryCardZones.set(key, createTemporaryCardZone(cardIds, nextSequence()));
}

function removeTemporaryCards(
  temporaryCardZones: Map<string, TemporaryCardZone>,
  movement: TemporaryZoneMovement,
  departingCardIds: readonly number[],
  nextSequence: () => number
): void {
  const prefix = `${movement.fromId}:${movement.fromZone}:`;
  // 先快照再遍历：循环内 delete+set 会把键移到 Map 末尾被迭代器再次访问，
  // 部分离场（remaining 非空）时同一键会被无限重写，主线程直接卡死。
  for (const [key, zone] of [...temporaryCardZones]) {
    if (!key.startsWith(prefix)) continue;
    const remaining = zone.cardIds.filter((cardId) => !departingCardIds.includes(cardId));
    if (remaining.length) {
      temporaryCardZones.delete(key);
      temporaryCardZones.set(key, createTemporaryCardZone(remaining, nextSequence()));
    }
    else temporaryCardZones.delete(key);
  }
}

function createTemporaryCardZone(cardIds: number[], sequence = 0): TemporaryCardZone {
  return {
    cardIds: [...cardIds],
    logicalCardIds: [...cardIds],
    gridByCardId: new Map(cardIds.map((cardId, index) => [cardId, index])),
    topGridCount: cardIds.length,
    traceClosed: false,
    sequence
  };
}

function applyTemporaryCardReorder(
  event: { seatId: number; spellId: number; zoneParam?: number | null; trace: readonly number[] },
  temporaryCardZones: Map<string, TemporaryCardZone>
): void {
  const candidates = [...temporaryCardZones.entries()]
    .filter(([key]) => key.startsWith(`${event.seatId}:`) && key.endsWith(`:${event.spellId}`))
    .filter(([key]) => event.zoneParam === null || event.zoneParam === undefined
      || Number(key.split(':')[3]) === event.zoneParam)
    .sort((left, right) => right[1].sequence - left[1].sequence);
  if (!candidates.length) return;
  const [key, zone] = candidates[0];
  if (event.trace.length === 1) {
    zone.traceClosed = true;
    return;
  }
  const [sourceIndex, targetGrid, finalIndex] = event.trace;
  if (sourceIndex >= zone.logicalCardIds.length || targetGrid >= zone.topGridCount * 2) return;
  const movedCardId = zone.logicalCardIds[sourceIndex];
  const oldGrid = zone.gridByCardId.get(movedCardId);
  if (oldGrid === undefined) return;
  const displacedCardId = [...zone.gridByCardId]
    .find(([cardId, grid]) => cardId !== movedCardId && grid === targetGrid)?.[0];
  if (displacedCardId !== undefined) zone.gridByCardId.set(displacedCardId, oldGrid);
  zone.gridByCardId.set(movedCardId, targetGrid);
  zone.logicalCardIds.splice(sourceIndex, 1);
  const insertionIndex = (finalIndex % zone.topGridCount + zone.topGridCount) % zone.topGridCount;
  zone.logicalCardIds.splice(Math.min(insertionIndex, zone.logicalCardIds.length), 0, movedCardId);
  zone.sequence = Math.max(zone.sequence, ...candidates.map(([, candidate]) => candidate.sequence)) + 1;
  temporaryCardZones.delete(key);
  temporaryCardZones.set(key, zone);
}

function temporaryZoneKey(
  seatId: number,
  zone: number,
  position: number,
  zoneParam: number,
  spellId: number
): string {
  return `${seatId}:${zone}:${position}:${zoneParam}:${spellId}`;
}
