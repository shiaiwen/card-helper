/**
 * 进阶辅助总控：开关开启时挂载南华、许劭、裴秀等子辅助，并轮询座位武将 tip。
 * 配置来自 cha_spellextend.sgs（经 CardConfigSource）；关闭时清理裴秀路线状态。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
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

  const pollTimer = globalObject.setInterval?.(() => {
    tryInstallSeatHooks();
    refreshQuanyu();
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
    }
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}
