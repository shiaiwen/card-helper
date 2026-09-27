import type { GameSceneSeatSource } from './seat-game-adapter.ts';

type UnknownRecord = Record<string, unknown>;

export interface GameRuntimeWindow extends Window {
  Laya?: {
    ClassUtils?: {
      getInstance?: (className: string, args?: unknown) => unknown;
      getClass?: (className: string) => unknown;
    };
  };
  /** 调试和未来平台适配使用的显式只读入口，优先级高于自动发现。 */
  __XIAOCHAO_GAME_SCENE__?: unknown;
}

/**
 * 定位当前游戏场景。仅检查 SceneManager 附近两层对象，不扫描整个 window，
 * 避免读取无关 getter 或给游戏主线程造成额外负担。
 */
export function locateGameScene(globalObject: GameRuntimeWindow): GameSceneSeatSource | null {
  if (isGameScene(globalObject.__XIAOCHAO_GAME_SCENE__)) {
    return globalObject.__XIAOCHAO_GAME_SCENE__;
  }
  const sceneManager = locateSceneManager(globalObject);
  if (!sceneManager || !sceneManager.IsGameScene) return null;
  return findGameSceneNear(sceneManager.CurrentScene, 1);
}

let cachedSceneManager: UnknownRecord | null = null;
let cachedDispatcher: UnknownRecord | null = null;
let nextDispatcherLookupAt = 0;
const DISPATCHER_RETRY_MS = 3000;

/**
 * SceneManager 没有以类名注册到 Laya，不能直接 getInstance。
 * 它订阅了 GameEventDispatcher 的 SWITCH_SCENE，从监听者的 caller 取回单例；
 * GameEventDispatcher 则由任意 PopUpWindow 的 ged 暴露。
 */
export function locateSceneManager(globalObject: GameRuntimeWindow): UnknownRecord | null {
  if (cachedSceneManager && 'CurrentScene' in cachedSceneManager) return cachedSceneManager;
  cachedSceneManager = null;
  locateGameEventDispatcher(globalObject);
  const events = cachedDispatcher && isRecord(cachedDispatcher._events) ? cachedDispatcher._events : null;
  const listeners = events?.SWITCH_SCENE;
  for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
    const caller = isRecord(listener) ? listener.caller : null;
    if (isRecord(caller) && 'CurrentScene' in caller) {
      cachedSceneManager = caller;
      return caller;
    }
  }
  return null;
}

export function locateGameEventDispatcher(globalObject: GameRuntimeWindow): UnknownRecord | null {
  if (!cachedDispatcher && Date.now() >= nextDispatcherLookupAt) {
    const dispatcher = readGameEventDispatcher(globalObject);
    if (isRecord(dispatcher)) cachedDispatcher = dispatcher;
    else nextDispatcherLookupAt = Date.now() + DISPATCHER_RETRY_MS;
  }
  return cachedDispatcher;
}

function readGameEventDispatcher(globalObject: GameRuntimeWindow): unknown {
  const classUtils = globalObject.Laya?.ClassUtils;
  try {
    const PopUpWindow = classUtils?.getClass?.('PopUpWindow') as { prototype?: object } | undefined;
    const prototype = PopUpWindow?.prototype;
    // 优先走原型 getter，避免为了读单例而创建弹窗实例。
    for (let proto = prototype; proto; proto = Object.getPrototypeOf(proto)) {
      const getter = Object.getOwnPropertyDescriptor(proto, 'ged')?.get;
      if (getter) {
        const dispatcher = getter.call(Object.create(prototype!));
        if (dispatcher) return dispatcher;
        break;
      }
    }
  } catch {
    // getter 依赖实例字段时回退到创建实例。
  }
  try {
    const popup = classUtils?.getInstance?.('PopUpWindow', null) as UnknownRecord | undefined;
    const dispatcher = popup?.ged;
    try { (popup?.destroy as (() => void) | undefined)?.call(popup); } catch { /* 仅用于取单例 */ }
    return dispatcher;
  } catch {
    return null;
  }
}

/** 实机排查用：说明场景查找停在哪一步，只读取键名不读取游戏对象内容。 */
export function describeGameSceneLookup(globalObject: GameRuntimeWindow): Record<string, unknown> {
  const classUtils = globalObject.Laya?.ClassUtils;
  const sceneManager = locateSceneManager(globalObject);
  const currentScene = sceneManager?.CurrentScene;
  return {
    hasLaya: Boolean(globalObject.Laya),
    hasGetClass: typeof classUtils?.getClass === 'function',
    hasPopUpWindowClass: Boolean(classUtils?.getClass?.('PopUpWindow')),
    dispatcherFound: Boolean(cachedDispatcher),
    switchSceneListenerCount: (() => {
      const listeners = isRecord(cachedDispatcher?._events) ? cachedDispatcher._events.SWITCH_SCENE : null;
      return Array.isArray(listeners) ? listeners.length : listeners ? 1 : 0;
    })(),
    sceneManagerFound: Boolean(sceneManager),
    isGameScene: sceneManager ? Boolean(sceneManager.IsGameScene) : null,
    currentSceneKeys: isRecord(currentScene) ? Object.keys(currentScene).slice(0, 40) : null,
    sceneFound: Boolean(locateGameScene(globalObject))
  };
}

export function findGameSceneNear(candidate: unknown, remainingDepth = 2): GameSceneSeatSource | null {
  if (isGameScene(candidate)) return candidate;
  if (remainingDepth <= 0 || !isRecord(candidate)) return null;

  for (const key of Object.keys(candidate)) {
    let child: unknown;
    try {
      child = candidate[key];
    } catch {
      continue;
    }
    if (!isRecord(child)) continue;
    const found = findGameSceneNear(child, remainingDepth - 1);
    if (found) return found;
  }
  return null;
}

function isGameScene(candidate: unknown): candidate is GameSceneSeatSource {
  if (!isRecord(candidate) || !isRecord(candidate.seatContainer)) return false;
  return Array.isArray(candidate.seatContainer.seatUIs);
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object';
}
