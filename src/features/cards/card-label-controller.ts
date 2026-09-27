import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

interface PatchedCardPrototype {
  prototype: UnknownRecord;
  originalDescriptor: PropertyDescriptor;
  patchedMethod: (...args: unknown[]) => unknown;
}

/**
 * 独立接管原版“卡牌标签”功能。
 * 原逻辑只把自己手牌中的“炁”切换为第二标签样式；其他标签继续走游戏默认方法。
 */
export function installCardLabelController(
  configStore: XiaochaoConfigStore,
  globalObject: GameRuntimeWindow = window
): () => void {
  let enabled = configStore.get('display.cardLabelsEnabled');
  const patches = new Set<PatchedCardPrototype>();

  const refresh = () => {
    const cardUIs = findSelfHandCardUIs(globalObject);
    cardUIs.forEach(installPrototypePatch);
    cardUIs.forEach(refreshCardTag);
  };
  const unsubscribe = configStore.subscribe('display.cardLabelsEnabled', ({ value }) => {
    enabled = value;
    refresh();
  });
  refresh();
  const intervalId = globalObject.setInterval(refresh, 1000);

  return () => {
    unsubscribe();
    globalObject.clearInterval(intervalId);
    for (const patch of patches) {
      const current = Object.getOwnPropertyDescriptor(patch.prototype, 'AddCardTag');
      if (current?.value !== patch.patchedMethod) continue;
      try { Object.defineProperty(patch.prototype, 'AddCardTag', patch.originalDescriptor); } catch { /* 游戏退出时对象可能已冻结。 */ }
    }
    patches.clear();
  };

  function installPrototypePatch(cardUI: UnknownRecord): void {
    let prototype = Object.getPrototypeOf(cardUI) as UnknownRecord | null;
    while (prototype && !Object.prototype.hasOwnProperty.call(prototype, 'AddCardTag')) {
      prototype = Object.getPrototypeOf(prototype) as UnknownRecord | null;
    }
    if (!prototype || patchesHasPrototype(patches, prototype)) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'AddCardTag');
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const patchedMethod = function (this: UnknownRecord, ...args: unknown[]) {
      const label = String(args[0] ?? '');
      const methodName = enabled && label === '炁' ? 'AddCardTag2' : '__AddCardTag';
      const method = this[methodName];
      return typeof method === 'function'
        ? method.apply(this, args)
        : descriptor.value.apply(this, args);
    };
    try {
      Object.defineProperty(prototype, 'AddCardTag', { ...descriptor, value: patchedMethod });
      patches.add({ prototype, originalDescriptor: descriptor, patchedMethod });
    } catch {
      // 不可写版本保持游戏默认行为，不影响其他模块启动。
    }
  }
}

function findSelfHandCardUIs(globalObject: GameRuntimeWindow): UnknownRecord[] {
  const scene = locateGameScene(globalObject) as UnknownRecord | null;
  const selfSeatUI = asRecord(scene?.SelfSeatUi);
  const container = asRecord(selfSeatUI?.cardContainer);
  if (!container) return [];
  for (const key of ['cardUis', 'cardUIs', 'handCardUis', 'handCardUIs']) {
    if (Array.isArray(container[key])) return container[key].map(asRecord).filter(isRecord);
  }
  return [];
}

function refreshCardTag(cardUI: UnknownRecord): void {
  for (const methodName of ['UpdateTag', 'updateTag']) {
    const method = cardUI[methodName];
    if (typeof method !== 'function') continue;
    try { method.call(cardUI); } catch { /* 单张 UI 刷新失败时等待下一轮。 */ }
    return;
  }
}

function patchesHasPrototype(patches: Set<PatchedCardPrototype>, prototype: UnknownRecord): boolean {
  for (const patch of patches) if (patch.prototype === prototype) return true;
  return false;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function isRecord(value: UnknownRecord | null): value is UnknownRecord {
  return value !== null;
}
