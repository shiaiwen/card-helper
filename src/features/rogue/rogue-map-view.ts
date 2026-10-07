/**
 * 山河地图 DOM/Laya 视图层：把控制器草稿渲染到游戏内覆盖层或面板区域。
 */

import {
  ROGUE_MAP_STYLE,
  type RogueMapPanelLayout
} from './rogue-map-types.ts';
import { dashSegments } from './rogue-map-geometry.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function call(target: UnknownRecord | null | undefined, method: string, ...args: unknown[]): unknown {
  const fn = target?.[method];
  if (typeof fn !== 'function') return undefined;
  return (fn as Function).apply(target, args);
}

function layaClass(name: string): (new () => object) | null {
  const ctor = asRecord((globalThis as UnknownRecord).Laya)?.[name];
  return typeof ctor === 'function' ? ctor as new () => object : null;
}

function createLabel(text: string, color: string, fontSize: number, bold = false): UnknownRecord | null {
  const Label = layaClass('Label') ?? layaClass('Text');
  if (!Label) return null;
  const node = asRecord(new Label());
  if (!node) return null;
  node.width = ROGUE_MAP_STYLE.panelWidth;
  node.wordWrap = true;
  node.align = 'left';
  node.valign = 'top';
  node.leading = 2;
  node.padding = `3,${ROGUE_MAP_STYLE.labelPad},3,${ROGUE_MAP_STYLE.labelPad}`;
  node.color = color;
  node.fontSize = fontSize;
  node.bold = bold;
  node.text = text;
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

function createDivider(): UnknownRecord | null {
  const Sprite = layaClass('Sprite');
  if (!Sprite) return null;
  const node = asRecord(new Sprite());
  if (!node) return null;
  node.width = ROGUE_MAP_STYLE.panelWidth;
  node.height = 5;
  call(asRecord(node.graphics), 'drawLine',
    ROGUE_MAP_STYLE.labelPad,
    3,
    ROGUE_MAP_STYLE.panelWidth - ROGUE_MAP_STYLE.labelPad,
    3,
    ROGUE_MAP_STYLE.dividerColor,
    1
  );
  return node;
}

/** 创建城池信息面板与引导虚线。 */
export function createCityOverlayNodes(
  panel: RogueMapPanelLayout
): UnknownRecord[] {
  const VBox = layaClass('VBox');
  const Sprite = layaClass('Sprite');
  if (!VBox || !Sprite) return [];

  const box = asRecord(new VBox());
  if (!box) return [];
  box.name = 'city';
  box.zOrder = ROGUE_MAP_STYLE.cityZOrder;
  box.mouseEnabled = false;
  box.mouseThrough = true;
  call(box, 'pos', panel.x, panel.y);

  const background = asRecord(new Sprite());
  if (background) {
    background.alpha = ROGUE_MAP_STYLE.backgroundAlpha;
    background.mouseEnabled = false;
    call(box, 'addChild', background);
  }

  const spacer = asRecord(new Sprite());
  if (spacer) {
    spacer.height = ROGUE_MAP_STYLE.topSpacer;
    spacer.mouseEnabled = false;
    call(box, 'addChild', spacer);
  }

  let contentHeight = ROGUE_MAP_STYLE.topSpacer;
  const title = createLabel(
    panel.title,
    ROGUE_MAP_STYLE.titleColor,
    ROGUE_MAP_STYLE.titleSize,
    true
  );
  if (title) {
    call(box, 'addChild', title);
    contentHeight += Number(title.height) || ROGUE_MAP_STYLE.titleSize + 8;
  }

  const lines = panel.lines ?? [];
  const hasGeneral = lines.some((line) => line.kind === 'general' || line.kind === 'stats');
  const rewardStart = lines.findIndex((line) => line.kind === 'reward');
  let insertedRewardDivider = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.kind === 'reward' && hasGeneral && !insertedRewardDivider) {
      const divider = createDivider();
      if (divider) {
        call(box, 'addChild', divider);
        contentHeight += Number(divider.height) || 5;
      }
      insertedRewardDivider = true;
    } else if (index === 0 && line.kind === 'reward' && rewardStart === 0) {
      // 无武将块时也加分隔，贴近标题与奖励。
      const divider = createDivider();
      if (divider) {
        call(box, 'addChild', divider);
        contentHeight += Number(divider.height) || 5;
      }
    }

    const color = line.kind === 'stats'
      ? ROGUE_MAP_STYLE.detailColor
      : line.kind === 'general'
        ? (line.warning ? ROGUE_MAP_STYLE.generalWarningColor : ROGUE_MAP_STYLE.generalColor)
        : ROGUE_MAP_STYLE.bodyColor;
    const size = line.kind === 'stats'
      ? ROGUE_MAP_STYLE.detailSize
      : line.kind === 'general'
        ? ROGUE_MAP_STYLE.generalSize
        : ROGUE_MAP_STYLE.bodySize;
    const label = createLabel(line.text, color, size, true);
    if (!label) continue;
    call(box, 'addChild', label);
    contentHeight += Number(label.height) || size + 6;
  }

  const panelHeight = contentHeight + ROGUE_MAP_STYLE.topSpacer;
  box.layoutEnabled = true;
  box.vScrollBarSkin = '';
  box.width = ROGUE_MAP_STYLE.panelWidth;
  box.height = panelHeight;
  if (background) {
    drawRoundedRect(
      background,
      ROGUE_MAP_STYLE.panelWidth,
      panelHeight,
      ROGUE_MAP_STYLE.panelFill,
      ROGUE_MAP_STYLE.panelStroke,
      1,
      ROGUE_MAP_STYLE.cornerRadius
    );
    call(background, 'pos', 0, 0);
  }

  const nodes: UnknownRecord[] = [box];
  const leader = createLeaderLine(panel, panelHeight);
  if (leader) nodes.push(leader);
  return nodes;
}

function createLeaderLine(panel: RogueMapPanelLayout, panelHeight: number): UnknownRecord | null {
  const Sprite = layaClass('Sprite');
  if (!Sprite) return null;
  const fromX = panel.x + panel.w / 2;
  const fromY = panel.y + panelHeight / 2;
  const toX = panel.centerX;
  const toY = panel.centerY;
  const distance = Math.hypot(toX - fromX, toY - fromY);
  if (distance < ROGUE_MAP_STYLE.layoutGap) return null;
  const sprite = asRecord(new Sprite());
  if (!sprite) return null;
  sprite.name = 'cityLeader';
  sprite.zOrder = ROGUE_MAP_STYLE.leaderZOrder;
  sprite.mouseEnabled = false;
  const graphics = asRecord(sprite.graphics);
  for (const segment of dashSegments(fromX, fromY, toX, toY)) {
    call(
      graphics,
      'drawLine',
      segment.fromX,
      segment.fromY,
      segment.toX,
      segment.toY,
      ROGUE_MAP_STYLE.leaderColor,
      ROGUE_MAP_STYLE.leaderLineWidth
    );
  }
  return sprite;
}

/** 清掉城池上的覆盖层。 */
export function clearCityOverlays(cityView: UnknownRecord | null): void {
  if (!cityView || typeof cityView.numChildren !== 'number') return;
  for (let index = Number(cityView.numChildren) - 1; index >= 0; index -= 1) {
    const child = asRecord(call(cityView, 'getChildAt', index));
    if (!child) continue;
    if (child.name === 'city' || child.name === 'cityLeader') {
      call(cityView, 'removeChild', child);
      try {
        if (typeof child.destroy === 'function') child.destroy(true);
      } catch {
        // 忽略异常
      }
    }
  }
}

/** 把城池信息挂到地图上。 */
export function mountCityOverlays(cityView: UnknownRecord | null, nodes: UnknownRecord[]): void {
  if (!cityView) return;
  clearCityOverlays(cityView);
  for (const node of nodes) call(cityView, 'addChild', node);
}

/** 该城是否已经挂过覆盖层。 */
export function hasMountedCityOverlay(cityView: UnknownRecord | null): boolean {
  if (!cityView || typeof cityView.numChildren !== 'number') return false;
  for (let index = 0; index < Number(cityView.numChildren); index += 1) {
    const child = asRecord(call(cityView, 'getChildAt', index));
    if (child?.name === 'city') return true;
  }
  return false;
}
