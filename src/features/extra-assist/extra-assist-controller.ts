/**
 * 进阶辅助总控：开关开启时挂载南华、许劭、裴秀等子辅助，并轮询座位武将 tip。
 * 配置来自 cha_spellextend.sgs（经 CardConfigSource）；关闭时清理裴秀路线状态。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { EXTRA_ASSIST_ENABLED_KEY } from './extra-assist-settings.ts';
import {
  buildExtraAssistConfigData,
  type ExtraAssistConfigData
} from './extra-assist-config-data.ts';
import { formatQuanyuTipText, QUANYU_SKILL_ID } from './quanyu-assist.ts';
import { installNanHuaAssist } from './nanhua-assist.ts';
import { installXuShaoAssist } from './xushao-assist.ts';
import { installPeixiuAssist } from './peixiu-assist.ts';
import type { PeixiuRouteStore } from './peixiu-route-store.ts';
import {
  applySeatGeneralTip,
  clearSeatGeneralTips,
  collectSeatTipTargets
} from './seat-general-tips.ts';
import {
  createZuifengUses,
  formatZuifengTip,
  zuifengSkillIds
} from './zuifeng-assist.ts';

type UnknownRecord = Record<string, unknown>;

export interface ExtraAssistController {
  dispose(): void;
}

export interface ExtraAssistControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  getSpellExtendRaw?: () => unknown;
  getExtraAssistData?: () => ExtraAssistConfigData | null;
  getCard?: (cardId: number) => Record<string, unknown> | null;
  pollIntervalMs?: number;
  peixiuRouteStore?: PeixiuRouteStore;
  gameEvents?: GameEventBus;
}

/**
 * 安装进阶辅助：按配置开关挂载子模块，轮询刷新权变/座位提示。
 * @returns dispose 清理补丁、定时器与 tip
 */
export function installExtraAssistController(
  configStore: XiaochaoConfigStore,
  options: ExtraAssistControllerOptions = {}
): ExtraAssistController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const pollIntervalMs = options.pollIntervalMs ?? 800;
  let disposed = false;
  let enabled = configStore.get(EXTRA_ASSIST_ENABLED_KEY) === true;
  let cachedConfig: ExtraAssistConfigData | null = null;
  let seatHooksInstalled = false;
  const cleanups: Array<() => void> = [];

  cleanups.push(configStore.subscribe(EXTRA_ASSIST_ENABLED_KEY, ({ value }) => {
    enabled = value === true;
    if (!enabled) options.peixiuRouteStore?.clear();
    refreshQuanyu();
  }));

  cleanups.push(installNanHuaAssist({
    isEnabled: () => enabled,
    getConfig: () => {
      const data = readConfig();
      return data ? { trigger: data.nanHua.trigger, effectHtml: data.nanHua.effectHtml } : null;
    },
    locator,
    patcher,
    globalObject
  }));
  cleanups.push(installXuShaoAssist({
    isEnabled: () => enabled,
    getEntries: () => readConfig()?.shiLun ?? [],
    resolveSpellName: (_spellId, fallback) => fallback,
    locator,
    patcher,
    globalObject
  }));
  cleanups.push(installPeixiuAssist({
    isEnabled: () => enabled,
    locator,
    patcher,
    globalObject,
    cardLookup: { getCard: options.getCard },
    getReward: (rewardId) => readConfig()?.peiXiuRewards[rewardId] ?? null,
    routeStore: options.peixiuRouteStore
  }));

  const zuifengUses = createZuifengUses();
  if (options.gameEvents) {
    cleanups.push(options.gameEvents.subscribe((event) => {
      if (event.type === 'game-started' || event.type === 'game-ended') {
        zuifengUses.resetAll();
        refreshZuifeng();
        return;
      }
      if (event.type === 'turn-started') {
        zuifengUses.resetSeat(event.seatId);
        refreshZuifeng();
        return;
      }
      if (event.type !== 'spell-targeted') return;
      const scene = locateGameScene(globalObject);
      const skillIds = zuifengSkillIds(scene);
      if (!skillIds.includes(event.spellId)) return;
      zuifengUses.noteUse(event.seatId);
      refreshZuifeng();
    }));
  }

  const pollTimer = globalObject.setInterval?.(() => {
    tryInstallSeatHooks();
    refreshQuanyu();
    refreshZuifeng();
  }, pollIntervalMs);
  if (pollTimer != null) cleanups.push(() => globalObject.clearInterval?.(pollTimer));
  tryInstallSeatHooks();
  refreshQuanyu();

  function readConfig(): ExtraAssistConfigData | null {
    if (cachedConfig) return cachedConfig;
    const ready = options.getExtraAssistData?.();
    if (ready) return (cachedConfig = ready);
    const raw = options.getSpellExtendRaw?.();
    if (!raw) return null;
    return (cachedConfig = buildExtraAssistConfigData(raw));
  }

  function refreshQuanyu(): void {
    if (disposed) return;
    const scene = locateGameScene(globalObject);
    const targets = collectSeatTipTargets(scene?.seatContainer?.seatUIs);
    if (!enabled) {
      clearSeatGeneralTips(targets, 'quanyu');
      return;
    }
    applySeatGeneralTip({
      key: 'quanyu',
      targets,
      enabled: true,
      getText: (target) => formatQuanyuTipText(target.seat),
      globalObject
    });
  }

  function refreshZuifeng(): void {
    if (disposed) return;
    const scene = locateGameScene(globalObject);
    const targets = collectSeatTipTargets(scene?.seatContainer?.seatUIs);
    const skillIds = zuifengSkillIds(scene);
    applySeatGeneralTip({
      key: 'zuifeng',
      targets,
      enabled: true,
      getText: (target) => {
        const seat = asRecord(target.seat);
        const seatId = readSeatId(seat);
        return formatZuifengTip(seat, skillIds, seatId === null ? 0 : zuifengUses.used(seatId));
      },
      style: {
        fontSize: 16,
        color: '#FFE14A',
        stroke: 3,
        strokeColor: '#1A1004',
        align: 'center',
        bold: true,
        bgColor: '#3A2410',
        place: (avatar) => {
          const width = Number(avatar.width) || 90;
          const height = Number(avatar.height) || 120;
          return { x: 0, y: Math.max(0, height - 22), width, height: 20 };
        }
      },
      globalObject
    });
  }

  function tryInstallSeatHooks(): void {
    if (seatHooksInstalled || disposed) return;
    const scene = locateGameScene(globalObject);
    const seatUIs = scene?.seatContainer?.seatUIs;
    const sample = Array.isArray(seatUIs) ? asRecord(seatUIs[0]) : null;
    const seat = asRecord(sample?.seat);
    const avatar = asRecord(sample?.seatAvatar);
    if (!seat || !avatar) return;
    const seatProto = Object.getPrototypeOf(seat);
    const avatarProto = Object.getPrototypeOf(avatar);
    if (!seatProto || !avatarProto) return;
    seatHooksInstalled = true;
    patcher.wrap(seatProto, 'SetSkillBuffInfo', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (Number(args[0]) === QUANYU_SKILL_ID) refreshQuanyu();
      return result;
    });
    patcher.wrap(avatarProto, 'SetGeneralCard', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      refreshQuanyu();
      refreshZuifeng();
      return result;
    });
  }

  return {
    dispose() {
      disposed = true;
      for (const cleanup of cleanups.splice(0)) {
        try { cleanup(); } catch { /* ignore */ }
      }
      patcher.restoreAll();
      refreshQuanyu();
      refreshZuifeng();
    }
  };
}

function readSeatId(seat: UnknownRecord | null): number | null {
  if (!seat) return null;
  for (const key of ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index']) {
    const value = Number(seat[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}
