/**
 * 自选身份：按房间座位顺序把身份显示到座位上。
 * 只看桌子设置里的自选身份开关，等待房间和牌局里都写。
 */

import { createLayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { locateGameEventDispatcher, locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import { figureByClientOrder } from './choose-figure.ts';

type UnknownRecord = Record<string, unknown>;

/** 挂上轮询：进局后反复尝试，直到房间座位和武将牌都就绪。 */
export function installChooseFigureController(
  globalObject: GameRuntimeWindow = window
): () => void {
  const timer = globalObject.setInterval(applyChooseFigures, 500);
  applyChooseFigures();
  return () => globalObject.clearInterval(timer);

  function applyChooseFigures(): void {
    try {
      const locator = createLayaObjectLocator(globalObject);
      const room = roomController(globalObject);
      const setting = asRecord(room?.TableSetting) ?? asRecord(room?.tableSetting);
      if (!isChooseFigure(setting)) return;
      const clientIds = readClientIds(
        asRecord(room?.TabbleSeatInfos)
        ?? asRecord(room?.tabbleSeatInfos)
        ?? asRecord(room?.TableSeatInfos)
        ?? asRecord(room?.tableSeatInfos)
      );
      if (clientIds.length !== 8) return;
      const seatUis = readSeatUis(seatScene(globalObject, locator));
      for (const seatUi of seatUis) {
        const clientId = readSeatClientId(asRecord(seatUi.seat));
        const figure = figureByClientOrder(clientIds, clientId);
        if (figure > 0) revealFigure(asRecord(seatUi.figureManager) ?? asRecord(seatUi.FigureManager), figure);
      }
    } catch {
      // 房间信息未就绪时跳过。
    }
  }
}

/** 自选身份开关。桌子上可能是布尔，也可能是 1。 */
export function isChooseFigure(setting: UnknownRecord | null): boolean {
  if (!setting) return false;
  const value = setting.IsChooseFigure ?? setting.isChooseFigure ?? setting.ChooseFigure ?? setting.chooseFigure;
  return value === true || value === 1 || value === '1';
}

/** 房间单例没有固定入口，按管理器列表、类名和事件监听者依次找。 */
function roomController(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const globals = globalObject as UnknownRecord;
  const locator = createLayaObjectLocator(globalObject);
  const windowManager = locator.manager('WindowManager');
  const managerList = asRecord(windowManager?.constructor)?.managerList;
  const named = [
    roomFromReady(locator),
    firstRoom(Array.isArray(managerList) ? managerList : []),
    lookupNamed(globals, 'RoomControler'),
    asRecord(asRecord(globals.GameContext)?.RoomControler),
    asRecord(asRecord(globals.GameContext)?.roomControler),
    nestedRoom(locator.gameContext())
  ];
  for (const room of named) {
    if (room) return room;
  }
  const dispatcher = locateGameEventDispatcher(globalObject);
  const events = asRecord(dispatcher?._events);
  if (!events) return null;
  for (const listeners of Object.values(events)) {
    const list = Array.isArray(listeners) ? listeners : [listeners];
    for (const listener of list) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (hasTableSetting(caller)) return caller;
    }
  }
  return null;
}

/** 进房应答的监听者就是房间对象。 */
function roomFromReady(locator: ReturnType<typeof createLayaObjectLocator>): UnknownRecord | null {
  const events = asRecord(locator.manager('ServerProxy')?._events);
  const listeners = events?.GsCReadyResp;
  const list = Array.isArray(listeners) ? listeners : [listeners];
  for (const listener of list) {
    const caller = asRecord(asRecord(listener)?.caller);
    if (hasTableSetting(caller)) return caller;
  }
  return null;
}

/** 牌局优先；人还在等待房间时用当前场景上的座位。 */
function seatScene(
  globalObject: GameRuntimeWindow,
  locator: ReturnType<typeof createLayaObjectLocator>
): UnknownRecord | null {
  const game = asRecord(locateGameScene(globalObject));
  if (readSeatUis(game).length > 0) return game;
  const current = asRecord(locator.scene());
  if (readSeatUis(current).length > 0) return current;
  return null;
}

function firstRoom(list: unknown[]): UnknownRecord | null {
  for (const item of list) {
    const record = asRecord(item);
    if (hasTableSetting(record)) return record;
  }
  return null;
}

function nestedRoom(context: UnknownRecord | null): UnknownRecord | null {
  if (!context) return null;
  for (const value of Object.values(context)) {
    const record = asRecord(value);
    if (hasTableSetting(record)) return record;
  }
  return null;
}

function lookupNamed(globals: UnknownRecord, name: string): UnknownRecord | null {
  for (const runtime of [asRecord(globals.zy), asRecord(globals.laya), asRecord(globals.Laya)]) {
    const lookup = runtime?.class;
    if (typeof lookup !== 'function') continue;
    try {
      const found = lookup.call(runtime, name);
      const record = asRecord(found);
      if (hasTableSetting(record)) return record;
      if (typeof found === 'function') {
        const ctor = found as { instance?: unknown; I?: unknown; prototype?: object };
        const instance = asRecord(ctor.instance) ?? asRecord(ctor.I);
        if (hasTableSetting(instance)) return instance;
      }
    } catch {
      // 换下一个入口。
    }
  }
  try {
    const classUtils = asRecord(asRecord(globals.Laya)?.ClassUtils);
    const getClass = classUtils?.getClass;
    if (typeof getClass !== 'function') return null;
    const ctor = getClass.call(classUtils, name) as { instance?: unknown; I?: unknown } | undefined;
    return asRecord(ctor?.instance) ?? asRecord(ctor?.I);
  } catch {
    return null;
  }
}

function hasTableSetting(value: UnknownRecord | null): boolean {
  return !!(value && (value.TableSetting || value.tableSetting || value.TabbleSeatInfos || value.tabbleSeatInfos || value.TableSeatInfos));
}

/** 只接受正好 8 个座位的账号表，空位保留位置，不能滤掉后错位。 */
function readClientIds(seats: UnknownRecord | null): string[] {
  if (!seats) return [];
  const raw = seats.datum ?? seats.Datum ?? seats.list ?? seats.objs ?? seats;
  const list = asList(raw);
  const ids = list.map(readDatumClientId);
  return ids.length === 8 ? ids : [];
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && typeof (value as { length?: unknown }).length === 'number') {
    return Array.from(value as ArrayLike<unknown>);
  }
  return [];
}

/** 身份还没写成目标值时才调用 SetFigure，避免每轮轮询重绘。 */
function revealFigure(manager: UnknownRecord | null, figure: number): void {
  if (!manager || figure <= 0 || Number(manager.Figure) === figure) return;
  if (typeof manager.SetFigure === 'function') {
    try { manager.SetFigure(figure); } catch { /* 单座位失败不影响其他人。 */ }
    return;
  }
  manager.Figure = figure;
}

function readDatumClientId(value: unknown): string {
  const record = asRecord(value);
  const seatPlayer = asRecord(record?.SeatPlayerInfo)
    ?? asRecord(record?.seatPlayerInfo)
    ?? asRecord(record?.playerInfo)
    ?? asRecord(record?.data)
    ?? asRecord(record?.Data)
    ?? asRecord(record?.value)
    ?? record;
  return normalizeId(seatPlayer?.ClientId ?? seatPlayer?.clientId ?? seatPlayer?.ClientID);
}

function readSeatClientId(seat: UnknownRecord | null): string {
  const info = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo) ?? seat;
  return normalizeId(info?.ClientId ?? info?.clientId ?? info?.ClientID);
}

function normalizeId(value: unknown): string {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? String(id) : '';
}

function readSeatUis(scene: UnknownRecord | null): UnknownRecord[] {
  const container = asRecord(scene?.seatContainer);
  const list = container?.seatUIs ?? container?.seatUis;
  if (!Array.isArray(list)) return [];
  return list.map(asRecord).filter((seat): seat is UnknownRecord => seat !== null);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
