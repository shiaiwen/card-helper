import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import type { RoguePlotMeta } from './rogue-map-types.ts';

type UnknownRecord = Record<string, unknown>;

/** 对照 app.bak `openStore` → `GameEventDispatcher.ShowWindow("RogueJiShiWindow")`。 */
export const ROGUE_SHOP_WINDOW = 'RogueJiShiWindow';

/**
 * 对照 app.bak `MX` / `RogueLikeDataReq`：集市同步缺 shopData 时请求完整山河数据。
 * `0x3f` 为原版默认 dataMark 掩码。
 */
export const ROGUE_SHOP_DATA_REQ_MARK = 0x3f;

/** 对照 app.bak `c9`：商品 type → 标题前缀。 */
export const ROGUE_SHOP_TYPE_LABELS: Readonly<Record<number, string>> = Object.freeze({
  2: '战法',
  3: '技能',
  4: '手牌',
  5: '装备'
});

export interface RogueShopPreviewItem {
  id: string;
  label: string;
  title: string;
  level: number;
}

export type RogueShopPreviewListener = (items: readonly RogueShopPreviewItem[]) => void;

export interface RogueShopController {
  /** 打开山河图集市窗口，并启用集市透视（强制 shopData.bShow）。 */
  openShop(): boolean;
  /** 当前集市透视列表（商品或默认方案）。 */
  getPreview(): readonly RogueShopPreviewItem[];
  /** 订阅透视列表变化。 */
  subscribePreview(listener: RogueShopPreviewListener): () => void;
  /**
   * 协议分发前改写：对照 app.bak `f6`/`wY`——
   * dataMark bit4 时强制 `shopData.bShow`；缺 shopData 则 `RogueLikeDataReq`；
   * 有 shopData 时刷新集市透视（`cD`）。
   */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface RogueShopOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  cardConfigSource?: Pick<CardConfigSource, 'getRogueMapData'>;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 对照 app.bak `Ve` → `wY(KE)` / `f6(kN)`：山河同步业务字段在 ProtoObj 上
 *（`allData` / `dataMark` / `shopData`），外层只带 ClassName。
 */
export function resolveRogueLikeSyncBody(payload: UnknownRecord): UnknownRecord {
  const nestedData = asRecord(payload.data) ?? asRecord(payload.Data);
  return asRecord(payload.ProtoObj)
    ?? asRecord(payload.protoObj)
    ?? asRecord(nestedData?.ProtoObj)
    ?? asRecord(nestedData?.protoObj)
    ?? payload;
}

/** 对照 app.bak：`Array.from(Number(dataMark).toString(2), Number).reverse()[4]`。 */
export function hasRogueShopSyncFlag(payload: UnknownRecord): boolean {
  const body = resolveRogueLikeSyncBody(payload);
  const mark = Number(body.dataMark ?? body.DataMark ?? payload.dataMark ?? payload.DataMark);
  if (!Number.isFinite(mark)) return false;
  return ((mark >> 4) & 1) === 1;
}

export function readShopData(payload: UnknownRecord): UnknownRecord | null {
  const body = resolveRogueLikeSyncBody(payload);
  const direct = asRecord(body.shopData) ?? asRecord(body.ShopData)
    ?? asRecord(payload.shopData) ?? asRecord(payload.ShopData);
  if (direct) return direct;
  const allData = asRecord(body.allData)
    ?? asRecord(body.AllData)
    ?? asRecord(body.data)
    ?? asRecord(body.Data)
    ?? asRecord(payload.allData)
    ?? asRecord(payload.AllData)
    ?? asRecord(payload.data)
    ?? asRecord(payload.Data);
  return asRecord(allData?.shopData) ?? asRecord(allData?.ShopData);
}

function isRplotReady(rplot: Record<string, RoguePlotMeta> | null | undefined): boolean {
  return Boolean(rplot && Object.keys(rplot).length > 0);
}

/**
 * 对照 app.bak `cD` 的商品解析部分：用 Rplot 解析 shopData.itemId。
 * 无数据 / 解析不出商品时返回空列表（界面不展示占位方案名）。
 */
export function buildRogueShopPreviewItems(
  itemIds: unknown,
  rplot: Record<string, RoguePlotMeta> | null | undefined
): RogueShopPreviewItem[] {
  const ids = asArray(itemIds);
  const table = rplot && typeof rplot === 'object' ? rplot : {};
  const goods: RogueShopPreviewItem[] = [];
  for (const rawId of ids) {
    if (rawId == null || rawId === '') continue;
    const id = String(rawId);
    const meta = table[id];
    if (!meta) continue;
    const moneyText = meta.money != null && String(meta.money) !== ''
      ? ` ${String(meta.money)}铜`
      : '';
    const typeLabel = ROGUE_SHOP_TYPE_LABELS[Number(meta.type)] ?? '';
    const rawLevel = Number(meta.level) || 0;
    // 对照 app.bak：等级样式类 TkxdW9UzobK1~4，超出范围按 0（默认色）处理。
    const level = rawLevel >= 1 && rawLevel <= 4 ? rawLevel : 0;
    goods.push({
      id,
      label: `${meta.name || id}${moneyText}`,
      title: `${typeLabel}${meta.desc || ''}`,
      level
    });
  }
  return goods;
}

/**
 * 打开集市 + 集市透视：对照 app.bak `#openStore` / `bShow=true` / `cD(shop itemIds)`。
 */
export function installRogueShopController(
  options: RogueShopOptions = {}
): RogueShopController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const cardConfigSource = options.cardConfigSource;
  const patcher = createMethodPatcher();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const previewListeners = new Set<RogueShopPreviewListener>();
  let disposed = false;
  /** 同步包里原始 bShow；为 false 时购买提示改为“月份未到”。 */
  let originalShopVisible: boolean | null = null;
  /** 对照 app.bak `MX`：避免重复 RogueLikeDataReq。 */
  let shopDataRequested = false;
  let previewItems: RogueShopPreviewItem[] = [];
  /**
   * 同步包先于 Rplot 到达时暂存 itemId；对照 app.bak `cD` 在 `Object.keys(Rplot).length`
   * 为 0 时解析不出商品——我们不展示占位方案，因此等配置就绪后再刷一次。
   */
  let pendingShopItemIds: unknown[] | null = null;
  let rplotWait: Promise<void> | null = null;

  function publishPreview(next: RogueShopPreviewItem[]): void {
    previewItems = next;
    for (const listener of previewListeners) {
      try {
        listener(previewItems);
      } catch (error) {
        console.warn('[山河图] 集市透视订阅回调失败', error);
      }
    }
  }

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

  function ensureRplotThenRefresh(): void {
    if (rplotWait) return;
    rplotWait = poll(() => {
      const rplot = cardConfigSource?.getRogueMapData()?.Rplot ?? null;
      return isRplotReady(rplot) ? rplot : null;
    }).then((rplot) => {
      rplotWait = null;
      if (!rplot || !pendingShopItemIds || disposed) return;
      const ids = pendingShopItemIds;
      pendingShopItemIds = null;
      publishPreview(buildRogueShopPreviewItems(ids, rplot));
    });
  }

  function refreshPreviewFromShopData(shopData: UnknownRecord): void {
    const itemIds = shopData.itemId ?? shopData.ItemId;
    const ids = asArray(itemIds);
    const rplot = cardConfigSource?.getRogueMapData()?.Rplot ?? null;
    // 有商品 id 但 Rplot 尚未加载：空列表不推占位，等配置就绪后再解析。
    if (ids.length && !isRplotReady(rplot)) {
      pendingShopItemIds = ids;
      publishPreview([]);
      ensureRplotThenRefresh();
      return;
    }
    pendingShopItemIds = null;
    publishPreview(buildRogueShopPreviewItems(itemIds, rplot));
  }

  /** 对照 app.bak：强制可见，并记下协议里的原始 bShow。 */
  function forceShopVisible(shopData: UnknownRecord, recordOriginal: boolean): void {
    if (recordOriginal) {
      originalShopVisible = shopData.bShow === true || shopData.BShow === true;
    }
    shopData.bShow = true;
    if ('BShow' in shopData) shopData.BShow = true;
  }

  function readShopDataFromManager(): UnknownRecord | null {
    const manager = asRecord(locator.manager('RogueLikePveManager'));
    if (!manager) return null;
    return readShopData(manager)
      ?? readShopData(asRecord(manager.allData) ?? {})
      ?? readShopData(asRecord(manager.AllData) ?? {});
  }

  /** 对照 app.bak `MX(dm)`：缺 shopData 时向 RogueLikePveManager 要一次完整同步。 */
  function requestShopData(mark = ROGUE_SHOP_DATA_REQ_MARK): boolean {
    if (shopDataRequested) {
      console.warn('[山河图] 集市数据已请求过，跳过重复请求, dm=', mark);
      return true;
    }
    const manager = asRecord(locator.manager('RogueLikePveManager'));
    const method = manager?.RogueLikeDataReq;
    if (typeof method !== 'function') return false;
    try {
      shopDataRequested = true;
      method.call(manager, mark);
      return true;
    } catch (error) {
      shopDataRequested = false;
      console.warn('[山河图] 请求集市数据失败', error);
      return false;
    }
  }

  function resetShopDataRequest(): void {
    shopDataRequested = false;
  }

  /** 打开集市时启用透视：强制当前缓存可见并刷新预览。 */
  function enablePerspectiveFromManager(): void {
    const shopData = readShopDataFromManager();
    if (!shopData) {
      requestShopData();
      return;
    }
    forceShopVisible(shopData, originalShopVisible === null);
    refreshPreviewFromShopData(shopData);
  }

  function openShop(): boolean {
    enablePerspectiveFromManager();
    const dispatcher = locator.dispatcher();
    if (!dispatcher) {
      showToast('游戏尚未就绪，稍后再打开集市');
      return false;
    }
    const showWindowName = locator.obfuscatedMethodName(
      dispatcher,
      'GameEventDispatcher',
      'ShowWindow'
    ) ?? 'ShowWindow';
    const method = dispatcher[showWindowName];
    if (typeof method !== 'function') {
      showToast('无法打开集市窗口');
      return false;
    }
    try {
      method.call(dispatcher, ROGUE_SHOP_WINDOW);
      return true;
    } catch (error) {
      console.warn('[山河图] 打开集市失败', error);
      showToast('打开集市失败');
      return false;
    }
  }

  function filterMessage(payload: UnknownRecord, className: string): void {
    if (className !== 'decodeRogueLikeDataSync') return;

    // ClassName 在外层；allData / dataMark / shopData 由 readShopData / hasRogueShopSyncFlag 解 ProtoObj。
    const shopFlag = hasRogueShopSyncFlag(payload);
    const shopData = readShopData(payload);

    // 对照 app.bak：dataMark bit4 且无 shopData → RogueLikeDataReq 后返回。
    if (shopFlag && !shopData) {
      requestShopData();
      return;
    }

    if (!shopData) return;

    // 对照 app.bak：bit4 时记下原始 bShow 并强制可见；同时复位 MX 请求锁。
    if (shopFlag) {
      resetShopDataRequest();
      forceShopVisible(shopData, true);
    }

    // 对照 app.bak `cD`：只要有 shopData 就刷新透视列表（不依赖 bit4）。
    refreshPreviewFromShopData(shopData);
  }

  // 对照 app.bak：购买成功提示在集市提前显示且原 bShow=false 时改写文案。
  void poll(() => {
    const context = asRecord(locator.gameContext())
      ?? asRecord((globalObject as UnknownRecord).GameContext)
      ?? asRecord(asRecord(globalObject.Laya?.Browser?.window)?.GameContext);
    return context && typeof context.ShowTextPrompt === 'function' ? context : null;
  }).then((context) => {
    if (!context || disposed) return;
    patcher.wrap(context, 'ShowTextPrompt', (original) => function (this: unknown, message: unknown, ...rest: unknown[]) {
      const text = String(message || '');
      if (
        text === '购买成功'
        && originalShopVisible === false
        && locator.window(ROGUE_SHOP_WINDOW)
      ) {
        return original.call(
          this,
          '购买失败：小抄可提前显示山河图集市<br>但是目前还没到购买东西的月份。',
          ...rest
        );
      }
      return original.call(this, message, ...rest);
    });
  });

  return {
    openShop,
    getPreview: () => previewItems,
    subscribePreview(listener) {
      previewListeners.add(listener);
      try {
        listener(previewItems);
      } catch {
        // 首次推送失败不影响后续订阅。
      }
      return () => {
        previewListeners.delete(listener);
      };
    },
    filterMessage,
    dispose() {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      previewListeners.clear();
      patcher.restoreAll();
      originalShopVisible = null;
      shopDataRequested = false;
      pendingShopItemIds = null;
      rplotWait = null;
      previewItems = [];
    }
  };
}
