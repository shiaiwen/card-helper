/**
 * 皮肤收藏 Tab：在游戏皮肤相关界面扩展收藏列表交互。
 */

import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { MethodPatcher, PatchableFunction } from '../../runtime/method-patch.ts';
import type { BackgroundFavorite, BackgroundResource, SkinBackgroundStore } from './skin-background-store.ts';
import { asRecord, callMethod, type UnknownRecord } from './skin-runtime.ts';

const TAB_VALUE = 'xcSkinBackgroundFavorites';
const TAB_MARKER = '__xcSkinBackgroundFavoritesTab';
const PREVIEW_WIDTH = 95;
const PREVIEW_HEIGHT = 40;

export interface FavoritesTabOptions {
  globalObject: LayaRuntimeWindow;
  store: SkinBackgroundStore;
  patcher: MethodPatcher;
  enabled(): boolean;
  /** 点击收藏项时设为背景。 */
  applyFavorite(resource: BackgroundResource): Promise<boolean>;
  /** 收藏项是否为当前背景。 */
  isCurrent(favorite: BackgroundFavorite): boolean;
}

export interface FavoritesTab {
  attach(menu: UnknownRecord): void;
  detach(menu: UnknownRecord): void;
  /** 当前背景变化后刷新选中态。 */
  refreshSelection(): void;
  dispose(): void;
}

interface MenuState {
  panel?: UnknownRecord;
  items: UnknownRecord[];
  empty?: UnknownRecord;
  loadMoreVisibility?: { text: unknown; background: unknown };
  tabEvent?: string;
  tabBound?: boolean;
}

/** 背景面板中的「小抄背景」页签。 */
export function createFavoritesTab(options: FavoritesTabOptions): FavoritesTab {
  const { globalObject, store, patcher } = options;
  const states = new WeakMap<object, MenuState>();
  const menus = new Set<UnknownRecord>();
  const previewTextures = new WeakMap<object, UnknownRecord>();
  const nativeTabClick = new WeakMap<object, PatchableFunction>();
  let itemConstructor: (new () => UnknownRecord) | null = null;
  let panelConstructor: (new () => UnknownRecord) | null = null;

  const laya = () => asRecord(globalObject.Laya);
  const layaEvent = () => asRecord(laya()?.Event);

  function stateOf(menu: UnknownRecord): MenuState {
    let state = states.get(menu);
    if (!state) {
      state = { items: [] };
      states.set(menu, state);
    }
    return state;
  }

  function isSelected(menu: UnknownRecord): boolean {
    return asRecord(menu.tabGroup)?.SelectedValue === TAB_VALUE;
  }

  function rememberConstructors(menu: UnknownRecord): void {
    const skinItems = Array.isArray(menu.wallPaperSkinItems) ? menu.wallPaperSkinItems as unknown[] : [];
    const item = skinItems.map(asRecord).find((entry) => typeof entry?.constructor === 'function');
    if (item) itemConstructor = item.constructor as new () => UnknownRecord;
    const panel = asRecord(menu.panel);
    if (typeof panel?.constructor === 'function') panelConstructor = panel.constructor as new () => UnknownRecord;
  }

  // ---------- 列表项 ----------

  function clearItems(menu: UnknownRecord): void {
    const state = stateOf(menu);
    state.items.splice(0).forEach((item) => callMethod(item, 'destroy', true));
    callMethod(state.empty, 'destroy', true);
    state.empty = undefined;
  }

  function ensurePanel(menu: UnknownRecord): UnknownRecord | null {
    const state = stateOf(menu);
    if (state.panel && state.panel !== menu.panel && !state.panel.destroyed) return state.panel;
    const nativePanel = asRecord(menu.panel);
    if (typeof nativePanel?.constructor === 'function') panelConstructor = nativePanel.constructor as new () => UnknownRecord;
    const PanelClass = panelConstructor;
    if (!PanelClass) return null;
    let panel: UnknownRecord;
    try {
      panel = new PanelClass();
    } catch {
      return null;
    }
    panel.name = 'WallSkinPanel';
    callMethod(panel, 'size',
      Number(nativePanel?.width) || 311,
      Number(nativePanel?.height) || Math.max(200, Number(menu.panelHeight) - 20 || 400));
    callMethod(panel, 'pos', Number(nativePanel?.x) || 0, Number(nativePanel?.y) || 10);
    panel.visible = false;
    panel.mouseEnabled = true;
    const tabIndex = Number(callMethod(menu, 'getChildIndex', menu.tabGroup));
    if (Number.isInteger(tabIndex) && tabIndex >= 0 && typeof menu.addChildAt === 'function') callMethod(menu, 'addChildAt', panel, tabIndex);
    else callMethod(menu, 'addChild', panel);
    state.panel = panel;
    return panel;
  }

  function previewUrl(favorite: BackgroundFavorite): string {
    return favorite.resource.type === 0 && favorite.resource.url ? favorite.resource.url : favorite.previewUrl;
  }

  function textureAlive(texture: unknown): boolean {
    const bitmap = asRecord(asRecord(texture)?.bitmap);
    return Boolean(bitmap) && bitmap!.destroyed !== true && bitmap!._destroyed !== true && bitmap!.released !== true;
  }

  function releasePreview(item: UnknownRecord): void {
    const background = asRecord(item.bg);
    const cropped = background ? previewTextures.get(background) : undefined;
    if (!background || !cropped) return;
    previewTextures.delete(background);
    const source = asRecord(cropped.__xcSourceTexture);
    callMethod(source, '_removeReference');
    callMethod(cropped, 'destroy', false);
  }

  /** 预览图按 95×40 居中裁切。 */
  function cropPreview(item: UnknownRecord): boolean {
    const background = asRecord(item.bg);
    if (!background) return false;
    const texture = asRecord(background.texture);
    if (!texture || (background.skin && texture.url !== background.skin)) {
      callMethod(background, 'size', PREVIEW_WIDTH, PREVIEW_HEIGHT);
      return false;
    }
    if (!textureAlive(texture)) return reloadPreview(item);
    if (texture === previewTextures.get(background)) return true;
    const width = Number(texture.width);
    const height = Number(texture.height);
    if (!(width > 0 && height > 0)) return false;
    const ratio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
    let cropWidth = width;
    let cropHeight = height;
    let offsetX = 0;
    let offsetY = 0;
    if (width / height > ratio) {
      cropWidth = height * ratio;
      offsetX = (width - cropWidth) / 2;
    } else if (width / height < ratio) {
      cropHeight = width / ratio;
      offsetY = (height - cropHeight) / 2;
    }
    const TextureClass = asRecord(laya()?.Texture);
    const cropped = asRecord(callMethod(TextureClass, 'createFromTexture', texture, offsetX, offsetY, cropWidth, cropHeight));
    if (!cropped) return false;
    Object.defineProperty(cropped, 'url', { value: String(background.skin || texture.url) });
    callMethod(texture, '_addReference');
    cropped.__xcSourceTexture = texture;
    releasePreview(item);
    previewTextures.set(background, cropped);
    background.texture = cropped;
    callMethod(background, 'size', PREVIEW_WIDTH, PREVIEW_HEIGHT);
    return true;
  }

  function armPreview(item: UnknownRecord): void {
    const background = asRecord(item.bg);
    const complete = layaEvent()?.COMPLETE;
    if (!background || !complete) return;
    callMethod(background, 'off', complete, item, onPreviewLoaded);
    callMethod(background, 'once', complete, item, onPreviewLoaded);
  }

  function onPreviewLoaded(this: UnknownRecord): void {
    cropPreview(this);
  }

  /** 纹理被回收后重新加载。 */
  function reloadPreview(item: UnknownRecord): boolean {
    const background = asRecord(item.bg);
    const skin = String(background?.skin || '');
    if (!background || !skin) return false;
    try {
      callMethod(asRecord(laya()?.loader), 'clearRes', skin, true);
    } catch {
      // 清缓存失败时仍尝试重新赋值。
    }
    background.skin = '';
    background.skin = skin;
    armPreview(item);
    return true;
  }

  function createItem(menu: UnknownRecord, favorite: BackgroundFavorite, index: number, panel: UnknownRecord): UnknownRecord | null {
    const ItemClass = itemConstructor;
    if (!ItemClass) return null;
    let item: UnknownRecord;
    try {
      item = new ItemClass();
    } catch {
      return null;
    }
    const clickEvent = layaEvent()?.CLICK;
    const selectButton = asRecord(item.selectedBtn);
    if (selectButton && typeof item.onSelectedClicked === 'function') {
      callMethod(selectButton, 'off', clickEvent, item, item.onSelectedClicked);
    }
    const choose = async (event?: unknown) => {
      callMethod(event, 'stopPropagation');
      if (!options.enabled()) return false;
      const applied = await options.applyFavorite(favorite.resource);
      if (applied) refreshSelection();
      return applied;
    };
    item.onSelectedClicked = choose;
    item.useWall = choose;
    item.UpdateSelectedUI = function (this: UnknownRecord) {
      const selected = asRecord(this.selectedImg);
      if (selected) selected.visible = options.isCurrent(favorite);
      const background = asRecord(this.bg);
      if (background) background.visible = true;
      const texture = background?.texture;
      if (background && texture && texture === previewTextures.get(background) && !textureAlive(texture)) reloadPreview(this);
    };
    const nativeUpdate = item.updateUI;
    if (typeof nativeUpdate === 'function') {
      item.updateUI = function (this: UnknownRecord, ...args: unknown[]) {
        const background = asRecord(this.bg);
        if (background) {
          armPreview(this);
          callMethod(background, 'size', PREVIEW_WIDTH, PREVIEW_HEIGHT);
          background.scrollRect = null;
        }
        const result = (nativeUpdate as PatchableFunction).apply(this, args);
        if (background) background.visible = true;
        return result;
      };
    }
    const nativeDestroy = item.destroy;
    if (typeof nativeDestroy === 'function') {
      item.destroy = function (this: UnknownRecord, ...args: unknown[]) {
        const result = (nativeDestroy as PatchableFunction).apply(this, args);
        releasePreview(this);
        return result;
      };
    }
    callMethod(selectButton, 'on', clickEvent, item, choose);
    callMethod(panel, 'addChild', item);
    callMethod(item, 'UpdateData', {
      ID: -(index + 1),
      SkinID: Number(favorite.skinId) || 0,
      Name: favorite.name,
      IconURL: previewUrl(favorite),
      IsUsual: false,
      canUsed: true
    });
    callMethod(item, 'pos', 5 + 101 * (index % 3), 1 + 65 * Math.floor(index / 3));
    item.visible = true;
    item.mouseEnabled = true;
    return item;
  }

  function createEmptyHint(panel: UnknownRecord, hasFavorites: boolean): UnknownRecord | null {
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    const TextClass = laya()?.Text as (new () => UnknownRecord) | undefined;
    if (!SpriteClass || !TextClass) return null;
    const hint = new SpriteClass();
    const text = new TextClass();
    const width = Number(panel.width) || 311;
    const height = Math.max(100, Number(panel.height) || 400);
    Object.assign(text, {
      text: hasFavorites ? '皮肤背景列表尚未就绪' : '还没有收藏背景\n请在皮肤详情中点击“收藏背景”',
      font: 'SimSun',
      fontSize: 12,
      color: '#DDCF98',
      align: 'center',
      valign: 'middle',
      leading: 8,
      mouseEnabled: false
    });
    callMethod(text, 'size', width, height);
    callMethod(hint, 'size', width, height);
    hint.mouseEnabled = false;
    hint.Drawed = false;
    hint.Draw = function (this: UnknownRecord) {
      this.Drawed = true;
      this.visible = true;
    };
    hint.ClearDraw = function (this: UnknownRecord) {
      this.Drawed = false;
      this.visible = false;
    };
    callMethod(hint, 'addChild', text);
    callMethod(panel, 'addChild', hint);
    return hint;
  }

  /** 重建收藏列表。 */
  function renderList(menu: UnknownRecord): boolean {
    rememberConstructors(menu);
    const panel = ensurePanel(menu);
    if (!panel) return false;
    clearItems(menu);
    const state = stateOf(menu);
    const favorites = store.favorites();
    if (!favorites.length || !itemConstructor) {
      state.empty = createEmptyHint(panel, favorites.length > 0) ?? undefined;
    } else {
      favorites.forEach((favorite, index) => {
        const item = createItem(menu, favorite, index, panel);
        if (item) state.items.push(item);
      });
    }
    callMethod(panel, 'UpdateDrawContent');
    const scrollBar = asRecord(panel.vScrollBar);
    callMethod(scrollBar, 'stopScroll');
    if (scrollBar) scrollBar.value = 0;
    callMethod(panel, 'refresh');
    return true;
  }

  function toggleLoadMore(menu: UnknownRecord, hide: boolean): void {
    const state = stateOf(menu);
    const text = asRecord(menu.loadMoreTxt);
    const background = asRecord(menu.loadMoreBg);
    if (hide) {
      state.loadMoreVisibility ??= { text: text?.visible, background: background?.visible };
      if (text) text.visible = false;
      if (background) background.visible = false;
      return;
    }
    const saved = state.loadMoreVisibility;
    if (!saved) return;
    if (text) text.visible = saved.text;
    if (background) background.visible = saved.background;
    state.loadMoreVisibility = undefined;
  }

  /** 显示或隐藏收藏面板。 */
  function showPanel(menu: UnknownRecord, show: boolean, restoreLoadMore = true): boolean {
    const state = stateOf(menu);
    if (!show) {
      if (restoreLoadMore) toggleLoadMore(menu, false);
      if (state.panel && state.panel !== menu.panel) state.panel.visible = false;
      return true;
    }
    const favorites = store.favorites();
    (Array.isArray(menu.wallPaperItems) ? menu.wallPaperItems as unknown[] : []).forEach((item) => {
      const record = asRecord(item);
      if (record) record.visible = false;
    });
    const noSkin = asRecord(menu.noSkinWallSpr);
    if (noSkin) noSkin.visible = false;
    rememberConstructors(menu);
    if (!menu.panel || (favorites.length && !itemConstructor)) {
      // 原生面板与列表项在首次“加载更多”时才创建，借它拿到构造器。
      const visible = menu.visible !== false;
      if (visible) menu.visible = false;
      try {
        callMethod(menu, 'loadMore');
      } finally {
        if (visible) menu.visible = true;
      }
      rememberConstructors(menu);
    }
    const nativePanel = asRecord(menu.panel);
    if (nativePanel) nativePanel.visible = false;
    toggleLoadMore(menu, true);
    const panel = ensurePanel(menu);
    if (!panel) return false;
    renderList(menu);
    panel.visible = true;
    return true;
  }

  // ---------- 页签 ----------

  /** 复制第一个原生页签按钮的样式，建立「小抄背景」页签。 */
  function ensureTab(menu: UnknownRecord): UnknownRecord | null {
    const group = asRecord(menu.tabGroup);
    const buttons = group?.BtnList;
    if (!group || !Array.isArray(buttons)) return null;
    const existing = buttons.map(asRecord).find((button) => button?.value === TAB_VALUE || button?.[TAB_MARKER]);
    if (existing) return existing;
    const template = asRecord(buttons[0]);
    let tab: UnknownRecord | null = null;
    try {
      tab = typeof template?.constructor === 'function' ? new (template.constructor as new () => UnknownRecord)() : null;
    } catch {
      tab = null;
    }
    if (!tab) return null;
    const skins = Array.isArray(template?.skins) ? Array.from(template!.skins as unknown[]) : [];
    if (skins.some(Boolean) && typeof tab.InitSkin === 'function') callMethod(tab, 'InitSkin', ...skins);
    else callMethod(tab, 'init');
    if (template) {
      callMethod(tab, 'size', Number(template.width) || Number(tab.width) || 0, Number(template.height) || Number(tab.height) || 0);
      const field = asRecord(template.textField);
      if (field?.font) tab.labelFont = field.font;
      if (Number(field?.fontSize) > 0) tab.labelSize = Number(field!.fontSize);
      if (typeof field?.bold === 'boolean') tab.labelBold = field.bold;
      if (Number(field?.stroke) > 0) tab.labelStroke = Number(field!.stroke);
      if (Array.isArray(template._labelColors)) tab.labelColors = (template._labelColors as unknown[]).join(',');
      if (Array.isArray(template._strokeColors)) tab.strokeColors = (template._strokeColors as unknown[]).join(',');
      if (Array.isArray(template._labelPadding)) tab.labelPadding = (template._labelPadding as unknown[]).join(',');
      if (template._soundRes) tab.soundRes = template._soundRes;
    }
    Object.assign(tab, {
      label: '小抄背景',
      value: TAB_VALUE,
      name: 'ChangeBgSkinBtn',
      [TAB_MARKER]: true,
      visible: true,
      enabled: true,
      mouseEnabled: true
    });
    buttons.splice(Math.min(2, buttons.length), 0, tab);
    callMethod(group, 'addChild', tab);
    callMethod(tab, 'AfterInitUiByGroup', { label: tab.label, value: tab.value });
    callMethod(group, 'layout');
    callMethod(group, 'LayoutBtn');
    return tab;
  }

  /** 接管页签切换与列表刷新。 */
  function bindTabSwitch(menu: UnknownRecord): boolean {
    const group = asRecord(menu.tabGroup);
    const prototype = Object.getPrototypeOf(menu) as UnknownRecord | null;
    if (!group || !prototype || typeof prototype.onTabClick !== 'function') return false;
    patcher.wrap(prototype, 'onTabClick', (original) => {
      nativeTabClick.set(prototype, original);
      return function (this: UnknownRecord, ...args: unknown[]) {
        const value = Array.isArray(args[0]) ? args[0][0] : args[0];
        if (value === TAB_VALUE && options.enabled()) return showPanel(this, true);
        showPanel(this, false, false);
        try {
          return original.apply(this, args);
        } finally {
          stateOf(this).loadMoreVisibility = undefined;
        }
      };
    });
    if (typeof prototype.RefreList === 'function') {
      patcher.wrap(prototype, 'RefreList', (original) => function (this: UnknownRecord, ...args: unknown[]) {
        if (isSelected(this) && options.enabled()) return showPanel(this, true);
        return original.apply(this, args);
      });
    }
    const state = stateOf(menu);
    if (!state.tabBound) {
      const eventName = String(asRecord(group.constructor)?.TAP_CLICKED || 'TAP_CLICKED');
      const native = nativeTabClick.get(prototype);
      if (native) callMethod(group, 'off', eventName, menu, native);
      callMethod(group, 'off', eventName, menu, prototype.onTabClick);
      callMethod(group, 'on', eventName, menu, prototype.onTabClick);
      state.tabEvent = eventName;
      state.tabBound = true;
    }
    return true;
  }

  function attach(menu: UnknownRecord): void {
    if (!options.enabled()) {
      detach(menu);
      return;
    }
    if (!ensureTab(menu) || !bindTabSwitch(menu)) return;
    menus.add(menu);
    if (isSelected(menu)) showPanel(menu, true);
  }

  function detach(menu: UnknownRecord): void {
    const group = asRecord(menu.tabGroup);
    if (isSelected(menu)) callMethod(group, 'SelectTab', 0);
    showPanel(menu, false);
    const state = stateOf(menu);
    if (state.tabBound) {
      const prototype = Object.getPrototypeOf(menu) as UnknownRecord | null;
      const eventName = state.tabEvent || String(asRecord(group?.constructor)?.TAP_CLICKED || 'TAP_CLICKED');
      const native = prototype ? nativeTabClick.get(prototype) : undefined;
      callMethod(group, 'off', eventName, menu, prototype?.onTabClick);
      if (native) {
        callMethod(group, 'off', eventName, menu, native);
        callMethod(group, 'on', eventName, menu, native);
      }
    }
    clearItems(menu);
    const buttons = group?.BtnList;
    if (Array.isArray(buttons)) {
      for (let index = buttons.length - 1; index >= 0; index -= 1) {
        if (!asRecord(buttons[index])?.[TAB_MARKER]) continue;
        callMethod(buttons.splice(index, 1)[0], 'destroy', true);
      }
      callMethod(group, 'layout');
      callMethod(group, 'LayoutBtn');
    }
    if (state.panel && state.panel !== menu.panel) callMethod(state.panel, 'destroy', true);
    states.delete(menu);
    menus.delete(menu);
  }

  function liveMenus(): UnknownRecord[] {
    for (const menu of menus) {
      if (menu.destroyed) menus.delete(menu);
    }
    return [...menus];
  }

  function refreshSelection(): void {
    liveMenus().forEach((menu) => stateOf(menu).items.forEach((item) => callMethod(item, 'UpdateSelectedUI')));
  }

  const unsubscribe = store.onFavoritesChange(() => {
    liveMenus().forEach((menu) => {
      if (isSelected(menu)) renderList(menu);
    });
  });

  return {
    attach,
    detach,
    refreshSelection,
    dispose() {
      unsubscribe();
      liveMenus().forEach(detach);
    }
  };
}
