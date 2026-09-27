import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type PatchableFunction } from '../../runtime/method-patch.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import {
  asRecord,
  callMethod,
  createTaskScope,
  prototypeOf,
  readJson,
  seatGeneral,
  seatHoldsGeneral,
  skinTrace,
  supportsDynamicSkin,
  watchSceneSwitch,
  watchWindowShow,
  writeJson,
  type SeatGeneralInfo,
  type UnknownRecord
} from './skin-runtime.ts';

const SAVED_SKINS_KEY = 'XC::localSkins';
const SKIN_WINDOWS = ['ChangeSkinWindow', 'SelectSkinWindow'] as const;
/** 未拥有皮肤项上表示限时、合成等状态的节点，本地解锁后隐藏。 */
const LOCKED_ITEM_NODES = ['timeBg', 'composeBg', 'composeIcon', 'composeTxt1', 'composeTxt2', 'composeTxt', 'timeLimiteTxt'];
const SELF_GENERAL_KEYS = ['generalIds', 'GeneralIds', 'WuJiangs', 'generals'];
const OTHER_BIND_DELAYS = [0, 50, 200, 600, 1500];
const OTHER_OPEN_TIMEOUT = 3000;

interface SavedSkin {
  skinID: number;
  isDynamic: boolean;
}

interface ItemOriginalState {
  skinID: number | null;
  supportsDynamic: boolean;
  dynamicState: unknown;
  hasSkin: unknown;
  isUsing: unknown;
  bgMouseEnabled: unknown;
  blackbgVisible: unknown;
  visibility: Record<string, unknown>;
}

interface OtherSkinSession {
  token: number;
  epoch: number;
  scene: unknown;
  seat: UnknownRecord;
  seatIndex: unknown;
  isZhu: boolean;
  generalID: number;
  view: UnknownRecord | null;
  cancelled: boolean;
  completed: boolean;
}

interface OtherSkinOverride {
  epoch: number;
  seat: UnknownRecord;
  generalID: number;
  skinID: number;
  isDynamic: boolean;
  skinType: number;
}

export interface SkinChangeController {
  /** 协议分发前调用：开局下发自己武将皮肤时替换为本地选择。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface SkinChangeOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

/**
 * 皮肤解锁与他人换肤（对照 app.bak 的 GI/GP/Gp 与 F0~F4、Yu/YP 一组实现）。
 * 两者共用换肤窗口：未拥有的皮肤显示为可选，确认时只在本地调用座位的
 * SetGeneralSkin；自己的选择按武将保存，开局时改写服务器下发的皮肤。
 */
export function installSkinChangeController(
  configStore: XiaochaoConfigStore,
  options: SkinChangeOptions = {}
): SkinChangeController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const patcher = createMethodPatcher();
  const tasks = createTaskScope();
  const unsubscribes: Array<() => void> = [];

  const itemStates = new WeakMap<object, ItemOriginalState>();
  const previewItems = new Map<string, Set<UnknownRecord>>();
  const guardedViews = new WeakMap<object, { items: Set<UnknownRecord>; handled?: { skinID: number; result: unknown } }>();

  const sessions = new Set<OtherSkinSession>();
  const sessionByView = new WeakMap<object, OtherSkinSession>();
  const overrides = new Map<string, OtherSkinOverride>();
  const seatKeys = new WeakMap<object, number>();
  const ownSkinButtons = new Set<UnknownRecord>();
  let openingSession: OtherSkinSession | null = null;
  let epoch = 0;
  let sessionToken = 0;
  let seatToken = 0;
  let currentScene: unknown = null;

  const localOn = () => configStore.get('skin.localSkin') === true;
  const otherOn = () => configStore.get('skin.otherLocalSkin') === true;
  const layaEvent = () => asRecord(globalObject.Laya?.Event);

  // ---------- 自己的皮肤选择 ----------

  function savedSkins(): Record<string, SavedSkin> {
    const value = readJson<unknown>(storage, SAVED_SKINS_KEY, {});
    return value && typeof value === 'object' ? value as Record<string, SavedSkin> : {};
  }

  function savedSkin(generalID: unknown): SavedSkin | null {
    const saved = savedSkins()[String(Number(generalID))];
    return saved && Number(saved.skinID) >= 0 ? { skinID: Number(saved.skinID), isDynamic: saved.isDynamic !== false } : null;
  }

  function saveSkin(generalID: number, skinID: number, isDynamic: boolean): void {
    if (!(generalID > 0)) return;
    writeJson(storage, SAVED_SKINS_KEY, { ...savedSkins(), [generalID]: { skinID, isDynamic } });
  }

  function selfSeat(): UnknownRecord | null {
    const seat = asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.seat);
    return typeof seat?.SetGeneralSkin === 'function' ? seat : null;
  }

  function isOwnGeneral(generalID: number): boolean {
    if (!Number.isFinite(generalID)) return false;
    const seat = asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.seat);
    for (const key of SELF_GENERAL_KEYS) {
      const ids = seat?.[key];
      if (Array.isArray(ids)) return ids.some((id) => Number(id) === generalID);
    }
    return false;
  }

  function filterMessage(payload: UnknownRecord, className: string): void {
    if (className !== 'ClientGeneralSkinRep' || !localOn()) return;
    const list = payload.GeneralSkinList;
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const skin = asRecord(entry);
      if (!skin || !isOwnGeneral(Number(skin.GeneralID))) continue;
      skin.state = 1;
      const saved = savedSkin(skin.GeneralID);
      if (!saved) continue;
      skin.SkinID = saved.skinID;
      skin.state = saved.isDynamic ? 1 : 0;
    }
  }

  /** 对照 app.bak 的 GX + Ge：在自己座位上本地应用皮肤。 */
  function applyToSelfSeat(generalID: number, skinID: number, isDynamic: boolean): boolean {
    const seat = selfSeat();
    if (!seat || !(generalID > 0)) return false;
    for (const isZhu of [true, false]) {
      const info = seatGeneral(seat, isZhu);
      if (!info || !seatHoldsGeneral(seat, info, generalID)) continue;
      callMethod(seat, 'SetGeneralSkin', generalID, skinID, isDynamic, info.skinType, true);
      return true;
    }
    return false;
  }

  // ---------- 换肤窗口：未拥有皮肤显示为可选 ----------

  function itemSkinId(item: UnknownRecord): number | null {
    const skinData = asRecord(item.skinData);
    const id = Number(item.SkinID ?? item.skinId ?? item.skinID ?? skinData?.skinID);
    return Number.isFinite(id) && id >= 0 ? id : null;
  }

  function rememberItem(item: UnknownRecord): ItemOriginalState {
    const existing = itemStates.get(item);
    if (existing) return existing;
    const state: ItemOriginalState = {
      skinID: itemSkinId(item),
      supportsDynamic: supportsDynamicSkin(item),
      dynamicState: item.dynamicState,
      hasSkin: item.hasSkin,
      isUsing: item.isUsing,
      bgMouseEnabled: asRecord(item.bg)?.mouseEnabled,
      blackbgVisible: asRecord(item.blackbg)?.visible,
      visibility: Object.fromEntries(LOCKED_ITEM_NODES.map((name) => [name, asRecord(item[name])?.visible]))
    };
    itemStates.set(item, state);
    return state;
  }

  function unlockItem(item: UnknownRecord): void {
    if (!localOn()) return;
    const original = rememberItem(item);
    item.dynamicState = original.hasSkin ? (original.dynamicState ? -1 : -2) : -3;
    item.hasSkin = true;
    const background = asRecord(item.bg);
    if (background) background.mouseEnabled = true;
    const blackBackground = asRecord(item.blackbg);
    if (blackBackground) blackBackground.visible = false;
    item.isUsing = false;
    LOCKED_ITEM_NODES.forEach((name) => {
      const node = asRecord(item[name]);
      if (node) node.visible = false;
    });
  }

  function restoreItem(item: UnknownRecord): void {
    const original = itemStates.get(item);
    if (!original) return;
    item.dynamicState = original.dynamicState;
    item.hasSkin = original.hasSkin;
    item.isUsing = original.isUsing;
    const background = asRecord(item.bg);
    if (background && original.bgMouseEnabled !== undefined) background.mouseEnabled = original.bgMouseEnabled;
    const blackBackground = asRecord(item.blackbg);
    if (blackBackground && original.blackbgVisible !== undefined) blackBackground.visible = original.blackbgVisible;
    LOCKED_ITEM_NODES.forEach((name) => {
      const node = asRecord(item[name]);
      if (node && original.visibility[name] !== undefined) node.visible = original.visibility[name];
    });
    itemStates.delete(item);
  }

  /** 列表项复用时会重新 render，需在每次渲染后重新套用。 */
  function guardItemRender(item: UnknownRecord): void {
    patcher.wrap(item, 'render', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const before = itemStates.get(this);
      const result = original.apply(this, args);
      if (localOn()) {
        if (before && itemSkinId(this) !== before.skinID) itemStates.delete(this);
        unlockItem(this);
      } else {
        restoreItem(this);
      }
      return result;
    });
  }

  function restorePreview(windowName?: string): void {
    const entries = windowName ? [[windowName, previewItems.get(windowName)] as const] : [...previewItems.entries()];
    for (const [name, items] of entries) {
      items?.forEach(restoreItem);
      previewItems.delete(name);
    }
  }

  function findPreviewItem(view: UnknownRecord, skinID: number): { item: UnknownRecord; original: ItemOriginalState } | null {
    const guard = guardedViews.get(view);
    if (!guard || !Number.isFinite(skinID) || skinID < 0) return null;
    for (const item of guard.items) {
      const original = itemStates.get(item);
      if (original && Number(original.skinID) === skinID) return { item, original };
    }
    return null;
  }

  /** 对照 app.bak 的 GP：确认选择时，未拥有的皮肤只在本地应用。 */
  function handleLocalSelection(view: UnknownRecord, native: PatchableFunction, args: unknown[]): { handled: boolean; result?: unknown } {
    const guard = guardedViews.get(view);
    if (!guard) return { handled: false };
    const skinID = Number(view.closeSelectSkinId);
    if (guard.handled && guard.handled.skinID === skinID) return { handled: true, result: guard.handled.result };
    const preview = findPreviewItem(view, skinID);
    if (!preview || !localOn()) {
      if (Number(view.closeSelectDynamicState) < 0) {
        view.closeSelectDynamicState = 0;
        return { handled: true, result: false };
      }
      return { handled: false };
    }
    if (view.clickCheck !== true) return { handled: false };
    const generalID = Number(view.defaultGeneralID ?? view.realGeneralID ?? view.generalID);
    const isDynamic = preview.original.supportsDynamic;
    if (generalID > 0) saveSkin(generalID, skinID, isDynamic);
    let nativeResult: unknown = false;
    if (preview.original.hasSkin) {
      view.closeSelectDynamicState = preview.original.dynamicState ? 1 : 0;
      nativeResult = native.apply(view, args);
    } else {
      view.closeSelectDynamicState = 0;
    }
    let applied = false;
    try {
      applied = applyToSelfSeat(generalID, skinID, isDynamic);
    } catch (error) {
      console.warn('[皮肤解锁] 本地应用失败:', error);
      showToast('本地换肤失败，请重试', 'error');
    }
    const result = applied || nativeResult;
    skinTrace('local-select', {
      generalID,
      skinID,
      owned: Boolean(preview.original.hasSkin),
      isDynamic,
      applied,
      selfSeat: Boolean(selfSeat()),
      seatGenerals: [true, false].map((isZhu) => seatGeneral(selfSeat(), isZhu)?.generalID ?? null)
    });
    guard.handled = { skinID, result };
    return { handled: true, result };
  }

  function guardSelectView(view: UnknownRecord, items: UnknownRecord[]): boolean {
    const existing = guardedViews.get(view);
    if (existing) {
      existing.items = new Set(items);
      existing.handled = undefined;
      return true;
    }
    guardedViews.set(view, { items: new Set(items) });
    return patcher.wrap(view, 'closeSelectSure', (native) => function (this: UnknownRecord, ...args: unknown[]) {
      if (sessionFor(this)) {
        const other = finishOtherSelection(this);
        if (other.handled) return other.applied;
      }
      const local = handleLocalSelection(this, native, args);
      skinTrace('close-select', {
        skinID: this.closeSelectSkinId,
        dynamicState: this.closeSelectDynamicState,
        clickCheck: this.clickCheck,
        handled: local.handled
      });
      return local.handled ? local.result : native.apply(this, args);
    }) || patcher.isWrapped(view, 'closeSelectSure');
  }

  function skinWindow(name: string): UnknownRecord | null {
    const win = locator.window(name);
    return win && !win.destroyed ? win : null;
  }

  /** 对局内打开换肤框不一定经过 ShowWindow，改由列表视图反查所属窗口。 */
  function owningWindowName(view: UnknownRecord): (typeof SKIN_WINDOWS)[number] | null {
    let node: UnknownRecord | null = view;
    for (let depth = 0; node && depth < 8; depth += 1) {
      const name = SKIN_WINDOWS.find((candidate) => candidate === node?.name);
      if (name) return name;
      node = asRecord(node._parent);
    }
    return SKIN_WINDOWS.find((name) => asRecord(skinWindow(name)?.selectView) === view) ?? null;
  }

  async function applyPreview(windowName: string): Promise<void> {
    if (!localOn()) {
      restorePreview(windowName);
      return;
    }
    const items = await tasks.poll(() => {
      const list = asRecord(skinWindow(windowName)?.selectView)?.itemList;
      return Array.isArray(list) && list.length > 1 ? list : null;
    }, 300, 20);
    const traceView = asRecord(skinWindow(windowName)?.selectView);
    skinTrace('local-preview', {
      windowName,
      windowFound: Boolean(skinWindow(windowName)),
      inGame: Boolean(locator.gameScene()),
      generalID: traceView?.realGeneralID ?? traceView?.generalID,
      itemCount: Array.isArray(traceView?.itemList) ? traceView.itemList.length : null,
      showCount: Array.isArray(traceView?.ShowItemList) ? traceView.ShowItemList.length : null,
      listArray: Array.isArray(asRecord(traceView?.list)?.array) ? (asRecord(traceView?.list)?.array as unknown[]).length : null,
      viewKeys: traceView ? Object.keys(traceView).slice(0, 80) : [],
      items: (Array.isArray(traceView?.itemList) ? traceView.itemList : []).slice(0, 40).map((entry) => {
        const item = asRecord(entry);
        return { skinID: item ? itemSkinId(item) : null, hasSkin: item?.hasSkin, dynamicState: item?.dynamicState, visible: item?.visible };
      })
    });
    if (!items || !localOn()) return;
    restorePreview(windowName);
    const view = asRecord(skinWindow(windowName)?.selectView);
    const records = items.map(asRecord).filter((item): item is UnknownRecord => item !== null);
    if (!view || !guardSelectView(view, records)) return;
    previewItems.set(windowName, new Set(records));
    records.forEach((item) => {
      guardItemRender(item);
      unlockItem(item);
    });
  }

  function syncOpenWindows(): void {
    for (const name of SKIN_WINDOWS) {
      if (!skinWindow(name)) continue;
      if (localOn()) void applyPreview(name);
      else restorePreview(name);
    }
  }

  // ---------- 他人换肤 ----------

  function seatKey(seat: object): number {
    let key = seatKeys.get(seat);
    if (!key) {
      key = ++seatToken;
      seatKeys.set(seat, key);
    }
    return key;
  }

  function overrideKey(seat: UnknownRecord, isZhu: boolean, generalID: number): string {
    return `${seatKey(seat)}:${isZhu ? 'main' : 'deputy'}:${generalID}`;
  }

  function seatIndex(seat: UnknownRecord | null): unknown {
    return seat?.Index ?? seat?.index ?? seat?.seatID;
  }

  function isSpectating(manager: UnknownRecord): boolean {
    const lookOn = asRecord(manager.lookOnBtn);
    if (!lookOn || lookOn.destroyed) return false;
    return '_visible' in lookOn ? lookOn._visible === true : lookOn.visible === true;
  }

  /** 悬停的是主将还是副将（对照 app.bak 的 YE）。 */
  function hoveredIsZhu(manager: UnknownRecord): boolean {
    const seat = asRecord(manager.seat);
    if (!seat) return manager.isZhu !== false;
    if (seat.General2 && typeof manager.getTipGeneral === 'function') {
      try {
        const general = (manager.getTipGeneral as () => unknown).call(manager);
        if (general === seat.General2) return false;
        if (general === seat.General) return true;
      } catch {
        // 回退到 isZhu。
      }
    }
    return manager.isZhu !== false;
  }

  function findOverride(seat: UnknownRecord, generalID: number): OtherSkinOverride | null {
    if (seat.IsSelf || !(generalID > 0)) return null;
    for (const isZhu of [true, false]) {
      const info = seatGeneral(seat, isZhu);
      if (!info || !seatHoldsGeneral(seat, info, generalID)) continue;
      const exact = overrides.get(overrideKey(seat, isZhu, info.generalID));
      if (exact?.epoch === epoch) return exact;
      const prefix = `${seatKey(seat)}:${isZhu ? 'main' : 'deputy'}:`;
      for (const [key, value] of overrides) {
        if (key.startsWith(prefix) && value.epoch === epoch && seatHoldsGeneral(seat, info, value.generalID)) return value;
      }
    }
    return null;
  }

  function sessionValid(session: OtherSkinSession | null): session is OtherSkinSession {
    if (!session || session.cancelled || session.completed || session.epoch !== epoch || !otherOn()) return false;
    if (session.scene !== locator.gameScene() || session.seat.destroyed || session.seat.IsSelf) return false;
    if (seatIndex(session.seat) !== session.seatIndex) return false;
    const info = seatGeneral(session.seat, session.isZhu);
    return Boolean(info && seatHoldsGeneral(session.seat, info, session.generalID));
  }

  function sessionFor(view: UnknownRecord, generalHint = 0): OtherSkinSession | null {
    const bound = sessionByView.get(view);
    if (bound && !bound.completed) return bound;
    const active = [...sessions].filter((session) => !session.completed && session.epoch === epoch)
      .sort((a, b) => b.token - a.token);
    if (!active.length) return null;
    const generalID = Number(view.realGeneralID ?? view.generalID) || Number(generalHint) || 0;
    if (generalID) {
      const matched = active.find((session) => session.generalID === generalID);
      if (matched) return matched;
    }
    if (openingSession && active.includes(openingSession) && (!generalID || openingSession.generalID === generalID)) {
      return openingSession;
    }
    const free = active.filter((session) => !session.view || session.view === view);
    return !generalID && free.length === 1 ? free[0] : null;
  }

  function bindSession(view: UnknownRecord, session: OtherSkinSession): void {
    sessionByView.set(view, session);
    session.view = view;
    const info = seatGeneral(session.seat, session.isZhu);
    if (!info) return;
    view.usingSkinID = info.skinID;
    view.closeSelectSkinId = info.skinID;
    view.closeSelectDynamicState = info.isDynamic ? 1 : 0;
  }

  function endSession(session: OtherSkinSession | null): void {
    if (!session) return;
    session.cancelled = true;
    session.completed = true;
    sessions.delete(session);
    if (openingSession === session) openingSession = null;
  }

  function cancelAllSessions(): void {
    [...sessions].forEach(endSession);
    openingSession = null;
  }

  function tryBindOpenWindow(session: OtherSkinSession): boolean {
    if (!sessionValid(session)) return false;
    const win = skinWindow('ChangeSkinWindow') ?? skinWindow('SelectSkinWindow');
    const view = asRecord(win?.selectView);
    if (!win || !view) return false;
    const generalID = Number(win.generalID ?? view.realGeneralID ?? session.generalID);
    if (generalID !== session.generalID) return false;
    bindSession(view, session);
    if (openingSession === session) openingSession = null;
    callMethod(view, 'sortList');
    callMethod(view, 'updateContent');
    skinTrace('other-bind', {
      generalID,
      windowName: win.name,
      itemCount: Array.isArray(view.itemList) ? view.itemList.length : null,
      showCount: Array.isArray(view.ShowItemList) ? view.ShowItemList.length : null
    });
    return true;
  }

  function scheduleBind(session: OtherSkinSession): void {
    OTHER_BIND_DELAYS.forEach((delay) => tasks.later(() => {
      if (openingSession === session) tryBindOpenWindow(session);
    }, delay));
    tasks.later(() => {
      if (openingSession !== session) return;
      const view = asRecord((skinWindow('ChangeSkinWindow') ?? skinWindow('SelectSkinWindow'))?.selectView);
      if (view) {
        sessionByView.set(view, session);
        view.clickCheck = false;
      }
      endSession(session);
    }, OTHER_OPEN_TIMEOUT);
  }

  function isDynamicChoice(view: UnknownRecord, skinID: number, dynamicState: unknown): boolean {
    const preview = findPreviewItem(view, skinID);
    if (preview) return preview.original.supportsDynamic;
    if (typeof dynamicState === 'boolean') return dynamicState;
    const state = Number(dynamicState) || 0;
    return state > 0 || state === -1;
  }

  /** 对照 app.bak 的 Yu + YP：确认后只在本地替换该座位皮肤并记住，服务器刷新时继续覆盖。 */
  function finishOtherSelection(view: UnknownRecord): { handled: boolean; applied: boolean } {
    const session = sessionFor(view);
    if (!session) return { handled: false, applied: false };
    sessionByView.delete(view);
    let applied = false;
    if (view.clickCheck === true && sessionValid(session)) {
      const info = seatGeneral(session.seat, session.isZhu);
      const skinID = Number(view.closeSelectSkinId);
      if (info && Number.isFinite(skinID) && skinID >= 0) {
        const isDynamic = isDynamicChoice(view, skinID, view.closeSelectDynamicState);
        const key = overrideKey(session.seat, session.isZhu, info.generalID);
        const previous = overrides.get(key);
        overrides.set(key, { epoch, seat: session.seat, generalID: info.generalID, skinID, isDynamic, skinType: info.skinType });
        try {
          callMethod(session.seat, 'SetGeneralSkin', info.generalID, skinID, isDynamic, info.skinType, true);
          applied = true;
        } catch (error) {
          if (previous) overrides.set(key, previous);
          else overrides.delete(key);
          console.warn('[他人换肤] 本地应用失败:', error);
          showToast('给其他角色换肤失败，请重试', 'error');
        }
      }
    }
    endSession(session);
    return { handled: true, applied };
  }

  /** 以“自己”的身份再调用一次悬停处理，让游戏为他人武将也生成换肤按钮。 */
  function hoverAsSelf(manager: UnknownRecord, args: unknown[], isZhu: boolean, original: PatchableFunction): unknown {
    const seat = asRecord(manager.seat);
    if (!seat) return undefined;
    const selfDescriptor = Object.getOwnPropertyDescriptor(seat, 'IsSelf');
    const canChangeSkin = manager.canChangeSkin;
    const activated = manager.activated;
    const wasZhu = manager.isZhu;
    let result: unknown;
    try {
      manager.canChangeSkin = false;
      result = original.apply(manager, args);
    } finally {
      manager.canChangeSkin = canChangeSkin;
    }
    if (isSpectating(manager)) return result;
    let overridden = false;
    try {
      Object.defineProperty(seat, 'IsSelf', { value: true, configurable: true });
      overridden = true;
      manager.canChangeSkin = true;
      manager.activated = false;
      manager.isZhu = isZhu;
      return original.apply(manager, args);
    } finally {
      manager.canChangeSkin = canChangeSkin;
      manager.activated = activated;
      manager.isZhu = wasZhu;
      if (overridden) {
        if (selfDescriptor) Object.defineProperty(seat, 'IsSelf', selfDescriptor);
        else delete seat.IsSelf;
      }
    }
  }

  const originalSkinClick = new WeakMap<object, PatchableFunction>();

  function patchSeatManager(manager: UnknownRecord): void {
    const prototype = prototypeOf(manager);
    if (!prototype) return;
    patcher.wrap(prototype, 'onSKinClick', (original) => {
      originalSkinClick.set(prototype, original);
      return function (this: UnknownRecord, ...args: unknown[]) {
        const seat = asRecord(this.seat);
        if (!otherOn() || !seat || seat.IsSelf || isSpectating(this)) return original.apply(this, args);
        return openOtherPicker(this, args, original) || original.apply(this, args);
      };
    });
    patcher.wrap(prototype, 'OnSomeTextureOver', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const seat = asRecord(this.seat);
      if (!seat || seat.IsSelf) return original.apply(this, args);
      if (!otherOn()) {
        const result = original.apply(this, args);
        const button = asRecord(this.skinBtn);
        if (button) Object.assign(button, { visible: false, mouseEnabled: false });
        return result;
      }
      const isZhu = hoveredIsZhu(this);
      const result = hoverAsSelf(this, args, isZhu, original);
      if (isSpectating(this)) return result;
      const button = asRecord(this.skinBtn);
      if (button && !ownSkinButtons.has(button)) {
        const eventName = layaEvent()?.CLICK;
        const nativeClick = originalSkinClick.get(prototype);
        if (eventName) {
          if (nativeClick) callMethod(button, 'off', eventName, this, nativeClick);
          callMethod(button, 'off', eventName, this, this.onSKinClick);
          callMethod(button, 'on', eventName, this, this.onSKinClick);
        }
        ownSkinButtons.add(button);
      }
      if (button) {
        button.mouseEnabled = true;
        button.__xcOtherSkinIsZhu = isZhu;
        if (seat.General2 && typeof this.getTipGeneral === 'function') {
          const half = Math.round(Number(this.width || 146) / 2);
          button.x = isZhu ? Math.max(0, 104 - half) : 104;
        }
      }
      return result;
    });
  }

  /** 对照 app.bak 的 F0：打开原生换肤框，并把窗口绑定到这次他人换肤会话。 */
  function openOtherPicker(manager: UnknownRecord, args: unknown[], original: PatchableFunction): boolean {
    const button = asRecord(manager.skinBtn);
    const isZhu = typeof button?.__xcOtherSkinIsZhu === 'boolean' ? button.__xcOtherSkinIsZhu : hoveredIsZhu(manager);
    const info: SeatGeneralInfo | null = seatGeneral(manager.seat, isZhu);
    const scene = locator.gameScene();
    if (!info || info.seat.IsSelf || !scene) return false;
    if (openingSession) endSession(openingSession);
    const session: OtherSkinSession = {
      token: ++sessionToken,
      epoch,
      scene,
      seat: info.seat,
      seatIndex: seatIndex(info.seat),
      isZhu: info.isZhu,
      generalID: info.generalID,
      view: null,
      cancelled: false,
      completed: false
    };
    sessions.add(session);
    openingSession = session;
    const wasZhu = manager.isZhu;
    try {
      manager.isZhu = info.isZhu;
      original.apply(manager, args);
    } catch (error) {
      endSession(session);
      console.warn('[他人换肤] 打开换肤框失败:', error);
      return false;
    } finally {
      manager.isZhu = wasZhu;
    }
    if (openingSession === session) scheduleBind(session);
    return true;
  }

  function patchSeat(seat: unknown): void {
    const prototype = prototypeOf(seat);
    if (!prototype) return;
    patcher.wrap(prototype, 'SetGeneralSkin', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const override = findOverride(this, Number(args[0]));
      if (override) {
        args[1] = override.skinID;
        args[2] = override.isDynamic;
        args[3] = override.skinType;
        args[4] = true;
      }
      return original.apply(this, args);
    });
  }

  function seatManagers(scene: UnknownRecord | null): UnknownRecord[] {
    const managers = new Set<UnknownRecord>();
    const visit = (seatUi: unknown) => {
      const record = asRecord(seatUi);
      if (!record) return;
      for (const manager of [record.otherTopManager, record.topManager]) {
        const candidate = asRecord(manager);
        if (typeof candidate?.OnSomeTextureOver === 'function' && typeof candidate.onSKinClick === 'function') {
          managers.add(candidate);
        }
      }
      if (record.fuSeatUI && record.fuSeatUI !== record) visit(record.fuSeatUI);
    };
    const seatUis = asRecord(scene?.seatContainer)?.seatUIs;
    if (Array.isArray(seatUis)) seatUis.forEach(visit);
    visit(scene?.SelfSeatUi);
    return [...managers];
  }

  function hideOwnSkinButtons(): void {
    ownSkinButtons.forEach((button) => {
      button.visible = false;
      button.mouseEnabled = false;
    });
  }

  /** 进入新牌局时清空覆盖记录（对照 app.bak 的 F4）。 */
  function resetForScene(): void {
    hideOwnSkinButtons();
    ownSkinButtons.clear();
    cancelAllSessions();
    overrides.clear();
    epoch += 1;
  }

  function syncGameScene(): number {
    const scene = locator.gameScene();
    if (scene && currentScene && scene !== currentScene) resetForScene();
    if (scene) currentScene = scene;
    patchSeat(asRecord(scene?.SelfSeatUi)?.seat);
    const managers = seatManagers(scene);
    managers.forEach((manager) => {
      patchSeatManager(manager);
      patchSeat(manager.seat);
    });
    if (!otherOn()) {
      hideOwnSkinButtons();
      cancelAllSessions();
      overrides.clear();
    }
    return managers.length;
  }

  function waitForSeats(): void {
    void tasks.poll(() => (locator.gameScene() ? syncGameScene() > 0 : false), 60, 500);
  }

  // ---------- 换肤框原型：他人换肤接管初始化与确认 ----------

  function patchPickerPrototype(view: unknown): void {
    const prototype = prototypeOf(view);
    if (!prototype) return;
    patcher.wrap(prototype, 'initUsingSKinID', (original) => function (this: UnknownRecord, generalID: unknown, ...rest: unknown[]) {
      const session = sessionFor(this, Number(generalID));
      if (session && Number(generalID) === session.generalID) {
        if (sessionValid(session)) {
          bindSession(this, session);
          if (openingSession === session) openingSession = null;
          return undefined;
        }
        sessionByView.set(this, session);
      }
      const result = original.call(this, generalID, ...rest);
      if (!(Number(this.usingSkinID) > 0)) {
        const manager = locator.manager('GeneralSkinManager');
        const using = callMethod(manager, 'GetSelfUsingSkinID', generalID);
        if (using !== undefined) this.usingSkinID = using;
      }
      return result;
    });
    patcher.wrap(prototype, 'UpdateInfo', (original) => function (this: UnknownRecord, generalID: unknown, ...rest: unknown[]) {
      const result = original.call(this, generalID, ...rest);
      const session = sessionFor(this, Number(generalID));
      if (session && Number(generalID) === session.generalID) {
        if (sessionValid(session)) {
          bindSession(this, session);
          callMethod(this, 'sortList');
          callMethod(this, 'updateContent');
        } else {
          sessionByView.set(this, session);
        }
      }
      const view = this;
      void tasks.poll(() => owningWindowName(view), 30, 100).then((windowName) => {
        skinTrace('update-info', { generalID, windowName, session: Boolean(session) });
        if (windowName) void applyPreview(windowName);
      });
      return result;
    });
    patcher.wrap(prototype, 'closeSelectSure', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const other = finishOtherSelection(this);
      return other.handled ? other.applied : original.apply(this, args);
    });
  }

  /** 换肤框首次打开前就要接管 initUsingSKinID，因此启动时临时建一个实例取原型。 */
  function preparePickerPrototype(): void {
    for (const name of SKIN_WINDOWS) {
      const instance = locator.createInstance(name);
      if (!instance) continue;
      patchPickerPrototype(instance.selectView);
      skinTrace('picker-prototype', { name, viewFound: Boolean(instance.selectView) });
      try {
        callMethod(instance, 'destroy', true);
      } catch {
        // 临时实例销毁失败不影响补丁。
      }
    }
  }

  function onSkinWindowShown(windowName: string): void {
    const view = asRecord(skinWindow(windowName)?.selectView);
    skinTrace('window-show', { windowName, windowFound: Boolean(skinWindow(windowName)), viewFound: Boolean(view), openingSession: Boolean(openingSession) });
    if (view) patchPickerPrototype(view);
    void applyPreview(windowName);
  }

  unsubscribes.push(
    configStore.subscribe('skin.localSkin', () => syncOpenWindows()),
    configStore.subscribe('skin.otherLocalSkin', () => {
      syncGameScene();
      if (otherOn()) waitForSeats();
    })
  );

  watchWindowShow(locator, patcher, tasks, SKIN_WINDOWS, onSkinWindowShown);
  watchSceneSwitch(locator, patcher, tasks, () => {
    syncGameScene();
    waitForSeats();
    syncOpenWindows();
  });
  void tasks.poll(() => locator.dispatcher() && locator.manager('WindowManager'), Infinity, 1000).then((ready) => {
    if (!ready) return;
    preparePickerPrototype();
    syncGameScene();
    if (locator.gameScene()) waitForSeats();
  });

  return {
    filterMessage,
    dispose() {
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      tasks.dispose();
      restorePreview();
      hideOwnSkinButtons();
      cancelAllSessions();
      overrides.clear();
      patcher.restoreAll();
    }
  };
}
