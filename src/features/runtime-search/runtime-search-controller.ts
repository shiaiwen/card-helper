import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type PatchableFunction } from '../../runtime/method-patch.ts';

type UnknownRecord = Record<string, any>;

interface SearchControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  pollIntervalMs?: number;
}

interface SearchInput extends UnknownRecord {
  text?: string;
  on?: (event: string, caller: unknown, listener: () => void) => void;
  off?: (event: string, caller: unknown, listener: () => void) => void;
}

interface SearchState {
  input: SearchInput;
  container: UnknownRecord;
  dispose(): void;
}

interface BagSearchState extends SearchState {
  keyword: string;
  filtering: boolean;
  fullList: unknown[];
  filteredList: unknown[];
  originalShowBags: PatchableFunction;
  originalUpdatePageIdx?: PatchableFunction;
}

interface GeneralPoolSearchState extends SearchState {
  keyword: string;
  originalUpdateItems: PatchableFunction;
  originalLayout?: PatchableFunction;
  placeSearch(): void;
}

const BAG_STATE_KEY = '__xiaochaoBagSearch';
const GENERAL_POOL_STATE_KEY = '__xiaochaoGeneralPoolSearch';
const POOL_WINDOW_NAMES = ['ModeGeneralPoolWindow'];
const POOL_ATTACH_METHODS = ['Init', 'layout', 'onOpened'];

/** 给游戏原生背包和将池窗口增加搜索输入框。 */
export function installRuntimeSearchController(
  options: SearchControllerOptions = {}
): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const activeStates = new Set<SearchState>();
  let disposed = false;

  const installPatches = () => {
    if (disposed) return;
    const bagPrototype = locator.classPrototype('BagView');
    if (bagPrototype && !patcher.isWrapped(bagPrototype, 'Init')) {
      patcher.wrap(bagPrototype, 'Init', (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        attachBagSearch(this, globalObject, activeStates);
        return result;
      });
    }

    for (const windowName of POOL_WINDOW_NAMES) {
      const poolPrototype = locator.classPrototype(windowName);
      if (!poolPrototype) continue;
      for (const methodName of POOL_ATTACH_METHODS) {
        if (typeof poolPrototype[methodName] !== 'function' || patcher.isWrapped(poolPrototype, methodName)) {
          continue;
        }
        patcher.wrap(poolPrototype, methodName, (original) => function (this: UnknownRecord, ...args: unknown[]) {
          const result = original.apply(this, args);
          attachGeneralPoolSearch(this, globalObject, activeStates);
          return result;
        });
      }
    }

    for (const windowName of POOL_WINDOW_NAMES) {
      const current = locator.window(windowName);
      if (current && current.destroyed !== true) {
        attachGeneralPoolSearch(current, globalObject, activeStates);
      }
      for (const extra of locator.findWindows(windowName)) {
        if (extra.destroyed !== true) {
          attachGeneralPoolSearch(extra, globalObject, activeStates);
        }
      }
    }

    for (const state of [...activeStates]) {
      const poolWindow = asRecord(state.container.parent);
      if (poolWindow?.destroyed === true) state.dispose();
    }
  };

  installPatches();
  const timer = globalObject.setInterval?.(installPatches, options.pollIntervalMs ?? 800);

  return () => {
    disposed = true;
    if (timer != null) globalObject.clearInterval?.(timer);
    patcher.restoreAll();
    for (const state of activeStates) state.dispose();
    activeStates.clear();
  };
}

function attachBagSearch(
  bagView: UnknownRecord,
  globalObject: LayaRuntimeWindow,
  activeStates: Set<SearchState>
): void {
  if (bagView[BAG_STATE_KEY] || typeof bagView.showBags !== 'function') return;
  const search = createSearchInput(globalObject, '搜索道具', 180, 24);
  if (!search) return;
  search.container.name = 'xiaochao-bag-search-container';
  search.container.pos?.(520, 28);
  bagView.addChild?.(search.container);

  const originalShowBags = bagView.showBags as PatchableFunction;
  const originalUpdatePageIdx = typeof bagView.updatePageIdx === 'function'
    ? bagView.updatePageIdx as PatchableFunction
    : undefined;
  const state: BagSearchState = {
    ...search,
    keyword: '',
    filtering: false,
    fullList: [],
    filteredList: [],
    originalShowBags,
    originalUpdatePageIdx,
    dispose: () => undefined
  };

  const refresh = debounce(globalObject, () => {
    state.keyword = normalizeKeyword(state.input.text);
    state.filtering = true;
    bagView.curPage = 1;
    const source = state.fullList.length > 0
      ? state.fullList
      : asArray(bagView.bagDatas);
    state.filteredList = filterBagItems(source, state.keyword);
    state.originalShowBags.call(bagView, state.filteredList);
    if (state.keyword) bagView.bagDatas = source;
    state.filtering = false;
    bagView.updatePageIdx?.();
  }, 100);

  bagView.showBags = function (items: unknown) {
    const nextItems = asArray(items);
    if (!state.filtering) state.fullList = nextItems;
    if (!state.keyword || state.filtering) {
      state.filteredList = [];
      return state.originalShowBags.call(this, nextItems);
    }
    state.filteredList = filterBagItems(state.fullList, state.keyword);
    const result = state.originalShowBags.call(this, state.filteredList);
    this.bagDatas = state.fullList;
    return result;
  };

  if (originalUpdatePageIdx) {
    bagView.updatePageIdx = function (...args: unknown[]) {
      if (!state.keyword) return state.originalUpdatePageIdx?.apply(this, args);
      const originalData = this.bagDatas;
      this.bagDatas = state.filteredList;
      try {
        return state.originalUpdatePageIdx?.apply(this, args);
      } finally {
        this.bagDatas = originalData;
      }
    };
  }

  const inputEvent = String(globalObject.Laya?.Event?.INPUT ?? 'input');
  state.input.on?.(inputEvent, bagView, refresh);
  state.dispose = () => {
    state.input.off?.(inputEvent, bagView, refresh);
    refresh.cancel();
    if (bagView.showBags !== originalShowBags) bagView.showBags = originalShowBags;
    if (originalUpdatePageIdx && bagView.updatePageIdx !== originalUpdatePageIdx) {
      bagView.updatePageIdx = originalUpdatePageIdx;
    }
    if (bagView[BAG_STATE_KEY] === state) delete bagView[BAG_STATE_KEY];
    destroyNode(state.container);
    activeStates.delete(state);
  };
  bagView[BAG_STATE_KEY] = state;
  activeStates.add(state);
}

function attachGeneralPoolSearch(
  poolWindow: UnknownRecord,
  globalObject: LayaRuntimeWindow,
  activeStates: Set<SearchState>
): void {
  const existing = poolWindow[GENERAL_POOL_STATE_KEY] as GeneralPoolSearchState | undefined;
  if (existing) {
    existing.placeSearch();
    return;
  }
  const updateItemsName = resolvePoolUpdateItemsName(poolWindow);
  if (!updateItemsName) return;
  const search = createSearchInput(globalObject, '搜索武将', 170, 24);
  if (!search) return;
  search.container.name = 'xiaochao-general-pool-search-container';
  search.container.zOrder = 0;
  const searchHost = asRecord(poolWindow.contentSprite) ?? poolWindow;
  searchHost.addChild?.(search.container);

  const originalUpdateItems = poolWindow[updateItemsName] as PatchableFunction;
  const originalLayout = typeof poolWindow.layout === 'function'
    ? poolWindow.layout as PatchableFunction
    : undefined;
  const state: GeneralPoolSearchState = {
    ...search,
    keyword: '',
    originalUpdateItems,
    originalLayout,
    placeSearch: () => undefined,
    dispose: () => undefined
  };

  const placeSearch = () => {
    const width = finite(search.container.width, 170);
    const height = finite(search.container.height, 24);
    const button = poolWindow.closeAllBtn ?? poolWindow.openBtn;
    if (button) {
      const x = finite(button.x) + finite(button.width) + 8;
      const y = finite(button.y) + Math.max(0, (finite(button.height) - height) / 2);
      search.container.pos?.(x, y);
      search.container.visible = button.visible !== false;
      return;
    }
    search.container.visible = false;
  };
  state.placeSearch = placeSearch;
  placeSearch();

  poolWindow[updateItemsName] = function (...args: unknown[]) {
    if (!state.keyword) return state.originalUpdateItems.apply(this, args);
    const generals = Array.isArray(args[1]) ? args[1] : [];
    return state.originalUpdateItems.call(this, args[0], filterGenerals(generals, state.keyword), ...args.slice(2));
  };
  if (originalLayout) {
    poolWindow.layout = function (...args: unknown[]) {
      const result = state.originalLayout?.apply(this, args);
      placeSearch();
      return result;
    };
  }

  const refresh = debounce(globalObject, () => {
    state.keyword = normalizeKeyword(state.input.text);
    const selectedIndex = poolWindow.tabGroup?.selectedIndex
      ?? poolWindow.tabGroup?.selected
      ?? 0;
    if (typeof poolWindow.tabClicked === 'function') {
      poolWindow.tabClicked(selectedIndex);
      return;
    }
    poolWindow[updateItemsName]?.();
  }, 100);
  const inputEvent = String(globalObject.Laya?.Event?.INPUT ?? 'input');
  const enterEvent = String(globalObject.Laya?.Event?.ENTER ?? 'enter');
  state.input.on?.(inputEvent, poolWindow, refresh);
  state.input.on?.(enterEvent, poolWindow, refresh);
  state.dispose = () => {
    state.input.off?.(inputEvent, poolWindow, refresh);
    state.input.off?.(enterEvent, poolWindow, refresh);
    refresh.cancel();
    if (poolWindow[updateItemsName] !== originalUpdateItems) {
      poolWindow[updateItemsName] = originalUpdateItems;
    }
    if (originalLayout && poolWindow.layout !== originalLayout) {
      poolWindow.layout = originalLayout;
    }
    if (poolWindow[GENERAL_POOL_STATE_KEY] === state) delete poolWindow[GENERAL_POOL_STATE_KEY];
    destroyNode(state.container);
    activeStates.delete(state);
  };
  poolWindow[GENERAL_POOL_STATE_KEY] = state;
  activeStates.add(state);
}

function resolvePoolUpdateItemsName(poolWindow: UnknownRecord): string | null {
  for (const name of ['updateItems', 'UpdateItems', 'updateGeneralItems']) {
    if (typeof poolWindow[name] === 'function') return name;
  }
  return null;
}

function createSearchInput(
  globalObject: LayaRuntimeWindow,
  prompt: string,
  width: number,
  height: number
): Omit<SearchState, 'dispose'> | null {
  const Laya = globalObject.Laya as UnknownRecord | undefined;
  const Sprite = Laya?.Sprite;
  const TextInput = Laya?.TextInput;
  if (typeof Sprite !== 'function' || typeof TextInput !== 'function') return null;
  try {
    const container = new Sprite() as UnknownRecord;
    container.size?.(width, height);
    container.graphics?.drawRect?.(0, 0, width, height, '#201A12', '#8B6F3A', 1);
    container.zOrder = 10;
    const input = new TextInput('') as SearchInput;
    input.size?.(width - 12, height - 4);
    input.pos?.(6, 2);
    input.color = '#E8D7AA';
    input.prompt = prompt;
    input.promptColor = '#8F8060';
    input.font = 'SimSun';
    input.fontSize = 14;
    input.align = 'left';
    input.valign = 'middle';
    input.padding = '2,4,2,4';
    input.bg = null;
    input.mouseEnabled = true;
    container.mouseEnabled = true;
    container.addChild?.(input);
    return { input, container };
  } catch (error) {
    console.warn(`[搜索] 创建“${prompt}”输入框失败`, error);
    return null;
  }
}

function filterBagItems(items: unknown[], keyword: string): unknown[] {
  if (!keyword) return items;
  return items.filter((item) => {
    const record = asRecord(item);
    const baseInfo = asRecord(record?.baseInfo);
    return searchableText(baseInfo, record).includes(keyword);
  });
}

function filterGenerals(items: unknown[], keyword: string): unknown[] {
  if (!keyword) return items;
  return items.filter((item) => {
    const record = asRecord(item);
    return searchableText(
      record,
      asRecord(record?.baseInfo),
      asRecord(record?.general),
      asRecord(record?.generalVo),
      asRecord(record?.vo),
      asRecord(record?.data)
    ).includes(keyword);
  });
}

function searchableText(...records: Array<UnknownRecord | null>): string {
  const fields = [
    'specifyName', 'name', 'Name', 'cnName', 'generalName', 'GeneralName',
    'showName', 'title', 'desc', 'description', 'id', 'Id', 'generalId', 'GeneralId'
  ];
  return records.flatMap((record) => fields.map((field) => record?.[field]))
    .filter((value) => value !== undefined && value !== null)
    .join('')
    .toLocaleLowerCase();
}

function normalizeKeyword(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function destroyNode(node: UnknownRecord): void {
  try {
    node.removeSelf?.();
    node.destroy?.(true);
  } catch {
    // 宿主窗口可能已经先一步销毁。
  }
}

function debounce(globalObject: LayaRuntimeWindow, callback: () => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = () => {
    if (timer != null) globalObject.clearTimeout?.(timer);
    timer = globalObject.setTimeout?.(() => {
      timer = undefined;
      callback();
    }, delay) as ReturnType<typeof setTimeout> | undefined;
  };
  wrapped.cancel = () => {
    if (timer != null) globalObject.clearTimeout?.(timer);
    timer = undefined;
  };
  return wrapped;
}
