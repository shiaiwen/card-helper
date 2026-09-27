import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameCardCatalog } from '../cards/game-card-catalog.ts';
import {
  createOfficialCardView,
  OFFICIAL_CARD_BASE_HEIGHT,
  OFFICIAL_CARD_BASE_WIDTH,
  releaseOfficialCardView,
  type OfficialCardView
} from '../cards/official-card-renderer.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import type { SeatStateStore } from '../seat-display/seat-state-store.ts';

type UnknownRecord = Record<string, unknown>;
interface Rect { x: number; y: number; width: number; height: number }

// 对照 app.bak 明牌卡牌预览的布局常量。
const TILE_WIDTH = 41;
const TILE_HEIGHT = 50;
const TILE_GAP = 4;
const MAX_VISIBLE_TILES = 5;
const STRIP_SCALE = 2 / 3;
const VIEWPORT_MARGIN = 12;
const STRIP_OFFSET_X = 2;
const STRIP_OFFSET_Y = 10;
const POPUP_OFFSET = 14;
const POPUP_CARD_SCALE = 0.85;
const POPUP_PADDING = 8;
const POPUP_TITLE_HEIGHT = 26;
const HIDE_DELAY_MS = 120;
const POLL_INTERVAL_MS = 250;
const GAME_FONT = 'fzltchjw';
const NATIVE_GUARD_KEY = '__xcVueMingpaiNativeGuard';

interface SeatStrip {
  seatId: number;
  strip: UnknownRecord;
  hit: UnknownRecord;
  signature: string;
  cardIds: number[];
  anchor: Rect | null;
  nativeSprite: UnknownRecord | null;
}

/** 在其他武将牌下方用 Laya 画明牌小牌条，悬停弹出官方牌面列表（对照 app.bak）。 */
export function installNativeMingpaiPreviewController(
  configStore: XiaochaoConfigStore,
  seatStateStore: SeatStateStore,
  gameCardCatalog: GameCardCatalog
): () => void {
  let stopped = false;
  let scene: UnknownRecord | null = null;
  let parent: UnknownRecord | null = null;
  let root: UnknownRecord | null = null;
  const strips = new Map<number, SeatStrip>();
  let popup: UnknownRecord | null = null;
  let popupCards: OfficialCardView[] = [];
  let popupSeatId: number | null = null;
  let popupSignature = '';
  let pinnedSeatId: number | null = null;
  let hideTimer = 0;

  const clearHideTimer = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = 0;
  };
  const scheduleHide = () => {
    if (pinnedSeatId !== null) return;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      destroyPopup();
    }, HIDE_DELAY_MS);
  };

  function destroyPopup(): void {
    popupCards.forEach((view) => releaseOfficialCardView(view));
    popupCards = [];
    popupSeatId = null;
    popupSignature = '';
    if (popup) destroyNode(popup);
    popup = null;
  }

  function destroyStrip(entry: SeatStrip): void {
    restoreNativeSprite(entry);
    destroyNode(entry.strip);
    strips.delete(entry.seatId);
    if (popupSeatId === entry.seatId) destroyPopup();
    if (pinnedSeatId === entry.seatId) pinnedSeatId = null;
  }

  function destroyAll(): void {
    clearHideTimer();
    destroyPopup();
    [...strips.values()].forEach(destroyStrip);
    if (root) destroyNode(root);
    scene = parent = root = null;
    pinnedSeatId = null;
  }

  function ensureRoot(): UnknownRecord | null {
    const nextScene = asRecord(locateGameScene(window));
    const roundInfo = asRecord(nextScene?.gameRoundInfo);
    const nextParent = asRecord(roundInfo?._parent) ?? roundInfo ?? nextScene;
    if (!nextScene || !nextParent || nextScene.destroyed || nextParent.destroyed) {
      destroyAll();
      return null;
    }
    if (scene !== nextScene || parent !== nextParent || !root || root.destroyed || !(root.parent || root._parent)) {
      destroyAll();
      const created = createSprite('xcVueMingpaiPreviewRoot');
      if (!created) return null;
      created.mouseEnabled = true;
      created.mouseThrough = true;
      created.zOrder = 200000;
      call(created, 'pos', 0, 0);
      call(nextParent, 'addChild', created);
      call(nextParent, 'sortChildren');
      scene = nextScene;
      parent = nextParent;
      root = created;
    }
    const viewport = readViewport(root);
    call(root, 'size', Math.max(1, Number(parent?.width) || viewport.x + viewport.width), Math.max(1, Number(parent?.height) || viewport.y + viewport.height));
    return root;
  }

  function createStrip(seatId: number, host: UnknownRecord): SeatStrip | null {
    const strip = createSprite(`xcVueMingpaiPreviewStrip-${seatId}`);
    const hit = createSprite(`xcVueMingpaiPreviewHit-${seatId}`);
    if (!strip || !hit) return null;
    strip.mouseEnabled = true;
    strip.mouseThrough = true;
    strip.zOrder = 100 + seatId;
    hit.mouseEnabled = true;
    hit.mouseThrough = false;
    hit.hitTestPrior = true;
    hit.zOrder = 1000;
    call(strip, 'addChild', hit);
    call(host, 'addChild', strip);
    const entry: SeatStrip = { seatId, strip, hit, signature: '', cardIds: [], anchor: null, nativeSprite: null };
    const Event = readLayaEvent();
    call(hit, 'on', Event?.ROLL_OVER ?? 'mouseover', entry, () => {
      if (pinnedSeatId !== null && pinnedSeatId !== seatId) return;
      clearHideTimer();
      showPopup(entry);
    });
    call(hit, 'on', Event?.ROLL_OUT ?? 'mouseout', entry, scheduleHide);
    call(hit, 'on', Event?.CLICK ?? 'click', entry, (event: UnknownRecord) => {
      call(event, 'stopPropagation');
      clearHideTimer();
      pinnedSeatId = pinnedSeatId === seatId ? null : seatId;
      if (pinnedSeatId === null) destroyPopup();
      else showPopup(entry);
    });
    strips.set(seatId, entry);
    return entry;
  }

  function renderStrip(entry: SeatStrip, cardIds: number[], anchor: Rect): void {
    const signature = cardIds.join(',');
    if (entry.signature !== signature) {
      readChildren(entry.strip)
        .filter((child) => child !== entry.hit)
        .forEach(destroyNode);
      const truncated = cardIds.length > MAX_VISIBLE_TILES;
      const visible = truncated ? cardIds.slice(0, MAX_VISIBLE_TILES - 1) : cardIds;
      visible.forEach((cardId, index) => {
        const tile = createTile(cardId);
        if (!tile) return;
        call(tile, 'pos', (TILE_WIDTH + TILE_GAP) * index, 0);
        tile.zOrder = index + 2;
        call(entry.strip, 'addChild', tile);
      });
      if (truncated) {
        const ellipsis = createEllipsisTile();
        if (ellipsis) {
          call(ellipsis, 'pos', (TILE_WIDTH + TILE_GAP) * visible.length, 0);
          ellipsis.zOrder = visible.length + 2;
          call(entry.strip, 'addChild', ellipsis);
        }
      }
      call(entry.strip, 'sortChildren');
      entry.signature = signature;
    }
    entry.cardIds = cardIds;
    entry.anchor = anchor;
    const tileCount = Math.min(cardIds.length, MAX_VISIBLE_TILES);
    const width = tileCount * TILE_WIDTH + Math.max(0, tileCount - 1) * TILE_GAP;
    const viewport = readViewport(root);
    const scaledWidth = width * STRIP_SCALE;
    const scaledHeight = TILE_HEIGHT * STRIP_SCALE;
    const x = clamp(anchor.x - STRIP_OFFSET_X, viewport.x + VIEWPORT_MARGIN, viewport.x + viewport.width - scaledWidth - VIEWPORT_MARGIN);
    const y = clamp(anchor.y + anchor.height + STRIP_OFFSET_Y, viewport.y + VIEWPORT_MARGIN, viewport.y + viewport.height - scaledHeight - VIEWPORT_MARGIN);
    call(entry.strip, 'size', width, TILE_HEIGHT);
    call(entry.strip, 'scale', STRIP_SCALE, STRIP_SCALE);
    entry.strip.scaleX = STRIP_SCALE;
    entry.strip.scaleY = STRIP_SCALE;
    call(entry.strip, 'pos', x, y);
    call(entry.hit, 'size', width, TILE_HEIGHT);
    call(entry.hit, 'pos', 0, 0);
    entry.strip.visible = cardIds.length > 0;
  }

  function createTile(cardId: number): UnknownRecord | null {
    const card = gameCardCatalog.resolve(cardId);
    const tile = createSprite(`xcVueMingpaiPreviewTag-${cardId}`);
    if (!tile) return null;
    tile.mouseEnabled = false;
    tile.mouseThrough = true;
    call(tile, 'size', TILE_WIDTH, TILE_HEIGHT);
    drawRoundedRect(tile, TILE_WIDTH, TILE_HEIGHT, 'rgba(255, 239, 207, 0.7)', '#392F22', 1, 4);

    const headHeight = Math.max(20, Math.round(TILE_HEIGHT * 0.53));
    const color = card.isRed ? '#E23E3E' : '#020000';
    const rank = card.rank || '?';
    const suit = card.suitGlyph || '';
    const head = createSprite('xcVueMingpaiPreviewRankSuit');
    const suitText = createText(suit, 20, color, 'left');
    const rankText = createText(rank, 20, color, 'left');
    if (head && suitText && rankText) {
      head.mouseEnabled = false;
      head.mouseThrough = true;
      const rankWidth = Math.max(1, Math.ceil(Number(rankText.textWidth) || 20 * Math.max(0.55, rank.length * 0.55)));
      const suitWidth = suit ? Math.max(1, Math.ceil(Number(suitText.textWidth) || 20)) : 0;
      const total = rankWidth + suitWidth;
      const fit = Math.min(1, TILE_WIDTH / total);
      call(head, 'size', total, headHeight + 4);
      head.scaleX = fit;
      call(head, 'pos', (TILE_WIDTH - total * fit) / 2, 0);
      call(suitText, 'size', suitWidth, headHeight + 4);
      call(suitText, 'pos', 0, 0);
      call(rankText, 'size', rankWidth, headHeight + 4);
      call(rankText, 'pos', suitWidth, 0);
      call(head, 'addChild', suitText);
      call(head, 'addChild', rankText);
      call(tile, 'addChild', head);
    }
    const shortName = createText((card.name || '?').slice(0, 2) || '?', 18, '#020000', 'center');
    if (shortName) {
      call(shortName, 'size', TILE_WIDTH, Math.max(1, TILE_HEIGHT - headHeight + 3));
      call(shortName, 'pos', 0, headHeight - 1);
      call(tile, 'addChild', shortName);
    }
    return tile;
  }

  function createEllipsisTile(): UnknownRecord | null {
    const tile = createSprite('xcVueMingpaiPreviewEllipsis');
    if (!tile) return null;
    tile.mouseEnabled = false;
    tile.mouseThrough = true;
    call(tile, 'size', TILE_WIDTH, TILE_HEIGHT);
    drawRoundedRect(tile, TILE_WIDTH, TILE_HEIGHT, 'rgba(255, 239, 207, 0.7)', '#392F22', 1, 4);
    const text = createText('…', 22, '#020000', 'center');
    if (text) {
      call(text, 'size', TILE_WIDTH, TILE_HEIGHT);
      call(text, 'pos', 0, -1);
      call(tile, 'addChild', text);
    }
    return tile;
  }

  function showPopup(entry: SeatStrip): void {
    if (!root || !entry.anchor || !entry.cardIds.length) {
      destroyPopup();
      return;
    }
    const viewport = readViewport(root);
    const direction = chooseDirection(entry.anchor, viewport);
    const maxWidth = direction === 'right'
      ? viewport.x + viewport.width - VIEWPORT_MARGIN - entry.anchor.x - entry.anchor.width - POPUP_OFFSET
      : entry.anchor.x - viewport.x - VIEWPORT_MARGIN - POPUP_OFFSET;
    const cardWidth = Math.round(OFFICIAL_CARD_BASE_WIDTH * POPUP_CARD_SCALE);
    const cardHeight = Math.round(OFFICIAL_CARD_BASE_HEIGHT * POPUP_CARD_SCALE);
    const count = entry.cardIds.length;
    const available = Math.max(cardWidth + POPUP_PADDING * 2, maxWidth || 1600);
    const gap = count > 1
      ? Math.max(5, Math.min(cardWidth + 8, (available - POPUP_PADDING * 2 - cardWidth) / (count - 1)))
      : 0;
    const width = Math.min(available, POPUP_PADDING * 2 + cardWidth + gap * (count - 1));
    const height = POPUP_PADDING * 2 + POPUP_TITLE_HEIGHT + cardHeight;
    const signature = `${entry.seatId}:${entry.cardIds.join(',')}:${Math.round(width)}:${direction}`;

    if (!popup || popupSignature !== signature) {
      destroyPopup();
      const created = createSprite('xcVueMingpaiCardList');
      if (!created) return;
      created.mouseEnabled = true;
      created.mouseThrough = false;
      created.zOrder = 10000;
      call(created, 'size', width, height);
      drawRoundedRect(created, width, height, 'rgba(29, 23, 18, 0.96)', '#C9A15D', 1, 6);
      const Event = readLayaEvent();
      call(created, 'on', Event?.ROLL_OVER ?? 'mouseover', created, clearHideTimer);
      call(created, 'on', Event?.ROLL_OUT ?? 'mouseout', created, scheduleHide);
      const title = createText(`确定牌（${count}）`, 14, '#FFF3D0', 'left');
      if (title) {
        call(title, 'size', Math.max(1, width - POPUP_PADDING * 2), POPUP_TITLE_HEIGHT);
        call(title, 'pos', POPUP_PADDING, POPUP_PADDING);
        call(created, 'addChild', title);
      }
      call(root, 'addChild', created);
      entry.cardIds.forEach((cardId, index) => {
        const view = createOfficialCardView(created, cardId, cardWidth, cardHeight);
        if (!view) return;
        call(view.ui, 'pos', POPUP_PADDING + gap * index, POPUP_PADDING + POPUP_TITLE_HEIGHT);
        popupCards.push(view);
      });
      popup = created;
      popupSignature = signature;
    }
    popupSeatId = entry.seatId;
    const rawX = direction === 'right'
      ? entry.anchor.x + entry.anchor.width + POPUP_OFFSET
      : entry.anchor.x - width - POPUP_OFFSET;
    const x = clamp(rawX, viewport.x + VIEWPORT_MARGIN, viewport.x + viewport.width - width - VIEWPORT_MARGIN);
    const y = clamp(
      entry.anchor.y + (entry.anchor.height - height) / 2,
      viewport.y + VIEWPORT_MARGIN,
      viewport.y + viewport.height - height - VIEWPORT_MARGIN
    );
    call(popup, 'pos', x, y);
  }

  function sync(): void {
    if (stopped) return;
    if (!configStore.get('display.seatUiEnabled')) {
      destroyAll();
      return;
    }
    const snapshot = seatStateStore.getSnapshot();
    if (!snapshot.inGame) {
      destroyAll();
      return;
    }
    const host = ensureRoot();
    if (!host || !scene) return;
    const seatUis = readSeatUis(scene);
    const activeSeatIds = new Set<number>();
    for (const seat of snapshot.seats) {
      if (seat.isSelf || seat.seatId === snapshot.selfSeatId) continue;
      const seatUi = seatUis.get(seat.seatId);
      const anchor = seatUi ? readAnchorRect(seatUi, host) : null;
      const cardIds = seat.knownCards.map((card) => card.cardId).filter((cardId) => cardId > 0);
      const existing = strips.get(seat.seatId);
      if (!seatUi || !anchor || !cardIds.length) {
        if (existing) destroyStrip(existing);
        continue;
      }
      const entry = existing ?? createStrip(seat.seatId, host);
      if (!entry) continue;
      hideNativeSprite(entry, seatUi);
      renderStrip(entry, cardIds, anchor);
      activeSeatIds.add(seat.seatId);
      if (popupSeatId === seat.seatId) showPopup(entry);
    }
    [...strips.values()]
      .filter((entry) => !activeSeatIds.has(entry.seatId))
      .forEach(destroyStrip);
  }

  const stopSeatState = seatStateStore.subscribe(sync);
  const stopConfig = configStore.subscribe('display.seatUiEnabled', sync);
  const timer = window.setInterval(sync, POLL_INTERVAL_MS);
  sync();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    stopSeatState();
    stopConfig();
    destroyAll();
  };
}

/** 官方明牌组件与小牌条重叠，显示期间强制隐藏，卸载时恢复。 */
function hideNativeSprite(entry: SeatStrip, seatUi: UnknownRecord): void {
  const manager = asRecord(seatUi.otherTopManager) ?? asRecord(seatUi.topManager);
  const sprite = asRecord(manager?.handCardSpr);
  if (entry.nativeSprite && entry.nativeSprite !== sprite) restoreNativeSprite(entry);
  if (!sprite || sprite.destroyed) return;
  entry.nativeSprite = sprite;
  if (sprite[NATIVE_GUARD_KEY]) return;
  const ownDescriptor = Object.getOwnPropertyDescriptor(sprite, 'visible');
  const inherited = findDescriptor(Object.getPrototypeOf(sprite), 'visible');
  const descriptor = ownDescriptor ?? inherited;
  let storedValue = ownDescriptor && 'value' in ownDescriptor ? Boolean(ownDescriptor.value) : Boolean(sprite.visible);
  const write = (value: boolean) => {
    if (typeof descriptor?.set === 'function') descriptor.set.call(sprite, value);
    else storedValue = value;
  };
  const guard = { ownDescriptor, requestedVisible: Boolean(sprite.visible), write, read: () => storedValue };
  try {
    Object.defineProperty(sprite, NATIVE_GUARD_KEY, { configurable: true, value: guard });
    Object.defineProperty(sprite, 'visible', {
      configurable: true,
      enumerable: ownDescriptor?.enumerable ?? false,
      get: () => false,
      set(value: unknown) {
        guard.requestedVisible = Boolean(value);
        write(false);
        if ('_visible' in sprite) sprite._visible = false;
      }
    });
    write(false);
    if ('_visible' in sprite) sprite._visible = false;
  } catch {
    // 官方组件不可改写时保持原样。
  }
}

function restoreNativeSprite(entry: SeatStrip): void {
  const sprite = entry.nativeSprite;
  entry.nativeSprite = null;
  const guard = asRecord(sprite?.[NATIVE_GUARD_KEY]) as {
    ownDescriptor?: PropertyDescriptor; requestedVisible: boolean; write(value: boolean): void;
  } | null;
  if (!sprite || !guard) return;
  try {
    if (guard.ownDescriptor) Object.defineProperty(sprite, 'visible', guard.ownDescriptor);
    else delete sprite.visible;
    delete sprite[NATIVE_GUARD_KEY];
    guard.write(guard.requestedVisible);
    if ('_visible' in sprite) sprite._visible = guard.requestedVisible;
    call(sprite, 'OnUpdateCard');
  } catch {
    // 场景切换时组件可能已销毁。
  }
}

function readSeatUis(scene: UnknownRecord): Map<number, UnknownRecord> {
  const result = new Map<number, UnknownRecord>();
  const seatUis = asRecord(scene.seatContainer)?.seatUIs;
  for (const value of Array.isArray(seatUis) ? seatUis : []) {
    const seatUi = asRecord(value);
    const seat = asRecord(seatUi?.seat);
    const seatId = Number(seat?.index ?? seat?.Index ?? seatUi?.seatID);
    if (seatUi && Number.isInteger(seatId)) result.set(seatId, seatUi);
  }
  return result;
}

/** 以武将牌（缺失时座位头像 / 座位）为锚点，换算到小牌条根节点坐标。 */
function readAnchorRect(seatUi: UnknownRecord, root: UnknownRecord): Rect | null {
  const avatar = asRecord(seatUi.seatAvatar);
  for (const node of [asRecord(avatar?.generalCard), avatar, seatUi]) {
    if (!node) continue;
    const local = readNodeRect(node);
    if (!local) continue;
    const topLeft = toRootPoint(node, root, local.x, local.y);
    const bottomRight = toRootPoint(node, root, local.x + local.width, local.y + local.height);
    if (!topLeft || !bottomRight) continue;
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y)
    };
  }
  return null;
}

function readNodeRect(node: UnknownRecord): Rect | null {
  if (node.destroyed) return null;
  const accept = (value: unknown): Rect | null => {
    const record = asRecord(value);
    const width = Math.max(0, Number(record?.width) || 0);
    const height = Math.max(0, Number(record?.height) || 0);
    if (width < 40 || height < 50) return null;
    return { x: Number(record?.x) || 0, y: Number(record?.y) || 0, width, height };
  };
  const fromShowRect = accept(node.showRect);
  if (fromShowRect) return fromShowRect;
  try {
    const fromBounds = accept(call(node, 'getSelfBounds'));
    if (fromBounds) return fromBounds;
  } catch { /* 不同版本方法可能缺失。 */ }
  const width = Math.max(0, Number(node.width) || Number(node.ScaledWidth) || 0);
  const height = Math.max(0, Number(node.height) || Number(node.ScaledHeight) || 0);
  return width >= 40 && height >= 50 ? { x: 0, y: 0, width, height } : null;
}

function readViewport(root: UnknownRecord | null): Rect {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const stage = asRecord(laya?.stage);
  const stageWidth = Math.max(1, Number(stage?.width) || Number(root?.width) || 1600);
  const stageHeight = Math.max(1, Number(stage?.height) || Number(root?.height) || 900);
  if (stage && root) {
    const topLeft = toRootPoint(stage, root, 0, 0);
    const bottomRight = toRootPoint(stage, root, stageWidth, stageHeight);
    if (topLeft && bottomRight) {
      return {
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
        height: Math.max(1, Math.abs(bottomRight.y - topLeft.y))
      };
    }
  }
  return { x: 0, y: 0, width: stageWidth, height: stageHeight };
}

function toRootPoint(node: UnknownRecord, root: UnknownRecord, x: number, y: number): { x: number; y: number } | null {
  try {
    const Point = asRecord((globalThis as UnknownRecord).Laya)?.Point as (new (x: number, y: number) => object) | undefined;
    const makePoint = (px: number, py: number) => (typeof Point === 'function' ? new Point(px, py) : { x: px, y: py });
    const global = typeof node.localToGlobal === 'function'
      ? asRecord((node.localToGlobal as Function).call(node, makePoint(x, y)))
      : { x, y };
    if (!global) return null;
    const local = typeof root.globalToLocal === 'function'
      ? asRecord((root.globalToLocal as Function).call(root, makePoint(Number(global.x), Number(global.y))))
      : global;
    const px = Number(local?.x);
    const py = Number(local?.y);
    return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
  } catch {
    return null;
  }
}

function chooseDirection(anchor: Rect, viewport: Rect): 'left' | 'right' {
  const rightSpace = viewport.x + viewport.width - VIEWPORT_MARGIN - anchor.x - anchor.width;
  const leftSpace = anchor.x - viewport.x - VIEWPORT_MARGIN;
  return rightSpace >= leftSpace ? 'right' : 'left';
}

function createSprite(name: string): UnknownRecord | null {
  const Sprite = asRecord((globalThis as UnknownRecord).Laya)?.Sprite;
  if (typeof Sprite !== 'function') return null;
  const sprite = asRecord(new (Sprite as unknown as new () => object)());
  if (sprite) sprite.name = name;
  return sprite;
}

function createText(text: string, fontSize: number, color: string, align: 'left' | 'center'): UnknownRecord | null {
  const Text = asRecord((globalThis as UnknownRecord).Laya)?.Text;
  if (typeof Text !== 'function') return null;
  const node = asRecord(new (Text as unknown as new () => object)());
  if (!node) return null;
  node.text = text;
  node.font = GAME_FONT;
  node.fontSize = fontSize;
  node.color = color;
  node.stroke = 0;
  node.align = align;
  node.valign = 'middle';
  node.bold = false;
  node.mouseEnabled = false;
  return node;
}

function drawRoundedRect(
  target: UnknownRecord,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  lineWidth: number,
  radius: number
): void {
  const graphics = asRecord(target.graphics);
  if (!graphics) return;
  const r = Math.min(radius, width / 2, height / 2);
  call(graphics, 'clear');
  try {
    call(graphics, 'drawPath', 0, 0, [
      ['moveTo', r, 0],
      ['arcTo', width, 0, width, height, r],
      ['arcTo', width, height, 0, height, r],
      ['arcTo', 0, height, 0, 0, r],
      ['arcTo', 0, 0, r, 0, r],
      ['closePath']
    ], { fillStyle: fill }, { strokeStyle: stroke, lineWidth });
  } catch {
    call(graphics, 'drawRect', 0, 0, width, height, fill, stroke, lineWidth);
  }
}

function destroyNode(node: UnknownRecord): void {
  try {
    call(node, 'removeSelf');
    call(node, 'destroy', true);
  } catch {
    // 场景切换时节点可能已销毁。
  }
}

function readChildren(node: UnknownRecord): UnknownRecord[] {
  const children = node._children;
  return Array.isArray(children) ? children.map(asRecord).filter(Boolean) as UnknownRecord[] : [];
}

function findDescriptor(target: object | null, key: string): PropertyDescriptor | null {
  for (let current = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
  }
  return null;
}

function readLayaEvent(): UnknownRecord | null {
  return asRecord(asRecord((globalThis as UnknownRecord).Laya)?.Event);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value));
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
