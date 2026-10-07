/**
 * 手牌排序控制器：在手牌区挂载排序按钮，按类型/花色/点数重排，并持久化位置与锁定模式。
 */

import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';

type Node = Record<string, any>;
type SortMode = 'CardType' | 'CardFlower' | 'CardNumber';

interface SegmentVisual {
  hover: Node;
  label: Node;
  lock: Node;
  hovered: boolean;
}

interface HandSortControl {
  host: Node;
  selfSeatUi: Node;
  visual: Node;
  hits: Node[];
  segments: SegmentVisual[];
  originalLabel: unknown;
  originalWidth: unknown;
  originalHeight: unknown;
  originalX: unknown;
  originalY: unknown;
  background: Node | null;
  originalBackgroundVisible: unknown;
  originalBackgroundRenderVisible: unknown;
  lockedMode: SortMode | '';
  handSignature: string;
  pendingAutoSort: boolean;
  lastClickMode: SortMode | null;
  lastClickAt: number;
  sorting: boolean;
  dragging: boolean;
  dragMoved: boolean;
  dragStage: Node | null;
  dragStartPointer: { x: number; y: number } | null;
  dragStartPosition: { x: number; y: number } | null;
  dragMoveHandler: (event: Node) => void;
  dragEndHandler: () => void;
  dragStartHandler: (event: Node) => void;
  suppressClickUntil: number;
  destroyed: boolean;
}

const SEGMENTS: ReadonlyArray<{ label: string; mode: SortMode }> = [
  { label: '类型', mode: 'CardType' },
  { label: '花色', mode: 'CardFlower' },
  { label: '点数', mode: 'CardNumber' }
];
const SEGMENT_WIDTH = 34;
const SEGMENT_HEIGHT = 22;
const FONT_SIZE = 11;
const DOUBLE_CLICK_MS = 300;
const DRAG_THRESHOLD2 = 16;
const DEFAULT_Y = 60;
const SKIP_AUTO_SKILL_ID = 0xde2;
const FLOWER_ORDER = [3, 4, 1, 2];
const CONTROL_KEY = '__xcHandSortSegmentControl';
const PATCHED_KEY = '__xcHandSortSegmentPatched';
const INACTIVE_COLOR = '#D9BE8A';
const ACTIVE_COLOR = '#FFE2A3';
const TEXT_STROKE = '#3A250D';
const BAR_FILL = 'rgba(34,27,19,0.9)';
const BAR_STROKE = '#8B744C';
const HOVER_FILL = 'rgba(46,36,24,0.96)';
const HOVER_STROKE = '#C4A36A';
const DIVIDER = '#6A5538';
const LOCK_COLOR = '#FFE2A3';

function asRecord(value: unknown): Node | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as Node
    : null;
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function layaEvent(laya: Node | undefined, name: string, fallback: string): string {
  return String(laya?.Event?.[name] ?? fallback);
}

function cardList(container: Node | null | undefined): Node[] {
  const cards = container?.cardUis ?? container?.cardUIs;
  return Array.isArray(cards) ? cards : [];
}

function handSignature(container: Node | null | undefined): string {
  return cardList(container)
    .map((item) => Number(item?.Card?.CardId ?? item?.Card?.CardID ?? 0) || 0)
    .sort((left, right) => left - right)
    .join(',');
}

function flowerRank(value: unknown): number {
  const index = FLOWER_ORDER.indexOf(Number(value));
  return index >= 0 ? index : FLOWER_ORDER.length + Math.max(0, Number(value) || 0);
}

function compareCards(left: Node, right: Node, mode: SortMode): number {
  const leftCard = left?.Card;
  const rightCard = right?.Card;
  if (mode === 'CardFlower') {
    return flowerRank(leftCard?.FlowerOnSeat) - flowerRank(rightCard?.FlowerOnSeat);
  }
  if (mode === 'CardNumber') {
    return (Number(leftCard?.CardNumber) || 0) - (Number(rightCard?.CardNumber) || 0);
  }
  return 0;
}

function hasSkipSkill(selfSeatUi: Node | null | undefined): boolean {
  try {
    return !!selfSeatUi?.seat?.HasSkill?.(SKIP_AUTO_SKILL_ID);
  } catch {
    return false;
  }
}

function buttonUsable(control: HandSortControl | null | undefined): boolean {
  const host = control?.host;
  return !!host
    && !host.destroyed
    && host.visible !== false
    && host._visible !== false
    && host.enabled !== false
    && host._enabled !== false
    && host.gray !== true;
}

function setVisible(node: Node | null | undefined, visible: boolean): void {
  if (!node || node.destroyed) return;
  node.visible = visible;
  if ('_visible' in node) node._visible = visible;
}

/** 类型走原生 SortNormalCards，花色和点数排 cardUis 后重绘。 */
export function sortHand(container: Node | null | undefined, mode: SortMode): boolean {
  if (!container || !cardList(container).length) return false;
  if (mode === 'CardType') {
    if (typeof container.SortNormalCards !== 'function') return false;
    container.SortNormalCards();
    return true;
  }
  if (mode !== 'CardFlower' && mode !== 'CardNumber') return false;
  const cards = cardList(container);
  cards.sort((left, right) => compareCards(left, right, mode));
  for (const card of cards) {
    card.clear?.(false);
    card.Draw?.(container);
  }
  container.invalidateLayoutHandCard?.();
  return true;
}

function drawRoundRect(
  node: Node,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  lineWidth: number,
  radius: number
): void {
  const graphics = node.graphics;
  if (!graphics) return;
  graphics.clear?.();
  if (typeof graphics.drawRoundRect === 'function') {
    graphics.drawRoundRect(0, 0, width, height, radius, fill, stroke, lineWidth);
    return;
  }
  graphics.drawRect?.(0, 0, width, height, fill, stroke, lineWidth);
}

function drawBar(visual: Node): void {
  const width = SEGMENT_WIDTH * SEGMENTS.length;
  drawRoundRect(visual, width, SEGMENT_HEIGHT, BAR_FILL, BAR_STROKE, 1, 4);
  for (let index = 1; index < SEGMENTS.length; index += 1) {
    const x = index * SEGMENT_WIDTH;
    visual.graphics?.drawLine?.(x, 3, x, SEGMENT_HEIGHT - 3, DIVIDER, 1);
  }
}

function drawLock(node: Node): void {
  const graphics = node.graphics;
  if (!graphics) return;
  graphics.clear?.();
  graphics.drawLine?.(2, 4, 2, 2, LOCK_COLOR, 1);
  graphics.drawLine?.(2, 2, 6, 2, LOCK_COLOR, 1);
  graphics.drawLine?.(6, 2, 6, 4, LOCK_COLOR, 1);
  graphics.drawRect?.(1, 4, 6, 5, LOCK_COLOR);
}

function createLabel(laya: Node, text: string): Node | null {
  const Constructor = laya.Text ?? laya.Label;
  if (typeof Constructor !== 'function') return null;
  const label = new Constructor();
  label.text = text;
  label.font = 'SimSun';
  label.fontSize = FONT_SIZE;
  label.color = INACTIVE_COLOR;
  label.stroke = 1;
  label.strokeColor = TEXT_STROKE;
  label.align = 'center';
  label.valign = 'middle';
  label.mouseEnabled = false;
  label.mouseThrough = true;
  return label;
}

function paintSegments(control: HandSortControl): void {
  control.segments.forEach((segment, index) => {
    const active = SEGMENTS[index]?.mode === control.lockedMode;
    setVisible(segment.hover, active || segment.hovered);
    setVisible(segment.lock, active);
    if (segment.label) {
      segment.label.color = active || segment.hovered ? ACTIVE_COLOR : INACTIVE_COLOR;
    }
  });
}

function pointerInHost(event: Node | null | undefined, host: Node): { x: number; y: number } | null {
  const x = Number(event?.stageX ?? event?.mouseX ?? event?.x);
  const y = Number(event?.stageY ?? event?.mouseY ?? event?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const parent = asRecord(host.parent);
  if (typeof parent?.globalToLocal !== 'function') return { x, y };
  try {
    const local = parent.globalToLocal({ x, y }, true);
    const localX = Number(local?.x);
    const localY = Number(local?.y);
    return Number.isFinite(localX) && Number.isFinite(localY) ? { x: localX, y: localY } : { x, y };
  } catch {
    return { x, y };
  }
}

function dragBounds(selfSeatUi: Node, host: Node): { minX: number; maxX: number; minY: number; maxY: number } {
  const width = Number(selfSeatUi?.width);
  const height = Number(selfSeatUi?.height);
  return {
    minX: 0,
    maxX: Number.isFinite(width) ? Math.max(0, width - Number(host?.width || SEGMENT_WIDTH * 3)) : 0,
    minY: 0,
    maxY: Number.isFinite(height) && height > 0
      ? Math.max(0, height - Number(host?.height || SEGMENT_HEIGHT))
      : Number.POSITIVE_INFINITY
  };
}

function layoutButton(selfSeatUi: Node, host: Node, store: XiaochaoConfigStore, dragging: boolean): void {
  if (!selfSeatUi || !host || host.destroyed) return;
  const barWidth = SEGMENT_WIDTH * SEGMENTS.length;
  host.width = barWidth;
  host.height = SEGMENT_HEIGHT;
  const seatWidth = Number(selfSeatUi.width);
  const rightSpace = Number(selfSeatUi.HandCardRightSpace);
  if (!Number.isFinite(seatWidth) || !Number.isFinite(rightSpace)) return;
  if (dragging) return;
  const saved = store.get('cards.handSortPosition');
  const defaultX = Math.max(0, Math.floor(seatWidth - rightSpace - barWidth));
  const maxX = Math.max(0, Math.floor(seatWidth - barWidth));
  const currentY = Number.isFinite(Number(host.y)) ? Number(host.y) : DEFAULT_Y;
  const seatHeight = Number(selfSeatUi.height);
  const y = saved
    ? Number.isFinite(seatHeight) && seatHeight > 0
      ? Math.max(0, Math.min(seatHeight - SEGMENT_HEIGHT, saved.top))
      : Math.max(0, saved.top)
    : currentY;
  const x = saved
    ? Math.max(0, Math.min(maxX, seatWidth - barWidth - saved.right))
    : defaultX;
  if (typeof host.pos === 'function') host.pos(x, y);
  else {
    host.x = x;
    host.y = y;
  }
}

function stageOf(runtime: Window): Node | null {
  const laya = asRecord((runtime as Node).Laya);
  return asRecord(laya?.stage);
}

function stopDrag(control: HandSortControl, laya: Node | undefined): void {
  const stage = control.dragStage;
  if (stage?.off) {
    stage.off(layaEvent(laya, 'MOUSE_MOVE', 'mousemove'), control, control.dragMoveHandler);
    stage.off(layaEvent(laya, 'MOUSE_UP', 'mouseup'), control, control.dragEndHandler);
  }
  control.dragStage = null;
}

function destroyControl(control: HandSortControl, laya: Node | undefined): void {
  if (!control || control.destroyed) return;
  control.destroyed = true;
  stopDrag(control, laya);
  try {
    control.visual?.destroy?.(true);
    control.hits.forEach((hit) => hit?.destroy?.(true));
    const host = control.host;
    if (host && !host.destroyed) {
      host.off?.(layaEvent(laya, 'MOUSE_DOWN', 'mousedown'), control, control.dragStartHandler);
      host.label = control.originalLabel;
      host.width = control.originalWidth;
      host.height = control.originalHeight;
      if (control.background && !control.background.destroyed) {
        control.background.visible = control.originalBackgroundVisible;
        if ('_visible' in control.background) {
          control.background._visible = control.originalBackgroundRenderVisible;
        }
      }
      const seatWidth = Number(control.selfSeatUi?.width);
      const rightSpace = Number(control.selfSeatUi?.HandCardRightSpace);
      const x = Number.isFinite(seatWidth) && Number.isFinite(rightSpace)
        ? seatWidth - rightSpace - 60
        : Number.isFinite(Number(control.originalX)) ? Number(control.originalX) : 0;
      const y = Number.isFinite(Number(control.originalY)) ? Number(control.originalY) : DEFAULT_Y;
      if (typeof host.pos === 'function') host.pos(x, y);
      else {
        host.x = x;
        host.y = y;
      }
      if (typeof host.on === 'function' && typeof control.selfSeatUi?.sortCardHandler === 'function') {
        host.on(layaEvent(laya, 'CLICK', 'click'), control.selfSeatUi, control.selfSeatUi.sortCardHandler);
      }
      delete host[CONTROL_KEY];
    }
  } catch {
    // 座位或按钮可能已经先销毁。
  }
}

function syncAutoSort(control: HandSortControl | null | undefined): boolean {
  if (!control || control.destroyed) return false;
  paintSegments(control);
  const container = control.selfSeatUi?.cardContainer;
  const signature = handSignature(container);
  if (control.handSignature === null) control.handSignature = signature;
  else if (signature !== control.handSignature) {
    control.handSignature = signature;
    if (control.lockedMode && !hasSkipSkill(control.selfSeatUi)) control.pendingAutoSort = true;
  }
  if (!control.lockedMode) {
    control.pendingAutoSort = false;
    return false;
  }
  if (hasSkipSkill(control.selfSeatUi)) {
    control.pendingAutoSort = false;
    return false;
  }
  if (buttonUsable(control)) setVisible(control.host, true);
  if (!control.pendingAutoSort || control.sorting || !buttonUsable(control)) return false;
  control.sorting = true;
  try {
    if (!sortHand(container, control.lockedMode)) return false;
    control.pendingAutoSort = false;
    control.handSignature = handSignature(container);
    setVisible(control.host, true);
    return true;
  } finally {
    control.sorting = false;
  }
}

function attachControl(
  selfSeatUi: Node,
  store: XiaochaoConfigStore,
  runtime: Window
): HandSortControl | null {
  const host = asRecord(selfSeatUi?.sortCardBtn);
  if (!host || host.destroyed) return null;
  const existing = host[CONTROL_KEY] as HandSortControl | undefined;
  if (!store.get('cards.handSortEnabled')) {
    if (existing) destroyControl(existing, asRecord((runtime as Node).Laya));
    return null;
  }
  if (existing && !existing.destroyed && existing.host === host) {
    layoutButton(selfSeatUi, host, store, existing.dragging);
    return existing;
  }
  if (existing) destroyControl(existing, asRecord((runtime as Node).Laya));

  const laya = asRecord((runtime as Node).Laya);
  if (!laya?.Sprite) return null;
  const visual = new laya.Sprite() as Node;
  const barWidth = SEGMENT_WIDTH * SEGMENTS.length;
  visual.name = 'xcHandSortSegmentVisual';
  visual.mouseEnabled = false;
  visual.mouseThrough = true;
  visual.size?.(barWidth, SEGMENT_HEIGHT);
  drawBar(visual);

  const lockedMode = store.get('cards.handSortLockedMode');
  const control: HandSortControl = {
    host,
    selfSeatUi,
    visual,
    hits: [],
    segments: [],
    originalLabel: host.label,
    originalWidth: host.width,
    originalHeight: host.height,
    originalX: host.x,
    originalY: host.y,
    background: asRecord(host.background),
    originalBackgroundVisible: host.background?.visible,
    originalBackgroundRenderVisible: host.background?._visible,
    lockedMode,
    handSignature: handSignature(selfSeatUi.cardContainer),
    pendingAutoSort: !!lockedMode,
    lastClickMode: null,
    lastClickAt: 0,
    sorting: false,
    dragging: false,
    dragMoved: false,
    dragStage: null,
    dragStartPointer: null,
    dragStartPosition: null,
    dragMoveHandler: () => undefined,
    dragEndHandler: () => undefined,
    dragStartHandler: () => undefined,
    suppressClickUntil: 0,
    destroyed: false
  };

  control.dragMoveHandler = (event) => {
    if (!control.dragging || control.destroyed || !control.host) return;
    const pointer = pointerInHost(event, control.host);
    if (!pointer || !control.dragStartPointer) return;
    const dx = pointer.x - control.dragStartPointer.x;
    const dy = pointer.y - control.dragStartPointer.y;
    if (!control.dragMoved && dx * dx + dy * dy < DRAG_THRESHOLD2) return;
    control.dragMoved = true;
    const bounds = dragBounds(control.selfSeatUi, control.host);
    const x = Math.max(bounds.minX, Math.min(bounds.maxX, control.dragStartPosition!.x + dx));
    const y = Math.max(bounds.minY, Math.min(bounds.maxY, control.dragStartPosition!.y + dy));
    if (typeof control.host.pos === 'function') control.host.pos(x, y);
    else {
      control.host.x = x;
      control.host.y = y;
    }
  };
  control.dragEndHandler = () => {
    if (!control.dragging) return;
    stopDrag(control, laya);
    control.dragging = false;
    if (!control.dragMoved) return;
    const seatWidth = Number(control.selfSeatUi?.width);
    const x = Number(control.host?.x);
    const y = Number(control.host?.y);
    if (!Number.isFinite(seatWidth) || !Number.isFinite(x) || !Number.isFinite(y)) {
      control.suppressClickUntil = Date.now() + DOUBLE_CLICK_MS;
      return;
    }
    store.set('cards.handSortPosition', {
      right: Math.max(0, seatWidth - x - Number(control.host?.width || SEGMENT_WIDTH * 3)),
      top: Math.max(0, y)
    });
    control.suppressClickUntil = Date.now() + DOUBLE_CLICK_MS;
  };
  control.dragStartHandler = (event) => {
    if (!control || control.destroyed || !buttonUsable(control)) return;
    const pointer = pointerInHost(event, control.host) ?? pointerInHost(stageOf(runtime), control.host);
    const stage = stageOf(runtime);
    if (!pointer || !stage?.on) return;
    stopDrag(control, laya);
    control.dragging = true;
    control.dragMoved = false;
    control.dragStartPointer = pointer;
    control.dragStartPosition = { x: finite(control.host?.x), y: finite(control.host?.y) };
    control.dragStage = stage;
    stage.on(layaEvent(laya, 'MOUSE_MOVE', 'mousemove'), control, control.dragMoveHandler);
    stage.on(layaEvent(laya, 'MOUSE_UP', 'mouseup'), control, control.dragEndHandler);
  };

  host.off?.(layaEvent(laya, 'CLICK', 'click'), selfSeatUi, selfSeatUi.sortCardHandler);
  host.label = '';
  if (host.background && !host.background.destroyed) {
    host.background.visible = false;
    if ('_visible' in host.background) host.background._visible = false;
  }
  host[CONTROL_KEY] = control;
  layoutButton(selfSeatUi, host, store, false);
  host.addChild?.(visual);

  SEGMENTS.forEach((segment, index) => {
    const hover = new laya.Sprite() as Node;
    hover.name = `xcHandSortSegmentHover-${segment.mode}`;
    hover.mouseEnabled = false;
    hover.mouseThrough = true;
    hover.size?.(SEGMENT_WIDTH - 4, SEGMENT_HEIGHT - 4);
    hover.pos?.(index * SEGMENT_WIDTH + 2, 2);
    drawRoundRect(hover, SEGMENT_WIDTH - 4, SEGMENT_HEIGHT - 4, HOVER_FILL, HOVER_STROKE, 1, 3);
    hover.visible = false;
    visual.addChild?.(hover);

    const label = createLabel(laya, segment.label);
    if (label) {
      label.name = `xcHandSortSegmentLabel-${segment.mode}`;
      label.width = SEGMENT_WIDTH;
      label.height = SEGMENT_HEIGHT;
      label.pos?.(index * SEGMENT_WIDTH, 0);
      visual.addChild?.(label);
    }

    const lock = new laya.Sprite() as Node;
    lock.name = `xcHandSortSegmentLock-${segment.mode}`;
    lock.mouseEnabled = false;
    lock.mouseThrough = true;
    lock.size?.(8, 10);
    lock.pos?.(index * SEGMENT_WIDTH + SEGMENT_WIDTH - 9, 1);
    drawLock(lock);
    lock.visible = false;
    visual.addChild?.(lock);
    control.segments.push({ hover, label: label ?? hover, lock, hovered: false });

    const hit = new laya.Sprite() as Node;
    hit.name = `xcHandSortSegmentHit-${segment.mode}`;
    hit.mouseEnabled = true;
    hit.mouseThrough = false;
    hit.hitTestPrior = true;
    hit.size?.(SEGMENT_WIDTH, SEGMENT_HEIGHT);
    hit.pos?.(index * SEGMENT_WIDTH, 0);
    hit.graphics?.drawRect?.(0, 0, SEGMENT_WIDTH, SEGMENT_HEIGHT, 'rgba(0,0,0,0)');
    hit.on?.(layaEvent(laya, 'ROLL_OVER', 'mouseover'), control, () => {
      const current = control.segments[index];
      if (!current) return;
      current.hovered = true;
      paintSegments(control);
    });
    hit.on?.(layaEvent(laya, 'ROLL_OUT', 'mouseout'), control, () => {
      const current = control.segments[index];
      if (!current) return;
      current.hovered = false;
      paintSegments(control);
    });
    hit.on?.(layaEvent(laya, 'CLICK', 'click'), control, (event: Node) => {
      event?.stopPropagation?.();
      if (!buttonUsable(control)) return;
      if (control.suppressClickUntil) {
        const blocked = Date.now() <= control.suppressClickUntil;
        control.suppressClickUntil = 0;
        if (blocked) return;
      }
      const now = Date.now();
      const doubled = control.lastClickMode === segment.mode && now - control.lastClickAt <= DOUBLE_CLICK_MS;
      control.lastClickMode = doubled ? null : segment.mode;
      control.lastClickAt = doubled ? 0 : now;
      if (!sortHand(control.selfSeatUi?.cardContainer, segment.mode)) return;
      control.handSignature = handSignature(control.selfSeatUi?.cardContainer);
      if (control.lockedMode && control.lockedMode !== segment.mode) {
        control.lastClickMode = null;
        control.lastClickAt = 0;
        control.lockedMode = segment.mode;
        control.pendingAutoSort = false;
        control.selfSeatUi.__xcHandSortLockedMode = segment.mode;
        store.set('cards.handSortLockedMode', segment.mode);
      } else if (doubled) {
        const next = control.lockedMode === segment.mode ? '' : segment.mode;
        control.lockedMode = next;
        control.pendingAutoSort = false;
        control.handSignature = handSignature(control.selfSeatUi?.cardContainer);
        control.selfSeatUi.__xcHandSortLockedMode = next;
        store.set('cards.handSortLockedMode', next);
      }
      paintSegments(control);
      setVisible(control.host, true);
    });
    host.addChild?.(hit);
    control.hits.push(hit);
  });

  host.on?.(layaEvent(laya, 'MOUSE_DOWN', 'mousedown'), control, control.dragStartHandler);
  paintSegments(control);
  return control;
}

function patchSeatPrototype(selfSeatUi: Node, patcher: ReturnType<typeof createMethodPatcher>,
  store: XiaochaoConfigStore, runtime: Window): Node | null {
  const proto = asRecord(Object.getPrototypeOf(selfSeatUi));
  if (!proto || typeof proto.showSortCardbtn !== 'function') return null;
  const wrap = (name: string, after: (seat: Node) => void) => {
    if (typeof proto[name] !== 'function' || patcher.isWrapped(proto, name)) return;
    patcher.wrap(proto, name, (original) => function (this: Node, ...args: unknown[]) {
      const result = original.apply(this, args);
      after(this);
      return result;
    });
  };
  wrap('showSortCardbtn', (seat) => {
    const control = attachControl(seat, store, runtime);
    if (control?.lockedMode && !hasSkipSkill(seat) && buttonUsable(control)) {
      setVisible(control.host, true);
    }
    syncAutoSort(control);
  });
  wrap('OnStageResize', (seat) => { attachControl(seat, store, runtime); });
  wrap('layoutCardContainerRight', (seat) => { attachControl(seat, store, runtime); });
  proto[PATCHED_KEY] = true;
  return proto;
}

/** 把原生整理按钮换成类型、花色、点数三段；双击锁定后，手牌变化时自动整理。 */
export function installHandSortController(
  store: XiaochaoConfigStore,
  runtime: Window = window
): () => void {
  const patcher = createMethodPatcher();
  const laya = () => asRecord((runtime as Node).Laya);
  let active: HandSortControl | null = null;
  let patchedProto: Node | null = null;

  const sync = () => {
    const scene = locateGameScene(runtime) as Node | null;
    const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
    if (!store.get('cards.handSortEnabled') || !self) {
      if (active) {
        destroyControl(active, laya());
        active = null;
      }
      return;
    }
    patchedProto = patchSeatPrototype(self, patcher, store, runtime) ?? patchedProto;
    const next = attachControl(self, store, runtime);
    if (active && next !== active) destroyControl(active, laya());
    active = next;
    if (active) syncAutoSort(active);
  };

  const timer = runtime.setInterval(sync, 250);
  const stopEnabled = store.subscribe('cards.handSortEnabled', sync);
  const stopLock = store.subscribe('cards.handSortLockedMode', sync);
  sync();
  return () => {
    runtime.clearInterval(timer);
    stopEnabled();
    stopLock();
    patcher.restoreAll();
    if (patchedProto) delete patchedProto[PATCHED_KEY];
    if (active) destroyControl(active, laya());
    active = null;
  };
}
