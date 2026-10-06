import type { SeatStateSnapshot } from './seat-state.ts';

/** 游戏对象只在运行时存在，因此适配层只描述迁移所需的最小只读结构。 */
export interface GameSceneSeatSource {
  SelfSeatUi?: unknown;
  width?: number;
  height?: number;
  mySeats?: unknown[];
  isGuoZhan?: boolean;
  seatContainer?: {
    seatUIs?: unknown[];
  };
}

type UnknownRecord = Record<string, unknown>;

// 实机座位对象没有 seatID 字段，座位号在 index/Index。
const SEAT_ID_KEYS = ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index', 'id', 'ID'] as const;
const ORDER_KEYS = ['order', 'seatOrder', 'displayOrder', 'Order'] as const;
const PLAYER_NAME_KEYS = ['playerName', 'name', 'Name', 'nickName', 'NickName'] as const;
const CARD_LIST_KEYS = ['knownCards', 'handCards', 'HandCards', 'cards', 'Cards'] as const;
const SHOWN_HAND_CARD_KEYS = ['HandShowCards', 'handShowCards'] as const;
const SHOWN_HAND_CARD_ID_KEYS = ['HandShowCardIDs', 'handShowCardIDs'] as const;
const CARD_UI_LIST_KEYS = ['cardUis', 'cardUIs', 'handCardUis', 'handCardUIs'] as const;
const EQUIP_CARD_UI_LIST_KEYS = ['equipCardUis', 'equipCardUIs'] as const;
const CARD_ID_KEYS = ['cardId', 'cardID', 'CardId', 'CardID', 'id', 'ID', 'key'] as const;
const CARD_NAME_KEYS = ['name', 'Name', 'cardName'] as const;
const HAND_COUNT_KEYS = ['handCardCount', 'cardCount', 'HandCardCount'] as const;
const CARD_TAG_KEYS = ['TagArr1', 'tagArr1'] as const;

/**
 * 把游戏拥有的座位对象翻译为小抄快照。
 *
 * 不保留游戏对象引用，也不向对象写值；游戏版本缺少某个字段时使用安全默认值，
 * 后续可以按实机观察逐项补充字段别名，而不用污染 Vue 组件。
 */
export function readSeatStateFromGameScene(
  gameScene: GameSceneSeatSource | null
): Partial<SeatStateSnapshot> {
  const rawSeatUIs = gameScene?.seatContainer?.seatUIs;
  if (!Array.isArray(rawSeatUIs) || rawSeatUIs.length === 0) {
    return { inGame: false };
  }

  const controlledSeatIds = readControlledSeatIds(gameScene, rawSeatUIs);
  const seats = rawSeatUIs.flatMap((rawSeatUI, index) => {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) return [];
    const seatId = readSeatId(seat, SEAT_ID_KEYS)
      ?? readSeatId(seatUI, SEAT_ID_KEYS);
    if (seatId === null) return [];

    // 2v2 的 mySeats/controlledSeatIds 会同时包含自己和队友。队友的手牌可以作为
    // 确定牌读取，但不能因此标成“自己”，否则明牌条会把队友座位过滤掉。
    const isSelf = rawSeatUI === gameScene?.SelfSeatUi
      || (readBoolean(seat, ['isSelf', 'IsSelf']) ?? false);
    const isControlled = isSelf || controlledSeatIds.includes(seatId);
    const seatCards = readArray(seat, CARD_LIST_KEYS);
    const shownHandCards = readArray(seat, SHOWN_HAND_CARD_KEYS)
      .filter((rawCard) => readBoolean(asRecord(rawCard), ['IsHide', 'isHide']) !== true);
    // 官方明牌常用 ID 数组（顺手牵羊等获得的牌会写入 HandShowCardIDs）。
    const shownHandCardIds = readArray(seat, SHOWN_HAND_CARD_ID_KEYS);
    const cardContainer = asRecord(seatUI?.cardContainer);
    const visibleCardUIs = readArray(cardContainer, CARD_UI_LIST_KEYS);
    const equipCardUIs = [
      ...readArray(cardContainer, EQUIP_CARD_UI_LIST_KEYS),
      ...readArray(seatUI, EQUIP_CARD_UI_LIST_KEYS)
    ];
    const equipmentCards = [...new Set(equipCardUIs)]
      .flatMap((rawCard) => readKnownCard(rawCard))
      .map((card) => ({ ...card, hints: equipmentHints(card.name) }));
    const equipmentIds = new Set(equipmentCards.map((card) => card.cardId));
    // 其他玩家的 HandCards / 背面 CardUi 常残留上一局卡号，不能当明牌。
    // 对手只读官方公开数组；确定牌还来自明牌引擎的移动记录。
    // 装备区牌已经在座位装备栏可见，不得并入已知手牌。
    const publicCardUIs = visibleCardUIs.filter((rawCard) => isPubliclyShownCard(rawCard));
    const knownCards = (isControlled
      ? [...seatCards, ...shownHandCards, ...shownHandCardIds, ...publicCardUIs]
      : [...shownHandCards, ...shownHandCardIds])
      // 2v2 队友的 HandCards 是确定牌，但调用 SetCardUIRemark 会连带触发技能
      // 文字图层（例如神典韦错误出现“克己”）。私有手牌只读卡号与已有标签。
      .flatMap((rawCard) => readKnownCard(rawCard))
      .filter((card) => !equipmentIds.has(card.cardId));
    const handCardCount = readNonNegativeInteger(seat, HAND_COUNT_KEYS)
      ?? Math.max(seatCards.length, knownCards.length);

    return [{
      seatId,
      displayOrder: readPositiveInteger(seatUI, ORDER_KEYS)
        ?? readPositiveInteger(seat, ORDER_KEYS)
        ?? index + 1,
      playerName: readString(seat, PLAYER_NAME_KEYS),
      // 旁观模式下数组首项也不是自己，不能用排列位置推断本家。
      isSelf,
      isAlive: !(readBoolean(seat, ['isDead', 'IsDead']) ?? false),
      anchor: readSeatAnchor(seatUI, gameScene),
      knownCards,
      equipmentCards,
      unknownCardCount: Math.max(0, handCardCount - knownCards.length)
    }];
  });
  const selfSeat = seats.find((seat) => seat.isSelf);

  return {
    inGame: seats.length > 0,
    isSpectating: !selfSeat,
    selfSeatId: selfSeat?.seatId ?? null,
    controlledSeatIds: controlledSeatIds.length
      ? controlledSeatIds
      : selfSeat ? [selfSeat.seatId] : [],
    mode: !selfSeat ? 'spectator' : gameScene?.isGuoZhan === true ? 'nation-war' : 'identity',
    seats
  };
}

function equipmentHints(name: string): string[] {
  return name.includes('阴风甲') ? ['阴风甲'] : [];
}

function readControlledSeatIds(scene: GameSceneSeatSource, rawSeatUIs: unknown[] = []): number[] {
  const sceneRecord = asRecord(scene);
  const values = Array.isArray(scene.mySeats)
    ? scene.mySeats
    : readArray(sceneRecord, ['MySeats', 'controlledSeats']);
  const ids = values.flatMap((value) => {
    const record = asRecord(value);
    const seatId = record ? readSeatId(record, SEAT_ID_KEYS) : Number(value);
    return Number.isInteger(seatId) && Number(seatId) >= 0 && Number(seatId) < 0xff
      ? [Number(seatId)] : [];
  });
  // 部分2v2排位版本不提供 gameScene.mySeats，只在座位对象上标记友方。
  // 把明确的友方座位并入可读取座位，不能用四人座次盲猜，以免泄露身份局手牌。
  for (const rawSeatUI of rawSeatUIs) {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) continue;
    const friendly = readBoolean(seat, [
      'isFriend', 'IsFriend', 'isTeammate', 'IsTeammate', 'isTeamMate', 'IsTeamMate'
    ]) ?? readBoolean(seatUI, [
      'isFriend', 'IsFriend', 'isTeammate', 'IsTeammate', 'isTeamMate', 'IsTeamMate'
    ]);
    if (friendly !== true) continue;
    const seatId = readSeatId(seat, SEAT_ID_KEYS) ?? readSeatId(seatUI, SEAT_ID_KEYS);
    if (seatId !== null) ids.push(seatId);
  }
  return [...new Set(ids)];
}

function isPubliclyShownCard(rawCard: unknown): boolean {
  const cardUI = asRecord(rawCard);
  const card = asRecord(cardUI?.card)
    ?? asRecord(cardUI?.Card)
    ?? asRecord(cardUI?.cardInfo)
    ?? cardUI;
  if (!cardUI && !card) return false;
  const hidden = readBoolean(cardUI, ['IsHide', 'isHide', 'isBack', 'IsBack', 'back'])
    ?? readBoolean(card, ['IsHide', 'isHide', 'isBack', 'IsBack', 'back']);
  if (hidden === true) return false;
  const shown = readBoolean(cardUI, ['isShow', 'IsShow', 'isFront', 'IsFront'])
    ?? readBoolean(card, ['isShow', 'IsShow', 'isFront', 'IsFront']);
  if (shown === false) return false;
  return readPositiveInteger(card, CARD_ID_KEYS) !== null;
}
function readKnownCard(rawCard: unknown) {
  if (Number.isInteger(Number(rawCard)) && Number(rawCard) > 0) {
    return [{ cardId: Number(rawCard), name: '', tags: [] }];
  }
  const cardUI = asRecord(rawCard);
  const card = asRecord(cardUI?.card)
    ?? asRecord(cardUI?.Card)
    ?? asRecord(cardUI?.cardInfo)
    ?? cardUI;
  const cardId = readPositiveInteger(card, CARD_ID_KEYS);
  return cardId === null ? [] : [{
    cardId,
    name: readString(card, CARD_NAME_KEYS),
    tags: [...new Set([
      ...readStringArray(cardUI, CARD_TAG_KEYS),
      ...readStringArray(card, CARD_TAG_KEYS)
    ])]
  }];
}

function readSeatAnchor(seatUI: UnknownRecord, scene: GameSceneSeatSource): object | null {
  const width = readFiniteNumber(seatUI, ['width', 'Width', 'displayWidth']);
  const height = readFiniteNumber(seatUI, ['height', 'Height', 'displayHeight']);
  if (!(width > 0 && height > 0)) return null;
  let x = 0;
  let y = 0;
  let scaleX = 1;
  let scaleY = 1;
  let node: UnknownRecord | null = seatUI;
  let depth = 0;
  while (node && depth++ < 12) {
    x += (readFiniteNumber(node, ['x', '_x']) || 0) * scaleX;
    y += (readFiniteNumber(node, ['y', '_y']) || 0) * scaleY;
    scaleX *= readFiniteNumber(node, ['scaleX', '_scaleX']) || 1;
    scaleY *= readFiniteNumber(node, ['scaleY', '_scaleY']) || 1;
    node = asRecord(node.parent);
  }
  const stageWidth = readFiniteNumber(asRecord(scene), ['width', 'Width', 'designWidth'])
    || readFiniteNumber(asRecord((globalThis as UnknownRecord).Laya)?.stage as UnknownRecord, ['width'])
    || 1920;
  const stageHeight = readFiniteNumber(asRecord(scene), ['height', 'Height', 'designHeight'])
    || readFiniteNumber(asRecord((globalThis as UnknownRecord).Laya)?.stage as UnknownRecord, ['height'])
    || 1080;
  return { x, y, width: width * scaleX, height: height * scaleY, stageWidth, stageHeight };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function readArray(record: UnknownRecord | null, keys: readonly string[]): unknown[] {
  if (!record) return [];
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function readString(record: UnknownRecord | null, keys: readonly string[]): string {
  if (!record) return '';
  for (const key of keys) if (typeof record[key] === 'string') return record[key] as string;
  return '';
}

function readStringArray(record: UnknownRecord | null, keys: readonly string[]): string[] {
  if (!record) return [];
  for (const key of keys) {
    if (!Array.isArray(record[key])) continue;
    return (record[key] as unknown[])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
  }
  return [];
}

function readBoolean(record: UnknownRecord | null, keys: readonly string[]): boolean | null {
  if (!record) return null;
  for (const key of keys) if (typeof record[key] === 'boolean') return record[key] as boolean;
  return null;
}

function readPositiveInteger(record: UnknownRecord | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function readSeatId(record: UnknownRecord | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

function readNonNegativeInteger(record: UnknownRecord | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

function readFiniteNumber(record: UnknownRecord | null, keys: readonly string[]): number {
  if (!record) return 0;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}
