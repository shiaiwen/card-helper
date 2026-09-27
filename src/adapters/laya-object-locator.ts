import {
  locateGameEventDispatcher,
  locateSceneManager,
  type GameRuntimeWindow
} from '../features/seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

export interface LayaRuntimeWindow extends GameRuntimeWindow {
  GameContext?: unknown;
  Laya?: GameRuntimeWindow['Laya'] & {
    stage?: unknown;
    Browser?: { window?: { GameContext?: unknown } };
    timer?: { once?: (delay: number, caller: unknown, callback: () => void) => void };
    Event?: { STOPPED?: string };
  };
}

/**
 * 游戏管理器没有注册到 Laya 类表；它们订阅了某个分发器的事件，
 * 从监听者的 caller 取回单例。格式：[事件名, 分发器, 单例上必有的键]。
 */
const MANAGER_LOOKUPS: Record<string, readonly [string, string?, string?]> = {
  ActivityManager: ['ClientJDInfoNtf'],
  ChatSysNewsManager: ['decodeSSCChatmsgNtf', 'ServerProxy', 'timeOutNoticeId'],
  RogueLikePveManager: ['decodeRogueLikeDataSync'],
  TaskRedDotManager: ['EXCHANGE_RED_VIEW_FIRST_UPDATE', 'ActivityManager'],
  UserInfoManger: ['ClientTTRankInfoRep'],
  WindowManager: ['HIDE_WINDOW', 'GameEventDispatcher']
};

/** 混淆后的方法名按函数源码中的特征文本恢复。 */
const METHOD_SIGNATURES: Record<string, Record<string, string>> = {
  GameEventDispatcher: { ShowWindow: '弹窗被功能关闭拦截' }
};

const LAYER_ORDER = [
  'BottomLayer',
  'BackgroundLayer',
  'SceneLayer',
  'AnimationLayer',
  'WindowLayer',
  'TopUILayer',
  'PromptLayer'
];

export interface LayaObjectLocator {
  manager(name: string): UnknownRecord | null;
  dispatcher(): UnknownRecord | null;
  scene(): UnknownRecord | null;
  gameScene(): UnknownRecord | null;
  gameContext(): UnknownRecord | null;
  baseEffectPrototype(): UnknownRecord | null;
  classPrototype(className: string): UnknownRecord | null;
  window(name: string): UnknownRecord | null;
  findWindows(name: string): UnknownRecord[];
  findInLayer(layerName: string, name: string): UnknownRecord[];
  managerFromList(predicate: (manager: UnknownRecord) => boolean): UnknownRecord | null;
  obfuscatedMethodName(target: unknown, owner: string, method: string): string | null;
}

/** 对应原版 zy 的只读部分；不创建游戏实例，只从已有对象上取引用。 */
export function createLayaObjectLocator(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): LayaObjectLocator {
  const managers = new Map<string, UnknownRecord>();

  function dispatcher(): UnknownRecord | null {
    return locateGameEventDispatcher(globalObject);
  }

  function manager(name: string): UnknownRecord | null {
    const cached = managers.get(name);
    if (cached) return cached;
    const found = name === 'ServerProxy'
      ? asRecord(manager('WindowManager')?.proxy)
      : name === 'GameEventDispatcher'
        ? dispatcher()
        : findManagerByCaller(name);
    if (found) managers.set(name, found);
    return found;
  }

  function findManagerByCaller(name: string): UnknownRecord | null {
    const lookup = MANAGER_LOOKUPS[name];
    if (!lookup) return null;
    const [eventName, dispatcherName = 'ServerProxy', requiredKey] = lookup;
    const source = manager(dispatcherName);
    const listeners = asRecord(source?._events)?.[eventName];
    for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (caller && (!requiredKey || requiredKey in caller)) return caller;
    }
    return null;
  }

  function managerFromList(predicate: (manager: UnknownRecord) => boolean): UnknownRecord | null {
    const windowManager = manager('WindowManager');
    const list = asRecord(windowManager?.constructor)?.managerList;
    if (!Array.isArray(list)) return null;
    for (const item of list) {
      const record = asRecord(item);
      if (record && predicate(record)) return record;
    }
    return null;
  }

  function scene(): UnknownRecord | null {
    return asRecord(locateSceneManager(globalObject)?.CurrentScene);
  }

  function gameScene(): UnknownRecord | null {
    return locateSceneManager(globalObject)?.IsGameScene ? scene() : null;
  }

  function gameContext(): UnknownRecord | null {
    const candidates = [
      globalObject.GameContext,
      globalObject.Laya?.Browser?.window?.GameContext
    ];
    for (const candidate of candidates) {
      const record = asRecord(candidate);
      if (typeof record?.GetModeVO === 'function' || typeof record?.CanOperationInGame === 'function') {
        return record;
      }
    }
    return null;
  }

  /**
   * 原版在局内用 SelfSeatUi.getEffectType(2) 取 BaseEffect；大厅没有座位时
   * 改为在显示树中找一个已有特效节点，不创建任何游戏窗口。
   */
  function baseEffectPrototype(): UnknownRecord | null {
    const selfSeatUi = asRecord(gameScene()?.SelfSeatUi);
    const getEffectType = selfSeatUi?.getEffectType;
    if (typeof getEffectType === 'function') {
      try {
        const owner = effectMethodOwner(asRecord(getEffectType.call(selfSeatUi, 2)));
        if (owner) return owner;
      } catch {
        // 回退到显示树查找。
      }
    }
    const queue = children(asRecord(globalObject.Laya?.stage) ?? {});
    for (let index = 0; index < queue.length && index < BASE_EFFECT_SCAN_LIMIT; index += 1) {
      const owner = effectMethodOwner(queue[index], true);
      if (owner) return owner;
      queue.push(...children(queue[index]));
    }
    return null;
  }

  function classPrototype(className: string): UnknownRecord | null {
    try {
      const constructor = globalObject.Laya?.ClassUtils?.getClass?.(className) as { prototype?: unknown } | undefined;
      return asRecord(constructor?.prototype);
    } catch {
      return null;
    }
  }

  function findInLayer(layerName: string, name: string): UnknownRecord[] {
    const stage = asRecord(globalObject.Laya?.stage);
    if (!stage) return [];
    const layers = children(stage).filter((child) => child.layerOrder === LAYER_ORDER.indexOf(layerName));
    return layers.flatMap((layer) => children(layer).filter((child) => (
      child.name === name || child.sceneName === name || asRecord(child.constructor)?.name === name
    )));
  }

  function findWindows(name: string): UnknownRecord[] {
    return findInLayer('WindowLayer', name);
  }

  function findWindow(name: string): UnknownRecord | null {
    const dict = asRecord(manager('WindowManager')?.WindowInstanceDict);
    const get = dict?.get;
    if (typeof get === 'function') {
      const found = asRecord(get.call(dict, name));
      if (found) return found;
    }
    return findWindows(name)[0] ?? null;
  }

  function obfuscatedMethodName(target: unknown, owner: string, method: string): string | null {
    const signature = METHOD_SIGNATURES[owner]?.[method];
    const record = asRecord(target);
    if (!signature || !record) return null;
    const prototype = Object.getPrototypeOf(record) ?? asRecord(record.constructor)?.prototype;
    if (!prototype) return null;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') continue;
      // legacy 包装后原方法挪到 `__name`，迁移期需一并检查。
      for (const lookupKey of [key, `__${key}`]) {
        let candidate: unknown;
        try {
          candidate = record[lookupKey];
        } catch {
          continue;
        }
        if (typeof candidate === 'function' && Function.prototype.toString.call(candidate).includes(signature)) {
          return key;
        }
      }
    }
    return null;
  }

  return {
    manager,
    dispatcher,
    scene,
    gameScene,
    gameContext,
    baseEffectPrototype,
    classPrototype,
    window: findWindow,
    findWindows,
    findInLayer,
    managerFromList,
    obfuscatedMethodName
  };
}

const BASE_EFFECT_SCAN_LIMIT = 3000;

/** 返回原型链上自有 InitEffect/playEffect 的那一层，即 BaseEffect.prototype。 */
function effectMethodOwner(node: UnknownRecord | null, requireEffectUrl = false): UnknownRecord | null {
  if (!node || (requireEffectUrl && !('effectUrl' in node))) return null;
  for (let proto = Object.getPrototypeOf(node); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    if (Object.prototype.hasOwnProperty.call(proto, 'InitEffect') && typeof proto.playEffect === 'function') {
      return proto as UnknownRecord;
    }
  }
  return null;
}

function children(node: UnknownRecord): UnknownRecord[] {
  const list = node._children;
  return Array.isArray(list) ? list.map(asRecord).filter((child): child is UnknownRecord => child !== null) : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}
