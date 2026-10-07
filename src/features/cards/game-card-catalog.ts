/**
 * 本局卡牌目录：结合场景与官方配置解析 cardId → 名称/花色/点数/立绘。
 */

import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';

type UnknownRecord = Record<string, unknown>;
type CardProvider = { GetInstance(cardId: number): unknown };

export interface GameCardMetadata {
  cardId: number;
  name: string;
  suit: 'spade' | 'heart' | 'club' | 'diamond' | '';
  suitGlyph: '♠' | '♥' | '♣' | '♦' | '';
  rank: string;
  isRed: boolean;
  /** 游戏原生卡牌类型编号；无法读取时为 0。 */
  cardType: number;
  /** 游戏模型直接暴露独立牌面资源时使用；图集资源无法裁切时保持空字符串。 */
  artworkUrl: string;
}

export interface GameCardCatalog {
  resolve(cardId: number): Readonly<GameCardMetadata>;
  clear(): void;
}

/** 神典韦技能派生牌，不是可展示的实体牌（牌名是左膀/右膀，不是“臂膀”）。 */
export function isDianweiArmCardName(name: string): boolean {
  return name === '左膀' || name === '右膀' || name.includes('臂膀');
}

const SUITS = {
  // 官方配置 Color：1 红桃、2 方片、3 黑桃、4 梅花。
  1: { suit: 'heart', glyph: '♥', red: true },
  2: { suit: 'diamond', glyph: '♦', red: true },
  3: { suit: 'spade', glyph: '♠', red: false },
  4: { suit: 'club', glyph: '♣', red: false }
} as const;

/** 通过游戏原生卡牌类读取元数据；缺少原生对象时从卡牌 ID 解析花色和点数。 */
export function createGameCardCatalog(
  getGameScene: () => GameSceneSeatSource | null,
  lookupConfiguredCard: (cardId: number) => UnknownRecord | null = () => null
): GameCardCatalog {
  const cache = new Map<number, Readonly<GameCardMetadata>>();
  let cachedScene: GameSceneSeatSource | null = null;
  let cachedProvider: CardProvider | null = null;

  return {
    resolve(rawCardId) {
      const cardId = positiveInteger(rawCardId) ?? 0;
      const cached = cache.get(cardId);
      // 元数据一旦读过就复用。原先要求 artworkUrl 才命中缓存，会在 Electron
      // 截图失败时每次 resolve 都再次走原生牌面池，把弃牌弹层正在用的 UI 清掉。
      if (cached) return cached;

      const scene = getGameScene();
      if (scene !== cachedScene) {
        cachedScene = scene;
        cachedProvider = findCardProvider(scene);
        cache.clear();
      }
      let nativeCard: unknown = null;
      try {
        nativeCard = cachedProvider?.GetInstance(cardId) ?? null;
      } catch {
        cachedProvider = null;
      }
      const metadata = Object.freeze(readCardMetadata(cardId, nativeCard, lookupConfiguredCard));
      cache.set(cardId, metadata);
      return metadata;
    },
    clear() {
      cachedScene = null;
      cachedProvider = null;
      cache.clear();
    }
  };
}

function findCardProvider(scene: GameSceneSeatSource | null): CardProvider | null {
  const sampleCard = findCardSample(scene);
  if (!sampleCard) return null;
  for (let candidate = asRecord(sampleCard)?.constructor; candidate; candidate = Object.getPrototypeOf(candidate)) {
    if (typeof (candidate as CardProvider).GetInstance === 'function') return candidate as CardProvider;
  }
  return null;
}

function findCardSample(scene: GameSceneSeatSource | null): unknown {
  if (!scene) return null;
  const sceneRecord = asRecord(scene);
  const seatUIs = scene.seatContainer?.seatUIs ?? [];
  const selfSeatUI = asRecord(sceneRecord?.SelfSeatUi);
  const candidates = [selfSeatUI, ...seatUIs.map(asRecord)].filter(Boolean) as UnknownRecord[];
  for (const seatUI of candidates) {
    const container = asRecord(seatUI.cardContainer);
    for (const listName of [
      'cardUis', 'cardUIs', 'equipCardUis', 'equipCardUIs',
      'judgeCardUis', 'judgeCardUIs', 'decideCardUis', 'decideCardUIs'
    ]) {
      const cardUI = Array.isArray(container?.[listName]) ? container[listName][0] : null;
      const sample = unwrapCard(cardUI);
      if (sample) return sample;
    }
    for (const listName of ['judgeCardUis', 'judgeCardUIs', 'decideCardUis', 'decideCardUIs']) {
      const cardUI = Array.isArray(seatUI[listName]) ? seatUI[listName][0] : null;
      const sample = unwrapCard(cardUI);
      if (sample) return sample;
    }
    const seat = asRecord(seatUI.seat);
    for (const listName of ['HandCards', 'handCards', 'EquipCards', 'equipCards']) {
      const card = Array.isArray(seat?.[listName]) ? seat[listName][0] : null;
      const sample = unwrapCard(card);
      if (sample && typeof sample === 'object') return sample;
    }
  }
  return null;
}

function unwrapCard(value: unknown): unknown {
  const record = asRecord(value);
  return record?.Card ?? record?.card ?? record?.cardInfo ?? value;
}

function readCardMetadata(
  cardId: number,
  nativeValue: unknown,
  lookupConfiguredCard: (cardId: number) => UnknownRecord | null
): GameCardMetadata {
  const nativeCard = findNativeCardMetadata(asRecord(nativeValue));
  const configuredCard = lookupConfiguredCard(cardId) ?? readGameConfiguredCard(cardId);
  // 原生卡牌对象的 Color 只区分红黑（1 红 2 黑），花色必须以官方配置 color（1♥ 2♦ 3♠ 4♣）为准。
  const cardData = hasUsefulCardMetadata(configuredCard) || !hasUsefulCardMetadata(nativeCard)
    ? configuredCard ?? nativeCard
    : nativeCard;
  const encodedSuit = Math.floor(cardId / 10000);
  const encodedNumber = Math.floor(cardId / 100) % 100;
  const suitNumber = positiveInteger(
    cardData?.Color
      ?? cardData?.color
      ?? cardData?.CardSuit
      ?? cardData?.cardSuit
      ?? cardData?.suit
  ) ?? encodedSuit;
  const suit = SUITS[suitNumber as keyof typeof SUITS];
  const number = positiveInteger(
    cardData?.CardNumber
      ?? cardData?.cardNumber
      ?? cardData?.Number
      ?? cardData?.number
      ?? cardData?.Point
      ?? cardData?.point
  ) ?? encodedNumber;

  return {
    cardId,
    name: readString(cardData, ['CardName', 'cardName', 'Name', 'name']),
    suit: suit?.suit ?? '',
    suitGlyph: suit?.glyph ?? '',
    rank: formatRank(number),
    isRed: suit?.red ?? false,
    cardType: positiveInteger(
      cardData?.CardType
        ?? cardData?.cardType
        ?? cardData?.Type
        ?? cardData?.type
    ) ?? 0,
    // 不在热路径截官方牌面：drawToCanvas 会再借一张原生 CardUi，弃牌弹层打开时
    // 会把已经画上的牌还回对象池，表现为「标题有张数、中间是空的」。
    artworkUrl: ''
  };
}

function hasUsefulCardMetadata(card: UnknownRecord | null): boolean {
  return Boolean(readString(card, ['CardName', 'cardName', 'Name', 'name', 'IconName', 'iconName']));
}

/** 从游戏已经加载的官方 sys_playcard.sgs 配置中读取卡牌，不维护自定义牌面表。 */
function readGameConfiguredCard(cardId: number): UnknownRecord | null {
  const globalRecord = globalThis as UnknownRecord;
  const ctrUtil = asRecord(globalRecord.CtrUtil);
  const systemContext = asRecord(globalRecord.SystemContext);
  const dataRoots = [
    asRecord(ctrUtil?.AllDatas), asRecord(ctrUtil?.allDatas),
    asRecord(systemContext?.AllDatas), asRecord(systemContext?.allDatas)
  ].filter(Boolean) as UnknownRecord[];
  for (const root of dataRoots) {
    const playCardConfig = asRecord(root['sys_playcard.sgs']);
    const gamePlayCards = asRecord(playCardConfig?.GamePlayCards);
    const cards = gamePlayCards?.card;
    if (!Array.isArray(cards)) continue;
    const found = cards.find((candidate) => {
      const record = asRecord(candidate);
      return Number(record?.id ?? record?.ID ?? record?.CardID ?? record?.cardId) === cardId;
    });
    const record = asRecord(found);
    if (record) return record;
  }
  return null;
}

/** 原生卡牌实例通常把配置包在 Config/Data/Info 中，只向下检查一层。 */
function findNativeCardMetadata(card: UnknownRecord | null): UnknownRecord | null {
  if (!card) return null;
  const candidates = [
    card,
    asRecord(card.Config), asRecord(card.config),
    asRecord(card.Data), asRecord(card.data),
    asRecord(card.Info), asRecord(card.info),
    asRecord(card.CardInfo), asRecord(card.cardInfo)
  ].filter(Boolean) as UnknownRecord[];
  return candidates.find((candidate) => [
    'CardName', 'cardName', 'Name', 'name', 'IconName', 'iconName',
    'Color', 'color', 'Number', 'number'
  ].some((key) => candidate[key] !== undefined)) ?? card;
}

function readArtworkUrl(nativeCard: UnknownRecord | null, cardId: number): string {
  if (!nativeCard) return '';
  for (const key of ['CardImage', 'cardImage', 'ImageUrl', 'imageUrl', 'IconUrl', 'iconUrl', 'ResPath', 'resPath']) {
    const candidate = normalizeArtworkUrl(nativeCard[key]);
    if (candidate) return candidate;
  }
  for (const methodName of ['getCardPath', 'GetCardPath', 'getCardUrl', 'GetCardUrl']) {
    const method = nativeCard[methodName];
    if (typeof method !== 'function') continue;
    try {
      const candidate = normalizeArtworkUrl(method.call(nativeCard, cardId));
      if (candidate) return candidate;
    } catch {
      // 不同版本方法签名可能不同，继续使用语义牌面降级。
    }
  }
  return '';
}

function normalizeArtworkUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const path = value.trim();
  // Laya 图集键（例如 xxx_png）不是浏览器可直接显示的图片地址。
  if (!/\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(path) && !/^data:image\//i.test(path)) return '';
  try {
    return typeof document === 'undefined' ? path : new URL(path, document.baseURI).href;
  } catch {
    return '';
  }
}

/** 按原版 cards/<IconName>.png 规则读取 Laya 已加载纹理，并自行裁出图集子区域。 */
function readLoadedCardTexture(nativeCard: UnknownRecord | null): string {
  if (!nativeCard || typeof document === 'undefined') return '';
  const resourceKey = readString(nativeCard, [
    'IconName', 'iconName', 'CardIcon', 'cardIcon', 'ResName', 'resName', 'resource'
  ]).replace(/^cards\//, '').replace(/\.png$/i, '');
  if (!resourceKey) return '';
  const rawPath = `cards/${resourceKey}.png`;
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const urlApi = asRecord(laya?.URL);
  const loader = asRecord(laya?.loader);
  const formatUrl = urlApi?.formatURL;
  const getResource = loader?.getRes ?? loader?.getResource;
  if (typeof getResource !== 'function') return '';
  let formattedPath = rawPath;
  try {
    if (typeof formatUrl === 'function') formattedPath = String(formatUrl.call(urlApi, rawPath));
    const texture = asRecord(getResource.call(loader, formattedPath))
      ?? asRecord(getResource.call(loader, rawPath));
    return texture ? textureToDataUrl(texture) : '';
  } catch {
    return '';
  }
}

function textureToDataUrl(texture: UnknownRecord): string {
  const bitmap = asRecord(texture.bitmap) ?? asRecord(texture._bitmap);
  const source = bitmap?.source ?? bitmap?._source ?? texture.source;
  if (!source || typeof source !== 'object') return '';
  const sourceRecord = source as UnknownRecord;
  const sourceWidth = Number(sourceRecord.naturalWidth ?? sourceRecord.videoWidth ?? sourceRecord.width);
  const sourceHeight = Number(sourceRecord.naturalHeight ?? sourceRecord.videoHeight ?? sourceRecord.height);
  if (!(sourceWidth > 0 && sourceHeight > 0)) return '';

  const uv = Array.isArray(texture.uv) ? texture.uv.map(Number) : [];
  const uValues = uv.filter((_, index) => index % 2 === 0);
  const vValues = uv.filter((_, index) => index % 2 === 1);
  const sourceX = uValues.length ? Math.min(...uValues) * sourceWidth : Number(texture.x ?? 0);
  const sourceY = vValues.length ? Math.min(...vValues) * sourceHeight : Number(texture.y ?? 0);
  const cropWidth = uValues.length
    ? (Math.max(...uValues) - Math.min(...uValues)) * sourceWidth
    : Number(texture.width ?? sourceWidth);
  const cropHeight = vValues.length
    ? (Math.max(...vValues) - Math.min(...vValues)) * sourceHeight
    : Number(texture.height ?? sourceHeight);
  if (!(cropWidth > 0 && cropHeight > 0)) return '';

  const outputWidth = Math.max(1, Math.round(Number(texture.sourceWidth ?? texture.width ?? cropWidth)));
  const outputHeight = Math.max(1, Math.round(Number(texture.sourceHeight ?? texture.height ?? cropHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  if (!context) return '';
  try {
    context.drawImage(
      source as CanvasImageSource,
      Math.round(sourceX), Math.round(sourceY), Math.round(cropWidth), Math.round(cropHeight),
      0, 0, outputWidth, outputHeight
    );
    return canvas.toDataURL('image/png');
  } catch {
    // 跨域图片或非浏览器图像源不可导出时使用语义牌面。
    return '';
  }
}

function formatRank(number: number): string {
  if (number === 1 || number === 14) return 'A';
  if (number === 11) return 'J';
  if (number === 12) return 'Q';
  if (number === 13) return 'K';
  if (number === 15) return '2';
  if (number === 16) return '小王';
  if (number === 17) return '大王';
  return number > 0 ? String(number) : '';
}

function readString(record: UnknownRecord | null, keys: readonly string[]): string {
  if (!record) return '';
  for (const key of keys) if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  return '';
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
