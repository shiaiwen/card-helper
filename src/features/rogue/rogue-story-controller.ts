/**
 * 山河剧情隐藏：按设置跳过/关闭剧情相关窗口与流程。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { ROGUE_HIDE_STORY_KEY } from './rogue-settings.ts';

const STORY_WINDOW = 'RogueChapterStoryWindow';
/** 运行时自检用假窗名：走与真对白相同的 Close 路径，不调游戏 ShowWindow 原实现。 */
const STORY_PROBE_WINDOW = '__XIAOCHAO_STORY_PROBE__';
const STORY_READY_FLAG = '__XIAOCHAO_ROGUE_STORY_READY__';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function closeWindow(win: UnknownRecord | null | undefined): boolean {
  if (!win || win.destroyed) return false;
  try {
    if (typeof win.Close === 'function') {
      (win.Close as Function).call(win);
      return true;
    }
    if (typeof win.close === 'function') {
      (win.close as Function).call(win);
      return true;
    }
  } catch (error) {
    console.warn('[山河图] 关闭对白失败', error);
  }
  return false;
}

function markStoryReady(globalObject: LayaRuntimeWindow, ready: boolean): void {
  try {
    (globalObject as UnknownRecord)[STORY_READY_FLAG] = ready;
  } catch {
    // 忽略只读全局。
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as PromiseLike<unknown>).then === 'function';
}

export interface RogueStoryController {
  dispose(): void;
}

export interface RogueStoryOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
}

/**
 * 隐藏对白：`ShowWindow("RogueChapterStoryWindow")` 后
 * 若 `rogue.hideStory` 开启则 `Close`；关闭时原样返回，对白正常显示。
 * 只认 configStore，不读写 XC / 旧 DOM / 旧存储键。
 */
export function installRogueStoryController(
  configStore: XiaochaoConfigStore,
  options: RogueStoryOptions = {}
): RogueStoryController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let patched = false;

  const isOn = () => configStore.get(ROGUE_HIDE_STORY_KEY) === true;

  function later(callback: () => void, delay = 0): void {
    if (disposed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
  }

  function poll<T>(probe: () => T | null | undefined | false, retries = 40, interval = 500): Promise<T | null> {
    return new Promise((resolve) => {
      const attempt = (remaining: number) => {
        if (disposed) return resolve(null);
        let value: T | null | undefined | false = null;
        try {
          value = probe();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (remaining <= 0) return resolve(null);
        later(() => attempt(remaining - 1), interval);
      };
      attempt(retries);
    });
  }

  function closeStoryWindows(): void {
    if (!isOn()) return;
    const windows = new Set(
      [locator.window(STORY_WINDOW), ...locator.findWindows(STORY_WINDOW)].filter(Boolean)
    );
    windows.forEach((win) => closeWindow(asRecord(win)));
  }

  function closeAfterShow(result: unknown): void {
    if (!isOn()) return;
    const settle = (win: unknown) => {
      if (!isOn()) return;
      if (!closeWindow(asRecord(win))) later(closeStoryWindows);
      else later(closeStoryWindows);
    };
    if (isThenable(result)) {
      void Promise.resolve(result).then(settle, () => later(closeStoryWindows));
      return;
    }
    settle(result);
  }

  function tryPatchDispatcher(): boolean {
    if (patched || disposed) return patched;
    const dispatcher = locator.dispatcher();
    if (!dispatcher) return false;
    const showWindowName = locator.obfuscatedMethodName(
      dispatcher,
      'GameEventDispatcher',
      'ShowWindow'
    ) ?? 'ShowWindow';
    if (typeof dispatcher[showWindowName] !== 'function') return false;
    patched = patcher.wrap(dispatcher, showWindowName, (original) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
      if (windowName === STORY_PROBE_WINDOW) {
        const probeWin: UnknownRecord = {
          destroyed: false,
          Close() {
            probeWin.destroyed = true;
            probeWin.__probeClosed = true;
          }
        };
        if (isOn()) closeWindow(probeWin);
        return probeWin;
      }
      const result = original.call(this, windowName, ...rest);
      if (windowName !== STORY_WINDOW) return result;
      if (isOn()) closeAfterShow(result);
      return result;
    });
    if (patched) {
      markStoryReady(globalObject, true);
      if (isOn()) closeStoryWindows();
    }
    return patched;
  }

  if (!tryPatchDispatcher()) {
    void poll(() => (tryPatchDispatcher() ? true : null)).then(() => {
      if (!patched && !disposed) {
        console.warn('[山河图] 隐藏对白未挂上 ShowWindow');
      }
    });
  }

  const unsubscribe = configStore.subscribe(ROGUE_HIDE_STORY_KEY, ({ value }) => {
    if (value) closeStoryWindows();
  });

  return {
    dispose() {
      disposed = true;
      markStoryReady(globalObject, false);
      unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      patcher.restoreAll();
    }
  };
}
