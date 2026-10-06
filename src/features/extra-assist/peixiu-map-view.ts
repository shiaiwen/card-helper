import { PEIXIU_SUIT_META, PEIXIU_SUITS } from './peixiu-map-model.ts';
import type { PeixiuRewardInfo } from './peixiu-map-model.ts';
import {
  flattenRouteSegments,
  remainingSuitCounts,
  sequencePlainText,
  sequenceRichParts,
  type PeixiuPlannedRoute,
  type PeixiuRouteSolution
} from './peixiu-route-planner.ts';

type UnknownRecord = Record<string, unknown>;

export interface PeixiuLayaWindow {
  Laya?: {
    Sprite?: new () => UnknownRecord;
    Text?: new () => UnknownRecord;
    Label?: new () => UnknownRecord;
    HTMLDivElement?: new () => UnknownRecord;
    Point?: new (x: number, y: number) => { x: number; y: number };
    Event?: { CLICK?: string; ROLL_OVER?: string; ROLL_OUT?: string };
    stage?: UnknownRecord;
  };
  document?: Document;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export interface PeixiuOverlayHost extends UnknownRecord {
  mapState?: { mapConfig?: unknown; currentPos?: unknown; drawnCells?: unknown };
  boardEffectRoot?: UnknownRecord;
  getMarkerPos?: (cell: number) => { x: number; y: number };
  getDisplayedBoardPixelWidth?: () => number;
  getDisplayedBoardPixelHeight?: () => number;
  getBoardPixelWidth?: () => number;
  getBoardPixelHeight?: () => number;
  getBoardPixelSize?: () => number;
  name?: string;
  peixiuSpBg?: unknown;
  destroyed?: boolean;
  parent?: UnknownRecord;
}

const SLIDER_WIDTH = 216;
const SLIDER_HEIGHT = 35;
const SLIDER_SLOT = SLIDER_WIDTH / 3;
const FONT = 'fzltchjw';

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function layaPoint(globalObject: PeixiuLayaWindow, x: number, y: number): { x: number; y: number } {
  const Point = globalObject.Laya?.Point;
  return Point ? new Point(x, y) : { x, y };
}

function boardRectIn(
  board: UnknownRecord,
  target: UnknownRecord,
  size: { width: number; height: number },
  globalObject: PeixiuLayaWindow
): { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number } {
  const localToGlobal = typeof board.localToGlobal === 'function'
    ? board.localToGlobal as (point: { x: number; y: number }) => { x: number; y: number }
    : typeof board.localToScene === 'function'
      ? board.localToScene as (point: { x: number; y: number }) => { x: number; y: number }
      : null;
  const globalToLocal = typeof target.globalToLocal === 'function'
    ? target.globalToLocal as (point: { x: number; y: number }) => { x: number; y: number }
    : null;
  if (localToGlobal && globalToLocal && size.width > 0 && size.height > 0) {
    try {
      const topLeft = globalToLocal.call(target, localToGlobal.call(board, layaPoint(globalObject, 0, 0)));
      const bottomRight = globalToLocal.call(
        target,
        localToGlobal.call(board, layaPoint(globalObject, size.width, size.height))
      );
      const width = Math.abs(Number(bottomRight.x) - Number(topLeft.x));
      const height = Math.abs(Number(bottomRight.y) - Number(topLeft.y));
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return {
          x: Math.min(Number(topLeft.x), Number(bottomRight.x)),
          y: Math.min(Number(topLeft.y), Number(bottomRight.y)),
          width,
          height,
          scaleX: width / size.width,
          scaleY: height / size.height
        };
      }
    } catch {
      // Fall back to the board's display coordinates when a host does not expose transforms.
    }
  }
  return {
    x: Number(board.x) || 0,
    y: Number(board.y) || 0,
    width: size.width,
    height: size.height,
    scaleX: 1,
    scaleY: 1
  };
}

function boardSize(host: PeixiuOverlayHost): { width: number; height: number } {
  const width = Number(
    (typeof host.getDisplayedBoardPixelWidth === 'function' ? host.getDisplayedBoardPixelWidth() : 0)
    || (typeof host.getBoardPixelWidth === 'function' ? host.getBoardPixelWidth() : 0)
    || asRecord(host.boardEffectRoot)?.width
    || (typeof host.getBoardPixelSize === 'function' ? host.getBoardPixelSize() : 0)
    || 0
  ) || 0;
  const height = Number(
    (typeof host.getDisplayedBoardPixelHeight === 'function' ? host.getDisplayedBoardPixelHeight() : 0)
    || (typeof host.getBoardPixelHeight === 'function' ? host.getBoardPixelHeight() : 0)
    || asRecord(host.boardEffectRoot)?.height
    || (typeof host.getBoardPixelSize === 'function' ? host.getBoardPixelSize() : 0)
    || 0
  ) || 0;
  return { width, height };
}

function ensureLayer(host: PeixiuOverlayHost, globalObject: PeixiuLayaWindow): UnknownRecord | null {
  const existing = asRecord(host.__xcPeiXiuRouteLayer);
  if (existing?.parent) return existing;
  const Sprite = globalObject.Laya?.Sprite;
  const root = asRecord(host.boardEffectRoot);
  if (!Sprite || !root) return null;
  const layer = new Sprite();
  layer.name = 'xcPeiXiuRouteLayer';
  layer.mouseEnabled = false;
  layer.mouseThrough = true;
  layer.zOrder = 999;
  if (typeof root.addDrawChild === 'function') {
    try { root.addDrawChild(layer); } catch { root.addChild?.(layer); }
  } else {
    root.addChild?.(layer);
  }
  root.sortChildren?.();
  host.__xcPeiXiuRouteLayer = layer;
  host.__xcPeiXiuRouteLabels = [];
  return layer;
}

function ensureControlRoot(host: PeixiuOverlayHost, size: { width: number; height: number }, globalObject: PeixiuLayaWindow): UnknownRecord | null {
  const Sprite = globalObject.Laya?.Sprite;
  const board = asRecord(host.boardEffectRoot);
  if (!Sprite || !board) return null;
  let root = asRecord(host.__xcPeiXiuRouteControlRoot);
  if (!root || root.destroyed) {
    root = new Sprite();
    root.name = 'xcPeiXiuRouteControlRoot';
    root.mouseEnabled = false;
    root.mouseThrough = true;
    root.alpha = 1;
    root.zOrder = 1100;
    host.__xcPeiXiuRouteControlRoot = root;
  }
  if (root.parent !== board) {
    try {
      board.addChild?.(root);
      board.sortChildren?.();
    } catch {
      return null;
    }
  }
  root.size?.(size.width || 0, (size.height || 0) + 64);
  return root;
}

function drawArrow(
  graphics: UnknownRecord,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  width: number
): void {
  graphics.drawLine?.(from.x, from.y, to.x, to.y, color, width);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(12, width * 2.2);
  const fan = Math.PI / 6;
  graphics.drawLine?.(
    to.x, to.y,
    to.x - Math.cos(angle - fan) * length,
    to.y - Math.sin(angle - fan) * length,
    color, width
  );
  graphics.drawLine?.(
    to.x, to.y,
    to.x - Math.cos(angle + fan) * length,
    to.y - Math.sin(angle + fan) * length,
    color, width
  );
}

function mixColor(index: number, total: number): string {
  const start = [255, 213, 74];
  const end = [255, 91, 70];
  const t = total > 1 ? Math.max(0, Math.min(1, index / (total - 1))) : 0;
  return `#${start.map((channel, i) => (
    Math.round(channel + (end[i] - channel) * t).toString(16).padStart(2, '0')
  )).join('')}`;
}

function offsetPoint(point: { x: number; y: number }, index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: point.x, y: point.y };
  return { x: point.x + (index - (total - 1) / 2) * 28, y: point.y - 16 };
}

function hideLabels(host: PeixiuOverlayHost, from = 0): void {
  const labels = (host.__xcPeiXiuRouteLabels as UnknownRecord[] | undefined) || [];
  labels.forEach((label, index) => {
    if (index >= from) label.visible = false;
  });
}

function ensureStepLabel(host: PeixiuOverlayHost, index: number, globalObject: PeixiuLayaWindow): UnknownRecord | null {
  const layer = asRecord(host.__xcPeiXiuRouteLayer);
  const Label = globalObject.Laya?.Label;
  if (!layer || !Label) return null;
  const labels = (host.__xcPeiXiuRouteLabels ||= []) as UnknownRecord[];
  if (!labels[index]) {
    const label = new Label();
    label.mouseEnabled = false;
    label.align = 'center';
    label.valign = 'middle';
    label.bold = true;
    label.font = FONT;
    label.stroke = 2;
    label.zOrder = 1000;
    layer.addChild?.(label);
    labels[index] = label;
  }
  labels[index].visible = true;
  return labels[index];
}

function estimateTextWidth(text: string, size = 16): number {
  let width = 0;
  for (const char of String(text || '')) {
    if (/[\u4e00-\u9fff\u3000-\u303f♥♦♠♣→]/.test(char)) width += Math.round(size * 1.1);
    else if (/[0-9A-Za-z]/.test(char)) width += Math.round(size * 0.62);
    else width += Math.round(size * 0.56);
  }
  return width;
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRemainingSuits(host: PeixiuOverlayHost, size: { width: number; height: number }, counts: number[], globalObject: PeixiuLayaWindow): void {
  const root = ensureControlRoot(host, size, globalObject);
  const Text = globalObject.Laya?.Text;
  const Sprite = globalObject.Laya?.Sprite;
  if (!root || !Text || !Sprite) return;
  const visibleSuits = PEIXIU_SUITS.filter((suit) => Number(counts[suit] || 0) > 0);
  let panel = asRecord(host.__xcPeiXiuRemainingSuitPanel);
  if (!panel || panel.destroyed || panel.parent !== root) {
    panel = new Sprite();
    panel.name = 'xcPeiXiuRemainingSuitPanel';
    panel.mouseEnabled = false;
    panel.mouseThrough = true;
    panel.zOrder = 121;
    panel.__xcPeiXiuSuitLabels = [];
    root.addChild?.(panel);
    host.__xcPeiXiuRemainingSuitPanel = panel;
  }
  if (!visibleSuits.length) {
    panel.visible = false;
    return;
  }
  const fontSize = 18;
  const pad = 8;
  const gap = 6;
  const titleWidth = estimateTextWidth('剩余步骤', fontSize);
  const commaWidth = estimateTextWidth('，', fontSize);
  const itemWidths = visibleSuits.map((suit) => (
    estimateTextWidth(`${Number(counts[suit] || 0)}×${PEIXIU_SUIT_META[suit].mark}`, fontSize)
  ));
  const itemsWidth = itemWidths.reduce((sum, width) => sum + width, 0)
    + (visibleSuits.length - 1) * (commaWidth + gap * 2);
  const width = pad * 2 + titleWidth + itemsWidth;
  panel.pos?.(Math.max(4, size.width - width - 8), -36 + SLIDER_HEIGHT / 2);
  panel.size?.(width, SLIDER_HEIGHT);
  panel.graphics?.clear?.();
  const labels = (panel.__xcPeiXiuSuitLabels ||= []) as UnknownRecord[];
  const paint = (index: number, text: string, color: string, stroke: string, itemWidth: number) => {
    let label = labels[index];
    if (!label || label.destroyed) {
      label = new Text();
      label.font = FONT;
      label.fontSize = fontSize;
      label.bold = true;
      label.align = 'center';
      label.valign = 'middle';
      label.stroke = 2;
      label.mouseEnabled = false;
      label.mouseThrough = true;
      panel!.addChild?.(label);
      labels[index] = label;
    }
    label.text = text;
    label.color = color;
    label.strokeColor = stroke;
    label.size?.(itemWidth, SLIDER_HEIGHT);
    label.visible = true;
    return label;
  };
  paint(0, '剩余步骤', '#3B2512', '#D9BE8A', titleWidth).pos?.(pad, 0);
  let cursor = pad + titleWidth;
  let used = 1;
  visibleSuits.forEach((suit, index) => {
    if (index > 0) {
      paint(used, '，', '#A88952', '#D9BE8A', commaWidth).pos?.(cursor, 0);
      used += 1;
      cursor += commaWidth + gap;
    }
    const color = suit === 1 || suit === 2 ? '#E8402F' : '#3B2512';
    paint(used, `${Number(counts[suit] || 0)}×${PEIXIU_SUIT_META[suit].mark}`, color, '#D9BE8A', itemWidths[index])
      .pos?.(cursor, 0);
    used += 1;
    cursor += itemWidths[index] + gap;
  });
  for (let index = used; index < labels.length; index += 1) {
    if (labels[index]) labels[index].visible = false;
  }
  panel.visible = true;
}

function renderSlider(
  host: PeixiuOverlayHost,
  size: { width: number; height: number },
  solutions: PeixiuRouteSolution[],
  variant: number,
  visible: boolean,
  globalObject: PeixiuLayaWindow,
  onSelect: (index: number) => void
): void {
  const root = ensureControlRoot(host, size, globalObject);
  const Sprite = globalObject.Laya?.Sprite;
  const Text = globalObject.Laya?.Text;
  if (!root || !Sprite || !Text) return;
  const count = Math.max(1, Math.min(3, solutions.length || 1));
  const width = SLIDER_SLOT * count;
  let slider = asRecord(host.__xcPeiXiuRouteSlider);
  if (!slider || slider.destroyed || slider.parent !== root) {
    slider = new Sprite();
    slider.name = 'xcPeiXiuRouteSlider';
    slider.size?.(width, SLIDER_HEIGHT);
    slider.mouseEnabled = false;
    slider.mouseThrough = true;
    slider.zOrder = 120;
    slider.__labels = ['上策', '中策', '下策'].map((title) => {
      const label = new Text();
      label.mouseEnabled = false;
      label.font = FONT;
      label.fontSize = 18;
      label.bold = true;
      label.align = 'center';
      label.valign = 'middle';
      label.stroke = 2;
      label.strokeColor = '#163D29';
      label.text = title;
      label.size?.(SLIDER_SLOT, SLIDER_HEIGHT);
      slider!.addChild?.(label);
      return label;
    });
    root.addChild?.(slider);
    host.__xcPeiXiuRouteSlider = slider;
  }
  slider.size?.(width, SLIDER_HEIGHT);
  slider.visible = visible;
  slider.pos?.(4, -36 + SLIDER_HEIGHT / 2);
  const selected = variant >= count ? 0 : variant;
  slider.graphics?.clear?.();
  slider.graphics?.drawRect?.(0, 0, width, SLIDER_HEIGHT, '#2A241B');
  slider.graphics?.drawRect?.(selected * SLIDER_SLOT + 2, 2, SLIDER_SLOT - 4, SLIDER_HEIGHT - 4, '#356B86');
  slider.graphics?.drawRect?.(selected * SLIDER_SLOT + 3, SLIDER_HEIGHT - 3, SLIDER_SLOT - 6, 2, '#FFE29A');
  for (let index = 1; index < count; index += 1) {
    slider.graphics?.drawLine?.(index * SLIDER_SLOT, 3, index * SLIDER_SLOT, SLIDER_HEIGHT - 3, '#A88952', 1);
  }
  ((slider.__labels as UnknownRecord[]) || []).forEach((label, index) => {
    label.pos?.(index * SLIDER_SLOT, 0);
    label.visible = index < count;
    const steps = (solutions[index]?.path || []).filter((step) => step?.dir).length;
    label.text = `${index === 0 ? '上策' : index === 1 ? '中策' : '下策'}${steps}`;
    label.color = index === selected ? '#FFF6D4' : '#9B927F';
  });

  const hostLayer = globalObject.Laya?.stage || asRecord(host.parent) || root;
  const board = asRecord(host.boardEffectRoot);
  let hitRoot = asRecord(host.__xcPeiXiuRouteSliderHitRoot);
  if (!hitRoot || hitRoot.destroyed) {
    hitRoot = new Sprite();
    hitRoot.name = 'xcPeiXiuRouteSliderHitRoot';
    hitRoot.mouseEnabled = true;
    hitRoot.mouseThrough = true;
    hitRoot.zOrder = 10001;
    hitRoot.__hits = [];
    for (let index = 0; index < 3; index += 1) {
      const hit = new Sprite();
      hit.name = `xcPeiXiuRouteSliderHit-${index}`;
      hit.mouseEnabled = true;
      hit.mouseThrough = false;
      hit.on?.(globalObject.Laya?.Event?.CLICK || 'click', host, function (this: PeixiuOverlayHost, event?: { stopPropagation?: () => void }) {
        event?.stopPropagation?.();
        onSelect(index);
      });
      hitRoot.addChild?.(hit);
      (hitRoot.__hits as UnknownRecord[]).push(hit);
    }
    host.__xcPeiXiuRouteSliderHitRoot = hitRoot;
  }
  if (hitRoot.parent !== hostLayer) {
    try { hostLayer.addChild?.(hitRoot); } catch { /* ignore */ }
  }
  const rect = board ? boardRectIn(board, hostLayer, size, globalObject) : {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    scaleX: 1,
    scaleY: 1
  };
  const hitWidth = width * rect.scaleX;
  const hitHeight = SLIDER_HEIGHT * rect.scaleY;
  hitRoot.pos?.(
    rect.x + 4 * rect.scaleX,
    rect.y + (-36 + SLIDER_HEIGHT / 2) * rect.scaleY
  );
  hitRoot.size?.(hitWidth, hitHeight);
  ((hitRoot.__hits as UnknownRecord[]) || []).forEach((hit, index) => {
    hit.pos?.(index * SLIDER_SLOT * rect.scaleX, 0);
    hit.size?.(SLIDER_SLOT * rect.scaleX, hitHeight);
    hit.visible = visible && index < count;
    hit.mouseEnabled = hit.visible;
  });
  hitRoot.visible = visible;
  hostLayer.sortChildren?.();
}

function renderSequence(
  host: PeixiuOverlayHost,
  size: { width: number; height: number },
  solution: PeixiuRouteSolution | undefined,
  globalObject: PeixiuLayaWindow
): string {
  const text = sequencePlainText(solution);
  const hostNode = globalObject.Laya?.stage;
  const board = asRecord(host.boardEffectRoot);
  const Sprite = globalObject.Laya?.Sprite;
  const Html = globalObject.Laya?.HTMLDivElement;
  if (!text || !hostNode?.addChild || !board || !Sprite || !Html) {
    const existing = asRecord(host.__xcPeiXiuCardSequenceLabel);
    if (existing) existing.visible = false;
    return '';
  }
  let box = asRecord(host.__xcPeiXiuCardSequenceLabel);
  if (!box || box.destroyed || !asRecord(box.__xcPeiXiuRichTextNode) || asRecord(box.__xcPeiXiuRichTextNode)?.destroyed) {
    try { box?.destroy?.(true); } catch { /* ignore */ }
    box = new Sprite();
    box.name = 'xcPeiXiuCardSequenceLabel';
    box.mouseEnabled = false;
    box.mouseThrough = true;
    box.zOrder = 10000;
    const rich = new Html();
    rich.name = 'xcPeiXiuCardSequenceRichText';
    rich.mouseEnabled = false;
    rich.mouseThrough = true;
    Object.assign(asRecord(rich.style) ?? {}, {
      color: '#0A0A0A',
      fontSize: 34,
      fontFamily: FONT,
      bold: true,
      stroke: 2,
      strokeColor: '#D9BE8A',
      wordWrap: false
    });
    rich.pos?.(0, 3);
    box.addChild?.(rich);
    box.__xcPeiXiuRichTextNode = rich;
    host.__xcPeiXiuCardSequenceLabel = box;
  }
  if (box.parent !== hostNode) {
    try { hostNode.addChild?.(box); } catch { return ''; }
  }
  const rect = boardRectIn(board, hostNode, size, globalObject);
  const width = Math.max(240, Math.min(900, rect.width + 152));
  box.pos?.(rect.x + 4 * rect.scaleX, rect.y + rect.height + 60 * rect.scaleY + 12);
  box.size?.(width, 56);
  const rich = asRecord(box.__xcPeiXiuRichTextNode);
  rich?.size?.(width, 50);
  if (rich?.style) {
    Object.assign(asRecord(rich.style)!, {
      width,
      color: '#0A0A0A',
      fontSize: 34,
      fontFamily: FONT,
      bold: true,
      stroke: 2,
      strokeColor: '#D9BE8A',
      wordWrap: false
    });
  }
  const html = sequenceRichParts(solution).map((part) => {
    const raw = String(part.text || '');
    const accent = String(part.accent || '');
    const accentIndex = accent ? raw.indexOf(accent) : -1;
    if (accentIndex < 0) return escapeHtml(raw);
    return `${escapeHtml(raw.slice(0, accentIndex))}<font color='${part.accentColor || '#0A0A0A'}'>${escapeHtml(accent)}</font>${escapeHtml(raw.slice(accentIndex + accent.length))}`;
  }).join('');
  if (rich) {
    rich.innerHTML = '';
    rich.innerHTML = html;
    rich.visible = true;
    rich.layout?.();
    rich.repaint?.();
  }
  box.repaint?.();
  hostNode.sortChildren?.();
  box.visible = true;
  return text;
}

function hideSkillBubble(host: PeixiuOverlayHost, delay: number, globalObject: PeixiuLayaWindow): void {
  const timer = host.__xcPeiXiuSkillBubbleHideTimer as number | undefined;
  if (timer) globalObject.clearTimeout?.(timer);
  host.__xcPeiXiuSkillBubbleHideTimer = globalObject.setTimeout?.(() => {
    host.__xcPeiXiuSkillBubbleHideTimer = null;
    const bubble = asRecord(host.__xcPeiXiuSkillBubble);
    if (bubble) bubble.visible = false;
  }, Math.max(0, delay));
}

function showSkillBubble(host: PeixiuOverlayHost, text: string, anchor: UnknownRecord, globalObject: PeixiuLayaWindow): void {
  const Sprite = globalObject.Laya?.Sprite;
  const Text = globalObject.Laya?.Text;
  const layer = globalObject.Laya?.stage;
  if (!Sprite || !Text || !layer || !text) return;
  if (host.__xcPeiXiuSkillBubbleHideTimer) {
    globalObject.clearTimeout?.(host.__xcPeiXiuSkillBubbleHideTimer as number);
    host.__xcPeiXiuSkillBubbleHideTimer = null;
  }
  let bubble = asRecord(host.__xcPeiXiuSkillBubble);
  if (!bubble || bubble.destroyed) {
    bubble = new Sprite();
    bubble.name = 'xcPeiXiuSkillBubble';
    bubble.mouseEnabled = false;
    const label = new Text();
    label.name = 'xcPeiXiuSkillBubbleText';
    label.font = FONT;
    label.fontSize = 26;
    label.color = '#FFF6D4';
    label.wordWrap = true;
    bubble.addChild?.(label);
    bubble.__xcPeiXiuText = label;
    host.__xcPeiXiuSkillBubble = bubble;
  }
  if (bubble.parent !== layer) layer.addChild?.(bubble);
  const width = Math.min(560, Math.max(260, estimateTextWidth(text, 26) + 32));
  const height = 78;
  bubble.size?.(width, height);
  bubble.graphics?.clear?.();
  bubble.graphics?.drawRect?.(0, 0, width, height, '#2A241B');
  const label = asRecord(bubble.__xcPeiXiuText);
  if (label) {
    label.text = text;
    label.fontSize = 26;
    label.size?.(width - 28, height - 18);
    label.pos?.(14, 9);
  }
  const x = Number(anchor.x) || 0;
  const y = Number(anchor.y) || 0;
  bubble.pos?.(x, y - height - 8);
  bubble.visible = true;
}

function renderSkills(
  host: PeixiuOverlayHost,
  size: { width: number; height: number },
  skills: PeixiuRewardInfo[],
  hasSequence: boolean,
  globalObject: PeixiuLayaWindow
): void {
  const layer = globalObject.Laya?.stage;
  const board = asRecord(host.boardEffectRoot);
  const Label = globalObject.Laya?.Label;
  if (!layer?.addChild || !board || !Label) return;
  const rect = boardRectIn(board, layer, size, globalObject);
  const labels = (host.__xcPeiXiuSkillLabels ||= []) as UnknownRecord[];
  const items = skills.length
    ? [{ name: '已获得：', description: '' }, ...skills.map((skill, index) => ({
      ...skill,
      name: `${index ? '、' : ''}${skill.name}`
    }))]
    : [];
  const maxWidth = Math.max(120, rect.width - 8);
  const fitted: Array<PeixiuRewardInfo & { width: number }> = [];
  let used = 0;
  let overflow = false;
  for (const item of items) {
    const width = Math.max(40, estimateTextWidth(String(item.name || ''), 32) + 12);
    if (used + width > maxWidth) {
      overflow = true;
      break;
    }
    fitted.push({ ...item, width });
    used += width;
  }
  if (overflow && fitted.length) {
    if (used + 26 <= maxWidth) fitted.push({ rewardId: 0, name: '…', description: '', width: 26 });
    else if (fitted.length > 1) fitted[fitted.length - 1].name = `${String(fitted[fitted.length - 1].name || '').replace(/…?$/, '…')}`;
  }
  const baseX = rect.x + 4 * rect.scaleX;
  const baseY = rect.y + rect.height + 60 * rect.scaleY + 12;
  const y = baseY + (hasSequence ? 56 : 0);
  fitted.forEach((item, index) => {
    let label = labels[index];
    if (!label || label.destroyed) {
      label = new Label();
      label.name = `xcPeiXiuSkillLabel-${index}`;
      label.mouseEnabled = true;
      label.mouseThrough = false;
      label.font = FONT;
      label.fontSize = 32;
      label.bold = true;
      label.color = '#0A0A0A';
      label.stroke = 2;
      label.strokeColor = '#D9BE8A';
      label.align = 'left';
      label.valign = 'top';
      label.wordWrap = false;
      label.zOrder = 10001;
      label.on?.(globalObject.Laya?.Event?.ROLL_OVER || 'rollover', label, function (this: UnknownRecord) {
        const desc = String(this.__xcPeiXiuSkillDescription || '');
        if (desc) showSkillBubble(host, desc, this, globalObject);
      });
      label.on?.(globalObject.Laya?.Event?.ROLL_OUT || 'rollout', label, function () {
        hideSkillBubble(host, 50, globalObject);
      });
      layer.addChild?.(label);
      labels[index] = label;
    }
    if (label.parent !== layer) layer.addChild?.(label);
    label.text = item.name;
    label.__xcPeiXiuSkillDescription = item.description || '';
    label.fontSize = 32;
    label.size?.(item.width, 44);
    label.pos?.(baseX + fitted.slice(0, index).reduce((sum, current) => sum + current.width, 0), y);
    label.visible = true;
  });
  labels.forEach((label, index) => {
    if (index >= fitted.length) label.visible = false;
  });
  layer.sortChildren?.();
}

export function hidePeixiuOverlay(host: PeixiuOverlayHost | null | undefined): void {
  if (!host) return;
  asRecord(host.__xcPeiXiuRouteLayer)?.graphics?.clear?.();
  hideLabels(host, 0);
  const slider = asRecord(host.__xcPeiXiuRouteSlider);
  if (slider) slider.visible = false;
  const hits = asRecord(host.__xcPeiXiuRouteSliderHitRoot);
  if (hits) hits.visible = false;
  const sequence = asRecord(host.__xcPeiXiuCardSequenceLabel);
  if (sequence) sequence.visible = false;
  ((host.__xcPeiXiuSkillLabels as UnknownRecord[]) || []).forEach((label) => { label.visible = false; });
  const bubble = asRecord(host.__xcPeiXiuSkillBubble);
  if (bubble) bubble.visible = false;
  const remain = asRecord(host.__xcPeiXiuRemainingSuitPanel);
  if (remain) remain.visible = false;
  host.__xcPeiXiuRouteRenderSignature = '';
}

export function destroyPeixiuOverlay(host: PeixiuOverlayHost | null | undefined, globalObject?: PeixiuLayaWindow): void {
  if (!host) return;
  if (host.__xcPeiXiuSkillBubbleHideTimer && globalObject?.clearTimeout) {
    globalObject.clearTimeout(host.__xcPeiXiuSkillBubbleHideTimer as number);
  }
  const nodes = [
    host.__xcPeiXiuRouteSliderHitRoot,
    host.__xcPeiXiuCardSequenceLabel,
    host.__xcPeiXiuSkillBubble,
    host.__xcPeiXiuRemainingSuitPanel,
    ...((host.__xcPeiXiuSkillLabels as unknown[]) || []),
    host.__xcPeiXiuRouteControlRoot,
    host.__xcPeiXiuRouteLayer
  ];
  for (const node of nodes) {
    const record = asRecord(node);
    if (!record) continue;
    try {
      record.removeSelf?.();
      record.destroy?.(true);
    } catch { /* ignore */ }
  }
  host.__xcPeiXiuRouteLayer = null;
  host.__xcPeiXiuRouteControlRoot = null;
  host.__xcPeiXiuRouteLabels = [];
  host.__xcPeiXiuRouteSlider = null;
  host.__xcPeiXiuRouteSliderHitRoot = null;
  host.__xcPeiXiuCardSequenceLabel = null;
  host.__xcPeiXiuRemainingSuitPanel = null;
  host.__xcPeiXiuSkillBubble = null;
  host.__xcPeiXiuSkillLabels = [];
  host.__xcPeiXiuRouteCache = null;
  host.__xcPeiXiuRouteRenderSignature = '';
  host.__xcPeiXiuRouteVariant = 0;
}

export function renderPeixiuRoute(options: {
  host: PeixiuOverlayHost;
  planned: PeixiuPlannedRoute | null;
  skills: PeixiuRewardInfo[];
  globalObject: PeixiuLayaWindow;
  force?: boolean;
  onVariantChange?: (variant: number) => void;
}): boolean {
  const { host, planned, skills, globalObject } = options;
  const layer = ensureLayer(host, globalObject);
  if (!layer) return false;
  const size = boardSize(host);
  let variant = [0, 1, 2].includes(Number(host.__xcPeiXiuRouteVariant))
    ? Number(host.__xcPeiXiuRouteVariant)
    : 0;
  const solutions = planned?.solutions || [];
  if (variant >= solutions.length) variant = 0;
  host.__xcPeiXiuRouteVariant = variant;
  const signature = [
    asRecord(host.__xcPeiXiuRouteCache)?.key || '',
    variant,
    solutions.length,
    size.width,
    size.height
  ].join('|');
  if (!options.force && host.__xcPeiXiuRouteRenderSignature === signature) return false;
  host.__xcPeiXiuRouteRenderSignature = signature;
  const graphics = asRecord(layer.graphics);
  graphics?.clear?.();
  if (!planned || !solutions.length || !host.getMarkerPos) {
    hidePeixiuOverlay(host);
    return true;
  }
  layer.size?.(size.width || 0, (size.height || 0) + 64);
  const selected = solutions[variant] || solutions[0];
  const segments = flattenRouteSegments(selected);
  const unavailable = [...new Set(segments.filter((item) => item.step?.available === false).map((item) => item.step))];
  const unavailableIndex = new Map(unavailable.map((step, index) => [step, index]));
  for (const segment of [...segments].sort((left, right) => (
    Number(left.step?.available !== false) - Number(right.step?.available !== false)
  ))) {
    const from = host.getMarkerPos(segment.from);
    const to = host.getMarkerPos(segment.to);
    const color = segment.step?.available === false
      ? mixColor(unavailableIndex.get(segment.step) || 0, unavailable.length)
      : segment.special
        ? '#7C5CFF'
        : '#56E39F';
    drawArrow(graphics!, from, to, color, segment.step?.available === false ? 4 : 3);
  }
  const path = selected?.path || [];
  const visitCount = new Map<number, number>();
  const visitIndex = new Map<number, number>();
  path.forEach((step) => {
    if (!step?.dir) return;
    const cell = step.to;
    visitCount.set(cell, (visitCount.get(cell) || 0) + 1);
  });
  let labelIndex = 0;
  let stepNo = 0;
  path.forEach((step) => {
    if (!step?.dir) return;
    stepNo += 1;
    const cell = step.to;
    const point = host.getMarkerPos!(step.to);
    const used = visitIndex.get(cell) || 0;
    const pos = offsetPoint(point, used, visitCount.get(cell) || 1);
    visitIndex.set(cell, used + 1);
    const unavailableAt = unavailableIndex.get(step) ?? -1;
    const fill = step.available === false ? mixColor(unavailableAt, unavailable.length) : '#2FB87A';
    const stroke = step.available === false ? mixColor(unavailableAt, unavailable.length) : '#16734A';
    graphics?.drawCircle?.(pos.x, pos.y, 12, fill, stroke, 2);
    const label = ensureStepLabel(host, labelIndex, globalObject);
    if (label) {
      label.text = String(stepNo);
      label.fontSize = stepNo >= 10 ? 14 : 16;
      label.color = step.available === false ? '#5C2A14' : '#0A3D28';
      label.strokeColor = step.available === false ? '#FFFBE8' : '#F2FFF7';
      label.size?.(24, 22);
      label.pos?.(pos.x - 12, pos.y - 11);
    }
    labelIndex += 1;
  });
  hideLabels(host, labelIndex);

  const sequence = renderSequence(host, size, selected, globalObject);
  renderSkills(host, size, skills, !!sequence, globalObject);
  const showSlider = solutions.some((item) => (item.path || []).some((step) => step.dir));
  renderSlider(host, size, solutions, variant, showSlider, globalObject, (index) => {
    host.__xcPeiXiuRouteVariant = index;
    options.onVariantChange?.(index);
  });
  renderRemainingSuits(host, size, remainingSuitCounts(solutions, variant), globalObject);
  return true;
}
