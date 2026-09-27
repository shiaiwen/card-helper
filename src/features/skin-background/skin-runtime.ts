import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import type { MethodPatcher } from '../../runtime/method-patch.ts';

export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

export function callMethod(target: unknown, name: string, ...args: unknown[]): unknown {
  const record = asRecord(target);
  const method = record?.[name];
  return typeof method === 'function' ? method.apply(record, args) : undefined;
}

export function prototypeOf(target: unknown): UnknownRecord | null {
  const record = asRecord(target);
  return asRecord(record ? Object.getPrototypeOf(record) : null)
    ?? asRecord(asRecord(record?.constructor)?.prototype);
}

const TRACE_LIMIT = 300;

/** 实机诊断：记录到页面全局缓冲，开发版主进程定时取走写入 .dev-data/skin-trace.log。 */
export function skinTrace(kind: string, detail: Record<string, unknown> = {}): void {
  try {
    const host = globalThis as unknown as { __XIAOCHAO_SKIN_TRACE__?: unknown[] };
    const buffer = Array.isArray(host.__XIAOCHAO_SKIN_TRACE__) ? host.__XIAOCHAO_SKIN_TRACE__ : [];
    host.__XIAOCHAO_SKIN_TRACE__ = buffer;
    buffer.push({ time: Date.now(), kind, detail });
    if (buffer.length > TRACE_LIMIT) buffer.splice(0, buffer.length - TRACE_LIMIT);
  } catch {
    // 诊断失败不影响功能。
  }
}

export function readJson<T>(storage: Pick<Storage, 'getItem'> | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(storage: Pick<Storage, 'setItem'> | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // 存储满或不可用时放弃本次保存。
  }
}

/** 当前登录账号，用作按账号区分的本地存储前缀。 */
export function accountStorageKey(storage: Pick<Storage, 'getItem'> | undefined): string {
  return storage?.getItem('LastUserName')
    || storage?.getItem('SGS_LASTLOGIN_ACCOUNT')
    || storage?.getItem('SGS_LASTLOGIN_ACCOUNT1')
    || 'default';
}

/** 定时任务作用域：控制器销毁后所有回调自动失效。 */
export interface TaskScope {
  readonly disposed: boolean;
  later(callback: () => void, delay: number): void;
  poll<T>(probe: () => T | null | undefined | false, retries: number, interval: number): Promise<T | null>;
  dispose(): void;
}

export function createTaskScope(): TaskScope {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  function later(callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
  }

  return {
    get disposed() {
      return disposed;
    },
    later,
    poll(probe, retries, interval) {
      return new Promise((resolve) => {
        const attempt = (remaining: number) => {
          if (disposed) return resolve(null);
          let value = null as ReturnType<typeof probe>;
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
    },
    dispose() {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    }
  };
}

/** 游戏打开指定窗口后回调（包装 GameEventDispatcher.ShowWindow）。 */
export function watchWindowShow(
  locator: LayaObjectLocator,
  patcher: MethodPatcher,
  tasks: TaskScope,
  windowNames: readonly string[],
  onShow: (windowName: string, args: unknown[]) => void
): void {
  void tasks.poll(() => {
    const dispatcher = locator.dispatcher();
    const methodName = dispatcher ? locator.obfuscatedMethodName(dispatcher, 'GameEventDispatcher', 'ShowWindow') : null;
    return dispatcher && methodName ? { dispatcher, methodName } : null;
  }, Infinity, 1000).then((found) => {
    if (!found) return;
    patcher.wrap(found.dispatcher, found.methodName, (original) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
      const result = original.call(this, windowName, ...rest);
      if (typeof windowName === 'string' && windowNames.includes(windowName)) {
        try {
          onShow(windowName, rest);
        } catch (error) {
          console.warn('[皮肤与背景] 窗口处理失败:', windowName, error);
        }
      }
      return result;
    });
  });
}

/** 场景切换完成后回调（包装 SceneManager.executeSwitchScene，回调延后一拍以等新场景初始化）。 */
export function watchSceneSwitch(
  locator: LayaObjectLocator,
  patcher: MethodPatcher,
  tasks: TaskScope,
  onSwitch: () => void
): void {
  void tasks.poll(() => {
    const listeners = asRecord(locator.dispatcher()?._events)?.SWITCH_SCENE;
    for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (caller && typeof caller.executeSwitchScene === 'function') return caller;
    }
    return null;
  }, Infinity, 1000).then((sceneManager) => {
    patcher.wrap(sceneManager, 'executeSwitchScene', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      tasks.later(() => {
        try {
          onSwitch();
        } catch (error) {
          console.warn('[皮肤与背景] 场景切换处理失败:', error);
        }
      }, 0);
      return result;
    });
  });
}

/** 座位上主将 / 副将的武将与皮肤信息（对照 app.bak 的 Yy）。 */
export interface SeatGeneralInfo {
  seat: UnknownRecord;
  isZhu: boolean;
  general: UnknownRecord;
  generalID: number;
  skinID: number;
  isDynamic: boolean;
  skinType: number;
}

export function seatGeneral(seat: unknown, isZhu = true): SeatGeneralInfo | null {
  const record = asRecord(seat);
  if (!record) return null;
  const general = asRecord(isZhu ? record.General ?? record.general : record.General2 ?? record.general2);
  const generalID = Number(isZhu
    ? record.GeneralId ?? record.generalID ?? general?.GeneralId ?? general?.CardId
    : record.General2Id ?? record.general2ID ?? general?.GeneralId ?? general?.CardId);
  if (!(generalID > 0) || !general || general.IsShibing) return null;
  const skinID = isZhu ? record.SkinID ?? general.SkinID : record.Skin2ID ?? general.SkinID;
  const skinType = isZhu ? general.DySkinType ?? record.DySkinType : general.DySkinType ?? record.DySkinType2;
  return {
    seat: record,
    isZhu,
    general,
    generalID,
    skinID: Number(skinID) || 0,
    isDynamic: Boolean(general.IsDynamic),
    skinType: Number(skinType) || 1
  };
}

/** 座位是否持有该武将（含皮肤映射的武将 ID）。 */
export function seatHoldsGeneral(seat: UnknownRecord, info: SeatGeneralInfo, generalID: number): boolean {
  if (info.generalID === generalID) return true;
  try {
    return typeof seat.inSkinGeneralId === 'function'
      && Boolean((seat.inSkinGeneralId as (a: number, b: number) => unknown).call(seat, info.generalID, generalID));
  } catch {
    return false;
  }
}

/** 皮肤详情 / 换肤项是否支持动态（对照 app.bak 的 GM）。 */
export function supportsDynamicSkin(item: UnknownRecord): boolean {
  if (item.dynamicState) return true;
  const data = asRecord(item.skinData);
  try {
    if (typeof data?.canUpdateDynamic === 'function' && (data.canUpdateDynamic as () => unknown).call(data)) return true;
  } catch {
    // 忽略游戏数据异常。
  }
  return Boolean(data?.CanUpdate || data?.IsSkillEffect || data?.IsDynamic || Number(data?.ResType) > 0
    || data?.DynamicSkinBigSkeletonUrl || data?.DynamicSkinBigUrl);
}
