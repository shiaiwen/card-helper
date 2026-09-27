import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createOfficialCardView,
  releaseOfficialCardView,
  type OfficialCardView
} from '../cards/official-card-renderer.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import type { RecentCardStore } from './recent-card-store.ts';

type UnknownRecord = Record<string, unknown>;

/**
 * 使用游戏自己的 Laya 卡牌组件显示最近用牌。
 *
 * 原版小抄并不在 DOM 中仿制卡牌，而是把 createNormalCardUi() 创建的对象
 * 直接 Draw 到 gameRoundInfo 旁边。本控制器保留这一边界：Vue 只管理开关，
 * 牌框、插画、字体、花色和清晰度全部由当前游戏版本负责。
 */
export function installNativeRecentCardController(
  configStore: XiaochaoConfigStore,
  recentCardStore: RecentCardStore
): () => void {
  let stopped = false;
  let scene: UnknownRecord | null = null;
  let parent: UnknownRecord | null = null;
  let root: UnknownRecord | null = null;
  let cardView: OfficialCardView | null = null;
  let placeholder: UnknownRecord | null = null;
  let label: UnknownRecord | null = null;
  let hitArea: UnknownRecord | null = null;
  let displayedCardId = 0;

  const clearCard = () => {
    if (!cardView) return;
    releaseOfficialCardView(cardView);
    cardView = null;
    displayedCardId = 0;
  };

  const destroyOverlay = () => {
    clearCard();
    try { call(root, 'removeSelf'); call(root, 'destroy', true); } catch { /* 已随场景销毁 */ }
    scene = parent = root = placeholder = label = hitArea = null;
  };

  const sync = () => {
    if (stopped) return;
    const nextScene = asRecord(locateGameScene(window));
    const roundInfo = asRecord(nextScene?.gameRoundInfo);
    const nextParent = asRecord(roundInfo?._parent) ?? roundInfo ?? nextScene;
    if (!nextScene || !roundInfo || !nextParent || nextScene.destroyed || roundInfo.destroyed) {
      destroyOverlay();
      return;
    }
    if (scene !== nextScene || parent !== nextParent || !root || root.destroyed) {
      destroyOverlay();
      const Sprite = asRecord(globalThis as UnknownRecord)?.Laya;
      const SpriteClass = asRecord(Sprite)?.Sprite;
      if (typeof SpriteClass !== 'function') return;
      root = asRecord(new (SpriteClass as unknown as new () => object)());
      if (!root) return;
      root.name = 'xcNativeRecentCardOverlay';
      root.mouseEnabled = true;
      root.mouseThrough = true;
      root.zOrder = Math.max(100, Number(roundInfo.zOrder || 0) + 1);
      call(nextParent, 'addChild', root);
      scene = nextScene;
      parent = nextParent;
    }

    const enabled = configStore.get('display.deckHudEnabled');
    const snapshot = recentCardStore.getSnapshot();
    const cardId = enabled ? Number(snapshot.displayedCardId || 0) : 0;
    const roundHeight = Math.max(43, Number(roundInfo.height || 43));
    const totalHeight = roundHeight + 24;
    const scale = Math.max(.5, Math.min(.68, totalHeight / 130));
    const width = Math.ceil(93 * scale);
    const height = Math.ceil(130 * scale);
    root.visible = enabled;
    call(root, 'pos', Number(roundInfo.x || 0) - width - 5, Number(roundInfo.y || 0));
    call(root, 'size', width, height);

    if (displayedCardId !== cardId) {
      clearCard();
      if (cardId > 0) cardView = createOfficialCardView(root, cardId, width, height, nextScene);
      displayedCardId = cardView ? cardId : 0;
    }
    const modeText = snapshot.displayMode === 'current' ? '当前' : '玩家';
    placeholder = updatePlaceholder(root, placeholder, `${modeText}\n用牌`, width, height);
    label = updateModeLabel(root, label, modeText, width, height);
    hitArea = updateHitArea(root, hitArea, width, height, () => {
      const nextMode = recentCardStore.getSnapshot().displayMode === 'current' ? 'player' : 'current';
      recentCardStore.setDisplayMode(nextMode);
      configStore.set('display.recentCardMode', nextMode);
      sync();
    });
    if (placeholder) placeholder.visible = !cardView;
    if (label) label.visible = Boolean(cardView);
  };

  const stopStore = recentCardStore.subscribe(sync);
  const stopConfig = configStore.subscribe('display.deckHudEnabled', sync);
  const timer = window.setInterval(sync, 250);
  sync();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    stopStore();
    stopConfig();
    destroyOverlay();
  };
}

/** 没有可显示的牌时占住牌位，样式对照原版“当前/玩家 用牌”空框。 */
function updatePlaceholder(host: UnknownRecord, existing: UnknownRecord | null, text: string, width: number, height: number): UnknownRecord | null {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Sprite = laya?.Sprite;
  const Text = laya?.Text;
  let box = existing;
  if (!box && typeof Sprite === 'function' && typeof Text === 'function') {
    box = asRecord(new (Sprite as unknown as new () => object)());
    const textNode = asRecord(new (Text as unknown as new () => object)());
    if (!box || !textNode) return null;
    box.name = 'xcNativeRecentCardPlaceholder';
    box.mouseEnabled = false;
    box.mouseThrough = true;
    textNode.name = 'xcNativeRecentCardPlaceholderText';
    textNode.fontSize = 12;
    textNode.color = '#B7AA8B';
    textNode.align = 'center';
    textNode.valign = 'middle';
    textNode.leading = 2;
    call(box, 'addChild', textNode);
    call(host, 'addChild', box);
  }
  if (!box) return null;
  call(box, 'size', width, height);
  call(box, 'pos', 0, 0);
  const graphics = asRecord(box.graphics);
  call(graphics, 'clear');
  call(graphics, 'drawRect', 0, 0, width, height, 'rgba(29,23,18,0.7)', '#8B744C', 1);
  const textNode = asRecord(readArray(box, '_children')[0]);
  if (textNode) {
    textNode.text = text;
    textNode.width = width;
    textNode.height = height;
    call(textNode, 'pos', 0, 0);
  }
  return box;
}

function updateModeLabel(host: UnknownRecord, existing: UnknownRecord | null, text: string, cardWidth: number, cardHeight: number): UnknownRecord | null {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Sprite = laya?.Sprite;
  const Text = laya?.Text;
  let label = existing;
  if (!label && typeof Sprite === 'function' && typeof Text === 'function') {
    label = asRecord(new (Sprite as unknown as new () => object)());
    const textNode = asRecord(new (Text as unknown as new () => object)());
    if (!label || !textNode) return null;
    label.name = 'xcNativeRecentCardLabel';
    label.mouseEnabled = false;
    label.zOrder = 160;
    textNode.name = 'xcNativeRecentCardLabelText';
    textNode.font = 'SimSun';
    textNode.bold = true;
    textNode.align = 'center';
    textNode.color = '#fff3d0';
    textNode.stroke = 1;
    textNode.strokeColor = '#3a2014';
    call(label, 'addChild', textNode);
    call(host, 'addChild', label);
  }
  if (!label) return null;
  const labelWidth = Math.max(28, Math.round(cardWidth * .52));
  const labelHeight = Math.max(14, Math.round(Math.min(18, cardHeight * .16)));
  const graphics = asRecord(label.graphics);
  call(graphics, 'clear');
  call(graphics, 'drawRect', 0, 0, labelWidth, labelHeight, '#39281d', '#d2a56e', 1);
  const textNode = asRecord(call(label, 'getChildByName', 'xcNativeRecentCardLabelText')) ?? asRecord(readArray(label, '_children')[0]);
  if (textNode) {
    textNode.text = text;
    textNode.fontSize = Math.max(10, Math.min(12, labelHeight - 3));
    textNode.width = labelWidth;
    textNode.height = labelHeight;
    call(textNode, 'pos', 0, 0);
  }
  call(label, 'size', labelWidth, labelHeight);
  call(label, 'pos', -Math.max(3, Math.round(Math.min(cardWidth, cardHeight) * .05)), Math.max(0, cardHeight - labelHeight - 6));
  return label;
}

function updateHitArea(host: UnknownRecord, existing: UnknownRecord | null, width: number, height: number, onClick: () => void): UnknownRecord | null {
  if (existing) { call(existing, 'size', width, height); return existing; }
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Sprite = laya?.Sprite;
  if (typeof Sprite !== 'function') return null;
  const hit = asRecord(new (Sprite as unknown as new () => object)());
  if (!hit) return null;
  hit.name = 'xcNativeRecentCardHitArea';
  hit.mouseEnabled = true;
  hit.mouseThrough = false;
  hit.zOrder = 170;
  call(hit, 'size', width, height);
  const clickEvent = asRecord(laya?.Event)?.CLICK ?? 'click';
  call(hit, 'on', clickEvent, hit, onClick);
  call(host, 'addChild', hit);
  return hit;
}

function readArray(record: UnknownRecord | null, key: string): unknown[] {
  return Array.isArray(record?.[key]) ? record[key] as unknown[] : [];
}

function call(target: UnknownRecord | null, methodName: string, ...args: unknown[]): unknown {
  const method = target?.[methodName];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? value as UnknownRecord : null;
}
