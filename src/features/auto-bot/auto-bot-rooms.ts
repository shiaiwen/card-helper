/**
 * 自动托管大厅与房间流程：识别模式、建房/填位/开局、桌内 AI 提示与会话状态。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateSceneManager } from '../seat-display/game-scene-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import {
  clickLayaNode,
  confirmNamedPrompt,
  locateTableScene,
  readSelfUserId
} from '../auto-hg/auto-hg-runtime.ts';
import {
  AI_PROMPT_TITLE
} from '../auto-hg/auto-hg-actions.ts';
import {
  applyCreateTableDefaults,
  detectAutoBotKind,
  hallCreatePlan,
  aiPromptLabel,
  ROGUE_1V1_SCENE,
  type AutoBotKind
} from './auto-bot-mode.ts';

type UnknownRecord = Record<string, unknown>;

export interface AutoBotRoomSession {
  managedRoom: boolean;
  kind: AutoBotKind;
  lastHallMark: string;
  lastCreateAt: number;
  lastStartAt: number;
  baiShengGeneralId: number;
  aiPromptDone: boolean;
}

/** 创建空白房间会话状态（未托管、默认模式 1）。 */
export function emptyRoomSession(): AutoBotRoomSession {
  return {
    managedRoom: false,
    kind: 1,
    lastHallMark: '',
    lastCreateAt: 0,
    lastStartAt: 0,
    baiShengGeneralId: 0,
    aiPromptDone: false
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 定位当前活动场景（大厅 / 桌面 / 山河等）。 */
export function locateCurrentScene(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  const manager = locateSceneManager(globalObject);
  return asRecord(manager?.CurrentScene);
}

function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const record = asRecord(value);
  return String(record?.text ?? record?.label ?? '');
}

function pushText(bucket: string[], value: unknown): void {
  const text = textOf(value);
  if (text && /[\u4e00-\u9fff]/.test(text)) bucket.push(text);
}

function descendantTexts(root: unknown, bucket: string[], depth = 0): void {
  const record = asRecord(root);
  if (!record || depth > 3 || bucket.length > 24) return;
  pushText(bucket, record.text);
  pushText(bucket, record.label);
  pushText(bucket, record.name);
  const children = (record._childs || record._children) as unknown[] | undefined;
  if (!Array.isArray(children)) return;
  for (const child of children) descendantTexts(child, bucket, depth + 1);
}

function selectedModeTexts(root: unknown, bucket: string[], depth = 0): void {
  const record = asRecord(root);
  if (!record || depth > 6 || bucket.length > 24) return;
  const selected = record.selected === true || record.Selected === true;
  if (selected) descendantTexts(record, bucket);
  if (Array.isArray(record.labels) && record.selectedIndex != null) {
    const current = record.labels[Number(record.selectedIndex)];
    if (current != null) pushText(bucket, current);
  }
  const children = (record._childs || record._children) as unknown[] | undefined;
  if (!Array.isArray(children)) return;
  for (const child of children) selectedModeTexts(child, bucket, depth + 1);
}

function mousePress(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) return false;
  try {
    if (typeof record.onMouse === 'function') {
      record.onMouse({ type: 'click' });
      return true;
    }
    if (typeof record.event === 'function') {
      record.event('click', record.name);
      return true;
    }
    if (typeof record.onClick === 'function') {
      record.onClick();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function nodeText(node: unknown, depth = 0): string {
  const record = asRecord(node);
  if (!record || depth > 2) return '';
  const own = [record.text, record.label, record.name, record.roomName, record.RoomName]
    .map(textOf)
    .filter((text) => /[\u4e00-\u9fff]/.test(text));
  if (own.length) return own.join('');
  const children = (record._childs || record._children) as unknown[] | undefined;
  if (!Array.isArray(children)) return '';
  return children.map((child) => nodeText(child, depth + 1)).filter(Boolean).join('');
}

function listedRoomTexts(scene: UnknownRecord | null): string[] {
  const list = asRecord(scene?.roomListView);
  const rooms = (list?.roomUis || list?.itemUis || list?.roomList || list?.list) as unknown[] | undefined;
  if (!Array.isArray(rooms)) return [];
  return rooms.slice(0, 12).map((room) => nodeText(room)).filter(Boolean);
}

/** 从房间名判断当前大厅是身份演武、国战演武还是欢乐。 */
export function hallModeFromRoomNames(names: string[]): string {
  const text = names.join('');
  if (text.includes('身份演武')) return '身份演武';
  if (text.includes('国战演武')) return '国战演武';
  if (text.includes('欢乐')) return '欢乐';
  return '';
}

function tabSelectionText(root: unknown, bucket: string[], depth = 0): void {
  const record = asRecord(root);
  if (!record || depth > 8 || bucket.length > 8) return;
  const index = Number(record.selectIndex ?? record.selectedIndex ?? record.tabIndex);
  const buttons = (record.btnList || record.tabBtns || record.tabs || record.labels) as unknown[] | undefined;
  if (Number.isInteger(index) && index >= 0 && Array.isArray(buttons) && buttons.length > index && buttons.length <= 16) {
    const text = typeof buttons[index] === 'string' ? String(buttons[index]) : nodeText(buttons[index]);
    if (text) bucket.push(text);
  }
  const children = (record._childs || record._children) as unknown[] | undefined;
  if (!Array.isArray(children)) return;
  for (const child of children) tabSelectionText(child, bucket, depth + 1);
}

function modeLabelOf(scene: UnknownRecord | null, locator?: LayaObjectLocator): string {
  const list = asRecord(scene?.roomListView);
  const selected: string[] = [];
  selectedModeTexts(scene, selected);
  selectedModeTexts(list, selected);
  let modeVo: UnknownRecord | null = null;
  try {
    const context = locator?.gameContext();
    modeVo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
  } catch {
    modeVo = null;
  }
  const tabs: string[] = [];
  tabSelectionText(scene, tabs);
  return [
    ...tabs,
    textOf(asRecord(asRecord(scene?.topMenu)?.areaServerLabel)?.text),
    textOf(scene?.modeName),
    textOf(list?.modeName),
    textOf(list?.modeLabel),
    textOf(list?.title),
    textOf(list?.nameTxt),
    textOf(modeVo?.ModeName ?? modeVo?.modeName ?? modeVo?.Name ?? modeVo?.name),
    hallModeFromRoomNames(listedRoomTexts(scene)),
    ...selected
  ].filter(Boolean).join(' ');
}

function officerLevel(locator: LayaObjectLocator): number {
  const user = locator.manager('UserInfoManger');
  return Number(user?.officerLevel ?? user?.OfficerLevel ?? 0) || 0;
}

function waitInfoOf(seat: UnknownRecord | null | undefined): UnknownRecord | null {
  return asRecord(seat?.WaitInfo) ?? asRecord(seat?.waitInfo);
}

/** 在桌子座位里找到自己的座位。 */
export function findOwnTableSeat(seats: unknown[], userId: number): UnknownRecord | null {
  const records = seats.map(asRecord).filter((seat): seat is UnknownRecord => !!seat);
  if (userId > 0) {
    const byId = records.find((seat) => {
      const info = waitInfoOf(seat);
      const id = Number(info?.clientId ?? info?.ClientId ?? info?.userID ?? info?.UserID ?? info?.playerid ?? info?.playerID ?? 0);
      return id === userId;
    });
    if (byId) return byId;
  }
  const flagged = records.find((seat) => {
    const info = waitInfoOf(seat);
    return !!(seat.isSelf || seat.IsSelf || info?.isSelf || info?.IsSelf);
  });
  if (flagged) return flagged;
  const masters = records.filter((seat) => {
    const info = waitInfoOf(seat);
    return !!(info?.isMaster || info?.IsMaster);
  });
  return masters.length === 1 ? masters[0]! : null;
}

function sitEmptySeat(scene: UnknownRecord, globalObject: LayaRuntimeWindow): boolean {
  const list = asRecord(scene.seatListView);
  const rows = tableSeats(scene);
  const target = [...rows].reverse().find((item) => item.empty)?.seat;
  if (!target || !list) return false;
  if (typeof list.showBtns === 'function') list.showBtns(target);
  if (typeof list.sitHandler === 'function') {
    try { list.sitHandler(); return true; } catch { return false; }
  }
  return clickLayaNode(target, globalObject);
}

const recentAiSeats = new WeakMap<object, number>();
let robotChainUntil = 0;

function addAiSeat(scene: UnknownRecord, seat: UnknownRecord, level = 1): boolean {
  const list = asRecord(scene.seatListView);
  if (!list || typeof list.addAiHandler !== 'function') return false;
  const last = recentAiSeats.get(seat) ?? 0;
  if (Date.now() - last < 800) return false;
  recentAiSeats.set(seat, Date.now());
  if (typeof list.showBtns === 'function') list.showBtns(seat);
  try {
    list.addAiHandler(level, seat);
    return true;
  } catch {
    return false;
  }
}

function seatNumber(seat: UnknownRecord, listIndex: number): number {
  const value = Number(seat.seatId ?? seat.SeatId ?? seat.seatID ?? seat.index ?? seat.Index);
  if (Number.isFinite(value) && value > 0) return value;
  return listIndex + 1;
}

function tableSeats(scene: UnknownRecord): Array<{ seat: UnknownRecord; number: number; empty: boolean }> {
  const list = asRecord(scene.seatListView);
  const rows = ((list?.seatList as unknown[]) || []).map((item, index) => {
    const seat = asRecord(item);
    if (!seat) return null;
    const raw = Number(seat.seatId ?? seat.SeatId ?? seat.seatID ?? seat.index ?? seat.Index);
    return { seat, index, raw, empty: !seat.WaitInfo && !seat.waitInfo };
  }).filter((item): item is { seat: UnknownRecord; index: number; raw: number; empty: boolean } => !!item);
  const zeroBased = rows.some((item) => item.raw === 0);
  return rows.map((item) => ({
    seat: item.seat,
    empty: item.empty,
    number: zeroBased
      ? (Number.isFinite(item.raw) ? item.raw + 1 : item.index + 1)
      : seatNumber(item.seat, item.index)
  }));
}

function cancelSpareSeatPrompt(locator: LayaObjectLocator): boolean {
  const layer = locator.layer('PromptLayer');
  const confirm = asRecord(layer?.confirmWin) ?? asRecord(locator.window('ConfirmWindow'));
  if (!confirm) return false;
  const data = asRecord(confirm.confirmData);
  const title = String(data?.title ?? '');
  if (title !== '提示') return false;
  const buttons = (confirm.buttonArr as unknown[]) || [];
  const cancel = buttons.map(asRecord).find((item) => String(item?.label ?? '') === '取消');
  if (!cancel) return false;
  const callback = cancel.callBack;
  if (typeof callback === 'function') {
    callback.apply(cancel.thisObject ?? confirm, (cancel.args as unknown[]) || []);
    return true;
  }
  return clickLayaNode(cancel);
}

function clickStart(scene: UnknownRecord, globalObject: LayaRuntimeWindow): boolean {
  const startUi = asRecord(scene.startUI);
  const start = asRecord(startUi?.startBtn);
  if (start && start.enabled !== false) {
    const clickType = (globalObject.Laya as { Event?: { CLICK?: string } } | undefined)?.Event?.CLICK || 'click';
    if (typeof start.onClick === 'function') {
      try { start.onClick({ type: clickType }); return true; } catch { /* ignore */ }
    }
    if (clickLayaNode(start, globalObject)) return true;
  }
  for (const name of ['onStartClick', 'startHandler', 'onClickStart']) {
    const fn = startUi?.[name];
    if (typeof fn !== 'function') continue;
    try { fn.call(startUi); return true; } catch { /* ignore */ }
  }
  return false;
}

function runRogue1v1Enter(scene: UnknownRecord, globalObject: LayaRuntimeWindow): boolean {
  const children = (scene._childs as unknown[]) || (scene._children as unknown[]) || [];
  const robot = children.map(asRecord).find((item) => item && String(item.name) === 'zgs_robot_tex');
  if (!robot) return false;
  if (!clickLayaNode(robot, globalObject) && typeof scene.onBtnClick === 'function') {
    try { scene.onBtnClick(robot); } catch { /* ignore */ }
  }
  const go = asRecord(scene.btnListGo) ?? asRecord((globalObject as UnknownRecord).gamescene)?.btnListGo;
  if (go && typeof go.onTouch === 'function') {
    try { go.onTouch(1); return true; } catch { return false; }
  }
  return true;
}

function runCreateCountryRoom(locator: LayaObjectLocator, scene: UnknownRecord): boolean {
  const list = asRecord(scene.roomListView);
  if (typeof list?.onShowOfWindow === 'function') {
    try { list.onShowOfWindow(); } catch { /* ignore */ }
  }
  const win = locator.window('CreatOFRoomWindow') ?? locator.findWindows('CreatOFRoomWindow')[0];
  if (!win || typeof win.sureCreate !== 'function') return false;
  try {
    win.sureCreate();
    return true;
  } catch {
    return false;
  }
}

function findByText(root: unknown, target: string, depth = 0): unknown {
  const record = asRecord(root);
  if (!record || depth > 8) return null;
  const text = textOf(record.text ?? record.label);
  if (text.replace(/\s/g, '') === target) return record;
  const children = (record._childs || record._children) as unknown[] | undefined;
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    const found = findByText(child, target, depth + 1);
    if (found) return asRecord(found)?.parent ?? found;
  }
  return null;
}

function runCreateIdentityRoom(
  locator: LayaObjectLocator,
  scene: UnknownRecord,
  globalObject: LayaRuntimeWindow,
  preferIdentity: boolean
): boolean {
  const win = locator.window('CreateTableWindow') ?? locator.findWindows('CreateTableWindow')[0];
  if (!win) {
    const list = asRecord(scene.roomListView);
    if (!mousePress(list?.createRoomSBtn) && !mousePress(list?.createBtn) && !mousePress(findByText(scene, '创建房间'))) {
      clickLayaNode(list?.createRoomSBtn, globalObject);
    }
    return false;
  }
  applyCreateTableDefaults(win, { preferIdentity });
  if (!mousePress(win.sureBtn)) clickLayaNode(win.sureBtn, globalObject);
  return true;
}

/** 大厅轮询：按模式建房或进入合适房间。 */
export function runAutoBotHall(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  session: AutoBotRoomSession,
  now: number
): AutoBotRoomSession {
  const scene = locateCurrentScene(globalObject);
  if (!scene) return session;
  const name = String(scene.SceneName || '');
  if (name === ROGUE_1V1_SCENE) {
    if (session.lastHallMark === name && now - session.lastCreateAt < 8000) return { ...session, kind: 11 };
    runRogue1v1Enter(scene, globalObject);
    return { ...session, kind: 11, managedRoom: true, lastHallMark: name, lastCreateAt: now };
  }
  if (!scene?.roomListView) return session;
  const label = modeLabelOf(scene, locator);
  const plan = hallCreatePlan(label);
  if (plan === 'none') return session;
  const mark = `${name}:${plan}`;
  if (session.lastHallMark === mark && now - session.lastCreateAt < 8000) return session;
  if (plan === 'country') {
    if (!runCreateCountryRoom(locator, scene)) return session;
    return { ...session, kind: 28, managedRoom: true, lastHallMark: mark, lastCreateAt: now };
  }
  if (!runCreateIdentityRoom(locator, scene, globalObject, true)) return session;
  return { ...session, kind: 1, managedRoom: true, lastHallMark: mark, lastCreateAt: now };
}

/** 桌内轮询：填 AI、准备/开局、处理 AI 提示框。 */
export function runAutoBotTable(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  session: AutoBotRoomSession,
  options: {
    baiSheng: boolean;
    onBaiSheng?: (scene: UnknownRecord, currentId: number) => number;
    schedule?: (callback: () => void, delay: number) => void;
  }
): AutoBotRoomSession {
  const scene = locateTableScene(globalObject);
  if (!scene) {
    const current = locateCurrentScene(globalObject);
    if (current && String(current.SceneName) === 'TableScene') {
      sitEmptySeat(current, globalObject);
    }
    return session;
  }
  const seats = asRecord(scene.seatListView)?.seatList;
  if (!Array.isArray(seats) || !seats.length || !scene.startUI) return session;
  const kind = detectAutoBotKind({
    sceneName: String(scene.SceneName || ''),
    modeLabel: modeLabelOf(scene)
  });
  const next = { ...session, kind };
  if (options.baiSheng && options.onBaiSheng) {
    const picked = options.onBaiSheng(scene, session.baiShengGeneralId);
    if (picked) next.baiShengGeneralId = picked;
  }
  const userId = readSelfUserId(locator, globalObject);
  const mine = findOwnTableSeat(seats, userId);
  const info = asRecord(mine?.WaitInfo) ?? asRecord(mine?.waitInfo);
  const drill = /身份演武|国战演武|欢乐/.test(modeLabelOf(scene));
  const rowsNow = tableSeats(scene);
  const onBottomRight = !!mine && rowsNow[rowsNow.length - 1]?.seat === mine;
  if (next.managedRoom || drill) {
    if (cancelSpareSeatPrompt(locator)) return next;
    if (!onBottomRight) {
      sitEmptySeat(scene, globalObject);
      return next;
    }
  }
  if (!info) return next;
  if (!info.isMaster && !info.IsMaster) {
    if (!info.isReady && !info.IsReady) {
      clickLayaNode(asRecord(scene.startUI)?.readyBtn, globalObject);
    }
    return next;
  }
  if (next.managedRoom || drill) {
    if (Date.now() < robotChainUntil) return next;
    const rows = tableSeats(scene);
    const kingLevel = officerLevel(locator) >= 23 ? 3 : 2;
    const steps = rows
      .filter((item) => item.empty)
      .map((item) => ({
        seat: item.seat,
        level: item.number >= rows.length / 2 ? kingLevel : 1
      }))
      .sort((left, right) => right.level - left.level);
    if (steps.length) {
      const gap = 200;
      const schedule = options.schedule ?? ((callback: () => void) => callback());
      steps.forEach((step, index) => {
        schedule(() => {
          addAiSeat(scene, step.seat, step.level);
          confirmNamedPrompt(locator, AI_PROMPT_TITLE, aiPromptLabel(step.level));
        }, index * gap);
      });
      schedule(() => {
        mousePress(scene.addAiBtn);
        confirmNamedPrompt(locator, AI_PROMPT_TITLE, aiPromptLabel(1));
      }, steps.length * gap);
      robotChainUntil = Date.now() + (steps.length + 1) * gap + 400;
      return next;
    }
  }
  if ((next.managedRoom || drill) && tableSeats(scene).some((item) => item.empty)) return next;
  if (!locateGameScene(globalObject)) clickStart(scene, globalObject);
  return next;
}
