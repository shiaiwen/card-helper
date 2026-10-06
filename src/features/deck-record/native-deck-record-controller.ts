import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import { isDianweiArmCardName, type GameCardCatalog } from '../cards/game-card-catalog.ts';
import {
  createOfficialCardView,
  detachOfficialDrawLayer,
  OFFICIAL_CARD_BASE_HEIGHT,
  OFFICIAL_CARD_BASE_WIDTH,
  releaseOfficialCardView,
  type OfficialCardView
} from '../cards/official-card-renderer.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import type { DeckRecordStore } from './deck-record-store.ts';
import type {
  DeckRecordInteraction,
  DeckRecordListKind
} from './deck-record-interaction.ts';

type UnknownRecord = Record<string, unknown>;
type SortMode = 'suit-type-number' | 'type-suit-number' | 'number-suit-type';

interface ButtonVisualStyle {
  fill: string;
  hoverFill: string;
  border: string;
  hoverBorder: string;
  text: string;
  hoverText: string;
  prefix: string;
}

interface ButtonNode {
  kind: DeckRecordListKind;
  visual: UnknownRecord;
  hit: UnknownRecord;
  label: UnknownRecord;
  hover: boolean;
}

interface ButtonHandlers {
  onEnter: (kind: DeckRecordListKind) => void;
  onLeave: () => void;
  onClick: (kind: DeckRecordListKind) => void;
}

const BUTTON_WIDTH = 36;
const BUTTON_HEIGHT = 22;
const BUTTON_GAP = 8;
const BUTTON_RADIUS = 4;
const BUTTON_FONT_SIZE = 12;
const BUTTON_ROW_GAP = 2;
const POPUP_CARD_SCALE = 0.72;
const POPUP_PADDING = 10;
const POPUP_MAX_WIDTH = 740;
const POPUP_TITLE_HEIGHT = 29;
const BUTTON_KINDS: readonly DeckRecordListKind[] = ['top', 'bottom', 'discard'];
const LIST_TITLES: Record<DeckRecordListKind, string> = {
  top: '牌堆顶（左侧最先摸到）',
  bottom: '牌堆底（右侧为最底部）',
  discard: '本回合弃牌堆'
};
const BUTTON_STYLES: Record<DeckRecordListKind, ButtonVisualStyle> = {
  top: {
    prefix: '顶',
    fill: 'rgba(34, 27, 19, 0.94)',
    hoverFill: 'rgba(46, 36, 24, 0.96)',
    border: 'rgba(201, 161, 93, 0.58)',
    hoverBorder: '#d2b66f',
    text: '#E8D4A8',
    hoverText: '#FFF3D0'
  },
  bottom: {
    prefix: '底',
    fill: 'rgba(34, 30, 22, 0.94)',
    hoverFill: 'rgba(40, 34, 26, 0.96)',
    border: 'rgba(176, 150, 104, 0.58)',
    hoverBorder: '#c9b07a',
    text: '#D8C69C',
    hoverText: '#FFF3D0'
  },
  discard: {
    prefix: '弃',
    fill: 'rgba(42, 26, 22, 0.94)',
    hoverFill: 'rgba(48, 30, 26, 0.96)',
    border: '#8E6458',
    hoverBorder: '#C4785A',
    text: '#E2C0B0',
    hoverText: '#FFE2D6'
  }
};

/**
 * 局内「顶 / 底 / 弃」挂在 gameRoundInfo 下方；悬停弹层用游戏
 * createNormalCardUi + Draw 画官方牌面（与最近用牌同一条渲染链）。
 * 迁移期顺带清掉旧包残留的同名 Laya 节点，避免叠两套；功能本身不依赖旧脚本。
 */
export function installNativeDeckRecordController(
  configStore: XiaochaoConfigStore,
  deckRecordStore: DeckRecordStore,
  interaction: DeckRecordInteraction,
  gameCardCatalog?: GameCardCatalog
): () => void {
  let stopped = false;
  let scene: UnknownRecord | null = null;
  let parent: UnknownRecord | null = null;
  let root: UnknownRecord | null = null;
  let buttons: ButtonNode[] = [];
  let popup: UnknownRecord | null = null;
  let popupCards: OfficialCardView[] = [];
  let popupSignature = '';
  let hideTimer = 0;

  const displayableCardIds = (cardIds: readonly number[]) => cardIds.filter((cardId) => {
    if (!(cardId > 0)) return false;
    const name = gameCardCatalog?.resolve(cardId).name ?? '';
    return !isDianweiArmCardName(name);
  });

  const clearHideTimer = () => {
    if (!hideTimer) return;
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  };

  const scheduleHide = () => {
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      if (stopped) return;
      interaction.setActiveList(null);
    }, 120);
  };

  const destroyPopup = () => {
    popupCards.forEach((card) => releaseOfficialCardView(card));
    popupCards = [];
    popupSignature = '';
    if (!popup) return;
    detachOfficialDrawLayer(popup);
    try {
      call(popup, 'removeSelf');
      if (typeof popup.addDrawChild !== 'function') call(popup, 'destroy', false);
    } catch {
      // 场景切换时可能已销毁。
    }
    popup = null;
  };

  const destroyOverlay = () => {
    clearHideTimer();
    destroyPopup();
    for (const button of buttons) {
      try {
        call(button.visual, 'removeSelf');
        call(button.visual, 'destroy', true);
        call(button.hit, 'removeSelf');
        call(button.hit, 'destroy', true);
      } catch {
        // 场景切换时官方节点可能已销毁。
      }
    }
    buttons = [];
    try {
      call(root, 'removeSelf');
      call(root, 'destroy', true);
    } catch {
      // 同上。
    }
    scene = parent = root = null;
    interaction.setAnchor(null);
    interaction.setActiveList(null);
  };

  const handlers: ButtonHandlers = {
    onEnter(list) {
      clearHideTimer();
      interaction.setActiveList(list);
    },
    onLeave: scheduleHide,
    onClick(list) {
      clearHideTimer();
      interaction.setActiveList(list);
    }
  };

  const syncPopup = () => {
    if (!root || root.destroyed) {
      destroyPopup();
      return;
    }
    const activeList = interaction.getSnapshot().activeList;
    if (!activeList) {
      destroyPopup();
      return;
    }
    const deck = deckRecordStore.getSnapshot();
    const sortMode = configStore.get('display.discardSortMode');
    const rawCardIds = activeList === 'top'
      ? deck.deckTopCardIds
      : activeList === 'bottom'
        ? deck.deckBottomCardIds
        : sortCardIds(deck.currentTurnDiscardCardIds, sortMode);
    // 神典韦“左膀/右膀”属于技能派生物，不是可展示的实体牌。它进入弃牌区协议时
    // 不能交给原生牌面池，也不能出现在当前用牌。
    const cardIds = displayableCardIds(rawCardIds);
    const knownCount = cardIds.filter(Boolean).length;
    const title = `${LIST_TITLES[activeList]}${knownCount ? ` · ${knownCount}张` : ''}`;
    const signature = `${activeList}:${sortMode}:${cardIds.join(',')}:${title}`;
    if (popup && popupSignature === signature) return;

    destroyPopup();
    const created = createCardListPopup(root, activeList, cardIds, title, {
      onEnter: clearHideTimer,
      onLeave: scheduleHide
    });
    if (!created) return;
    popup = created.popup;
    popupCards = created.cards;
    popupSignature = signature;

    const rowWidth = BUTTON_WIDTH * BUTTON_KINDS.length + BUTTON_GAP * (BUTTON_KINDS.length - 1);
    const popupWidth = Number(popup.width || created.width);
    const roundHeight = Math.max(43, Number(asRecord(root.__xcRoundInfo)?.height || 43));
    const rowY = roundHeight + BUTTON_ROW_GAP;
    const x = Math.max(4 - Number(root.x || 0), rowWidth - popupWidth);
    call(popup, 'pos', x, rowY + BUTTON_HEIGHT + 4);
  };

  const sync = () => {
    if (stopped) return;
    const nextScene = asRecord(locateGameScene(window));
    const roundInfo = asRecord(nextScene?.gameRoundInfo);
    const nextParent = asRecord(roundInfo?._parent) ?? roundInfo ?? nextScene;
    const enabled = configStore.get('display.deckHudEnabled');
    if (!enabled || !nextScene || !roundInfo || !nextParent || nextScene.destroyed || roundInfo.destroyed) {
      destroyOverlay();
      return;
    }
    if (scene !== nextScene || parent !== nextParent || !root || root.destroyed) {
      destroyOverlay();
      const created = createOverlayRoot(nextParent, roundInfo, handlers);
      if (!created) return;
      root = created.root;
      buttons = created.buttons;
      root.__xcRoundInfo = roundInfo;
      scene = nextScene;
      parent = nextParent;
    }

    const roundHeight = Math.max(43, Number(roundInfo.height || 43));
    const rowWidth = BUTTON_WIDTH * BUTTON_KINDS.length + BUTTON_GAP * (BUTTON_KINDS.length - 1);
    const rowY = roundHeight + BUTTON_ROW_GAP;
    call(root, 'pos', Number(roundInfo.x || 0), Number(roundInfo.y || 0));
    call(root, 'size', Math.max(rowWidth, Number(popup?.width || 0)), rowY + BUTTON_HEIGHT + Number(popup?.height || 0));
    root.visible = true;

    buttons.forEach((button, index) => {
      const x = index * (BUTTON_WIDTH + BUTTON_GAP);
      call(button.visual, 'pos', x, rowY);
      call(button.hit, 'pos', x, rowY);
      button.visual.visible = true;
      button.hit.visible = true;
    });

    const snapshot = deckRecordStore.getSnapshot();
    updateButtonLabels(buttons, {
      top: snapshot.deckTopCardIds.filter(Boolean).length,
      bottom: snapshot.deckBottomCardIds.filter(Boolean).length,
      discard: displayableCardIds(snapshot.currentTurnDiscardCardIds).length
        + snapshot.currentTurnHiddenDiscardCount
    });

    const globalPoint = toGlobalPoint(root, 0, rowY);
    if (globalPoint) {
      interaction.setAnchor({
        left: globalPoint.x,
        top: globalPoint.y,
        width: rowWidth,
        height: BUTTON_HEIGHT
      });
    }
    syncPopup();
  };

  const stopStore = deckRecordStore.subscribe(sync);
  const stopConfigEnabled = configStore.subscribe('display.deckHudEnabled', sync);
  const stopConfigSort = configStore.subscribe('display.discardSortMode', sync);
  const stopInteraction = interaction.subscribe((snapshot) => {
    if (snapshot.activeList) clearHideTimer();
    syncPopup();
  });
  const timer = window.setInterval(sync, 250);
  sync();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    clearHideTimer();
    stopStore();
    stopConfigEnabled();
    stopConfigSort();
    stopInteraction();
    destroyOverlay();
  };
}

function createCardListPopup(
  host: UnknownRecord,
  kind: DeckRecordListKind,
  cardIds: readonly number[],
  title: string,
  handlers: { onEnter: () => void; onLeave: () => void }
): { popup: UnknownRecord; cards: OfficialCardView[]; width: number; buttonRowOffset: number } | null {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Text = laya?.Text;
  if (typeof Text !== 'function') return null;

  // 对照 app.bak EG：外壳用普通 Sprite 画底和标题；官方牌 Draw 到内层 SgsSprite。
  // 底图不能画在 Draw 宿主上，否则不透明 graphics 会盖住绘制层，只剩标题空框。
  const Sprite = laya?.Sprite;
  if (typeof Sprite !== 'function') return null;
  const popup = asRecord(new (Sprite as unknown as new () => object)());
  if (!popup) return null;
  popup.name = 'xcNativeDeckRecordList';
  popup.mouseEnabled = true;
  popup.mouseThrough = false;
  popup.zOrder = 1001;

  const cardWidth = OFFICIAL_CARD_BASE_WIDTH * POPUP_CARD_SCALE;
  const cardHeight = OFFICIAL_CARD_BASE_HEIGHT * POPUP_CARD_SCALE;
  const overlapGap = cardIds.length > 1
    ? Math.max(4, Math.min(cardWidth + 7, (POPUP_MAX_WIDTH - POPUP_PADDING * 2 - cardWidth) / (cardIds.length - 1)))
    : 0;
  const width = cardIds.length
    ? Math.min(POPUP_MAX_WIDTH, Math.ceil(POPUP_PADDING * 2 + cardWidth + overlapGap * (cardIds.length - 1)))
    : 184;
  const height = cardIds.length
    ? Math.ceil(31 + cardHeight + POPUP_PADDING)
    : 54;
  call(popup, 'size', width, height);
  paintPopupBackground(popup, width, height, kind);

  const titleNode = asRecord(new (Text as unknown as new () => object)())!;
  titleNode.text = title;
  titleNode.font = 'SimSun';
  titleNode.fontSize = 14;
  titleNode.color = '#E8D4A8';
  titleNode.stroke = 1;
  titleNode.strokeColor = '#3a2014';
  titleNode.align = 'left';
  titleNode.bold = false;
  titleNode.width = width - POPUP_PADDING * 2;
  titleNode.height = 24;
  call(titleNode, 'pos', POPUP_PADDING, 3);
  call(popup, 'addChild', titleNode);

  const cards: OfficialCardView[] = [];
  if (cardIds.length) {
    const scene = asRecord(locateGameScene(window));
    cardIds.forEach((cardId, index) => {
      if (!(cardId > 0)) return;
      const view = createOfficialCardView(
        popup,
        cardId,
        cardWidth,
        cardHeight,
        scene,
        { x: POPUP_PADDING + overlapGap * index, y: POPUP_TITLE_HEIGHT }
      );
      if (view) {
        view.ui.zOrder = 10 + index;
        cards.push(view);
      }
    });
  } else {
    const empty = asRecord(new (Text as unknown as new () => object)())!;
    empty.text = '暂无已知牌';
    empty.font = 'SimSun';
    empty.fontSize = 13;
    empty.color = '#B7AA8B';
    empty.align = 'center';
    empty.width = width;
    empty.height = 24;
    call(empty, 'pos', 0, 25);
    call(popup, 'addChild', empty);
  }

  const Event = asRecord(laya?.Event);
  call(popup, 'on', Event?.ROLL_OVER ?? 'mouseover', popup, handlers.onEnter);
  call(popup, 'on', Event?.ROLL_OUT ?? 'mouseout', popup, handlers.onLeave);
  call(host, 'addChild', popup);
  return {
    popup,
    cards,
    width,
    buttonRowOffset: BUTTON_HEIGHT + BUTTON_ROW_GAP + 4
  };
}

function sortCardIds(cardIds: readonly number[], _sortMode: SortMode): number[] {
  // 弹层不重算花色/类型；排序由 Vue 面板与快捷键写入的 discardSortMode 驱动展示侧。
  return [...cardIds];
}

function paintPopupBackground(
  target: UnknownRecord,
  width: number,
  height: number,
  kind: DeckRecordListKind
): void {
  const style = BUTTON_STYLES[kind];
  const graphics = asRecord(target.graphics);
  call(graphics, 'clear');
  try {
    call(graphics, 'drawPath', 0, 0, [
      ['moveTo', BUTTON_RADIUS, 0],
      ['arcTo', width, 0, width, height, BUTTON_RADIUS],
      ['arcTo', width, height, 0, height, BUTTON_RADIUS],
      ['arcTo', 0, height, 0, 0, BUTTON_RADIUS],
      ['arcTo', 0, 0, BUTTON_RADIUS, 0, BUTTON_RADIUS],
      ['closePath']
    ], { fillStyle: 'rgba(29, 23, 18, 0.97)' }, { strokeStyle: style.border, lineWidth: 1 });
  } catch {
    call(graphics, 'drawRect', 0, 0, width, height, 'rgba(29, 23, 18, 0.97)', style.border, 1);
  }
}

function createOverlayRoot(
  nextParent: UnknownRecord,
  roundInfo: UnknownRecord,
  handlers: ButtonHandlers
): { root: UnknownRecord; buttons: ButtonNode[] } | null {
  const SpriteClass = asRecord(asRecord(globalThis as UnknownRecord)?.Laya)?.Sprite;
  if (typeof SpriteClass !== 'function') return null;
  const root = asRecord(new (SpriteClass as unknown as new () => object)());
  if (!root) return null;
  root.name = 'xcNativeDeckRecordOverlay';
  root.mouseEnabled = true;
  root.mouseThrough = true;
  root.zOrder = Math.max(100, Number(roundInfo.zOrder || 0) + 2);
  call(nextParent, 'addChild', root);

  const buttons: ButtonNode[] = [];
  for (const [index, kind] of BUTTON_KINDS.entries()) {
    const button = createButton(kind, index, root, handlers);
    if (!button) {
      try {
        call(root, 'removeSelf');
        call(root, 'destroy', true);
      } catch {
        // 创建失败时清理半成品。
      }
      return null;
    }
    buttons.push(button);
  }
  return { root, buttons };
}

function createButton(
  kind: DeckRecordListKind,
  index: number,
  host: UnknownRecord,
  handlers: ButtonHandlers
): ButtonNode | null {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Sprite = laya?.Sprite;
  const Text = laya?.Text;
  if (typeof Sprite !== 'function' || typeof Text !== 'function') return null;

  const style = BUTTON_STYLES[kind];
  const visual = asRecord(new (Sprite as unknown as new () => object)())!;
  visual.name = `xcNativeDeckRecordButton-${kind}`;
  visual.mouseEnabled = false;
  visual.mouseThrough = true;
  visual.zOrder = 120 + index;
  call(visual, 'size', BUTTON_WIDTH, BUTTON_HEIGHT);
  paintButton(visual, style, false);

  const label = asRecord(new (Text as unknown as new () => object)())!;
  label.name = `xcNativeDeckRecordButtonLabel-${kind}`;
  label.font = 'SimSun';
  label.bold = true;
  label.align = 'center';
  label.valign = 'middle';
  label.color = style.text;
  label.fontSize = BUTTON_FONT_SIZE;
  label.width = BUTTON_WIDTH;
  label.height = BUTTON_HEIGHT;
  label.text = `${style.prefix} 0`;
  call(label, 'pos', 0, 0);
  call(visual, 'addChild', label);

  const hit = asRecord(new (Sprite as unknown as new () => object)())!;
  hit.name = `xcNativeDeckRecordButtonHit-${kind}`;
  hit.mouseEnabled = true;
  hit.mouseThrough = false;
  hit.zOrder = 130 + index;
  call(hit, 'size', BUTTON_WIDTH, BUTTON_HEIGHT);

  const Event = asRecord(laya?.Event);
  const node: ButtonNode = { kind, visual, hit, label, hover: false };
  call(hit, 'on', Event?.ROLL_OVER ?? 'mouseover', hit, () => {
    node.hover = true;
    paintButton(visual, style, true);
    label.color = style.hoverText;
    handlers.onEnter(kind);
  });
  call(hit, 'on', Event?.ROLL_OUT ?? 'mouseout', hit, () => {
    node.hover = false;
    paintButton(visual, style, false);
    label.color = style.text;
    handlers.onLeave();
  });
  call(hit, 'on', Event?.CLICK ?? 'click', hit, () => handlers.onClick(kind));

  call(host, 'addChild', visual);
  call(host, 'addChild', hit);
  return node;
}

function updateButtonLabels(
  buttons: readonly ButtonNode[],
  counts: Record<DeckRecordListKind, number>
): void {
  for (const button of buttons) {
    const style = BUTTON_STYLES[button.kind];
    const text = `${style.prefix} ${Math.max(0, counts[button.kind] || 0)}`;
    if (button.label.text !== text) button.label.text = text;
    if (!button.hover) button.label.color = style.text;
  }
}

function paintButton(target: UnknownRecord, style: ButtonVisualStyle, hover: boolean): void {
  const graphics = asRecord(target.graphics);
  call(graphics, 'clear');
  drawRoundedRect(
    graphics,
    BUTTON_WIDTH,
    BUTTON_HEIGHT,
    hover ? style.hoverFill : style.fill,
    hover ? style.hoverBorder : style.border
  );
}

function drawRoundedRect(
  graphics: UnknownRecord | null,
  width: number,
  height: number,
  fill: string,
  border: string
): void {
  if (!graphics) return;
  const radius = Math.min(BUTTON_RADIUS, width / 2, height / 2);
  try {
    call(graphics, 'drawPath', 0, 0, [
      ['moveTo', radius, 0],
      ['arcTo', width, 0, width, height, radius],
      ['arcTo', width, height, 0, height, radius],
      ['arcTo', 0, height, 0, 0, radius],
      ['arcTo', 0, 0, radius, 0, radius],
      ['closePath']
    ], { fillStyle: fill }, { strokeStyle: border, lineWidth: 1 });
  } catch {
    call(graphics, 'drawRect', 0, 0, width, height, fill, border, 1);
  }
}

function toGlobalPoint(node: UnknownRecord | null, x: number, y: number): { x: number; y: number } | null {
  if (!node || typeof node.localToGlobal !== 'function') {
    return {
      x: Number(node?.x || 0) + x,
      y: Number(node?.y || 0) + y
    };
  }
  try {
    const Point = asRecord(asRecord(globalThis as UnknownRecord)?.Laya)?.Point;
    const point = typeof Point === 'function'
      ? new (Point as unknown as new (x: number, y: number) => object)(x, y)
      : { x, y };
    const global = (node.localToGlobal as Function).call(node, point, false);
    const record = asRecord(global);
    if (!record) return null;
    return { x: Number(record.x || 0), y: Number(record.y || 0) };
  } catch {
    return null;
  }
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
