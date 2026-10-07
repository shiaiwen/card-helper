/** 小抄允许展示的游戏座位范围；当前微端模式最多八个座位。 */
export const MAX_GAME_SEAT_COUNT = 8;

export interface KnownHandCardSnapshot {
  cardId: number;
  /** 无法解析牌名时保持空字符串，由展示层使用卡牌 ID 降级显示。 */
  name: string;
  /** 游戏官方附加的公开原因或技能标签，例如“炁”。 */
  tags: string[];
}

export interface KnownEquipmentCardSnapshot extends KnownHandCardSnapshot {
  /** 旧版装备提示，例如阴风甲；不代表一张额外手牌。 */
  hints: string[];
}

/** 游戏座位在 Laya 设计坐标中的实际边界，用于把明牌贴在武将牌下方。 */
export interface GameSeatAnchorSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  stageWidth: number;
  stageHeight: number;
}

export interface GameSeatSnapshot {
  seatId: number;
  displayOrder: number;
  playerName: string;
  isSelf: boolean;
  isAlive: boolean;
  anchor: GameSeatAnchorSnapshot | null;
  knownCards: KnownHandCardSnapshot[];
  /** 游戏公开装备区，用于装备状态标签和装备来源预览。 */
  equipmentCards?: KnownEquipmentCardSnapshot[];
  /** 暗牌移动后「可能在该座位」的牌，不计入已知手牌数。 */
  possibleCards?: KnownHandCardSnapshot[];
  unknownCardCount: number;
}

export interface SeatStateSnapshot {
  inGame: boolean;
  isSpectating: boolean;
  selfSeatId: number | null;
  /** 单人模式通常只有一项；多控制角色模式可同时拥有多个座位。 */
  controlledSeatIds: number[];
  mode: 'identity' | 'nation-war' | 'spectator' | 'unknown';
  playerCount: number;
  seats: GameSeatSnapshot[];
}

/** 创建一局开始前的空座位快照。 */
export function createEmptySeatState(): SeatStateSnapshot {
  return {
    inGame: false,
    isSpectating: false,
    selfSeatId: null,
    controlledSeatIds: [],
    mode: 'unknown',
    playerCount: 0,
    seats: []
  };
}

/**
 * 清洗游戏适配器产生的快照，阻止无效座位、重复卡牌和负数计数进入 Vue。
 * 这里只规范展示数据，不修改游戏进程中的任何对象。
 */
export function normalizeSeatState(
  candidate: Partial<SeatStateSnapshot> | null | undefined
): SeatStateSnapshot {
  if (!candidate?.inGame) return createEmptySeatState();

  const selfSeatId = normalizeSeatId(candidate.selfSeatId);
  const controlledSeatIds = [...new Set(
    (Array.isArray(candidate.controlledSeatIds) ? candidate.controlledSeatIds : [selfSeatId])
      .map(normalizeSeatId)
      .filter((seatId): seatId is number => seatId !== null)
  )];
  const seatsById = new Map<number, GameSeatSnapshot>();
  for (const seat of Array.isArray(candidate.seats) ? candidate.seats : []) {
    const seatId = normalizeSeatId(seat?.seatId);
    if (seatId === null || seatsById.has(seatId)) continue;
    const knownCardsById = new Map<number, KnownHandCardSnapshot>();
    for (const card of Array.isArray(seat.knownCards) ? seat.knownCards : []) {
      const cardId = Number(card?.cardId);
      if (!Number.isInteger(cardId) || cardId <= 0 || knownCardsById.has(cardId)) continue;
      const existing = knownCardsById.get(cardId);
      const tags = normalizeCardTags(card?.tags);
      knownCardsById.set(cardId, {
        cardId,
        name: typeof card.name === 'string' && card.name ? card.name : existing?.name ?? '',
        tags: [...new Set([...(existing?.tags ?? []), ...tags])]
      });
    }
    const possibleCards: KnownHandCardSnapshot[] = [];
    for (const card of Array.isArray(seat.possibleCards) ? seat.possibleCards : []) {
      const cardId = Number(card?.cardId);
      if (!Number.isInteger(cardId) || cardId <= 0 || knownCardsById.has(cardId)
        || possibleCards.some((entry) => entry.cardId === cardId)) continue;
      possibleCards.push({
        cardId,
        name: typeof card.name === 'string' ? card.name : '',
        tags: normalizeCardTags(card?.tags)
      });
    }
    const equipmentCards = new Map<number, KnownEquipmentCardSnapshot>();
    for (const card of Array.isArray(seat.equipmentCards) ? seat.equipmentCards : []) {
      const cardId = Number(card?.cardId);
      if (!Number.isInteger(cardId) || cardId <= 0) continue;
      const previous = equipmentCards.get(cardId);
      equipmentCards.set(cardId, {
        cardId,
        name: typeof card.name === 'string' ? card.name : previous?.name ?? '',
        tags: [...new Set([...(previous?.tags ?? []), ...normalizeCardTags(card.tags)])],
        hints: [...new Set([...(previous?.hints ?? []), ...normalizeCardTags(card.hints)])]
      });
    }
    for (const cardId of equipmentCards.keys()) {
      knownCardsById.delete(cardId);
    }
    const possibleCardsWithoutEquip = possibleCards.filter((card) => !equipmentCards.has(card.cardId));
    seatsById.set(seatId, {
      seatId,
      displayOrder: normalizeDisplayOrder(seat.displayOrder, seatsById.size + 1),
      playerName: typeof seat.playerName === 'string' ? seat.playerName : '',
      // controlledSeatIds 在 2v2 中还包含队友；isSelf 只表示本机玩家本人。
      isSelf: seat.isSelf === true || seatId === selfSeatId,
      isAlive: seat.isAlive !== false,
      anchor: normalizeSeatAnchor(seat.anchor),
      knownCards: [...knownCardsById.values()],
      ...(equipmentCards.size ? { equipmentCards: [...equipmentCards.values()] } : {}),
      ...(possibleCardsWithoutEquip.length ? { possibleCards: possibleCardsWithoutEquip } : {}),
      unknownCardCount: Math.max(0, Math.floor(Number(seat.unknownCardCount) || 0))
    });
  }
  const seats = [...seatsById.values()].sort((left, right) => (
    left.displayOrder - right.displayOrder || left.seatId - right.seatId
  ));

  return {
    inGame: true,
    isSpectating: candidate.isSpectating === true,
    selfSeatId,
    controlledSeatIds,
    mode: normalizeGameMode(candidate.mode, candidate.isSpectating === true),
    playerCount: seats.length,
    seats
  };
}

function normalizeGameMode(value: unknown, isSpectating: boolean): SeatStateSnapshot['mode'] {
  if (isSpectating) return 'spectator';
  return value === 'identity' || value === 'nation-war' ? value : 'unknown';
}

function normalizeSeatAnchor(value: unknown): GameSeatAnchorSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const anchor = value as Partial<GameSeatAnchorSnapshot>;
  const numbers = [anchor.x, anchor.y, anchor.width, anchor.height, anchor.stageWidth, anchor.stageHeight]
    .map(Number);
  if (!numbers.every(Number.isFinite) || numbers[2] <= 0 || numbers[3] <= 0
    || numbers[4] <= 0 || numbers[5] <= 0) return null;
  return {
    x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3],
    stageWidth: numbers[4], stageHeight: numbers[5]
  };
}

function normalizeCardTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => String(tag ?? '').trim())
    .filter(Boolean);
}

function normalizeSeatId(value: unknown): number | null {
  const seatId = Number(value);
  return Number.isInteger(seatId) && seatId >= 0 && seatId <= MAX_GAME_SEAT_COUNT
    ? seatId
    : null;
}

function normalizeDisplayOrder(value: unknown, fallback: number): number {
  const displayOrder = Number(value);
  return Number.isInteger(displayOrder) && displayOrder >= 1 && displayOrder <= MAX_GAME_SEAT_COUNT
    ? displayOrder
    : fallback;
}
