import type { GameEvent } from '../runtime/game-event-bus.ts';

type UnknownRecord = Record<string, unknown>;

const TURN_MESSAGE_NAMES = new Set(['MsgGameTurnNtf']);
/** 新行动角色开始时 Round=0；每位玩家回合切换时清空本回合弃牌。 */
const PLAYER_TURN_MESSAGE_NAMES = new Set(['GsCGamephaseNtf']);
const CARD_USE_MESSAGE_NAMES = new Set(['PubGsCUseCard', 'PubGsCUseSpell']);
const CARD_MOVE_MESSAGE_NAME = 'PubGsCMoveCard';
const FRIEND_HAND_REVEAL_MESSAGE_NAME = 'ClientHappyGetFriendHandcardRep';
const OPT_TARGET_MESSAGE_NAME = 'GsCRoleOptTargetNtf';
const TEMPORARY_CARD_REORDER_MESSAGE_NAME = 'CGsRoleSpellOptRep';
const PLAYER_DIED_MESSAGE_NAME = 'SmsgGamePlayerDead';
const SPELL_TARGET_MESSAGE_NAME = 'PubGsCUseSpell';
const ROLE_DATA_MESSAGE_NAME = 'GsCUpdateRoleDataExNtf';
const SHA_COUNT_DATA_ID = 1;
const SEAT_ID_KEYS = [
  'SeatID', 'SeatId', 'seatID', 'seatId',
  'SrcSeatID', 'SrcSeatId', 'FromSeatID', 'FromSeatId'
] as const;
const SRC_SEAT_ID_KEYS = ['SrcSeatID', 'SrcSeatId', 'srcSeatID', 'srcSeatId'] as const;
const TARGET_SEAT_ID_KEYS = [
  'targetSeatID', 'TargetSeatID', 'targetSeatId', 'TargetSeatId',
  'DestSeatID', 'DestSeatId'
] as const;
const CARD_ID_KEYS = ['CardID', 'CardId', 'cardID', 'cardId'] as const;
const CARD_IDS_KEYS = ['CardIDs', 'CardIds', 'cardIDs', 'cardIds', 'Cards'] as const;

/** 将微端收到的协议日志翻译为稳定业务事件；未知协议直接忽略。 */
export function translateGameMessage(rawArguments: unknown[]): GameEvent | null {
  return translateGameMessages(rawArguments)[0] ?? null;
}

/** 一条协议可能对应多个业务事件（SpellOptRep = 看牌 + 临时区重排线索）。 */
export function translateGameMessages(rawArguments: unknown[]): GameEvent[] {
  const payload = findMessagePayload(rawArguments);
  if (!payload) return [];
  const className = readString(payload, ['ClassName', 'className']);
  if (!className) return [];
  if (className === OPT_TARGET_MESSAGE_NAME) {
    const event = translateOptTarget(payload);
    return event ? [event] : [];
  }
  if (className === TEMPORARY_CARD_REORDER_MESSAGE_NAME) return translateSpellOptRep(payload);
  if (className === ROLE_DATA_MESSAGE_NAME) {
    const event = translateShaCount(payload);
    return event ? [event] : [];
  }
  const event = translateSingleMessage(payload, className);
  if (PLAYER_TURN_MESSAGE_NAMES.has(className)) {
    const phaseEvent = translatePhase(payload);
    return [event, phaseEvent].filter((item): item is GameEvent => item !== null);
  }
  return event ? [event] : [];
}

function translatePhase(payload: UnknownRecord): GameEvent | null {
  const seatId = readSeatId(payload, [
    ...SEAT_ID_KEYS,
    'CurrentID', 'CurrentId', 'currentID', 'currentId'
  ]);
  const phase = readNonNegativeInteger(payload, ['Round', 'round']);
  if (seatId === null || phase === null) return null;
  return { type: 'phase-changed', seatId, phase };
}

/** 对照原版：DataID=1 且 Datas 至少 3 项时，Datas[1] 为已出杀次数、Datas[2] 为上限。 */
function translateShaCount(payload: UnknownRecord): GameEvent | null {
  const dataId = readNonNegativeInteger(payload, ['DataID', 'DataId', 'dataID', 'dataId']);
  const datas = payload.Datas ?? payload.datas;
  if (dataId !== SHA_COUNT_DATA_ID || !Array.isArray(datas) || datas.length < 3) return null;
  const seatId = readSeatId(payload, SEAT_ID_KEYS);
  const used = Number(datas[1]);
  const limit = Number(datas[2]);
  if (seatId === null || !Number.isFinite(limit)) return null;
  return { type: 'sha-count-updated', seatId, used: Number.isFinite(used) ? used : 0, limit };
}

function translateSingleMessage(payload: UnknownRecord, className: string): GameEvent | null {
  if (className === CARD_MOVE_MESSAGE_NAME) return translateCardMovement(payload);
  // MsgGameTurnNtf 通常只有 TurnCnt，不携带 SeatID。必须在通用座位校验前
  // 处理，否则每次回合切换都会被提前丢弃，本回合统计便永远不会清空。
  if (TURN_MESSAGE_NAMES.has(className)) {
    const seatId = readSeatId(payload, [
      ...SEAT_ID_KEYS,
      'CurrentID', 'CurrentId', 'currentID', 'currentId'
    ]);
    return {
      type: 'turn-started',
      seatId: seatId ?? 0,
      turnCount: readNonNegativeInteger(payload, [
        'TurnCnt', 'turnCnt', 'Turn', 'turn', 'TurnCount', 'turnCount'
      ]) ?? 0,
      round: readNonNegativeInteger(payload, ['Round', 'round']) ?? 0
    };
  }
  // 每位行动角色开始（Round=0）时清空本回合弃牌；Round>0 只是阶段推进。
  if (PLAYER_TURN_MESSAGE_NAMES.has(className)) {
    const seatId = readSeatId(payload, [
      ...SEAT_ID_KEYS,
      'CurrentID', 'CurrentId', 'currentID', 'currentId'
    ]);
    const round = readNonNegativeInteger(payload, ['Round', 'round']);
    if (seatId === null || round === null || round !== 0) return null;
    return {
      type: 'turn-started',
      seatId,
      turnCount: 0,
      round: 0
    };
  }
  const seatId = readSeatId(payload, SEAT_ID_KEYS);
  if (seatId === null) return null;

  const stateId = readNonNegativeInteger(payload, ['StateID', 'StateId', 'stateID', 'stateId']);
  const stateValue = readFiniteNumber(payload, ['Value', 'value']);
  if (stateId !== null && stateValue !== null) {
    return { type: 'seat-state-changed', seatId, stateId, value: stateValue };
  }
  if (className === PLAYER_DIED_MESSAGE_NAME) {
    const killerSeatId = readSeatId(payload, [
      'MurderSeatID', 'MurderSeatId', 'murderSeatID', 'murderSeatId',
      'KillerSeatID', 'KillerSeatId'
    ]);
    return { type: 'player-died', seatId, killerSeatId };
  }
  if (className === SPELL_TARGET_MESSAGE_NAME) {
    const spellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']);
    const targetSeatIds = readSeatIdArray(payload, ['DestSeatIDs', 'DestSeatIds', 'Targets']);
    const cardIds = readCardIds(payload);
    if (spellId !== null && (targetSeatIds.length || cardIds.length)) {
      return {
        type: 'spell-targeted',
        seatId,
        spellId,
        targetSeatIds,
        cardIds
      };
    }
  }

  if (className === FRIEND_HAND_REVEAL_MESSAGE_NAME) {
    const cardIds = readCardIds(payload);
    return cardIds.length ? { type: 'hand-cards-revealed', seatId, cardIds } : null;
  }
  if (!CARD_USE_MESSAGE_NAMES.has(className)) return null;

  const cardIds = readCardIds(payload);
  if (!cardIds.length) return null;
  return {
    type: 'cards-used',
    seatId,
    cardIds,
    source: className === 'PubGsCUseSpell' ? 'use-spell' : 'use-card',
    useType: readNonNegativeInteger(payload, ['UseType', 'useType']),
    isSend: payload.isSend === true
  };
}

function translateCardMovement(payload: UnknownRecord): GameEvent | null {
  const cardCount = readNonNegativeInteger(payload, ['CardCount', 'cardCount']);
  const moveType = readNonNegativeInteger(payload, ['MoveType', 'moveType']);
  if (!cardCount || !moveType || payload.isSend === true) return null;
  const fromZone = readNonNegativeInteger(payload, ['FromZone', 'fromZone']) ?? 0;
  const toZone = readNonNegativeInteger(payload, ['ToZone', 'toZone']) ?? 0;
  return {
    type: 'cards-moved',
    cardCount,
    cardIds: readMovementCardIds(payload),
    fromId: normalizeZoneOwner(
      readNonNegativeInteger(payload, ['FromID', 'FromId', 'fromID', 'fromId']) ?? 0,
      fromZone
    ),
    fromZone,
    fromPosition: readNonNegativeInteger(payload, ['FromPosition', 'fromPosition']) ?? 0,
    fromZoneParam: readNonNegativeInteger(payload, ['FromZoneParam', 'fromZoneParam']) ?? 0,
    toId: normalizeZoneOwner(
      readNonNegativeInteger(payload, ['ToID', 'ToId', 'toID', 'toId']) ?? 0,
      toZone
    ),
    toZone,
    toPosition: readNonNegativeInteger(payload, ['ToPosition', 'toPosition']) ?? 0,
    toZoneParam: readNonNegativeInteger(payload, ['ToZoneParam', 'toZoneParam']) ?? 0,
    moveType,
    spellId: readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']) ?? 0
  };
}

/**
 * GsCRoleOptTargetNtf：SeatID=操作者，SrcSeatID=施法者，
 * targetSeatID=被看座位（255=牌堆），Param/Params 含义由技能决定。
 * 这里只搬字段，不解释；解释在 mingpai/rules/opt-target-rules.ts。
 */
function translateOptTarget(payload: UnknownRecord): GameEvent | null {
  const spellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']);
  const seatId = readSeatId(payload, ['SeatID', 'SeatId', 'seatID', 'seatId'])
    ?? readSeatId(payload, SRC_SEAT_ID_KEYS);
  if (spellId === null || seatId === null) return null;
  return {
    type: 'opt-target',
    seatId,
    srcSeatId: readSeatId(payload, SRC_SEAT_ID_KEYS),
    targetSeatId: readNonNegativeInteger(payload, TARGET_SEAT_ID_KEYS),
    spellId,
    param: readNonNegativeInteger(payload, ['Param', 'param']) ?? 0,
    params: readRawNumberArray(payload, ['Params', 'params']),
    cardIds: readRawNumberArray(payload, ['CardIDs', 'CardIds', 'cardIDs', 'cardIds'])
  };
}

function translateSpellOptRep(payload: UnknownRecord): GameEvent[] {
  const seatId = readSeatId(payload, SEAT_ID_KEYS);
  const spellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']);
  if (seatId === null || spellId === null) return [];
  const events: GameEvent[] = [{
    type: 'spell-opt-rep',
    seatId,
    spellId,
    optType: readNonNegativeInteger(payload, ['Type', 'type']) ?? 0,
    datas: readRawNumberArray(payload, ['Datas', 'datas'])
  }];
  const trace = readNumberArray(payload, [
    'Args', 'args', 'Params', 'params', 'Param', 'param',
    'Values', 'values', 'Result', 'result'
  ]);
  if (trace.length === 1 || trace.length === 3) {
    events.push({ type: 'temporary-cards-reordered', seatId, spellId, trace });
  }
  return events;
}

function readRawNumberArray(payload: UnknownRecord, keys: readonly string[]): number[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    return value.map(nonNegativeInteger).filter(isNumber);
  }
  return [];
}

const GLOBAL_ZONE_IDS = new Set([0, 1, 2, 3, 9, 12]);

/** 原版 Zone 构造器会把公共区域的协议 ID=0 归一为 0xff。 */
function normalizeZoneOwner(ownerId: number, zone: number): number {
  return ownerId === 0 && GLOBAL_ZONE_IDS.has(zone) ? 0xff : ownerId;
}

function readMovementCardIds(payload: UnknownRecord): number[] {
  for (const key of CARD_IDS_KEYS) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    return value.map((candidate) => {
      const card = asRecord(candidate);
      return card
        ? readNonNegativeInteger(card, CARD_ID_KEYS) ?? 0
        : nonNegativeInteger(candidate) ?? 0;
    });
  }
  // 单张移动（顺手牵羊等）有时只带 CardID，不带 CardIDs 数组。
  for (const key of CARD_ID_KEYS) {
    const value = nonNegativeInteger(payload[key]);
    if (value !== null) return [value];
  }
  return [];
}

function readNumberArray(payload: UnknownRecord, keys: readonly string[]): number[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    const numbers = value.map(nonNegativeInteger).filter(isNumber);
    if (numbers.length === value.length) return numbers;
  }
  return [];
}

function readSeatIdArray(payload: UnknownRecord, keys: readonly string[]): number[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((candidate) => nonNegativeInteger(candidate))
      .filter((seatId): seatId is number => seatId !== null && seatId < 0xff);
  }
  return [];
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function findMessagePayload(rawArguments: unknown[]): UnknownRecord | null {
  for (let index = rawArguments.length - 1; index >= 0; index -= 1) {
    const candidate = asRecord(rawArguments[index]);
    if (candidate && readString(candidate, ['ClassName', 'className'])) return candidate;
  }
  return null;
}

function readCardIds(payload: UnknownRecord): number[] {
  const ids: number[] = [];
  for (const key of CARD_IDS_KEYS) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    value.forEach((candidate) => appendCardId(ids, candidate));
  }
  for (const key of CARD_ID_KEYS) appendCardId(ids, payload[key]);
  return [...new Set(ids)];
}

function appendCardId(target: number[], candidate: unknown): void {
  const card = asRecord(candidate);
  const value = card ? readPositiveInteger(card, CARD_ID_KEYS) : positiveInteger(candidate);
  if (value !== null) target.push(value);
}

function readString(record: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) if (typeof record[key] === 'string') return record[key] as string;
  return '';
}

function readPositiveInteger(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = positiveInteger(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function readSeatId(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = nonNegativeInteger(record[key]);
    if (value !== null && value < 0xff) return value;
  }
  return null;
}

function readNonNegativeInteger(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = nonNegativeInteger(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function readFiniteNumber(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
