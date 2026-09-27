import { locateGameScene } from '../seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

export interface OfficialCardView {
  ui: UnknownRecord;
  owner: UnknownRecord;
  cardId: number;
}

export const OFFICIAL_CARD_BASE_WIDTH = 93;
export const OFFICIAL_CARD_BASE_HEIGHT = 130;

const artworkCache = new Map<number, string>();

/** 通过游戏原生卡牌类获取指定 ID 的牌对象。 */
export function resolveOfficialCard(cardId: number, scene = asRecord(locateGameScene(window))): unknown {
  if (!(cardId > 0) || !scene) return null;
  const sample = findCardSample(scene);
  for (let provider = asRecord(sample)?.constructor; provider; provider = Object.getPrototypeOf(provider)) {
    if (typeof provider.GetInstance !== 'function') continue;
    try {
      return (provider.GetInstance as Function).call(provider, cardId) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 复用游戏 createNormalCardUi + Draw，把官方牌面画到宿主 Sprite 上。
 * 与原版局内弹层、最近用牌同一条渲染链。
 */
export function createOfficialCardView(
  host: UnknownRecord,
  cardId: number,
  width = OFFICIAL_CARD_BASE_WIDTH,
  height = OFFICIAL_CARD_BASE_HEIGHT,
  scene = asRecord(locateGameScene(window))
): OfficialCardView | null {
  if (!host || !(cardId > 0) || !scene) return null;
  const container = findCardContainer(scene);
  const nativeCard = resolveOfficialCard(cardId, scene);
  if (!container || !nativeCard || typeof container.createNormalCardUi !== 'function') return null;

  let ui: UnknownRecord | null = null;
  try {
    ui = asRecord((container.createNormalCardUi as Function).call(container, nativeCard));
    if (!ui || typeof ui.Draw !== 'function') return null;
    ui.mouseEnabled = false;
    ui.mouseThrough = true;
    ui.NeedToolTip = cardId > 0;
    const actualWidth = Math.max(1, Math.round(width));
    const actualHeight = Math.max(1, Math.round(height));
    // size 只改布局盒，牌面仍按 93×130 绘制；缩放必须走 SetActualSize。
    if (typeof ui.SetActualSize === 'function') call(ui, 'SetActualSize', actualWidth, actualHeight);
    else call(ui, 'size', actualWidth, actualHeight);
    call(ui, 'pos', 0, 0);
    const drawHost = resolveDrawHost(host, scene);
    if (!drawHost) {
      releaseOfficialCardView({ ui, owner: container, cardId });
      return null;
    }
    (ui.Draw as Function).call(ui, drawHost);
    return { ui, owner: container, cardId };
  } catch {
    if (ui) releaseOfficialCardView({ ui, owner: container, cardId });
    return null;
  }
}

/**
 * 牌面 Draw 要求宿主实现 addDrawChild（游戏 SgsSprite），普通 Laya.Sprite 会抛错；
 * 在宿主下挂一个同类绘制层并复用。
 */
function resolveDrawHost(host: UnknownRecord, scene: UnknownRecord): UnknownRecord | null {
  if (typeof host.addDrawChild === 'function') return host;
  const existing = asRecord(host.__xcCardDrawLayer);
  if (existing && !existing.destroyed && existing.parent === host) return existing;
  const DrawSprite = findDrawSpriteClass(scene);
  if (!DrawSprite) return null;
  const layer = asRecord(new DrawSprite());
  if (!layer || typeof layer.addDrawChild !== 'function') return null;
  layer.name = 'xcCardDrawLayer';
  layer.mouseEnabled = false;
  layer.mouseThrough = true;
  call(layer, 'pos', 0, 0);
  call(host, 'addChild', layer);
  host.__xcCardDrawLayer = layer;
  return layer;
}

function findDrawSpriteClass(scene: UnknownRecord): (new () => object) | null {
  const sample = asRecord(scene.gameRoundInfo);
  for (let proto = sample && Object.getPrototypeOf(sample); proto; proto = Object.getPrototypeOf(proto)) {
    if (!Object.prototype.hasOwnProperty.call(proto, 'addDrawChild')) continue;
    if (typeof proto.addDrawChild !== 'function' || typeof proto.constructor !== 'function') continue;
    return proto.constructor as new () => object;
  }
  return null;
}

/**
 * 牌面 UI 来自游戏对象池，归还后会被手牌复用：
 * 必须 clear 掉挂在宿主上的绘制子项并还原交互状态，否则手牌会丢花色点数、明暗异常。
 */
export function releaseOfficialCardView(view: OfficialCardView | null | undefined): void {
  if (!view) return;
  try {
    call(view.ui, 'clear');
    call(view.ui, 'removeSelf');
    view.ui.alpha = 1;
    view.ui.mouseEnabled = true;
    view.ui.mouseThrough = false;
    call(view.ui, 'AddCardTag');
    view.ui.Card = null;
    call(view.ui, 'UpdateTag');
    call(view.owner, 'ReturnNormalCardUi', view.ui);
  } catch {
    // 场景切换时对象池可能已释放。
  }
}

/**
 * 解析可供 <img> 使用的官方牌面地址。
 * 优先 data URL 快照（与局内弹层一致），其次 Laya 已加载纹理/资源路径。
 */
export function resolveOfficialCardArtworkUrl(cardId: number, scale = 0.72): string {
  if (!(cardId > 0)) return '';
  const cached = artworkCache.get(cardId);
  if (cached) return cached;

  const snapshot = snapshotOfficialCardDataUrl(cardId, scale);
  if (snapshot) {
    artworkCache.set(cardId, snapshot);
    return snapshot;
  }

  const scene = asRecord(locateGameScene(window));
  const nativeCard = asRecord(resolveOfficialCard(cardId, scene));
  const meta = findCardMetadata(nativeCard);
  const textureUrl = readLoadedCardTexture(meta) || readFormattedCardResourceUrl(meta);
  if (textureUrl) {
    artworkCache.set(cardId, textureUrl);
    return textureUrl;
  }
  return '';
}

export function clearOfficialCardArtworkCache(): void {
  artworkCache.clear();
}

/**
 * 把官方牌面快照成 data URL，供 Vue 面板复用同一视觉。
 * 需要先挂到舞台再 drawToCanvas，否则离屏 Sprite 常得到空白图。
 */
export function snapshotOfficialCardDataUrl(
  cardId: number,
  scale = 0.72
): string {
  if (!(cardId > 0) || typeof document === 'undefined') return '';
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Sprite = laya?.Sprite;
  const stage = asRecord(laya?.stage);
  if (typeof Sprite !== 'function' || !stage) return '';

  const width = Math.max(1, Math.round(OFFICIAL_CARD_BASE_WIDTH * scale));
  const height = Math.max(1, Math.round(OFFICIAL_CARD_BASE_HEIGHT * scale));
  let host: UnknownRecord | null = null;
  let view: OfficialCardView | null = null;
  try {
    host = asRecord(new (Sprite as unknown as new () => object)());
    if (!host) return '';
    host.name = 'xcOfficialCardSnapshotHost';
    host.mouseEnabled = false;
    host.mouseThrough = true;
    host.visible = true;
    host.alpha = 1;
    call(host, 'size', width, height);
    // 放在舞台可见区域外，但仍参与渲染树。
    call(host, 'pos', -width - 40, -height - 40);
    call(stage, 'addChild', host);
    view = createOfficialCardView(host, cardId, width, height);
    if (!view) return '';
    call(stage, 'render');
    call(host, 'repaint');
    call(view.ui, 'repaint');

    const candidates = [
      call(host, 'drawToCanvas', width, height, 0, 0),
      call(view.ui, 'drawToCanvas', width, height, 0, 0),
      call(host, 'drawToCanvas', width, height, Number(host.x || 0), Number(host.y || 0))
    ];
    for (const candidate of candidates) {
      const dataUrl = canvasLikeToDataUrl(candidate);
      if (dataUrl) return dataUrl;
    }
    return '';
  } catch {
    return '';
  } finally {
    releaseOfficialCardView(view);
    try {
      call(host, 'removeSelf');
      call(host, 'destroy', true);
    } catch {
      // 离屏宿主清理失败不影响主流程。
    }
  }
}

function findCardContainer(scene: UnknownRecord): UnknownRecord | null {
  const self = asRecord(scene.SelfSeatUi);
  const fromSelf = asRecord(self?.cardContainer);
  if (fromSelf && typeof fromSelf.createNormalCardUi === 'function') return fromSelf;
  for (const seatUi of readArray(asRecord(scene.seatContainer), 'seatUIs').map(asRecord)) {
    const container = asRecord(seatUi?.cardContainer);
    if (container && typeof container.createNormalCardUi === 'function') return container;
  }
  return null;
}

function findCardSample(scene: UnknownRecord): unknown {
  const candidates = [
    asRecord(scene.SelfSeatUi),
    ...readArray(asRecord(scene.seatContainer), 'seatUIs').map(asRecord)
  ].filter(Boolean) as UnknownRecord[];
  for (const seatUi of candidates) {
    const container = asRecord(seatUi.cardContainer);
    for (const key of [
      'cardUis', 'cardUIs', 'handCardUis', 'handCardUIs',
      'equipCardUis', 'equipCardUIs', 'judgeCardUis', 'judgeCardUIs'
    ]) {
      const item = readArray(container, key)[0];
      if (item) return asRecord(item)?.Card ?? asRecord(item)?.card ?? item;
    }
    const seat = asRecord(seatUi.seat);
    const hand = readArray(seat, 'HandCards')[0] ?? readArray(seat, 'handCards')[0];
    if (hand) return hand;
  }
  return null;
}

function findCardMetadata(card: UnknownRecord | null): UnknownRecord | null {
  if (!card) return null;
  const candidates = [
    card,
    asRecord(card.Config), asRecord(card.config),
    asRecord(card.Data), asRecord(card.data),
    asRecord(card.Info), asRecord(card.info)
  ].filter(Boolean) as UnknownRecord[];
  return candidates.find((candidate) => [
    'IconName', 'iconName', 'CardName', 'cardName', 'Name', 'name'
  ].some((key) => candidate[key] !== undefined)) ?? card;
}

function readFormattedCardResourceUrl(meta: UnknownRecord | null): string {
  if (!meta) return '';
  const resourceKey = readString(meta, [
    'IconName', 'iconName', 'CardIcon', 'cardIcon', 'ResName', 'resName'
  ]).replace(/^cards\//, '').replace(/\.png$/i, '');
  if (!resourceKey) return '';
  const rawPath = `cards/${resourceKey}.png`;
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const urlApi = asRecord(laya?.URL);
  try {
    if (typeof urlApi?.formatURL === 'function') {
      const formatted = String(urlApi.formatURL.call(urlApi, rawPath) || '');
      if (isBrowserDisplayableUrl(formatted)) return formatted;
    }
  } catch {
    // 继续尝试相对路径。
  }
  return isBrowserDisplayableUrl(rawPath) ? rawPath : '';
}

function readLoadedCardTexture(meta: UnknownRecord | null): string {
  if (!meta || typeof document === 'undefined') return '';
  const resourceKey = readString(meta, [
    'IconName', 'iconName', 'CardIcon', 'cardIcon', 'ResName', 'resName'
  ]).replace(/^cards\//, '').replace(/\.png$/i, '');
  if (!resourceKey) return '';
  const rawPath = `cards/${resourceKey}.png`;
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const urlApi = asRecord(laya?.URL);
  const loader = asRecord(laya?.loader);
  const getResource = loader?.getRes ?? loader?.getResource;
  if (typeof getResource !== 'function') return '';
  let formattedPath = rawPath;
  try {
    if (typeof urlApi?.formatURL === 'function') {
      formattedPath = String(urlApi.formatURL.call(urlApi, rawPath));
    }
    const texture = asRecord(getResource.call(loader, formattedPath))
      ?? asRecord(getResource.call(loader, rawPath));
    if (!texture) return '';
    const bitmap = asRecord(texture.bitmap) ?? asRecord(texture._bitmap);
    const source = bitmap?.source ?? bitmap?._source ?? texture.source;
    if (source instanceof HTMLImageElement && source.src && !source.src.startsWith('blob:')) {
      // 独立牌面图可直接给 <img>；图集仍走裁切。
      if (Number(texture.width) >= OFFICIAL_CARD_BASE_WIDTH - 2
        && Number(texture.height) >= OFFICIAL_CARD_BASE_HEIGHT - 2) {
        return source.src;
      }
    }
    return textureToDataUrl(texture);
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
    return '';
  }
}

function canvasLikeToDataUrl(value: unknown): string {
  if (!value) return '';
  if (value instanceof HTMLCanvasElement) {
    try {
      return value.toDataURL('image/png');
    } catch {
      return '';
    }
  }
  const canvas = asRecord(value);
  if (!canvas) return '';
  if (typeof canvas.getCanvas === 'function') {
    const nested = canvas.getCanvas();
    if (nested instanceof HTMLCanvasElement) {
      try {
        return nested.toDataURL('image/png');
      } catch {
        return '';
      }
    }
  }
  const source = canvas.source ?? canvas._source;
  if (source instanceof HTMLCanvasElement) {
    try {
      return source.toDataURL('image/png');
    } catch {
      return '';
    }
  }
  if (typeof canvas.toBase64 === 'function') {
    try {
      const base64 = canvas.toBase64('image/png');
      return typeof base64 === 'string' && base64
        ? (base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`)
        : '';
    } catch {
      return '';
    }
  }
  return '';
}

function isBrowserDisplayableUrl(path: string): boolean {
  return Boolean(path)
    && !/_png$/i.test(path)
    && (
      /^data:image\//i.test(path)
      || /^https?:\/\//i.test(path)
      || /^blob:/i.test(path)
      || /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(path)
    );
}

function readString(record: UnknownRecord | null, keys: readonly string[]): string {
  if (!record) return '';
  for (const key of keys) if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  return '';
}

function readArray(record: UnknownRecord | null, key: string): unknown[] {
  return Array.isArray(record?.[key]) ? record[key] as unknown[] : [];
}

function call(target: UnknownRecord | null | undefined, methodName: string, ...args: unknown[]): unknown {
  const method = target?.[methodName];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}
