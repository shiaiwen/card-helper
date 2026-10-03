import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  AUTO_BOT_ENABLED_KEY,
  AUTO_BOT_TAVERN_TARGET_KEY,
  AUTO_HG_ENABLED_KEY,
  BAI_SHENG_ENABLED_KEY
} from '../extra-assist/extra-assist-settings.ts';
import { RESTART_DELAY_MS } from '../auto-hg/auto-hg-actions.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { DEAL_INTERVAL_MS } from './auto-bot-actions.ts';
import { tryBaiShengDianjiang, readAchList, unfinishedBaiShengIds } from './auto-bot-baisheng.ts';
import { leaveGameAfterDeath, readSeatAiFlags, readSelfSeatId, shouldLeaveAfterDeath } from './auto-bot-leave.ts';
import { emptyRoomSession, runAutoBotHall, runAutoBotTable, type AutoBotRoomSession } from './auto-bot-rooms.ts';
import { runAutoBotDeal, type AutoBotPlayContext } from './auto-bot-play.ts';
import {
  readTavernProgress,
  requestTavernProgress,
  tavernStatusText,
  type TavernProgress
} from './auto-bot-tavern.ts';
import {
  clickFirstGeneral,
  findGeneralWindows,
  handleExtraBotWindows,
  handlePlayWindows
} from './auto-bot-windows.ts';

type UnknownRecord = Record<string, unknown>;

const STATE_KEY = 'XC_AUTO_BOT_STATE';
const SESSION_KEY = 'XC_AUTO_BOT_SESSION';
const LEAVE_DELAY_MS = 5000;
const TAVERN_POLL_MS = 5000;

export interface AutoBotStatus {
  tavernText: string;
  managedRoom: boolean;
  kind: number;
}

export interface AutoBotController {
  dispose(): void;
  filterMessage(payload: UnknownRecord, className: string): void;
  getStatus(): AutoBotStatus;
}

export interface AutoBotControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  gameEvents?: GameEventBus;
  pollIntervalMs?: number;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function persistEnabled(globalObject: LayaRuntimeWindow, enabled: boolean): void {
  try {
    if (enabled) globalObject.localStorage?.setItem?.(STATE_KEY, '1');
    else globalObject.localStorage?.removeItem?.(STATE_KEY);
  } catch {
    // ignore
  }
}

function persistSession(globalObject: LayaRuntimeWindow, session: AutoBotRoomSession): void {
  try {
    globalObject.localStorage?.setItem?.(SESSION_KEY, JSON.stringify({
      managedRoom: session.managedRoom,
      kind: session.kind,
      baiShengGeneralId: session.baiShengGeneralId,
      aiPromptDone: session.aiPromptDone
    }));
  } catch {
    // ignore
  }
}

function restoreSession(globalObject: LayaRuntimeWindow): AutoBotRoomSession {
  const session = emptyRoomSession();
  try {
    const raw = globalObject.localStorage?.getItem?.(SESSION_KEY);
    if (!raw) return session;
    const parsed = JSON.parse(raw) as Partial<AutoBotRoomSession>;
    if (typeof parsed.managedRoom === 'boolean') session.managedRoom = parsed.managedRoom;
    if (parsed.kind === 11 || parsed.kind === 28 || parsed.kind === 29 || parsed.kind === 1) {
      session.kind = parsed.kind;
    }
    if (Number(parsed.baiShengGeneralId) > 0) session.baiShengGeneralId = Number(parsed.baiShengGeneralId);
    if (parsed.aiPromptDone === true) session.aiPromptDone = true;
  } catch {
    // ignore
  }
  return session;
}

/**
 * 自动挂机全套：建房/入座/开局、选将、出牌、窗口、酒馆目标、百胜点将、阵亡离场。
 * 对照 app.bak autoR/autoS/deal。不重包 ShowWindow，轮询窗口。
 * 盖主速刷开启时让出选将、出牌和房间流程。
 */
export function installAutoBotController(
  configStore: XiaochaoConfigStore,
  options: AutoBotControllerOptions = {}
): AutoBotController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const pollIntervalMs = options.pollIntervalMs ?? 400;
  let disposed = false;
  let enabled = configStore.get(AUTO_BOT_ENABLED_KEY) === true;
  let baiSheng = configStore.get(BAI_SHENG_ENABLED_KEY) === true;
  let tavernTarget = configStore.get(AUTO_BOT_TAVERN_TARGET_KEY);
  let runId = 0;
  let lastTableAt = 0;
  let lastHallAt = 0;
  let lastTavernAt = 0;
  let tavernProgress: TavernProgress | null = null;
  let session = restoreSession(globalObject);
  let play: AutoBotPlayContext = { decision: null, mode: 'off' };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cleanups: Array<() => void> = [];

  silenceLegacyAutoBot(globalObject);
  persistEnabled(globalObject, enabled);

  cleanups.push(configStore.subscribe(AUTO_BOT_ENABLED_KEY, ({ value }) => {
    enabled = value === true;
    silenceLegacyAutoBot(globalObject);
    persistEnabled(globalObject, enabled);
    bumpRun();
    play = { decision: null, mode: 'off' };
    if (!enabled) session = emptyRoomSession();
    persistSession(globalObject, session);
    if (enabled && !stopIfTavernDone()) scheduleTable(0);
  }));
  cleanups.push(configStore.subscribe(BAI_SHENG_ENABLED_KEY, ({ value }) => {
    baiSheng = value === true;
  }));
  cleanups.push(configStore.subscribe(AUTO_BOT_TAVERN_TARGET_KEY, ({ value }) => {
    tavernTarget = value;
    refreshTavern(true);
    if (enabled) stopIfTavernDone();
  }));

  if (options.gameEvents) {
    cleanups.push(options.gameEvents.subscribe((event) => {
      if (!enabled || disposed) return;
      if (event.type === 'game-ended') {
        play = { decision: null, mode: 'off' };
        refreshTavern(true);
        if (stopIfTavernDone()) return;
        scheduleTable(RESTART_DELAY_MS);
      }
      if (event.type === 'player-died') {
        const selfSeatId = readSelfSeatId(locator, globalObject);
        if (!shouldLeaveAfterDeath({
          deadSeatId: event.seatId,
          selfSeatId,
          seats: readSeatAiFlags(globalObject)
        })) return;
        later(() => leaveGameAfterDeath(locator, globalObject), LEAVE_DELAY_MS);
      }
    }));
  }

  const pollTimer = globalObject.setInterval?.(() => tick(), pollIntervalMs);
  if (pollTimer != null) cleanups.push(() => globalObject.clearInterval?.(pollTimer));
  const dealTimer = globalObject.setInterval?.(() => deal(), DEAL_INTERVAL_MS);
  if (dealTimer != null) cleanups.push(() => globalObject.clearInterval?.(dealTimer));
  if (enabled && !stopIfTavernDone()) {
    refreshTavern(true);
    scheduleTable(0);
  }

  function bumpRun(): number {
    runId += 1;
    return runId;
  }

  function stillRunning(expected: number): boolean {
    return !disposed && enabled && runId === expected;
  }

  function later(callback: () => void, delay: number): void {
    const expected = runId;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stillRunning(expected)) callback();
    }, delay);
    timers.add(timer);
  }

  function hgOwnsPlay(): boolean {
    return configStore.get(AUTO_HG_ENABLED_KEY) === true;
  }

  function refreshTavern(request: boolean): void {
    if (request) requestTavernProgress(locator);
    tavernProgress = readTavernProgress(locator, tavernTarget);
  }

  function stopIfTavernDone(): boolean {
    if (tavernTarget === 'none') return false;
    const progress = tavernProgress ?? readTavernProgress(locator, tavernTarget);
    tavernProgress = progress;
    if (!progress?.available || !progress.completed) return false;
    configStore.set(AUTO_BOT_ENABLED_KEY, false);
    return true;
  }

  function scheduleTable(delay: number): void {
    later(() => {
      if (hgOwnsPlay()) return;
      session = runAutoBotTable(locator, globalObject, session, {
        baiSheng,
        onBaiSheng: (scene, currentId) => tryBaiShengDianjiang(
          locator,
          scene,
          unfinishedBaiShengIds(readAchList(globalObject), locator),
          currentId
        ),
        schedule: later
      });
      persistSession(globalObject, session);
    }, delay);
  }

  function tick(): void {
    if (disposed || !enabled) return;
    const now = Date.now();
    if (now - lastTavernAt >= TAVERN_POLL_MS) {
      lastTavernAt = now;
      refreshTavern(false);
      if (stopIfTavernDone()) return;
    }
    handleExtraBotWindows(locator, globalObject, session.kind);
    if (hgOwnsPlay()) return;
    for (const win of findGeneralWindows(locator)) {
      if (Array.isArray(win.generalUis) && win.generalUis.length) clickFirstGeneral(win);
    }
    if (now - lastHallAt >= 2000) {
      lastHallAt = now;
      session = runAutoBotHall(locator, globalObject, session, now);
      persistSession(globalObject, session);
    }
    if (now - lastTableAt >= 500) {
      lastTableAt = now;
      session = runAutoBotTable(locator, globalObject, session, {
        baiSheng,
        onBaiSheng: (scene, currentId) => tryBaiShengDianjiang(
          locator,
          scene,
          unfinishedBaiShengIds(readAchList(globalObject), locator),
          currentId
        ),
        schedule: later
      });
      persistSession(globalObject, session);
    }
  }

  function deal(): void {
    if (disposed || !enabled || hgOwnsPlay()) return;
    handlePlayWindows(locator, globalObject);
    play = runAutoBotDeal(locator, globalObject, play);
    const scene = asRecord(locateGameScene(globalObject));
    const self = asRecord(scene?.SelfSeatUi);
    if (session.kind === 28 && self && typeof self.canHalfShow === 'function') {
      try { if (self.canHalfShow()) self.onHalfShow?.(); } catch { /* ignore */ }
    }
  }

  return {
    filterMessage(payload, className) {
      if (!enabled || disposed) return;
      if (className === 'MsgGameOver') {
        play = { decision: null, mode: 'off' };
        refreshTavern(true);
        later(() => {
          if (stopIfTavernDone()) return;
          scheduleTable(0);
        }, RESTART_DELAY_MS);
        return;
      }
      if (className === 'SmsgUpdateTaskProgressToClient' || className === 'decodeUserQuestInfoRep') {
        refreshTavern(false);
        stopIfTavernDone();
      }
    },
    getStatus() {
      return {
        tavernText: tavernStatusText(tavernProgress, tavernTarget),
        managedRoom: session.managedRoom,
        kind: session.kind
      };
    },
    dispose() {
      disposed = true;
      enabled = false;
      bumpRun();
      persistEnabled(globalObject, false);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const cleanup of cleanups.splice(0)) {
        try { cleanup(); } catch { /* ignore */ }
      }
    }
  };
}

function silenceLegacyAutoBot(globalObject: LayaRuntimeWindow): void {
  try {
    const config = asRecord(asRecord((globalObject as UnknownRecord).XC)?.globalConfig);
    if (config && 'autoBotSwitch' in config && Number(config.autoBotSwitch) !== 9) {
      config.autoBotSwitch = false;
    }
  } catch {
    // ignore
  }
  try {
    const input = globalObject.document?.getElementById?.('autoBotSwitch') as HTMLInputElement | null;
    if (input?.checked) {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch {
    // ignore
  }
  try {
    globalObject.localStorage?.setItem?.('AUTO_BOT_SWITCH', 'false');
  } catch {
    // ignore
  }
}
