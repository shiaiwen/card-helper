/**
 * 自动托管窗口处理：点将窗选将、结算/MVP 等干扰窗关闭、局内额外弹窗点击。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { clickLayaNode } from '../auto-hg/auto-hg-runtime.ts';
import { firstSelectableGeneral } from './auto-bot-actions.ts';

type UnknownRecord = Record<string, unknown>;

const GENERAL_WINDOW_NAMES = [
  'SelectGeneralWindow',
  'SelectCountryWarGeneralWindow',
  'SelectGeneralHappyWindow',
  'SelectGeneralHappyNewWindow'
];

const CLOSE_WINDOW_NAMES = [
  'GameMvpWindow',
  'GameZhanJiWindow',
  'GeneralOpenResultWindow',
  'SkinOpenResultWindowNew',
  'SelectSkinWindow',
  'RogueLike1v1ZhanJiWindow',
  'ShouQiKaAskWindow'
];

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 是否为各类选将窗口名。 */
export function isGeneralSelectWindowName(name: string): boolean {
  return /^Select.*General.*Window$/.test(name);
}

/** 在选将窗点击第一个可选武将；已点过则跳过，必要时 500ms 后重试。 */
export function clickFirstGeneral(windowInstance: UnknownRecord): 'picked' | 'skipped' | 'missing' {
  if (windowInstance.destroyed || windowInstance.visible === false) return 'skipped';
  const picked = firstSelectableGeneral(windowInstance.generalUis);
  if (!picked) return 'missing';
  if (windowInstance.__xcAutoBotSelectedGeneralUi === picked) return 'skipped';
  const card = asRecord(picked);
  const click = typeof card?.onClickGeneralCard === 'function'
    ? () => card.onClickGeneralCard()
    : typeof windowInstance.onClickGeneralCard === 'function'
      ? () => (windowInstance.onClickGeneralCard as (ui: unknown) => void)(picked)
      : null;
  if (!click) return 'missing';
  windowInstance.__xcAutoBotSelectedGeneralUi = picked;
  try {
    click();
    setTimeout(() => {
      if (windowInstance.destroyed || windowInstance.visible === false) return;
      if (windowInstance.__xcAutoBotSelectedGeneralUi === picked) click();
    }, 500);
    return 'picked';
  } catch {
    delete windowInstance.__xcAutoBotSelectedGeneralUi;
    return 'missing';
  }
}

function clickFirstChild(list: unknown, globalObject?: LayaRuntimeWindow): boolean {
  if (!Array.isArray(list)) return false;
  const item = list.find(Boolean);
  return item ? clickLayaNode(item, globalObject) : false;
}

function closeWindow(win: UnknownRecord): boolean {
  for (const method of ['laterClose', 'CloseWin', 'Close', 'close', 'onClose']) {
    const fn = win[method];
    if (typeof fn === 'function') {
      try { fn.call(win); return true; } catch { /* ignore */ }
    }
  }
  return false;
}

function collectNamedOptions(root: unknown, prefix: string, bucket: unknown[]): void {
  const record = asRecord(root);
  if (!record) return;
  if (String(record.name || '').startsWith(prefix) && record.visible !== false && record.mouseEnabled !== false) {
    bucket.push(record);
  }
  const count = Number(record.numChildren || 0);
  for (let index = 0; index < count; index += 1) {
    if (typeof record.getChildAt === 'function') collectNamedOptions(record.getChildAt(index), prefix, bucket);
  }
}

/** 局内五谷、选牌窗口点第一项再确定。 */
export function handlePlayWindows(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  const names = ['WuGuFengDengWindow', 'SelectCardWindow'];
  let acted = false;
  for (const name of names) {
    const win = locator.window(name) ?? locator.findWindows(name)[0];
    if (!win || win.destroyed || win.visible === false) continue;
    const cards = win.cardUis ?? win.itemUis ?? win.cardList ?? win.ItemList;
    if (clickFirstChild(cards, globalObject)) acted = true;
    const ok = asRecord(win.btnOK) ?? asRecord(win.sureBtn) ?? asRecord(win.btnSure);
    if (ok) {
      clickLayaNode(ok, globalObject);
      acted = true;
    }
  }
  return acted;
}

export function handleResultWindows(locator: LayaObjectLocator): boolean {
  let acted = false;
  for (const name of CLOSE_WINDOW_NAMES) {
    const win = locator.window(name) ?? locator.findWindows(name)[0];
    if (!win || win.destroyed || win.visible === false) continue;
    if (closeWindow(win)) acted = true;
  }
  return acted;
}

export function handleJinLanWindow(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  const win = locator.window('JinLan2025Window') ?? locator.findWindows('JinLan2025Window')[0];
  if (!win || win.destroyed || win.visible === false || win.isPlayingSelectClose) return false;
  const options: unknown[] = [];
  collectNamedOptions(win.contentSprite ?? win, 'JinLan2025Option_', options);
  const first = options[0];
  return first ? clickLayaNode(first, globalObject) : false;
}

export function handleRogue1v1Windows(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  let acted = false;
  const say = locator.window('SayRogueLike1V1Window') ?? locator.findWindows('SayRogueLike1V1Window')[0];
  if (say && !say.destroyed && say.visible !== false) {
    const btn = asRecord(say.sureBtn) ?? asRecord(say.btnSure) ?? asRecord(say.btnOK);
    if (btn && clickLayaNode(btn, globalObject)) acted = true;
    else if (closeWindow(say)) acted = true;
  }
  const shop = locator.window('RogueLike1v1GameShopWindow') ?? locator.findWindows('RogueLike1v1GameShopWindow')[0];
  if (shop && !shop.destroyed && shop.visible !== false) {
    const items = shop.itemUis ?? shop.goodsList ?? shop.cardUis;
    if (clickFirstChild(items, globalObject)) acted = true;
    const buy = asRecord(shop.buyBtn) ?? asRecord(shop.sureBtn) ?? asRecord(shop.btnOK);
    if (buy && clickLayaNode(buy, globalObject)) acted = true;
  }
  return acted;
}

export function handleExtraBotWindows(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  kind: number
): boolean {
  let acted = handleResultWindows(locator);
  if (handleJinLanWindow(locator, globalObject)) acted = true;
  if (kind === 11 && handleRogue1v1Windows(locator, globalObject)) acted = true;
  return acted;
}

export function findGeneralWindows(locator: LayaObjectLocator): UnknownRecord[] {
  const found: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  const add = (item: UnknownRecord | null) => {
    if (!item || seen.has(item)) return;
    seen.add(item);
    found.push(item);
  };
  for (const name of GENERAL_WINDOW_NAMES) {
    add(locator.window(name));
    locator.findWindows(name).forEach((item) => add(item));
  }
  return found;
}
