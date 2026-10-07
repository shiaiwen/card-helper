/**
 * 身份演武里的身份自选：按房间座位顺序把身份显示到武将牌上。
 * 房间名包含「身份演武」，并且模式是身份自选，才会写入。
 */

import { createLayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { locateGameEventDispatcher, locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import { figureByClientOrder } from './choose-figure.ts';

type UnknownRecord = Record<string, unknown>;

export function installChooseFigureController(
  globalObject: GameRuntimeWindow = window
): () => void {
  const timer = globalObject.setInterval(applyChooseFigures, 500);
  applyChooseFigures();
  return () => globalObject.clearInterval(timer);

  function applyChooseFigures(): void {
    try {
      const room = roomController(globalObject);
      const setting = asRecord(room?.TableSetting) ?? asRecord(room?.tableSetting);
      const mode = readMode(globalObject, room, setting);
      if (!shouldRevealIdentityFigures(mode)) return;
      const clientIds = readClientIds(
        asRecord(room?.TabbleSeatInfos)
        ?? asRecord(room?.tabbleSeatInfos)
        ?? asRecord(room?.TableSeatInfos)
        ?? asRecord(room?.tableSeatInfos)
      );
      if (clientIds.length !== 8) return;
      const scene = asRecord(locateGameScene(globalObject));
      const seatUis = readSeatUis(scene);
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

export function shouldRevealIdentityFigures(input: {
  modeText: string;
  modeType?: number;
  chooseFigure: boolean;
}): boolean {
  const drill = input.modeText.includes('身份演武')
    || input.modeType === 74
    || input.modeType === 84;
  const custom = input.chooseFigure
    || input.modeText.includes('自选身份')
    || input.modeText.includes('身份自选');
  return drill && custom;
}

function readMode(globalObject: GameRuntimeWindow, room: UnknownRecord | null, setting: UnknownRecord | null): {
  modeText: string;
  modeType: number;
  chooseFigure: boolean;
} {
  const scene = asRecord(locateGameScene(globalObject));
  const topMenu = asRecord(scene?.topMenu);
  const area = asRecord(topMenu?.areaServerLabel);
  const parts: unknown[] = [area?.text, scene?.modeName, scene?.ModeName];
  const context = createLayaObjectLocator(globalObject).gameContext()
    ?? asRecord((globalObject as UnknownRecord).GameContext);
  let modeType = 0;
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    modeType = Number(vo?.ModeType ?? vo?.modeType ?? context?.GetModeType?.() ?? 0) || 0;
    parts.push(
      vo?.ModeName, vo?.modeName, vo?.Name, vo?.name,
      vo?.SectionName, vo?.sectionName, vo?.ModelName, vo?.modelName,
      vo?.SectionDesc, vo?.Desc, vo?.desc
    );
  } catch {
    // 模式名读失败时继续看房间设置里的文字。
  }
  collectChinese(setting, parts);
  collectChinese(room, parts);
  return {
    modeText: parts.filter((part) => typeof part === 'string').join(' '),
    modeType,
    chooseFigure: isChooseFigure(setting)
  };
}

function collectChinese(record: UnknownRecord | null, parts: unknown[]): void {
  if (!record) return;
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && /[\u4e00-\u9fff]/.test(value)) parts.push(value);
  }
}

function isChooseFigure(setting: UnknownRecord | null): boolean {
  if (!setting) return false;
  const value = setting.IsChooseFigure ?? setting.isChooseFigure ?? setting.ChooseFigure ?? setting.chooseFigure;
  return value === true || value === 1 || value === '1';
}

function roomController(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const globals = globalObject as UnknownRecord;
  const locator = createLayaObjectLocator(globalObject);
  const windowManager = locator.manager('WindowManager');
  const managerList = asRecord(windowManager?.constructor)?.managerList;
  const named = [
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
