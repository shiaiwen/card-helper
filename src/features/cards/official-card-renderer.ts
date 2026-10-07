/**
 * 官方卡面渲染：创建/释放游戏原生卡牌 UI，供最近用牌等 HUD 复用。
 */

import { locateGameScene } from '../seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

export interface OfficialCardView {
  ui: UnknownRecord;
  owner: UnknownRecord;
  cardId: number;
}

export const OFFICIAL_CARD_BASE_WIDTH = 93;
export const OFFICIAL_CARD_BASE_HEIGHT = 130;

let cachedCardProvider: { scene: UnknownRecord; provider: UnknownRecord } | null = null;

/** 通过游戏原生卡牌类获取指定 ID 的牌对象。 */
export function resolveOfficialCard(cardId: number, scene = asRecord(locateGameScene(window))): unknown {
  if (!(cardId > 0) || !scene) return null;
  const provider = resolveCardProvider(scene);
  if (!provider || typeof provider.GetInstance !== 'function') return null;
  try {
    return (provider.GetInstance as Function).call(provider, cardId) ?? null;
  } catch {
    cachedCardProvider = null;
    return null;
  }
}

function resolveCardProvider(scene: UnknownRecord): UnknownRecord | null {
  if (cachedCardProvider?.scene === scene && cachedCardProvider.provider) return cachedCardProvider.provider;
  const sample = findCardSample(scene);
  for (let provider = asRecord(sample)?.constructor; provider; provider = Object.getPrototypeOf(provider)) {
    if (typeof provider.GetInstance !== 'function') continue;
    cachedCardProvider = { scene, provider };
    return provider;
  }
  cachedCardProvider = null;
  return null;
}

/**
 * 复用游戏 createNormalCardUi + Draw，把官方牌面画到宿主 Sprite 上。
 * 先 SetActualSize / pos，再 Draw 到带 addDrawChild 的宿主。
 */
export function createOfficialCardView(
  host: UnknownRecord,
  cardId: number,
  width = OFFICIAL_CARD_BASE_WIDTH,
  height = OFFICIAL_CARD_BASE_HEIGHT,
  scene = asRecord(locateGameScene(window)),
  position?: { x: number; y: number }
): OfficialCardView | null {
  if (!host || !(cardId > 0) || !scene) return null;
  const container = findCardContainer(scene);
  const nativeCard = resolveOfficialCard(cardId, scene);
  if (!container || !nativeCard || typeof container.createNormalCardUi !== 'function') return null;

  let ui: UnknownRecord | null = null;
  try {
    ui = asRecord((container.createNormalCardUi as Function).call(container, nativeCard));
    if (!ui || typeof ui.Draw !== 'function') {
      if (ui) releaseOfficialCardView({ ui, owner: container, cardId });
      return null;
    }
    ui.mouseEnabled = false;
    ui.mouseThrough = true;
    ui.NeedToolTip = cardId > 0;
    const actualWidth = Math.max(1, Math.round(width));
    const actualHeight = Math.max(1, Math.round(height));
    // size 只改布局盒，牌面仍按 93×130 绘制；缩放必须走 SetActualSize。
    if (typeof ui.SetActualSize === 'function') call(ui, 'SetActualSize', actualWidth, actualHeight);
    else call(ui, 'size', actualWidth, actualHeight);
    const x = Number.isFinite(position?.x) ? Number(position!.x) : 0;
    const y = Number.isFinite(position?.y) ? Number(position!.y) : 0;
    call(ui, 'pos', x, y);
    const drawHost = resolveDrawHost(host);
    if (!drawHost) {
      releaseOfficialCardView({ ui, owner: container, cardId });
      return null;
    }
    (ui.Draw as Function).call(ui, drawHost);
    suppressOfficialCardSkillTags(ui);
    return { ui, owner: container, cardId };
  } catch {
    if (ui) releaseOfficialCardView({ ui, owner: container, cardId });
    return null;
  }
}

/** 覆盖层不展示牌面自带的技能来源标签；不改写局内手牌对象上的 tagArr1。 */
function suppressOfficialCardSkillTags(ui: UnknownRecord): void {
  ui.__xcSuppressLabel = true;
  const card = asRecord(ui.Card) ?? asRecord(ui.card);
  const tagKey = card && Object.prototype.hasOwnProperty.call(card, 'tagArr1')
    ? 'tagArr1'
    : card && Object.prototype.hasOwnProperty.call(card, 'TagArr1')
      ? 'TagArr1'
      : null;
  const original = tagKey && card ? card[tagKey] : undefined;
  try {
    if (card && tagKey) card[tagKey] = [];
    call(ui, 'AddCardTag');
    call(ui, 'UpdateTag');
    call(ui, 'layoutTagUI');
  } catch {
    // 没有标签接口时保持牌面即可。
  } finally {
    if (card && tagKey) {
      if (original === undefined) delete card[tagKey];
      else card[tagKey] = original;
    }
  }
  const label = asRecord(ui.__xcLabelBtn);
  if (label) label.visible = false;
}

/**
 * new 出真正带 addDrawChild 的 SgsSprite。
 * 禁止 new GameRoundInfo（会再造一份局内 HUD，画面被掏空）。
 * 禁止给普通 Laya.Sprite 伪造 addDrawChild：Draw 会把牌画进绘制层，普通 Sprite 不渲染那层，弹层就只剩标题。
 */
export function createOfficialDrawHost(): UnknownRecord | null {
  const scene = asRecord(locateGameScene(window));
  const roundInfo = asRecord(scene?.gameRoundInfo);
  const roundCtor = roundInfo?.constructor;
  for (let proto = roundInfo ? Object.getPrototypeOf(roundInfo) : null; proto; proto = Object.getPrototypeOf(proto)) {
    if (!Object.prototype.hasOwnProperty.call(proto, 'addDrawChild')) continue;
    if (typeof proto.addDrawChild !== 'function' || typeof proto.constructor !== 'function') continue;
    if (roundCtor && proto.constructor === roundCtor) continue;
    const node = tryConstructDrawHost(proto.constructor);
    if (node) return node;
  }
  const classUtils = asRecord(asRecord((globalThis as UnknownRecord).Laya)?.ClassUtils);
  const getClass = classUtils?.getClass;
  if (typeof getClass === 'function') {
    try {
      const node = tryConstructDrawHost(getClass.call(classUtils, 'SgsSprite'));
      if (node) return node;
    } catch {
      // 类表未注册时走 Object.create 补一层。
    }
  }
  const Sprite = asRecord((globalThis as UnknownRecord).Laya)?.Sprite;
  if (typeof Sprite === 'function') {
    for (let proto = roundInfo ? Object.getPrototypeOf(roundInfo) : null; proto; proto = Object.getPrototypeOf(proto)) {
      if (typeof proto.addDrawChild !== 'function') continue;
      try {
        const node = asRecord(Object.create(proto));
        if (!node) continue;
        (Sprite as unknown as (this: unknown) => void).call(node);
        if (typeof node.addDrawChild !== 'function') continue;
        prepareDrawHost(node);
        return node;
      } catch {
        // 该原型不能当 Sprite 初始化。
      }
    }
  }
  return null;
}

function tryConstructDrawHost(ctor: unknown): UnknownRecord | null {
  if (typeof ctor !== 'function') return null;
  try {
    const node = asRecord(new (ctor as new () => object)());
    if (!node || typeof node.addDrawChild !== 'function') return null;
    prepareDrawHost(node);
    return node;
  } catch {
    return null;
  }
}

function prepareDrawHost(node: UnknownRecord): void {
  node.name = 'xcOfficialDrawHost';
  node.mouseEnabled = false;
  node.mouseThrough = true;
  call(asRecord(node.graphics), 'clear');
  const children = Array.isArray(node._children) ? [...node._children] : [];
  for (const child of children) {
    try {
      call(asRecord(child), 'removeSelf');
    } catch {
      // 构造函数残留节点摘不掉也不继续用它挡牌。
    }
  }
}

function isRealDrawHost(node: UnknownRecord | null): boolean {
  if (!node || typeof node.addDrawChild !== 'function') return false;
  if (node.name === 'xcOfficialDrawHost') return true;
  for (let proto = Object.getPrototypeOf(node); proto; proto = Object.getPrototypeOf(proto)) {
    if (Object.prototype.hasOwnProperty.call(proto, 'addDrawChild') && typeof proto.addDrawChild === 'function') {
      return true;
    }
  }
  return false;
}

/**
 * 牌面 Draw 要求宿主实现 addDrawChild。普通弹层是 Laya.Sprite 时，在其下挂一层 SgsSprite。
 */
function resolveDrawHost(host: UnknownRecord): UnknownRecord | null {
  if (isRealDrawHost(host)) return host;
  const existing = asRecord(host.__xcCardDrawLayer);
  if (isRealDrawHost(existing)) {
    const parent = asRecord(existing.parent) ?? asRecord(existing._parent);
    if (parent !== host) call(host, 'addChild', existing);
    return existing;
  }
  const layer = createOfficialDrawHost();
  if (!layer) return null;
  host.__xcCardDrawLayer = layer;
  layer.zOrder = 10;
  call(host, 'addChild', layer);
  return layer;
}

/** 卸下借来画官方牌面的临时层。 */
export function detachOfficialDrawLayer(host: UnknownRecord | null | undefined): void {
  if (!host) return;
  const layer = asRecord(host.__xcCardDrawLayer);
  if (!layer) return;
  try {
    call(layer, 'removeSelf');
    if (layer.name === 'xcOfficialDrawHost') call(layer, 'destroy', false);
  } catch {
    // 只从树上摘下自制绘制层，不 destroy 游戏节点。
  }
  host.__xcCardDrawLayer = null;
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
      'equipCardUis', 'equipCardUIs', 'judgeCardUis', 'judgeCardUIs',
      'decideCardUis', 'decideCardUIs'
    ]) {
      const item = readArray(container, key)[0];
      if (item) {
        return asRecord(item)?.Card ?? asRecord(item)?.card ?? asRecord(item)?.theCard ?? item;
      }
    }
    const seat = asRecord(seatUi.seat);
    const hand = readArray(seat, 'HandCards')[0]
      ?? readArray(seat, 'handCards')[0]
      ?? readArray(seat, 'handShowCards')[0];
    if (hand) return hand;
  }
  return null;
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
