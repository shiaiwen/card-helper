import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { TaskScope } from '../skin-background/skin-runtime.ts';

type UnknownRecord = Record<string, unknown>;

/**
 * 按类名创建游戏窗口 / 视图实例而不加到舞台，用来调用其业务方法（对照 app.bak 的 Za.get / Za.del）。
 * 同名实例复用，直到被释放。
 */
export interface AutoTaskWindows {
  /** args 为 null 时不调用 Init。 */
  get(name: string, args?: unknown): UnknownRecord | null;
  /** 释放实例：未挂到舞台时调用 Close()，否则仅丢弃引用；delay 毫秒后执行。 */
  release(name: string, delay?: number): void;
  /** 已打开的同名窗口。 */
  opened(name: string): UnknownRecord | null;
  /** 关闭已打开的同名窗口，之后再重试 retries 次。 */
  closeOpened(name: string, retries?: number, interval?: number): boolean;
  dispose(): void;
}

export function createAutoTaskWindows(
  globalObject: LayaRuntimeWindow,
  locator: LayaObjectLocator,
  tasks: TaskScope
): AutoTaskWindows {
  const instances = new Map<string, UnknownRecord>();
  const releaseTokens = new Map<string, number>();
  let tokenSeed = 0;

  function destroyInstance(name: string): void {
    const instance = instances.get(name);
    instances.delete(name);
    releaseTokens.delete(name);
    if (!instance || instance.parent) return;
    try {
      if (typeof instance.Close === 'function') (instance.Close as () => void)();
      else if (typeof instance.destroy === 'function') (instance.destroy as () => void)();
    } catch (error) {
      console.warn('[自动领取] 释放窗口失败:', name, error);
    }
  }

  function get(name: string, args?: unknown): UnknownRecord | null {
    const cached = instances.get(name);
    if (cached && !cached.destroyed) {
      releaseTokens.delete(name);
      return cached;
    }
    instances.delete(name);
    let instance: UnknownRecord | null = null;
    try {
      const classUtils = globalObject.Laya?.ClassUtils as { getInstance?: (name: string, args?: unknown) => unknown } | undefined;
      const created = classUtils?.getInstance?.(name, args);
      instance = created !== null && typeof created === 'object' ? created as UnknownRecord : null;
    } catch {
      return null;
    }
    if (!instance) return null;
    if (typeof instance.Init === 'function' && args !== null) {
      try {
        (instance.Init as () => void)();
      } catch (error) {
        console.warn('[自动领取] 窗口初始化失败:', name, error);
      }
    }
    instances.set(name, instance);
    return instance;
  }

  function release(name: string, delay = 0): void {
    if (!instances.has(name)) return;
    if (delay <= 0) {
      destroyInstance(name);
      return;
    }
    const token = ++tokenSeed;
    releaseTokens.set(name, token);
    tasks.later(() => {
      if (releaseTokens.get(name) === token) destroyInstance(name);
    }, delay);
  }

  function opened(name: string): UnknownRecord | null {
    return locator.window(name);
  }

  function closeOpened(name: string, retries = 0, interval = 500): boolean {
    let closed = false;
    const candidates = new Set<UnknownRecord>();
    const found = locator.window(name);
    if (found) candidates.add(found);
    locator.findWindows(name).forEach((item) => candidates.add(item));
    candidates.forEach((item) => {
      if (item.destroyed) return;
      try {
        if (typeof item.Close === 'function') (item.Close as () => void)();
        else if (typeof item.close === 'function') (item.close as () => void)();
        else if (typeof item.destroy === 'function') (item.destroy as (all: boolean) => void)(true);
        else return;
        closed = true;
      } catch (error) {
        console.warn('[自动领取] 关闭窗口失败:', name, error);
      }
    });
    if (retries > 0) tasks.later(() => closeOpened(name, retries - 1, interval), interval);
    return closed;
  }

  return {
    get,
    release,
    opened,
    closeOpened,
    dispose() {
      [...instances.keys()].forEach(destroyInstance);
    }
  };
}
