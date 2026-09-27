import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import type { WallpaperMenuExtension } from './official-background-controller.ts';
import { createFavoritesTab } from './skin-background-favorites-tab.ts';
import { createSkinBackgroundRenderer } from './skin-background-renderer.ts';
import { createSkinBackgroundStore, type BackgroundFavorite, type BackgroundResource } from './skin-background-store.ts';
import {
  asRecord,
  callMethod,
  createTaskScope,
  skinTrace,
  supportsDynamicSkin,
  watchSceneSwitch,
  watchWindowShow,
  type UnknownRecord
} from './skin-runtime.ts';

const MAP_SCENES = ['RogueLikeBigMapScene', 'RogueSmallMapScene'];
const DETAIL_BUTTON_GAP = 3;
const DETAIL_BUTTON_HEIGHT = 50;
const ICON_SIZE = 28;
/** 多形态皮肤原画数量缺省表（其余按文件名是否带 _N 推断）。 */
const SKIN_STATE_COUNTS: Record<number, number> = { 60500: 3, 62300: 2, 66100: 2 };

type SkinStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type IconKind = 'background' | 'favorite';

export interface SkinPaperController {
  readonly menuExtension: WallpaperMenuExtension;
  /** 协议分发前调用：出场、出杀、互动表情时播放背景动作。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface SkinPaperOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: SkinStorage;
  selfSeatId(): number | null;
  /** 开关变化时重新同步游戏背景面板（由官方背景控制器提供）。 */
  syncWallpaperMenu(): void;
}

/** 背景尺寸：16:9 横版 594×335，普通横版 536×380，竖版不支持做背景。 */
function backgroundSize(is169: unknown, isHorizontal: unknown): { width: number; height: number } {
  return { width: is169 ? 594 : isHorizontal ? 536 : 350, height: is169 ? 335 : isHorizontal ? 380 : 464 };
}

function isPortrait(is169: unknown, isHorizontal: unknown): boolean {
  return !is169 && !isHorizontal;
}

/**
 * 皮肤做背景与全局背景（对照 app.bak 的 br / VZ / VO / bD / V8 一组实现）：
 * 皮肤详情可保存图片、设为背景；换肤窗口悬停出“设为背景”图标。
 */
export function installSkinPaperController(
  configStore: XiaochaoConfigStore,
  options: SkinPaperOptions
): SkinPaperController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const patcher = createMethodPatcher();
  const tasks = createTaskScope();
  const store = createSkinBackgroundStore(storage);
  const renderer = createSkinBackgroundRenderer({ globalObject, locator, store, tasks });
  const laya = () => asRecord(globalObject.Laya);
  const layaEvent = () => asRecord(laya()?.Event);

  const isOn = () => configStore.get('skin.skinPaper') === true;
  const favoritesTab = createFavoritesTab({
    globalObject,
    store,
    patcher,
    enabled: isOn,
    applyFavorite: (resource) => applyBackground(resource),
    isCurrent: (favorite) => isCurrentFavorite(favorite)
  });

  function shouldShow(): boolean {
    if (!isOn()) return false;
    if (configStore.get('skin.allPaper') === true) {
      return !MAP_SCENES.includes(String(locator.scene()?.SceneName ?? ''));
    }
    return Boolean(locator.gameScene());
  }

  // ---------- 资源解析 ----------

  async function fetchSkinImage(url: string, preferBigSkin = true): Promise<{ response: Response; url: string } | null> {
    if (preferBigSkin) {
      const bigUrl = url.replace('/big/static/', '/big/bigSkin/');
      const response = await fetch(bigUrl);
      if (response.ok) return { response, url: bigUrl };
    }
    const response = await fetch(url);
    return response.ok ? { response, url } : null;
  }

  /** 静态原画优先取高清版并量出真实尺寸（对照 app.bak 的 VD）。 */
  async function measureStatic(url: string, width: number, height: number): Promise<BackgroundResource> {
    if (!url) return { url: '', type: 0, width, height };
    const found = await fetchSkinImage(url).catch(() => null);
    const finalUrl = found?.url || url;
    if (!found?.response.ok || typeof createImageBitmap !== 'function') return { url: finalUrl, type: 0, width, height };
    try {
      const bitmap = await createImageBitmap(await found.response.blob());
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return { url: finalUrl, type: 0, ...size };
    } catch {
      return { url: finalUrl, type: 0, width, height };
    }
  }

  function rememberDetailEffectClasses(win: UnknownRecord): void {
    const bigSprites = asRecord(win.skinBigSps);
    renderer.rememberEffectClass('BaseEffect', asRecord(bigSprites?.bgEffect)?.constructor);
    renderer.rememberEffectClass('BaseSpineEffect', asRecord(bigSprites?.spineBg)?.constructor);
  }

  /** 皮肤详情窗口当前展示的背景资源；视频皮肤返回 videoUrl。 */
  async function resolveDetailResource(win: UnknownRecord): Promise<{ resource?: BackgroundResource; videoUrl?: string } | null> {
    if (isPortrait(win.is169, win.isHor)) return null;
    const imageUrl = String(asRecord(win.skinImg)?.skin || '');
    if (!imageUrl) return null;
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    let { width, height } = backgroundSize(win.is169, win.isHor);
    let type = Number(win.isDynamicPlay) === 1 ? Number(base?.ResType) || 0 : 0;
    let url = String(base?.DynamicSkinBigSkeletonUrl || '');
    rememberDetailEffectClasses(win);
    if (type === 1) return { videoUrl: `${String(base?.DynamicSkinBigUrl || '')}.mp4` };
    if (type === 3) {
      if (base?.NewSkinJudge) url = String(callMethod(base, 'DynamicSkinBigSkeletonUrlNew', win.juexingState) || '');
      else type = 4;
    } else if (type !== 2 && type !== 4) {
      ({ url, width, height } = await measureStatic(imageUrl, width, height));
      type = 0;
    }
    return { resource: { url, type, width, height } };
  }

  /** 换肤窗口列表项对应的背景资源（对照 app.bak 的 Vq）。 */
  async function resolveItem(item: UnknownRecord): Promise<{ state: number; previewUrl: string; resource: BackgroundResource } | null> {
    const data = asRecord(item.skinData);
    const general = asRecord(item.paperGeneralInfo);
    if (!data || isPortrait(data.Is169, data.IsBanner)) return null;
    const state = Number(item.CurDynamicState) || 1;
    const { width, height } = backgroundSize(data.Is169, data.IsBanner);
    const dynamic = supportsDynamicSkin(item);
    let type = dynamic ? Number(data.ResType) || 0 : 0;
    let url = dynamic ? String(data.DynamicSkinBigSkeletonUrl || '') : '';
    if (type === 1) type = 0;
    if (type === 3) {
      if (data.NewSkinJudge) url = String(callMethod(data, 'DynamicSkinBigSkeletonUrlNew', state) || '');
      else type = 4;
    }
    const bigUrl = String(callMethod(data, 'SkinBigUrl', state) || '');
    if (![2, 3, 4].includes(type) || !url) {
      const imageUrl = bigUrl || String(general?.GeneralBigImgUrl || '');
      return { state: 0, previewUrl: imageUrl, resource: await measureStatic(imageUrl, width, height) };
    }
    return { state, previewUrl: bigUrl, resource: { url, type, width, height } };
  }

  // ---------- 收藏（对照 app.bak 的 bb / Vs / Vl） ----------

  function skinIdOf(source: UnknownRecord | null): string {
    const value = source?.skinID ?? source?.SkinID ?? source?.ID ?? source?.id ?? source?.baseID;
    return value === undefined || value === null ? '' : String(value);
  }

  function detailFavoriteId(win: UnknownRecord): string {
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    const generalId = Number(asRecord(win.skinData)?.generalID) || 0;
    const state = Number(win.juexingState ?? win.CurDynamicState ?? 0) || 0;
    const skinId = skinIdOf(base);
    if (skinId) return `${generalId}:${skinId}:${state}`;
    const image = String(asRecord(win.skinImg)?.skin || '');
    return image ? `resource:${image}:${state}` : '';
  }

  function itemFavoriteState(item: UnknownRecord): number {
    const type = Number(asRecord(item.skinData)?.ResType) || 0;
    return supportsDynamicSkin(item) && [2, 3, 4].includes(type) ? Number(item.CurDynamicState) || 1 : 0;
  }

  function itemFavoriteId(item: UnknownRecord, state: number): string {
    const data = asRecord(item.skinData);
    const skinId = data?.skinID ?? data?.SkinID ?? item.skinId ?? item.SkinID;
    if (skinId === undefined || skinId === null || skinId === '') return '';
    const generalId = Number(data?.generalID ?? asRecord(item.paperGeneralInfo)?.GeneralID) || 0;
    return `${generalId}:${String(skinId)}:${Number(state) || 0}`;
  }

  function isCurrentFavorite(favorite: BackgroundFavorite): boolean {
    const current = renderer.resource;
    return current.url === favorite.resource.url && Number(current.type) === Number(favorite.resource.type);
  }

  // ---------- 设为背景 ----------

  async function applyBackground(resource: Partial<BackgroundResource> | undefined, win?: UnknownRecord): Promise<boolean> {
    if (!resource?.url) {
      showToast('当前皮肤未找到可用背景资源', 'warning', 4000);
      return false;
    }
    callMethod(win, 'Close');
    try {
      if (win) await new Promise((resolve) => tasks.later(() => resolve(undefined), 300));
      if (!(await renderer.setBackground(resource))) {
        showToast('背景设置失败，请重试', 'error', 4000);
        return false;
      }
      favoritesTab.refreshSelection();
      showToast('背景设置成功', 'success', 4000);
      return true;
    } catch (error) {
      console.warn('[皮肤做背景] 设置失败:', error);
      showToast('背景设置失败，请重试', 'error', 4000);
      return false;
    }
  }

  // ---------- 皮肤详情窗口按钮（对照 app.bak 的 VZ） ----------

  function isVideoDetail(win: UnknownRecord): boolean {
    return Number(win.isDynamicPlay) === 1 && Number(asRecord(asRecord(win.skinData)?.skinBaseVo)?.ResType) === 1;
  }

  function setButtonPhase(button: UnknownRecord | null, phase: number): void {
    if (!button || (button.enabled === false && phase !== 3)) return;
    button.phase = phase;
    callMethod(button, 'changeState');
  }

  function drawHitArea(hit: UnknownRecord): void {
    const graphics = asRecord(hit.graphics);
    callMethod(graphics, 'clear');
    callMethod(graphics, 'drawRect', 0, 0, hit.width, hit.height, 'rgba(0,0,0,0.001)', null, 0);
  }

  /** 按钮本体不接收鼠标，由透明热区驱动按下态并响应点击。 */
  function ensureHitArea(
    win: UnknownRecord,
    index: number,
    button: UnknownRecord,
    width: number,
    onClick: (win: UnknownRecord) => unknown
  ): UnknownRecord | null {
    const key = `myFuncBtnHit${index}`;
    let hit = asRecord(win[key]);
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    const content = asRecord(win.contentSprite);
    if (!hit) {
      if (!SpriteClass || !content) return null;
      hit = new SpriteClass();
      Object.assign(hit, {
        name: `xcSkinInfoActionHit${index}`,
        mouseEnabled: true,
        mouseChildren: false,
        mouseThrough: false,
        hitTestPrior: true
      });
      const event = layaEvent();
      callMethod(hit, 'on', event?.MOUSE_OVER, hit, () => setButtonPhase(button, 1));
      callMethod(hit, 'on', event?.MOUSE_OUT, hit, () => setButtonPhase(button, 0));
      callMethod(hit, 'on', event?.MOUSE_DOWN, hit, () => setButtonPhase(button, 2));
      callMethod(hit, 'on', event?.MOUSE_UP, hit, () => setButtonPhase(button, 1));
      callMethod(hit, 'on', event?.CLICK, win, (clickEvent: unknown) => {
        callMethod(clickEvent, 'stopPropagation');
        void onClick(win);
      });
      win[key] = hit;
      callMethod(content, 'addChild', hit);
    }
    callMethod(hit, 'size', width, DETAIL_BUTTON_HEIGHT);
    callMethod(hit, 'pos', button.x, button.y);
    hit.zOrder = Math.max(10000, Number(button.zOrder) + 1 || 10000);
    const Rectangle = laya()?.Rectangle as (new (x: number, y: number, w: number, h: number) => unknown) | undefined;
    hit.hitArea = Rectangle ? new Rectangle(0, 0, width, DETAIL_BUTTON_HEIGHT) : null;
    hit.mouseEnabled = true;
    drawHitArea(hit);
    setButtonPhase(button, button.enabled === false ? 3 : 0);
    return hit;
  }

  function createFlatButton(): UnknownRecord | null {
    const button = locator.createInstance('SgsFlatButton');
    if (button) return button;
    const template = asRecord(asRecord(locator.scene()?.topMenu)?.settingBtn);
    try {
      return typeof template?.constructor === 'function' ? new (template.constructor as new () => UnknownRecord)() : null;
    } catch {
      return null;
    }
  }

  async function saveDetailImage(win: UnknownRecord, videoUrl?: string): Promise<void> {
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    const name = String(base?.name || '三国杀皮肤');
    const source = videoUrl || String(asRecord(win.skinImg)?.skin || '');
    if (!source) return;
    const match = source.match(/\/([0-9]+)(_[0-9])?(\.png|\.mp4)/i);
    if (!match) {
      showToast('当前皮肤资源地址无法识别', 'warning', 4000);
      return;
    }
    const skinNumber = Number(match[1]);
    const count = SKIN_STATE_COUNTS[skinNumber] || (match[2] ? 2 : 1);
    const suffixes = count > 1 ? Array.from({ length: count }, (_, index) => `_${index + 1}`) : [''];
    for (const suffix of suffixes) {
      const url = source.replace(/(\/[0-9]+)(_[0-9])?(\.png|\.mp4)/i, `$1${suffix}$3`);
      const found = await fetchSkinImage(url, Boolean(base?.bigSkin)).catch(() => null);
      if (!found?.response.ok) continue;
      const objectUrl = URL.createObjectURL(await found.response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${name}${suffix}${match[3]}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function setDetailAsBackground(win: UnknownRecord): Promise<boolean> {
    if (isPortrait(win.is169, win.isHor)) return false;
    const resolved = await resolveDetailResource(win);
    if (resolved?.videoUrl) {
      await saveDetailImage(win, resolved.videoUrl);
      return false;
    }
    if (!resolved) return false;
    return applyBackground(resolved.resource, win);
  }

  /** 同步“收藏背景”按钮文字（对照 app.bak VZ 内的 kU）。 */
  function updateDetailFavoriteButton(win: UnknownRecord): void {
    const button = asRecord(win.myFuncBtn2);
    if (!button) return;
    const id = detailFavoriteId(win);
    const favorited = Boolean(id) && store.isFavorite(id);
    const video = isVideoDetail(win);
    Object.assign(button, {
      label: video ? '无法收藏' : favorited ? '取消收藏' : '收藏背景',
      enabled: !video,
      mouseEnabled: false,
      labelSize: favorited ? 15 : 16,
      phase: video ? 3 : 0
    });
    callMethod(button, 'changeState');
    const hit = asRecord(win.myFuncBtnHit2);
    if (hit) hit.mouseEnabled = !video;
  }

  async function toggleDetailFavorite(win: UnknownRecord): Promise<boolean> {
    if (isPortrait(win.is169, win.isHor)) return false;
    if (!isOn()) {
      showToast('请先打开皮肤做背景', 'warning', 4000);
      return false;
    }
    const id = detailFavoriteId(win);
    if (!id) {
      showToast('当前皮肤信息不完整，暂时无法收藏', 'warning', 4000);
      return false;
    }
    if (store.isFavorite(id)) {
      store.removeFavorite(id);
      updateDetailFavoriteButton(win);
      showToast('已取消收藏背景', 'success', 3000);
      return true;
    }
    const resolved = await resolveDetailResource(win);
    if (resolved?.videoUrl) {
      showToast('视频皮肤暂不支持做背景和收藏', 'warning', 4000);
      return false;
    }
    if (!resolved?.resource?.url) {
      showToast('当前皮肤未找到可收藏的背景资源', 'warning', 4000);
      return false;
    }
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    store.addFavorite({
      id,
      skinId: skinIdOf(base),
      generalId: Number(asRecord(win.skinData)?.generalID) || 0,
      state: Number(win.juexingState ?? win.CurDynamicState ?? 0) || 0,
      name: String(base?.name || base?.skinname || '三国杀皮肤'),
      generalName: '',
      previewUrl: String(asRecord(win.skinImg)?.skin || ''),
      resource: resolved.resource,
      savedAt: Date.now()
    });
    updateDetailFavoriteButton(win);
    showToast('已收藏到“小抄背景”', 'success', 3000);
    return true;
  }

  function installDetailButtons(win: UnknownRecord): boolean {
    const frame = asRecord(win.skinFrame);
    const content = asRecord(win.contentSprite);
    if (!frame || !content) return false;
    rememberDetailEffectClasses(win);
    const frameX = Number(frame.x) || 0;
    const frameY = Number(frame.y) || 0;
    const frameWidth = Number(frame.width) || 360;
    const totalWidth = Math.min(360, frameWidth);
    const portrait = isPortrait(win.is169, win.isHor);
    const handlers = portrait
      ? [(target: UnknownRecord) => saveDetailImage(target)]
      : [(target: UnknownRecord) => saveDetailImage(target), setDetailAsBackground, toggleDetailFavorite];
    const width = Math.floor((totalWidth - DETAIL_BUTTON_GAP * (handlers.length - 1)) / handlers.length);
    const left = frameX + frameWidth / 2 - totalWidth / 2;
    const video = isVideoDetail(win);
    for (let index = 0; index < 3; index += 1) {
      const handler = handlers[index];
      let button = asRecord(win[`myFuncBtn${index}`]);
      const existingHit = asRecord(win[`myFuncBtnHit${index}`]);
      if (!handler) {
        if (button) Object.assign(button, { visible: false, enabled: false });
        if (existingHit) Object.assign(existingHit, { visible: false, mouseEnabled: false });
        continue;
      }
      if (!button) {
        button = createFlatButton();
        if (!button) return false;
        callMethod(button, 'InitSkin', 'skinInfo_dynamicBtn_normal', 'skinInfo_dynamicBtn_over', 'skinInfo_dynamicBtn_down', 'skinInfo_dynamicBtn_disable');
        win[`myFuncBtn${index}`] = button;
        if (typeof content.addDrawChild === 'function') callMethod(content, 'addDrawChild', button);
        else callMethod(content, 'addChild', button);
      }
      callMethod(button, 'removeEventListener');
      Object.assign(button, {
        label: ['保存图片', video ? '保存视频' : '设为背景', '收藏背景'][index],
        width,
        height: DETAIL_BUTTON_HEIGHT,
        labelSize: 16,
        labelFont: 'fzltchjw',
        labelPadding: '0,0,10,0',
        labelColors: '#FCE1AA,#FCE1AA,#FCE1AA,#FCE1AA',
        align: 'center',
        valign: 'middle',
        visible: true,
        mouseEnabled: false,
        mouseChildren: false,
        enabled: true,
        phase: 0
      });
      callMethod(button, 'changeState');
      callMethod(button, 'pos', left + index * (width + DETAIL_BUTTON_GAP), frameY - DETAIL_BUTTON_HEIGHT);
      const hit = ensureHitArea(win, index, button, width, handler);
      if (hit) {
        hit.visible = true;
        if (index === 2 && video) hit.mouseEnabled = false;
      }
    }
    if (!portrait) updateDetailFavoriteButton(win);
    return true;
  }

  function onSkinInfoWindow(): void {
    void tasks.poll(() => {
      const win = locator.window('SkinInfoWindow');
      return win && !win.isShowWait ? win : null;
    }, 50, 100).then((win) => {
      if (win && !win.destroyed && isOn()) installDetailButtons(win);
    });
  }

  // ---------- 换肤窗口悬停图标（对照 app.bak 的 VO / VF / VH） ----------

  function drawIcon(icon: unknown, kind: IconKind, active = false, hovered = false): void {
    const graphics = asRecord(asRecord(icon)?.graphics);
    if (!graphics) return;
    const color = hovered ? '#FFF2C8' : '#F7D88A';
    callMethod(graphics, 'clear');
    callMethod(graphics, 'drawCircle', 14, 14, 13, hovered ? 'rgba(68,45,25,0.96)' : 'rgba(39,29,22,0.88)', active ? '#FFE28A' : '#B98B4C', 1);
    if (kind === 'background') {
      callMethod(graphics, 'drawRect', 6.5, 7.5, 15, 12, null, color, 1.5);
      callMethod(graphics, 'drawCircle', 17.5, 11, 1.5, color);
      callMethod(graphics, 'drawPoly', 8, 18, [0, 0, 4.5, -5, 7.5, -2.5, 10.5, -6, 12, 0], color);
      return;
    }
    callMethod(graphics, 'drawPoly', 14, 14,
      [0, -8, 2.4, -2.8, 8, -2.3, 3.8, 1.4, 5.1, 7, 0, 4, -5.1, 7, -3.8, 1.4, -8, -2.3, -2.4, -2.8],
      active ? '#FFD866' : null, color, 1.5);
  }

  function drawFavoriteIcon(item: UnknownRecord, hovered = false): void {
    const actions = asRecord(item.myFuncBtnPaperActions);
    drawIcon(callMethod(actions, 'getChildAt', 1), 'favorite', Boolean(item.__xcPaperFavoriteActive), hovered);
  }

  function setItemHover(item: UnknownRecord, hovered: boolean, source: 'surface' | 'actions' = 'surface'): void {
    if (source === 'actions') item.__xcPaperActionsHovered = hovered;
    else item.__xcPaperSurfaceHovered = hovered;
    const icon = asRecord(item.myFuncBtnPaperActions);
    if (!icon) return;
    const update = () => {
      const data = asRecord(item.skinData);
      const visible = isOn() && !isPortrait(data?.Is169, data?.IsBanner)
        && Boolean(item.__xcPaperSurfaceHovered || item.__xcPaperActionsHovered);
      Object.assign(icon, { visible, mouseEnabled: visible });
    };
    // 从图标移到列表项时 MOUSE_OUT 先于 MOUSE_OVER，延后一拍避免闪烁。
    if (hovered) update();
    else tasks.later(update, 0);
  }

  async function setItemAsBackground(item: UnknownRecord): Promise<boolean> {
    if (!isOn()) {
      showToast('请先打开皮肤做背景', 'warning', 4000);
      return false;
    }
    try {
      const resolved = await resolveItem(item);
      return resolved ? applyBackground(resolved.resource) : false;
    } catch (error) {
      console.warn('[皮肤做背景] 换肤窗口设背景失败:', error);
      showToast('设背景失败，请重试', 'error', 4000);
      return false;
    }
  }

  /** 对照 app.bak 的 VY：换肤窗口里收藏或取消收藏。 */
  async function toggleItemFavorite(item: UnknownRecord): Promise<boolean> {
    if (!isOn()) {
      showToast('请先打开皮肤做背景', 'warning', 4000);
      return false;
    }
    try {
      const resolved = await resolveItem(item);
      if (!resolved?.resource.url) return false;
      const id = itemFavoriteId(item, resolved.state);
      if (!id) return false;
      if (store.isFavorite(id)) {
        store.removeFavorite(id);
        item.__xcPaperFavoriteActive = false;
        drawFavoriteIcon(item);
        showToast('已取消收藏背景', 'success', 3000);
        return true;
      }
      const data = asRecord(item.skinData);
      store.addFavorite({
        id,
        skinId: String(data?.skinID ?? data?.SkinID ?? item.skinId ?? item.SkinID ?? ''),
        generalId: Number(data?.generalID ?? asRecord(item.paperGeneralInfo)?.GeneralID) || 0,
        state: resolved.state,
        name: String(data?.name || data?.skinname || '三国杀皮肤'),
        generalName: '',
        previewUrl: resolved.previewUrl,
        resource: resolved.resource,
        savedAt: Date.now()
      });
      item.__xcPaperFavoriteActive = true;
      drawFavoriteIcon(item);
      showToast('已收藏到“小抄背景”', 'success', 3000);
      return true;
    } catch (error) {
      console.warn('[皮肤做背景] 换肤窗口收藏失败:', error);
      showToast('收藏背景失败，请重试', 'error', 4000);
      return false;
    }
  }

  function positionIcon(item: UnknownRecord, actions: UnknownRecord): void {
    callMethod(actions, 'pos', Number(item.x) + 8, Number(item.y) + Number(item.height) - ICON_SIZE - 8);
  }

  function createIcon(item: UnknownRecord, kind: IconKind, onClick: (item: UnknownRecord) => unknown): UnknownRecord | null {
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    if (!SpriteClass) return null;
    const icon = new SpriteClass();
    const event = layaEvent();
    icon.name = kind === 'background' ? 'xcSetSkinBackgroundIcon' : 'xcFavoriteSkinBackgroundIcon';
    callMethod(icon, 'size', ICON_SIZE, ICON_SIZE);
    Object.assign(icon, { mouseEnabled: true, mouseChildren: false, toolTip: kind === 'background' ? '设为背景' : '收藏背景' });
    const active = () => kind === 'favorite' && Boolean(item.__xcPaperFavoriteActive);
    callMethod(icon, 'on', event?.CLICK, item, (clickEvent: unknown) => {
      callMethod(clickEvent, 'stopPropagation');
      void onClick(item);
    });
    callMethod(icon, 'on', event?.MOUSE_OVER, icon, () => {
      setItemHover(item, true, 'actions');
      drawIcon(icon, kind, active(), true);
    });
    callMethod(icon, 'on', event?.MOUSE_OUT, icon, () => {
      drawIcon(icon, kind, active(), false);
      setItemHover(item, false, 'actions');
    });
    drawIcon(icon, kind);
    return icon;
  }

  function createActions(item: UnknownRecord): UnknownRecord | null {
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    const background = createIcon(item, 'background', setItemAsBackground);
    const favorite = createIcon(item, 'favorite', toggleItemFavorite);
    if (!SpriteClass || !background || !favorite) return null;
    const actions = new SpriteClass();
    actions.name = 'xcSkinBackgroundActions';
    callMethod(actions, 'size', ICON_SIZE * 2 + 4, ICON_SIZE);
    actions.zOrder = 10000;
    callMethod(favorite, 'pos', ICON_SIZE + 4, 0);
    callMethod(actions, 'addChild', background);
    callMethod(actions, 'addChild', favorite);
    const event = layaEvent();
    callMethod(actions, 'on', event?.MOUSE_OVER, item, () => setItemHover(item, true, 'actions'));
    callMethod(actions, 'on', event?.MOUSE_OUT, item, () => setItemHover(item, false, 'actions'));
    return actions;
  }

  function prepareItemIcon(item: UnknownRecord, container: UnknownRecord, view: UnknownRecord): UnknownRecord | null {
    item.paperGeneralInfo = view.generalInfo;
    let icon = asRecord(item.myFuncBtnPaperActions);
    if (!icon) {
      icon = createActions(item);
      if (!icon) return null;
      item.myFuncBtnPaperActions = icon;
      callMethod(container, 'addChild', icon);
      const event = layaEvent();
      const over = () => setItemHover(item, true);
      const out = () => setItemHover(item, false);
      callMethod(item, 'on', event?.MOUSE_OVER, item, over);
      callMethod(item, 'on', event?.MOUSE_OUT, item, out);
      callMethod(item.bg, 'on', event?.MOUSE_OVER, item, over);
      callMethod(item.bg, 'on', event?.MOUSE_OUT, item, out);
    }
    const favoriteId = itemFavoriteId(item, itemFavoriteState(item));
    item.__xcPaperFavoriteActive = Boolean(favoriteId) && store.isFavorite(favoriteId);
    drawFavoriteIcon(item);
    positionIcon(item, icon);
    item.__xcPaperSurfaceHovered = false;
    item.__xcPaperActionsHovered = false;
    setItemHover(item, false);
    if (!item.__xcPaperRenderBound && typeof item.render === 'function') {
      patcher.wrap(item, 'render', (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        const ownIcon = asRecord(this.myFuncBtnPaperActions);
        if (ownIcon) {
          positionIcon(this, ownIcon);
          this.__xcPaperSurfaceHovered = false;
          this.__xcPaperActionsHovered = false;
          setItemHover(this, false);
        }
        return result;
      });
      item.__xcPaperRenderBound = true;
    }
    return icon;
  }

  function hideAllIcons(view: UnknownRecord | null): void {
    const icons = view?.__xcPaperButtons;
    if (icons instanceof Set) {
      icons.forEach((icon) => Object.assign(icon as UnknownRecord, { visible: false, mouseEnabled: false }));
    }
  }

  async function prepareChangeSkinWindow(win: UnknownRecord): Promise<boolean> {
    if (!isOn()) {
      hideAllIcons(asRecord(win.selectView));
      return false;
    }
    const view = await tasks.poll(() => {
      const selectView = asRecord(win.selectView);
      const list = selectView?.itemList;
      return Array.isArray(list) && list.length ? selectView : null;
    }, 20, 100);
    const container = asRecord(view?.pannelContent) ?? view;
    if (!view || !container || !Array.isArray(view.itemList)) return false;
    const all = view.__xcPaperButtons instanceof Set ? view.__xcPaperButtons as Set<UnknownRecord> : new Set<UnknownRecord>();
    view.__xcPaperButtons = all;
    const current = new Set<UnknownRecord>();
    for (const entry of view.itemList) {
      const item = asRecord(entry);
      if (!item) continue;
      const icon = prepareItemIcon(item, container, view);
      if (!icon) continue;
      current.add(icon);
      all.add(icon);
    }
    all.forEach((icon) => {
      if (!current.has(icon)) Object.assign(icon, { visible: false, mouseEnabled: false });
    });
    const panel = asRecord(view.pannel);
    if (panel && !panel.__xcPaperRefreshBound && typeof panel.refresh === 'function') {
      patcher.wrap(panel, 'refresh', (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        queueMicrotask(() => void prepareChangeSkinWindow(win));
        return result;
      });
      panel.__xcPaperRefreshBound = true;
    }
    return true;
  }

  function refreshChangeSkinWindow(): void {
    const win = locator.window('ChangeSkinWindow');
    if (win) void prepareChangeSkinWindow(win);
  }

  function onChangeSkinWindow(): void {
    void tasks.poll(() => locator.window('ChangeSkinWindow'), 20, 100).then((win) => {
      if (win) void prepareChangeSkinWindow(win);
    });
  }

  // ---------- 开关与场景 ----------

  /** 对照 app.bak 的 V8。 */
  function syncVisibility(): void {
    const show = shouldShow();
    skinTrace('paper-visibility', {
      show,
      sceneName: locator.scene()?.SceneName,
      inGame: Boolean(locator.gameScene()),
      allPaper: configStore.get('skin.allPaper'),
      resource: renderer.resource,
      layerFound: Boolean(locator.layer('BackgroundLayer'))
    });
    void renderer.setEnabled(show);
  }

  function onSwitchChanged(): void {
    syncVisibility();
    options.syncWallpaperMenu();
    refreshChangeSkinWindow();
  }

  // ---------- 背景动作（对照 app.bak 的 bD） ----------

  function filterMessage(payload: UnknownRecord, className: string): void {
    if (!isOn()) return;
    if (className === 'decodeGameChooseAllGenNtf') {
      renderer.playAction('ChuChang');
      return;
    }
    const selfSeatId = options.selfSeatId();
    if (selfSeatId === null) return;
    if (className === 'PubGsCUseCard') {
      if (Number(payload.SeatID) === selfSeatId && Number(payload.useType) === 1
        && Number(payload.spellID) === 1 && !payload.isSend) {
        renderer.playAction('GongJi');
      }
      return;
    }
    if (className === 'GsClientBroadcastChatGoods') {
      const proto = asRecord(payload.ProtoObj);
      const seatInfo = proto?.seatInfo;
      const involved = (Array.isArray(seatInfo) && seatInfo.some((seat) => Number(asRecord(seat)?.seatId) === selfSeatId))
        || Number(proto?.seatid) === selfSeatId;
      if (involved) renderer.playAction('HuDong');
    }
  }

  const menuExtension: WallpaperMenuExtension = {
    enabled: isOn,
    onOfficialWallpaperUsed() {
      // 改用官方背景时清掉皮肤背景（对照 app.bak 的 bf）。
      if (renderer.hasBackground()) renderer.clearBackground(true);
      favoritesTab.refreshSelection();
    },
    attachMenu: (menu) => favoritesTab.attach(menu),
    detachMenu: (menu) => favoritesTab.detach(menu)
  };

  const unsubscribes = [
    configStore.subscribe('skin.skinPaper', onSwitchChanged),
    configStore.subscribe('skin.allPaper', syncVisibility)
  ];
  watchWindowShow(locator, patcher, tasks, ['SkinInfoWindow', 'ChangeSkinWindow'], (name) => {
    if (name === 'SkinInfoWindow') onSkinInfoWindow();
    else onChangeSkinWindow();
  });
  watchSceneSwitch(locator, patcher, tasks, syncVisibility);
  void tasks.poll(() => locator.dispatcher() && locator.scene(), Infinity, 1000).then((ready) => {
    if (ready) syncVisibility();
  });

  return {
    menuExtension,
    filterMessage,
    dispose() {
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      tasks.dispose();
      favoritesTab.dispose();
      renderer.dispose();
      patcher.restoreAll();
    }
  };
}
