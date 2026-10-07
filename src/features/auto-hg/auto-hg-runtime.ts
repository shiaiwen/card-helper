/**
 * 自动换将运行时：点选黄盖、苦肉/确认点击、桌内补 AI 再开、Laya 节点点击封装。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene, locateSceneManager } from '../seat-display/game-scene-locator.ts';
import {
  AI_PROMPT_LABEL,
  AI_PROMPT_TITLE,
  CONFIRM_BUTTON_INDICES,
  HUANG_GAI_NAME,
  KUROU_SKILL_ID,
  buttonName,
  findHuangGaiGeneral,
  isEnabledFlag,
  nextKurouAction,
  shouldClickFallbackCancel,
  shouldClickFallbackConfirm,
  skillItemId
} from './auto-hg-actions.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 模拟点击 Laya 节点：优先 onMouse / event(CLICK) / onClick / click。 */
export function clickLayaNode(node: unknown, globalObject?: LayaRuntimeWindow): boolean {
  const record = asRecord(node);
  if (!record) return false;
  const clickType = (globalObject?.Laya as { Event?: { CLICK?: string } } | undefined)?.Event?.CLICK || 'click';
  const clickEvent = { type: clickType };
  try {
    if (typeof record.onMouse === 'function') {
      record.onMouse(clickEvent);
      return true;
    }
    if (typeof record.event === 'function') {
      // Laya.EventDispatcher.event 第一个参数必须是事件名。把事件对象放在第一位时，技能项会静默忽略。
      record.event(clickType, record.name ?? clickEvent);
      return true;
    }
    if (typeof record.onClick === 'function') {
      record.onClick();
      return true;
    }
    if (typeof record.click === 'function') {
      record.click();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function mousePress(node: unknown, globalObject?: LayaRuntimeWindow): boolean {
  const record = asRecord(node);
  if (!record) return false;
  try {
    if (typeof record.onMouse === 'function') {
      record.onMouse({ type: 'click' });
      return true;
    }
  } catch { /* ignore */ }
  try {
    if (typeof record.event === 'function') {
      record.event('click', String(record.name || 'click'));
      return true;
    }
  } catch { /* ignore */ }
  try {
    if (typeof record.onClick === 'function') {
      const clickType = (globalObject?.Laya as { Event?: { CLICK?: string } } | undefined)?.Event?.CLICK || 'click';
      record.onClick({ type: clickType });
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function ownTableSeat(scene: UnknownRecord, userId: number): UnknownRecord | null {
  const seats = asRecord(scene.seatListView)?.seatList;
  if (!Array.isArray(seats)) return null;
  const records = seats.map(asRecord).filter((seat): seat is UnknownRecord => !!seat);
  if (userId > 0) {
    const byId = records.find((seat) => {
      const info = waitInfo(seat);
      const id = Number(info?.clientId ?? info?.ClientId ?? info?.userID ?? info?.UserID ?? info?.playerid ?? info?.playerID ?? 0);
      return id === userId;
    });
    if (byId) return byId;
  }
  const flagged = records.find((seat) => {
    const info = waitInfo(seat);
    return !!(seat.isSelf || seat.IsSelf || info?.isSelf || info?.IsSelf);
  });
  if (flagged) return flagged;
  const masters = records.filter((seat) => {
    const info = waitInfo(seat);
    return !!(info?.isMaster || info?.IsMaster);
  });
  return masters.length === 1 ? masters[0]! : null;
}

function emptyTableSeats(scene: UnknownRecord): UnknownRecord[] {
  const seats = asRecord(scene.seatListView)?.seatList;
  if (!Array.isArray(seats)) return [];
  return seats.map(asRecord).filter((seat): seat is UnknownRecord => !!seat && !seat.WaitInfo && !seat.waitInfo);
}

let hostFillUntil = 0;

function fillHostSeats(
  locator: LayaObjectLocator,
  scene: UnknownRecord,
  globalObject?: LayaRuntimeWindow
): boolean {
  if (Date.now() < hostFillUntil) return true;
  const empty = emptyTableSeats(scene);
  if (!empty.length) return false;
  const list = asRecord(scene.seatListView);
  const schedule = globalObject?.setTimeout?.bind(globalObject) ?? setTimeout;
  empty.forEach((seat, index) => {
    schedule(() => {
      if (typeof list?.showBtns === 'function') list.showBtns(seat);
      if (typeof list?.addAiHandler === 'function') {
        try { list.addAiHandler(1, seat); } catch { /* ignore */ }
      }
      mousePress(scene.addAiBtn, globalObject);
      confirmNamedPrompt(locator, AI_PROMPT_TITLE, AI_PROMPT_LABEL);
    }, index * 200);
  });
  hostFillUntil = Date.now() + empty.length * 200 + 600;
  return true;
}

function cancelSpareSeatPrompt(locator: LayaObjectLocator): boolean {
  const layer = locator.layer('PromptLayer');
  const confirm = asRecord(layer?.confirmWin) ?? asRecord(locator.window('ConfirmWindow'));
  if (!confirm) return false;
  const title = String(asRecord(confirm.confirmData)?.title ?? '');
  if (title !== '提示') return false;
  const cancel = ((confirm.buttonArr as unknown[]) || []).map(asRecord).find((item) => String(item?.label ?? '') === '取消');
  if (!cancel) return false;
  const callback = cancel.callBack;
  if (typeof callback === 'function') {
    callback.apply(cancel.thisObject ?? confirm, (cancel.args as unknown[]) || []);
    return true;
  }
  return mousePress(cancel);
}

/** 定位桌面/牌桌场景。 */
export function locateTableScene(globalObject?: LayaRuntimeWindow): UnknownRecord | null {
  const manager = locateSceneManager(globalObject ?? (typeof window !== 'undefined' ? window : {} as LayaRuntimeWindow));
  if (!manager?.IsTableScene) return null;
  return asRecord(manager.CurrentScene);
}

export function readSelfUserId(locator: LayaObjectLocator, globalObject?: LayaRuntimeWindow): number {
  const user = locator.manager('UserInfoManger');
  const context = locator.gameContext() ?? asRecord((globalObject ?? {}) as UnknownRecord)?.GameContext;
  return Number(
    user?.myID ?? user?.MyID ?? user?.userID ?? user?.UserID
    ?? asRecord(context)?.myID ?? asRecord(context)?.UserID ?? 0
  ) || 0;
}

function waitInfo(seat: UnknownRecord | null): UnknownRecord | null {
  return asRecord(seat?.WaitInfo) ?? asRecord(seat?.waitInfo);
}

/** 在选将窗点击黄盖武将。 */
export function clickHuangGai(windowInstance: UnknownRecord): 'picked' | 'missing' | 'skipped' {
  if (windowInstance.destroyed || windowInstance.visible === false) return 'skipped';
  const picked = findHuangGaiGeneral(windowInstance.generalUis);
  if (!picked) return 'missing';
  if (windowInstance.__xcHgSelectedGeneralUi === picked) return 'skipped';
  const card = asRecord(picked);
  const click = typeof card?.onClickGeneralCard === 'function'
    ? () => card.onClickGeneralCard()
    : typeof windowInstance.onClickGeneralCard === 'function'
      ? () => (windowInstance.onClickGeneralCard as (ui: unknown) => void)(picked)
      : null;
  if (!click) return 'missing';
  windowInstance.__xcHgSelectedGeneralUi = picked;
  try {
    click();
    setTimeout(() => {
      if (windowInstance.destroyed || windowInstance.visible === false) return;
      if (windowInstance.__xcHgSelectedGeneralUi === picked) click();
    }, 500);
    return 'picked';
  } catch {
    delete windowInstance.__xcHgSelectedGeneralUi;
    return 'missing';
  }
}

function skillItems(selfSeatUi: UnknownRecord): unknown[] {
  const candidates = [
    selfSeatUi.skillItems,
    selfSeatUi.SkillItems,
    asRecord(selfSeatUi.skillBar)?.skillItems,
    asRecord(selfSeatUi.SkillBar)?.skillItems
  ];
  return candidates.find(Array.isArray) as unknown[] | undefined ?? [];
}

function clickSkill(selfSeatUi: UnknownRecord, skillId: number, globalObject?: LayaRuntimeWindow): boolean {
  const items = skillItems(selfSeatUi);
  const target = items.find((item) => skillItemId(item) === skillId);
  return target ? clickLayaNode(target, globalObject) : false;
}

function clickEnabledButtons(
  buttons: unknown[],
  indices: readonly number[],
  globalObject?: LayaRuntimeWindow
): boolean {
  for (const index of indices) {
    const button = asRecord(buttons[index]);
    if (button && isEnabledFlag(button, '_enabled')) {
      return clickLayaNode(button, globalObject);
    }
  }
  return false;
}

function fallbackDeal(selfSeatUi: UnknownRecord, globalObject?: LayaRuntimeWindow): boolean {
  const buttons = (asRecord(selfSeatUi.buttonBar)?.btnList as unknown[]) || [];
  const cancel = buttons.find((item) => shouldClickFallbackCancel(buttonName(item)) && isEnabledFlag(item, '_enabled'));
  if (cancel) return clickLayaNode(cancel, globalObject);
  const confirm = buttons.find((item) => shouldClickFallbackConfirm(buttonName(item)) && isEnabledFlag(item, '_enabled'));
  if (confirm) return clickLayaNode(confirm, globalObject);
  return clickEnabledButtons(buttons, CONFIRM_BUTTON_INDICES, globalObject);
}

/** 执行一次苦肉节拍（点技能或确认）。 */
export function runKurouTick(
  globalObject: LayaRuntimeWindow,
  tick: number
): 'skill' | 'confirm' | 'deal' | 'idle' {
  const scene = locateGameScene(globalObject);
  const sceneRecord = asRecord(scene);
  const self = asRecord(sceneRecord?.SelfSeatUi) ?? asRecord(sceneRecord?.selfSeatUi);
  const seat = asRecord(self?.seat) ?? asRecord(self?.Seat);
  if (!self || !seat) return 'idle';
  const hasSkill = typeof seat.HasSkill === 'function'
    ? seat.HasSkill
    : typeof seat.hasSkill === 'function'
      ? seat.hasSkill
      : null;
  const hasKurou = hasSkill
    ? !!hasSkill.call(seat, KUROU_SKILL_ID)
    : skillItems(self).some((item) => skillItemId(item) === KUROU_SKILL_ID);
  if (!hasKurou) {
    fallbackDeal(self, globalObject);
    return 'deal';
  }
  const action = nextKurouAction(tick);
  if (action === 'skill') clickSkill(self, KUROU_SKILL_ID, globalObject);
  else {
    const bar = asRecord(self.buttonBar) ?? asRecord(self.ButtonBar);
    const buttons = (bar?.btnList as unknown[]) || (bar?.buttons as unknown[]) || [];
    clickEnabledButtons(buttons, CONFIRM_BUTTON_INDICES, globalObject);
  }
  return action;
}

export function confirmNamedPrompt(
  locator: LayaObjectLocator,
  title: string,
  label: string
): boolean {
  const layer = locator.layer('PromptLayer');
  const confirm = asRecord(layer?.confirmWin) ?? asRecord(locator.window('ConfirmWindow'));
  if (!confirm) return false;
  const data = asRecord(confirm.confirmData);
  if (data && String(data.title ?? '') && String(data.title) !== title) return false;
  const buttons = (confirm.buttonArr as unknown[]) || [];
  const target = buttons.map(asRecord).find((item) => String(item?.label ?? '') === label);
  if (!target) return false;
  const callback = target.callBack;
  if (typeof callback === 'function') {
    callback.apply(target.thisObject ?? confirm, (target.args as unknown[]) || []);
    return true;
  }
  return clickLayaNode(target);
}

function openDianjiang(scene: UnknownRecord): void {
  const view = asRecord(scene.dianjiangView);
  if (scene.__xcDianjiangOpened) return;
  if (typeof view?.openDianjiang === 'function') {
    try {
      view.openDianjiang();
      scene.__xcDianjiangOpened = true;
    } catch {
      scene.__xcDianjiangOpened = false;
    }
  }
}

export function runTableAssist(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  options: { fillAi?: boolean } = {}
): 'started' | 'ready' | 'waiting' | 'idle' {
  const scene = locateTableScene(globalObject);
  if (!scene) return 'idle';
  const seats = asRecord(scene.seatListView)?.seatList;
  if (!Array.isArray(seats) || !seats.length || !scene.startUI) return 'idle';
  const userId = readSelfUserId(locator, globalObject);
  const mine = ownTableSeat(scene, userId);
  const info = waitInfo(mine);
  if (!info) return 'waiting';
  if (!info.isMaster && !info.IsMaster) {
    if (!info.isReady && !info.IsReady) {
      clickLayaNode(asRecord(scene.startUI)?.readyBtn, globalObject);
    }
    return 'ready';
  }
  if (options.fillAi) {
    if (cancelSpareSeatPrompt(locator)) return 'waiting';
    openDianjiang(scene);
    if (fillHostSeats(locator, scene, globalObject)) return 'waiting';
  }
  return mousePress(asRecord(asRecord(scene.startUI)?.startBtn), globalObject) ? 'started' : 'waiting';
}

/**
 * 盖主分支：桌上补人机、点「小杀(普通)」、循环点开始。
 * 非房主只点准备。
 */
/** 结算后补 AI 并再开一局。 */
export function runTableRestart(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow
): 'started' | 'ready' | 'waiting' | 'idle' {
  return runTableAssist(locator, globalObject, { fillAi: true });
}

/** 查找当前可见的选将窗口实例。 */
export function findSelectGeneralWindow(locator: LayaObjectLocator): UnknownRecord | null {
  return locator.window('SelectGeneralWindow')
    ?? locator.findWindows('SelectGeneralWindow')[0]
    ?? null;
}

export { HUANG_GAI_NAME };
