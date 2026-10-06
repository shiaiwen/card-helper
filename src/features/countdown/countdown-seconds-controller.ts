import type { XiaochaoConfigStore } from '../../config/config-store';

interface CountdownTextNode {
  visible?: boolean;
  label?: string;
  labelSize?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  mouseEnabled?: boolean;
  zOrder?: number;
  name?: string;
  __xiaochaoCountdownSeconds?: boolean;
  __xiaochaoCountdownValue?: string;
  removeSelf?: () => void;
  destroy?: (destroyChildren?: boolean) => void;
}

interface LayaDisplayNode {
  RemainValue?: unknown;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  visible?: boolean;
  alpha?: number;
  destroyed?: boolean;
  parent?: LayaDisplayNode | null;
  localToGlobal?: (point: { x: number; y: number }, createNewPoint?: boolean) => { x: number; y: number };
  _children?: Array<LayaDisplayNode | CountdownTextNode>;
  numChildren?: number;
  getChildAt?: (index: number) => LayaDisplayNode | null;
  addChild?: (child: CountdownTextNode) => unknown;
}

type DisplayConstructor = new () => CountdownTextNode;

interface CountdownRuntimeWindow extends Window {
  Laya?: {
    stage?: LayaDisplayNode;
    Label?: DisplayConstructor;
    Text?: DisplayConstructor;
    ClassUtils?: { getClass?: (className: string) => DisplayConstructor | undefined };
  };
}

/**
 * 独立实现进度条旁的剩余秒数。
 * 游戏自己的进度条保持原样；本控制器只创建和管理小抄附加的文字节点。
 */
export function installCountdownSecondsController(
  configStore: XiaochaoConfigStore,
  globalObject: CountdownRuntimeWindow = window
): () => void {
  let enabled = configStore.get('display.countdownEnabled');
  const secondsByCountdown = new Map<LayaDisplayNode, CountdownTextNode>();
  let primaryCountdown: LayaDisplayNode | null = null;

  const synchronize = () => {
    if (!enabled) {
      for (const secondsText of secondsByCountdown.values()) destroyTextNode(secondsText);
      secondsByCountdown.clear();
      primaryCountdown = null;
      return;
    }
    const stage = globalObject.Laya?.stage;
    if (!stage) return;
    const activeCountdowns = new Set<LayaDisplayNode>();
    const candidates: LayaDisplayNode[] = [];

    visitDisplayTree(stage, (node) => {
      if (!isCountdownDisplay(node)) return;
      removeDuplicateSecondsTexts(node, secondsByCountdown.get(node));
      if (isVisiblyAttached(node, stage)) candidates.push(node);
    });

    // 游戏会把未使用的倒计时组件留在显示树中复用。只选择最接近舞台水平中心的
    // 活动进度条，避免给左下角的缓存组件也添加数字。
    // 同一阶段可能同时残留多个可见倒计时实例。优先沿用当前实例，避免轮询
    // 在两个候选间反复销毁/创建文字，造成数字明显闪烁。
    const countdown = primaryCountdown && candidates.includes(primaryCountdown)
      ? primaryCountdown
      : selectPrimaryCountdown(candidates, stage);
    primaryCountdown = countdown;
    if (countdown) {
      activeCountdowns.add(countdown);

      let secondsText = secondsByCountdown.get(countdown);
      if (!secondsText) {
        secondsText = createSecondsText(globalObject);
        if (secondsText) {
          secondsText.visible = false;
          countdown.addChild?.(secondsText);
          secondsByCountdown.set(countdown, secondsText);
        }
      }
      if (secondsText) updateSecondsText(secondsText, countdown.RemainValue as number);
    }

    for (const [countdown, secondsText] of secondsByCountdown) {
      if (!activeCountdowns.has(countdown)) {
        destroyTextNode(secondsText);
        secondsByCountdown.delete(countdown);
      }
    }
    if (!countdown) primaryCountdown = null;
  };

  const unsubscribe = configStore.subscribe('display.countdownEnabled', ({ value }) => {
    enabled = Boolean(value);
    synchronize();
  });
  // 避免高频遍历整个 Laya 显示树；250ms 仍足以跟上秒数变化和弹窗创建。
  const timer = globalObject.setInterval(synchronize, 250);
  synchronize();

  return () => {
    window.clearInterval(timer);
    unsubscribe();
    secondsByCountdown.forEach(destroyTextNode);
    secondsByCountdown.clear();
  };
}

function isVisiblyAttached(node: LayaDisplayNode, stage: LayaDisplayNode): boolean {
  let current: LayaDisplayNode | null | undefined = node;
  let depth = 0;
  while (current && depth++ < 20) {
    if (current.destroyed === true || current.visible === false || Number(current.alpha ?? 1) <= 0) {
      return false;
    }
    if (current === stage) return true;
    current = current.parent;
  }
  return false;
}

function selectPrimaryCountdown(
  candidates: readonly LayaDisplayNode[],
  stage: LayaDisplayNode
): LayaDisplayNode | null {
  if (!candidates.length) return null;
  const stageWidth = Number(stage.width) || 1920;
  const centralCandidates = candidates.filter((candidate) => {
    const position = readGlobalPosition(candidate);
    const width = Math.max(0, Number(candidate.width ?? 0));
    const height = Math.max(0, Number(candidate.height ?? 0));
    // 不能用中心点判断：左侧缓存组件可能有很大的逻辑宽度。主进度条本体的
    // 左上角必须已经位于画面中央，同时具有正常的横向进度条尺寸。
    return position.x >= Math.max(100, stageWidth * .2)
      && position.x <= stageWidth * .75
      && position.y >= 0
      && width >= 120
      && height > 0;
  });
  if (!centralCandidates.length) return null;
  return [...centralCandidates].sort((left, right) => (
    countdownPositionScore(right, stageWidth) - countdownPositionScore(left, stageWidth)
  ))[0];
}

function countdownPositionScore(node: LayaDisplayNode, stageWidth: number): number {
  const position = readGlobalPosition(node);
  const width = Math.max(0, Number(node.width ?? 0));
  const centerX = position.x + width / 2;
  // 出牌阶段主进度条位于画面上方；顶部位置优先级高于水平居中程度。
  return -Math.max(0, position.y) * 4 - Math.abs(centerX - stageWidth / 2) * .25;
}

function readGlobalPosition(node: LayaDisplayNode): { x: number; y: number } {
  if (typeof node.localToGlobal === 'function') {
    try {
      const point = node.localToGlobal({ x: 0, y: 0 }, true);
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
        return { x: Number(point.x), y: Number(point.y) };
      }
    } catch {
      // 某些旧 Laya 版本要求 Point 实例，回退到父链坐标。
    }
  }
  let x = 0;
  let y = 0;
  let scaleX = 1;
  let current: LayaDisplayNode | null | undefined = node;
  let depth = 0;
  while (current && depth++ < 20) {
    x += Number(current.x ?? 0) * scaleX;
    y += Number(current.y ?? 0);
    scaleX *= Number(current.scaleX ?? 1) || 1;
    current = current.parent;
  }
  return { x, y };
}

function isCountdownDisplay(node: LayaDisplayNode): boolean {
  return typeof node.RemainValue === 'number'
    && Number.isFinite(node.RemainValue)
    && typeof node.addChild === 'function';
}

function createSecondsText(globalObject: CountdownRuntimeWindow): CountdownTextNode | null {
  const laya = globalObject.Laya;
  const constructors = [
    laya?.ClassUtils?.getClass?.('SgsText'),
    laya?.ClassUtils?.getClass?.('SgsLabel'),
    laya?.Label,
    laya?.Text,
  ].filter((Constructor): Constructor is DisplayConstructor => Boolean(Constructor));
  for (const Constructor of constructors) {
    try {
      const textNode = new Constructor();
      textNode.labelSize = 17;
      textNode.fontSize = 17;
      textNode.color = '#f2de9c';
      textNode.mouseEnabled = false;
      textNode.zOrder = 1000;
      textNode.name = 'xiaochao-countdown-seconds';
      textNode.__xiaochaoCountdownSeconds = true;
      return textNode;
    } catch {
      // 某些游戏组件构造函数要求内部参数，继续尝试 Laya 原生文字组件。
    }
  }
  return null;
}

/** 热更新或重复初始化时只保留当前控制器登记的一个节点。 */
function removeDuplicateSecondsTexts(
  countdown: LayaDisplayNode,
  currentText: CountdownTextNode | undefined
): void {
  const children = Array.isArray(countdown._children) ? countdown._children : [];
  for (const child of children) {
    const candidate = child as CountdownTextNode;
    if (candidate === currentText) continue;
    if (candidate.__xiaochaoCountdownSeconds === true
      || candidate.name === 'xiaochao-countdown-seconds') {
      destroyTextNode(candidate);
    }
  }
}

function updateSecondsText(textNode: CountdownTextNode, remainValue: number): void {
  const value = Math.max(0, remainValue).toFixed(0);
  textNode.visible = true;
  if (textNode.__xiaochaoCountdownValue === value) return;
  textNode.__xiaochaoCountdownValue = value;
  if ('label' in textNode) textNode.label = value;
  else textNode.text = value;
}

function destroyTextNode(textNode: CountdownTextNode): void {
  try {
    textNode.removeSelf?.();
    textNode.destroy?.(true);
  } catch {
    // 游戏场景可能已先一步销毁该节点，清理保持幂等。
  }
}

function visitDisplayTree(root: LayaDisplayNode, visitor: (node: LayaDisplayNode) => void): void {
  const pending = [root];
  const visited = new Set<LayaDisplayNode>();
  while (pending.length > 0 && visited.size < 5000) {
    const node = pending.pop();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    visitor(node);

    if (Array.isArray(node._children)) {
      pending.push(...node._children);
      continue;
    }
    if (typeof node.numChildren !== 'number' || typeof node.getChildAt !== 'function') continue;
    for (let index = 0; index < node.numChildren; index += 1) {
      const child = node.getChildAt(index);
      if (child) pending.push(child);
    }
  }
}
