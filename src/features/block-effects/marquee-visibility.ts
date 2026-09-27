type UnknownRecord = Record<string, unknown>;

interface VisibilityGuard {
  ui: UnknownRecord;
  blocked: boolean;
  /** 游戏在屏蔽期间期望的可见状态，恢复时写回。 */
  requestedVisible: boolean;
  ownVisibleDescriptor?: PropertyDescriptor;
  visibleDescriptor?: PropertyDescriptor;
  ownRenderDescriptor?: PropertyDescriptor;
  fallback: boolean;
}

const GUARD_KEY = '__xcSystemNoticeVisibilityGuard';

/**
 * 顶部跑马灯（狗托弹幕）屏蔽：接管 UI 的 visible 与 Laya 渲染用的 _visible，
 * 屏蔽期间游戏仍可正常设置可见性，但实际始终不绘制。
 */
export function createMarqueeVisibilityBlocker() {
  const guards = new Set<VisibilityGuard>();

  function hide(ui: UnknownRecord): boolean {
    if (ui.destroyed) return false;
    const existing = ui[GUARD_KEY] as VisibilityGuard | undefined;
    if (existing) {
      existing.blocked = true;
      repaint(ui);
      return true;
    }
    const ownVisible = Object.getOwnPropertyDescriptor(ui, 'visible');
    const visible = ownVisible ?? findDescriptor(Object.getPrototypeOf(ui), 'visible');
    const ownRender = Object.getOwnPropertyDescriptor(ui, '_visible');
    const readVisible = typeof visible?.get === 'function'
      ? () => visible.get!.call(ui)
      : () => (ownVisible && 'value' in ownVisible ? ownVisible.value : ui._visible);
    const writeVisible = typeof visible?.set === 'function'
      ? (value: boolean) => visible.set!.call(ui, value)
      : null;
    const guard: VisibilityGuard = {
      ui,
      blocked: true,
      requestedVisible: typeof ui._visible === 'boolean' ? ui._visible : readVisible() !== false,
      ownVisibleDescriptor: ownVisible,
      visibleDescriptor: visible ?? undefined,
      ownRenderDescriptor: ownRender,
      fallback: false
    };
    try {
      Object.defineProperty(ui, GUARD_KEY, { configurable: true, value: guard });
      if (!ownRender?.configurable || !('value' in ownRender)) throw new Error('_visible 渲染字段不可接管');
      const guardedGet = function (this: UnknownRecord) {
        const current = this[GUARD_KEY] as VisibilityGuard | undefined;
        return current?.blocked ? false : Boolean(current?.requestedVisible);
      };
      Object.defineProperty(ui, '_visible', {
        configurable: true,
        enumerable: ownRender.enumerable,
        get: guardedGet,
        set(this: UnknownRecord, value: unknown) {
          const current = this[GUARD_KEY] as VisibilityGuard | undefined;
          if (current) current.requestedVisible = Boolean(value);
        }
      });
      Object.defineProperty(ui, 'visible', {
        configurable: true,
        enumerable: ownVisible?.enumerable ?? false,
        get: guardedGet,
        set(this: UnknownRecord, value: unknown) {
          const current = this[GUARD_KEY] as VisibilityGuard | undefined;
          if (!current) return;
          current.requestedVisible = Boolean(value);
          if (!current.blocked && writeVisible) writeVisible(Boolean(value));
        }
      });
      guards.add(guard);
      repaint(ui);
      return true;
    } catch {
      guard.fallback = true;
      try {
        if (ownRender) Object.defineProperty(ui, '_visible', ownRender);
        if (ownVisible) Object.defineProperty(ui, 'visible', ownVisible);
        else delete ui.visible;
        delete ui[GUARD_KEY];
        ui.visible = false;
        if ('_visible' in ui) ui._visible = false;
        guards.add(guard);
        return true;
      } catch (error) {
        console.warn('[屏蔽设置] 隐藏顶部广播失败', error);
        return false;
      }
    }
  }

  function restore(guard: VisibilityGuard): boolean {
    guards.delete(guard);
    const { ui } = guard;
    if (ui.destroyed) return false;
    const visible = guard.requestedVisible;
    try {
      if (guard.fallback) {
        ui.visible = visible;
        if ('_visible' in ui) ui._visible = visible;
        return true;
      }
      Object.defineProperty(ui, '_visible', { ...guard.ownRenderDescriptor, value: visible });
      const own = guard.ownVisibleDescriptor;
      if (own) Object.defineProperty(ui, 'visible', 'value' in own ? { ...own, value: visible } : own);
      else delete ui.visible;
      delete ui[GUARD_KEY];
      if (!own && typeof guard.visibleDescriptor?.set === 'function') guard.visibleDescriptor.set.call(ui, visible);
      repaint(ui);
      return true;
    } catch (error) {
      console.warn('[屏蔽设置] 恢复顶部广播失败', error);
      return false;
    }
  }

  /** 按开关同步：关闭或 UI 已销毁时恢复，开启时隐藏当前全部跑马灯 UI。 */
  function sync(uis: UnknownRecord[], blocked: boolean): void {
    Array.from(guards).forEach((guard) => {
      if (guard.ui.destroyed || !blocked) restore(guard);
    });
    if (blocked) uis.forEach(hide);
  }

  function restoreAll(): void {
    Array.from(guards).forEach(restore);
  }

  return { sync, restoreAll };
}

/** 跑马灯管理器上的全部跑马灯 UI（单条、列表、活动列表）。 */
export function collectMarqueeUis(manager: UnknownRecord): UnknownRecord[] {
  const candidates = [manager.marqueeUI, ...listItems(manager.marqueeUIList), ...listItems(manager.marqueeUIActList)];
  return Array.from(new Set(candidates.filter(
    (ui): ui is UnknownRecord => Boolean(ui) && typeof ui === 'object' && !(ui as UnknownRecord).destroyed
  )));
}

/** 兼容数组与 Laya 的几种列表/字典容器。 */
function listItems(list: unknown): unknown[] {
  try {
    if (Array.isArray(list)) return list.filter((item) => item != null);
    const record = list && typeof list === 'object' ? list as UnknownRecord : null;
    if (!record) return [];
    if (Array.isArray(record.datum)) return record.datum.filter((item) => item != null);
    if (Array.isArray(record._objDatum) && record._objDatum.length) return record._objDatum.filter((item) => item != null);
    if (record._maps && typeof record._maps === 'object') {
      return Object.values(record._maps as UnknownRecord).flat().filter((item) => item != null);
    }
  } catch {
    // 容器结构异常时视为空。
  }
  return [];
}

function findDescriptor(target: unknown, name: string): PropertyDescriptor | undefined {
  for (let current = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function repaint(ui: UnknownRecord): void {
  if (typeof ui.repaint === 'function') (ui.repaint as () => void).call(ui);
}
