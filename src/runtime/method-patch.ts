export type PatchableFunction = (this: any, ...args: any[]) => any;

export interface MethodPatcher {
  /**
   * 包装 target[name] 当前的方法。同一对象同名方法只包装一次；
   * 包装链中已有其他实现（如 legacy 的补丁）时在其外层继续包装。
   */
  wrap(
    target: unknown,
    name: string,
    createWrapper: (original: PatchableFunction) => PatchableFunction
  ): boolean;
  /** 包装自有属性上的 getter，用于游戏的静态开关属性。 */
  wrapGetter(
    target: unknown,
    name: string,
    createGetter: (originalGet: () => unknown) => () => unknown
  ): boolean;
  isWrapped(target: unknown, name: string): boolean;
  restoreAll(): void;
}

/**
 * 对应原版 kD：原方法不写回游戏对象（原版存为 `__name`），而是保存在闭包里，
 * 以免与仍在运行的 legacy 补丁互相覆盖。恢复时若外层已被别人再次包装，
 * 则保留包装但让它直接透传原方法。
 */
export function createMethodPatcher(): MethodPatcher {
  const wrappedNames = new WeakMap<object, Set<string>>();
  const restores: Array<() => void> = [];

  function claim(target: object, name: string): boolean {
    let names = wrappedNames.get(target);
    if (names?.has(name)) return false;
    if (!names) {
      names = new Set();
      wrappedNames.set(target, names);
    }
    names.add(name);
    return true;
  }

  function release(target: object, name: string): void {
    wrappedNames.get(target)?.delete(name);
  }

  function isObjectLike(value: unknown): value is Record<string, unknown> {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
  }

  return {
    wrap(target, name, createWrapper) {
      if (!isObjectLike(target)) return false;
      const original = target[name];
      if (typeof original !== 'function') return false;
      if (!claim(target, name)) return false;
      const ownDescriptor = Object.getOwnPropertyDescriptor(target, name);
      const active = createWrapper(original as PatchableFunction);
      let restored = false;
      const wrapper: PatchableFunction = function (this: unknown, ...args: unknown[]) {
        return restored
          ? (original as PatchableFunction).apply(this, args)
          : active.apply(this, args);
      };
      try {
        Object.defineProperty(target, name, {
          value: wrapper,
          configurable: true,
          writable: true,
          enumerable: ownDescriptor?.enumerable ?? false
        });
      } catch {
        release(target, name);
        return false;
      }
      restores.push(() => {
        restored = true;
        release(target, name);
        if (target[name] !== wrapper) return;
        try {
          if (ownDescriptor) Object.defineProperty(target, name, ownDescriptor);
          else delete target[name];
        } catch {
          // 不可配置时保留透传包装。
        }
      });
      return true;
    },

    wrapGetter(target, name, createGetter) {
      if (!isObjectLike(target)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      const originalGet = descriptor?.get;
      if (!descriptor || typeof originalGet !== 'function') return false;
      if (!claim(target, name)) return false;
      // 原型上的 getter 由实例触发，originalGet 需以当次访问的实例为 this。
      let receiver: unknown = target;
      const active = createGetter(() => originalGet.call(receiver));
      let restored = false;
      const getter = function (this: unknown) {
        if (restored) return originalGet.call(this);
        const previous = receiver;
        receiver = this;
        try {
          return active();
        } finally {
          receiver = previous;
        }
      };
      try {
        Object.defineProperty(target, name, { ...descriptor, get: getter, configurable: true });
      } catch {
        release(target, name);
        return false;
      }
      restores.push(() => {
        restored = true;
        release(target, name);
        if (Object.getOwnPropertyDescriptor(target, name)?.get !== getter) return;
        try {
          Object.defineProperty(target, name, descriptor);
        } catch {
          // 不可配置时保留透传 getter。
        }
      });
      return true;
    },

    isWrapped(target, name) {
      return isObjectLike(target) && Boolean(wrappedNames.get(target)?.has(name));
    },

    restoreAll() {
      restores.splice(0).reverse().forEach((restore) => restore());
    }
  };
}
