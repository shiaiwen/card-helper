export type GameEvent =
  | {
    type: 'game-started';
  }
  | {
    type: 'game-ended';
  }
  | {
    type: 'turn-started';
    seatId: number;
    /** 协议 TurnCnt；用于按回合过滤本回合弃牌，与原版 nC.turn 对齐。 */
    turnCount: number;
    round: number;
  }
  | {
    /** GsCGamephaseNtf：Round 为阶段下标（0 回合开始时 … 4 出牌 … 8 回合结束后）。 */
    type: 'phase-changed';
    seatId: number;
    phase: number;
  }
  | {
    /** GsCUpdateRoleDataExNtf DataID=1：Datas=[?, 本回合已出杀, 出杀上限]。 */
    type: 'sha-count-updated';
    seatId: number;
    used: number;
    limit: number;
  }
  | {
    type: 'cards-used';
    seatId: number;
    cardIds: number[];
    /** PubGsCUseCard vs PubGsCUseSpell；技能花色序列只认用牌。 */
    source: 'use-card' | 'use-spell';
    /** 协议 UseType；权变等要求 === 1。 */
    useType: number | null;
    isSend: boolean;
  }
  | {
    type: 'hand-cards-revealed';
    seatId: number;
    cardIds: number[];
  }
  | {
    type: 'temporary-cards-reordered';
    seatId: number;
    spellId: number;
    trace: number[];
  }
  | {
    type: 'seat-state-changed';
    seatId: number;
    stateId: number;
    value: number;
  }
  | {
    type: 'player-died';
    seatId: number;
    killerSeatId: number | null;
  }
  | {
    type: 'spell-targeted';
    seatId: number;
    spellId: number;
    targetSeatIds: number[];
    cardIds: number[];
  }
  | {
    /** GsCRoleOptTargetNtf 原样字段；看牌规则在 mingpai/rules 里解释。 */
    type: 'opt-target';
    /** 操作者座位（SeatID）。 */
    seatId: number;
    srcSeatId: number | null;
    /** 被看座位；255 表示牌堆。 */
    targetSeatId: number | null;
    spellId: number;
    param: number;
    /** 原始 Params，保留 0 与前缀计数。 */
    params: number[];
    /** 协议 CardIDs；部分技能（严教）Params 为空时卡号在这里。 */
    cardIds?: number[];
  }
  | {
    /** CGsRoleSpellOptRep 原样字段。 */
    type: 'spell-opt-rep';
    seatId: number;
    spellId: number;
    optType: number;
    datas: number[];
  }
  | {
    type: 'cards-moved';
    cardCount: number;
    cardIds: number[];
    fromId: number;
    fromZone: number;
    fromPosition: number;
    fromZoneParam: number;
    toId: number;
    toZone: number;
    toPosition: number;
    toZoneParam: number;
    moveType: number;
    spellId: number;
  };

export type GameEventListener = (event: Readonly<GameEvent>) => void;

export interface GameEventBus {
  publish(event: GameEvent): void;
  subscribe(listener: GameEventListener): () => void;
  clear(): void;
}

/**
 * 游戏协议解析层与各项功能之间的单向事件边界。
 * 功能模块只接收已经命名的业务事件，不直接判断混淆协议类名。
 */
export function createGameEventBus(): GameEventBus {
  const listeners = new Set<GameEventListener>();
  return {
    publish(event) {
      const normalizedEvent = normalizeGameEvent(event);
      if (!normalizedEvent) return;
      listeners.forEach((listener) => listener(normalizedEvent));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      listeners.clear();
    }
  };
}

function normalizeGameEvent(event: GameEvent): Readonly<GameEvent> | null {
  if (!event || typeof event.type !== 'string') return null;
  if (event.type === 'game-started' || event.type === 'game-ended') {
    return Object.freeze({ type: event.type });
  }
  if (event.type === 'cards-moved') {
    const cardCount = normalizeNonNegativeInteger(event.cardCount);
    if (cardCount === null || cardCount === 0) return null;
    return Object.freeze({
      type: event.type,
      cardCount,
      // 0 是服务端用于隐藏牌身份的有效占位，移动事件中必须保留。
      cardIds: Object.freeze(event.cardIds.map(normalizeNonNegativeInteger).filter(isNumber)),
      fromId: normalizeNonNegativeInteger(event.fromId) ?? 0,
      fromZone: normalizeNonNegativeInteger(event.fromZone) ?? 0,
      fromPosition: normalizeNonNegativeInteger(event.fromPosition) ?? 0,
      fromZoneParam: normalizeNonNegativeInteger(event.fromZoneParam) ?? 0,
      toId: normalizeNonNegativeInteger(event.toId) ?? 0,
      toZone: normalizeNonNegativeInteger(event.toZone) ?? 0,
      toPosition: normalizeNonNegativeInteger(event.toPosition) ?? 0,
      toZoneParam: normalizeNonNegativeInteger(event.toZoneParam) ?? 0,
      moveType: normalizeNonNegativeInteger(event.moveType) ?? 0,
      spellId: normalizeNonNegativeInteger(event.spellId) ?? 0
    }) as Readonly<GameEvent>;
  }
  if (event.type === 'temporary-cards-reordered') {
    const seatId = normalizeSeatId(event.seatId);
    const spellId = normalizeNonNegativeInteger(event.spellId);
    const trace = event.trace.map(normalizeNonNegativeInteger).filter(isNumber);
    if (seatId === null || spellId === null || (trace.length !== 1 && trace.length !== 3)) return null;
    return Object.freeze({
      type: event.type,
      seatId,
      spellId,
      trace: Object.freeze(trace)
    }) as Readonly<GameEvent>;
  }
  if (event.type === 'seat-state-changed') {
    const seatId = normalizeSeatId(event.seatId);
    const stateId = normalizeNonNegativeInteger(event.stateId);
    const value = Number(event.value);
    if (seatId === null || stateId === null || !Number.isFinite(value)) return null;
    return Object.freeze({ type: event.type, seatId, stateId, value });
  }
  if (event.type === 'player-died') {
    const seatId = normalizeSeatId(event.seatId);
    const killerSeatId = event.killerSeatId === null ? null : normalizeSeatId(event.killerSeatId);
    if (seatId === null) return null;
    return Object.freeze({ type: event.type, seatId, killerSeatId });
  }
  if (event.type === 'spell-targeted') {
    const seatId = normalizeSeatId(event.seatId);
    const spellId = normalizeNonNegativeInteger(event.spellId);
    const targetSeatIds = [...new Set(event.targetSeatIds.map(normalizeSeatId).filter(isNumber))];
    const cardIds = [...new Set(event.cardIds.map(normalizePositiveInteger).filter(isNumber))];
    if (seatId === null || spellId === null || (!targetSeatIds.length && !cardIds.length)) return null;
    return Object.freeze({
      type: event.type,
      seatId,
      spellId,
      targetSeatIds: Object.freeze(targetSeatIds),
      cardIds: Object.freeze(cardIds)
    }) as Readonly<GameEvent>;
  }
  if (event.type === 'opt-target') {
    const seatId = normalizeSeatId(event.seatId);
    const spellId = normalizeNonNegativeInteger(event.spellId);
    if (seatId === null || spellId === null) return null;
    return Object.freeze({
      type: event.type,
      seatId,
      srcSeatId: event.srcSeatId === null ? null : normalizeSeatId(event.srcSeatId),
      // 255 = 牌堆，是合法目标，不能用 normalizeSeatId 过滤。
      targetSeatId: event.targetSeatId === null
        ? null
        : normalizeNonNegativeInteger(event.targetSeatId),
      spellId,
      param: normalizeNonNegativeInteger(event.param) ?? 0,
      params: Object.freeze(event.params.map(normalizeNonNegativeInteger).filter(isNumber)),
      cardIds: Object.freeze((event.cardIds ?? []).map(normalizeNonNegativeInteger)
        .filter((cardId): cardId is number => cardId !== null && cardId > 0))
    }) as Readonly<GameEvent>;
  }
  if (event.type === 'spell-opt-rep') {
    const seatId = normalizeSeatId(event.seatId);
    const spellId = normalizeNonNegativeInteger(event.spellId);
    if (seatId === null || spellId === null) return null;
    return Object.freeze({
      type: event.type,
      seatId,
      spellId,
      optType: normalizeNonNegativeInteger(event.optType) ?? 0,
      datas: Object.freeze(event.datas.map(normalizeNonNegativeInteger).filter(isNumber))
    }) as Readonly<GameEvent>;
  }
  const seatId = normalizeSeatId(event.seatId);
  if (seatId === null) return null;
  if (event.type === 'turn-started') {
    return Object.freeze({
      type: event.type,
      seatId,
      turnCount: normalizeNonNegativeInteger(event.turnCount) ?? 0,
      round: normalizeNonNegativeInteger(event.round) ?? 0
    });
  }
  if (event.type === 'phase-changed') {
    const phase = normalizeNonNegativeInteger(event.phase);
    if (phase === null) return null;
    return Object.freeze({ type: event.type, seatId, phase });
  }
  if (event.type === 'sha-count-updated') {
    const used = Number(event.used);
    const limit = Number(event.limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
    return Object.freeze({ type: event.type, seatId, used, limit });
  }
  if (event.type === 'hand-cards-revealed') {
    const cardIds = [...new Set(event.cardIds.map(normalizePositiveInteger).filter(isNumber))];
    if (!cardIds.length) return null;
    return Object.freeze({ type: event.type, seatId, cardIds: Object.freeze(cardIds) }) as Readonly<GameEvent>;
  }
  if (event.type === 'cards-used') {
    const cardIds = [...new Set(event.cardIds.map(normalizePositiveInteger).filter(isNumber))];
    if (!cardIds.length) return null;
    const source = event.source === 'use-spell' ? 'use-spell' : 'use-card';
    const useType = event.useType === null || event.useType === undefined
      ? null
      : normalizeNonNegativeInteger(event.useType);
    return Object.freeze({
      type: event.type,
      seatId,
      cardIds: Object.freeze(cardIds),
      source,
      useType,
      isSend: event.isSend === true
    }) as Readonly<GameEvent>;
  }
  return null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeSeatId(value: unknown): number | null {
  const seatId = Number(value);
  return Number.isInteger(seatId) && seatId >= 0 && seatId < 0xff ? seatId : null;
}

function isNumber(value: number | null): value is number {
  return value !== null;
}
