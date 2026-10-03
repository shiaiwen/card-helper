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
 * 对照 app.bak 的 qo：在武将头像右下角挂 Laya.Text 提示。
 * enabled=false 或文案为空时隐藏；节点复用，避免每帧重建。
 */
export function applySeatGeneralTip(options: {
  key: string;
  targets: readonly SeatTipTarget[];
  enabled: boolean;
  getText: (target: SeatTipTarget) => string;
  globalObject?: SeatTipLayaWindow;
}): void {
  const { key, targets, enabled, getText, globalObject = window as SeatTipLayaWindow } = options;
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
      node.fontSize = 12;
      node.color = '#FFFFFF';
      node.stroke = 2;
      node.strokeColor = '#000000';
      node.align = 'right';
      node.leading = 0;
      node.mouseEnabled = false;
      node.zOrder = 999;
      node.width = 70;
      node.height = 90;
      const avatarWidth = Number(avatar.width) || 0;
      node.pos?.(Math.max(0, avatarWidth - (node.width || 70) - 15), 40);
      avatar[property] = node;
      const addChild = avatar.addChild;
      if (typeof addChild === 'function') addChild.call(avatar, node);
    }
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
      // ignore
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

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function asTipNode(value: unknown): SeatTipTextNode | null {
  return value && typeof value === 'object' ? value as SeatTipTextNode : null;
}
