/**
 * 座位武将 tip：收集目标座位并应用/清理浮层提示。
 */

type UnknownRecord = Record<string, unknown>;

export interface SeatTipTarget {
  seat?: unknown;
  seatAvatar?: UnknownRecord | null;
}

export interface SeatTipLayaWindow {
  Laya?: {
    Text?: new () => SeatTipTextNode;
  };
}

export interface SeatTipTextNode {
  name?: string;
  fontSize?: number;
  color?: string;
  stroke?: number;
  strokeColor?: string;
  align?: string;
  bold?: boolean;
  bgColor?: string;
  leading?: number;
  mouseEnabled?: boolean;
  zOrder?: number;
  width?: number;
  height?: number;
  text?: string;
  visible?: boolean;
  pos?: (x: number, y: number) => void;
  destroy?: (destroyChildren?: boolean) => void;
  removeSelf?: () => void;
}

const TIP_PROPERTY_PREFIX = '__xcGeneralTip_';

/**
 * 在武将头像右下角挂 Laya.Text 提示。
 * enabled=false 或文案为空时隐藏；节点复用，避免每帧重建。
 */
export interface SeatTipStyle {
  fontSize: number;
  color: string;
  stroke: number;
  strokeColor: string;
  align: string;
  bold?: boolean;
  bgColor?: string;
  /** 相对头像左上角；缺省贴右下。 */
  place?: (avatar: UnknownRecord) => { x: number; y: number; width: number; height: number };
}

export function applySeatGeneralTip(options: {
  key: string;
  targets: readonly SeatTipTarget[];
  enabled: boolean;
  getText: (target: SeatTipTarget) => string;
  globalObject?: SeatTipLayaWindow;
  style?: SeatTipStyle;
}): void {
  const { key, targets, enabled, getText, globalObject = window as SeatTipLayaWindow, style } = options;
  if (!key) return;
  for (const target of targets) {
    const avatar = asRecord(target.seatAvatar);
    if (!avatar) continue;
    const text = enabled ? String(getText(target) || '') : '';
    const property = `${TIP_PROPERTY_PREFIX}${key}`;
    let node = asTipNode(avatar[property]);
    if (!node && !text) continue;
    if (!node) {
      const Text = globalObject.Laya?.Text;
      if (!Text) continue;
      node = new Text();
      node.name = `xcGeneralCardTip-${key}`;
      node.leading = 0;
      node.mouseEnabled = false;
      node.zOrder = 999;
      avatar[property] = node;
      applyTipStyle(node, avatar, style);
      const addChild = avatar.addChild;
      if (typeof addChild === 'function') addChild.call(avatar, node);
    }
    applyTipStyle(node, avatar, style);
    if (node.text !== text) node.text = text;
    node.visible = Boolean(text);
  }
}

/** 清掉指定 key 的座位提示（关开关 / 离场）。 */
export function clearSeatGeneralTips(
  targets: readonly SeatTipTarget[],
  key: string
): void {
  const property = `${TIP_PROPERTY_PREFIX}${key}`;
  for (const target of targets) {
    const avatar = asRecord(target.seatAvatar);
    if (!avatar) continue;
    const node = asTipNode(avatar[property]);
    if (!node) continue;
    try {
      node.removeSelf?.();
      node.destroy?.(true);
    } catch {
      // 忽略异常
    }
    delete avatar[property];
  }
}

export function collectSeatTipTargets(seatUIs: unknown): SeatTipTarget[] {
  if (!Array.isArray(seatUIs)) return [];
  return seatUIs.map((raw) => {
    const seatUI = asRecord(raw);
    return {
      seat: seatUI?.seat ?? seatUI,
      seatAvatar: asRecord(seatUI?.seatAvatar) ?? null
    };
  });
}

function applyTipStyle(node: SeatTipTextNode, avatar: UnknownRecord, style: SeatTipStyle | undefined): void {
  node.fontSize = style?.fontSize ?? 12;
  node.color = style?.color ?? '#FFFFFF';
  node.stroke = style?.stroke ?? 2;
  node.strokeColor = style?.strokeColor ?? '#000000';
  node.align = style?.align ?? 'right';
  node.bold = style?.bold ?? false;
  node.bgColor = style?.bgColor;
  const box = style?.place?.(avatar) ?? defaultTipBox(avatar);
  node.width = box.width;
  node.height = box.height;
  node.pos?.(box.x, box.y);
}

function defaultTipBox(avatar: UnknownRecord): { x: number; y: number; width: number; height: number } {
  const avatarWidth = Number(avatar.width) || 0;
  return {
    x: Math.max(0, avatarWidth - 70 - 15),
    y: 40,
    width: 70,
    height: 90
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function asTipNode(value: unknown): SeatTipTextNode | null {
  return value && typeof value === 'object' ? value as SeatTipTextNode : null;
}
