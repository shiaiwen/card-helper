import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { AUTO_HG_ENABLED_KEY } from '../extra-assist/extra-assist-settings.ts';
import { isIdleKickWhy, KUROU_INTERVAL_MS, RESTART_DELAY_MS } from './auto-hg-actions.ts';
import {
  clickHuangGai,
  findSelectGeneralWindow,
  locateTableScene,
  runKurouTick,
  runTableRestart
} from './auto-hg-runtime.ts';

type UnknownRecord = Record<string, unknown>;

export interface AutoHgController {
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface AutoHgControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  gameEvents?: GameEventBus;
  pollIntervalMs?: number;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/**
 * 盖主速刷：小号主公点黄盖，隔拍点苦肉与确认，结算后补人机再开。
 * 不依赖 xiaochao-legacy；大号出牌仍走「自动挂机」（尚未迁移）。
 */
export function installAutoHgController(
  configStore: XiaochaoConfigStore,
  options: AutoHgControllerOptions = {}
): AutoHgController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const pollIntervalMs = options.pollIntervalMs ?? 400;
  let disposed = false;
  let enabled = configStore.get(AUTO_HG_ENABLED_KEY) === true;
  let runId = 0;
  let kurouTick = 0;
  let missingHuangGai = 0;
  let lastTableAt = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cleanups: Array<() => void> = [];

  silenceLegacyAutoHg(globalObject);

  cleanups.push(configStore.subscribe(AUTO_HG_ENABLED_KEY, ({ value }) => {
    enabled = value === true;
    silenceLegacyAutoHg(globalObject);
    bumpRun();
    missingHuangGai = 0;
    if (enabled) scheduleRestart(0);
  }));

  if (options.gameEvents) {
    cleanups.push(options.gameEvents.subscribe((event) => {
      if (!enabled || disposed) return;
      if (event.type === 'game-ended') scheduleRestart(RESTART_DELAY_MS);
      if (event.type === 'game-started') kurouTick = 0;
    }));
  }

  const pollTimer = globalObject.setInterval?.(() => tick(), pollIntervalMs);
  if (pollTimer != null) cleanups.push(() => globalObject.clearInterval?.(pollTimer));
  if (enabled) scheduleRestart(0);

  function currentRun(): number {
    return runId;
  }

  function bumpRun(): number {
    runId += 1;
    return runId;
  }

  function stillRunning(expected: number): boolean {
    return !disposed && enabled && runId === expected;
  }

  function later(callback: () => void, delay: number): void {
    const expected = currentRun();
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stillRunning(expected)) callback();
    }, delay);
    timers.add(timer);
  }

  function scheduleRestart(delay: number): void {
    const expected = currentRun();
    later(() => {
      if (!stillRunning(expected)) return;
      if (locateTableScene(globalObject)) runTableRestart(locator, globalObject);
    }, delay);
  }

  function tick(): void {
    if (disposed || !enabled) return;
    const generalWin = findSelectGeneralWindow(locator);
    if (generalWin && Array.isArray(generalWin.generalUis) && generalWin.generalUis.length) {
      const result = clickHuangGai(generalWin);
      if (result === 'missing') {
        missingHuangGai += 1;
        if (missingHuangGai >= 8) {
          console.warn('[盖主速刷] 本次选将未找到黄盖，已停止');
          configStore.set(AUTO_HG_ENABLED_KEY, false);
        }
        return;
      }
      missingHuangGai = 0;
    }
    if (locateTableScene(globalObject)) {
      const now = Date.now();
      if (now - lastTableAt >= 2000) {
        lastTableAt = now;
        runTableRestart(locator, globalObject);
      }
    }
  }

  const kurouTimer = globalObject.setInterval?.(() => {
    if (disposed || !enabled) return;
    runKurouTick(globalObject, kurouTick);
    kurouTick += 1;
  }, KUROU_INTERVAL_MS);
  if (kurouTimer != null) cleanups.push(() => globalObject.clearInterval?.(kurouTimer));

  return {
    filterMessage(payload, className) {
      if (!enabled || disposed) return;
      if (className !== 'ClientLeavetableRep') return;
      const body = asRecord(payload.ProtoObj) ?? asRecord(payload.protoObj) ?? payload;
      if (!isIdleKickWhy(body.Why ?? body.why)) return;
      console.warn('[盖主速刷] 房主长时间未开局，已被请出房间，已自动关闭');
      configStore.set(AUTO_HG_ENABLED_KEY, false);
    },
    dispose() {
      disposed = true;
      enabled = false;
      bumpRun();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const cleanup of cleanups.splice(0)) {
        try { cleanup(); } catch { /* ignore */ }
      }
    }
  };
}

function silenceLegacyAutoHg(globalObject: LayaRuntimeWindow): void {
  try {
    const config = asRecord(asRecord((globalObject as UnknownRecord).XC)?.globalConfig);
    if (config && 'autoHGSwitch' in config) config.autoHGSwitch = false;
    if (config && Number(config.autoBotSwitch) === 9) config.autoBotSwitch = false;
  } catch {
    // ignore
  }
  try {
    const input = globalObject.document?.getElementById?.('autoHGSwitch') as HTMLInputElement | null;
    if (input?.checked) {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch {
    // ignore
  }
  try {
    globalObject.localStorage?.setItem?.('AUTO_HG_SWITCH', 'false');
  } catch {
    // ignore
  }
}
