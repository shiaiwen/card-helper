/**
 * 酒馆进度：读取每日/每周对局目标，供自动托管决定是否继续开房。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import type { XiaochaoConfig } from '../../config/config-schema.ts';

type UnknownRecord = Record<string, unknown>;

export type AutoBotTavernTarget = XiaochaoConfig['assist.autoBotTavernTarget'];

export const AUTO_BOT_TAVERN_OPTIONS = {
  none: { taskId: 0, label: '无目标', targetSeconds: 0 },
  dailyGame: { taskId: 161114, label: '每日游戏时间', targetSeconds: 1800 },
  dailyWin: { taskId: 161115, label: '每日胜利时间', targetSeconds: 1800 },
  weeklyWin: { taskId: 161116, label: '每周胜利时间', targetSeconds: 5400 }
} as const;

export const AUTO_BOT_TAVERN_TASK_IDS = [161114, 161115, 161116] as const;

export interface TavernProgress {
  key: AutoBotTavernTarget;
  current: number;
  target: number;
  completed: boolean;
  available: boolean;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 把配置值收成酒馆目标，无法识别时当作未设置。 */
export function parseTavernTarget(value: unknown): AutoBotTavernTarget {
  if (value === 'dailyGame' || value === 'dailyWin' || value === 'weeklyWin' || value === 'none') {
    return value;
  }
  return 'none';
}

/** 把秒数格式化成分秒文案。 */
export function formatTavernSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes) return remain ? `${minutes}分${remain}秒` : `${minutes}分`;
  return `${remain}秒`;
}

function callTask(locator: LayaObjectLocator, method: string, ...args: unknown[]): unknown {
  const manager = locator.manager('TaskManager');
  if (!manager) return null;
  const name = locator.obfuscatedMethodName(manager, 'TaskManager', method) || method;
  const fn = manager[name];
  if (typeof fn !== 'function') return null;
  try {
    return fn.apply(manager, args);
  } catch {
    return null;
  }
}

/** 向任务管理器请求酒馆任务进度。 */
export function requestTavernProgress(locator: LayaObjectLocator): boolean {
  const manager = locator.manager('TaskManager');
  if (!manager) return false;
  const fn = manager.reqTaskProgressByIds ?? manager.ReqTaskProgressByIds;
  if (typeof fn !== 'function') return false;
  try {
    fn.call(manager, [...AUTO_BOT_TAVERN_TASK_IDS]);
    return true;
  } catch {
    return false;
  }
}

/** 读取当前酒馆目标的完成进度。 */
export function readTavernProgress(
  locator: LayaObjectLocator,
  target: AutoBotTavernTarget
): TavernProgress | null {
  if (target === 'none') return null;
  const option = AUTO_BOT_TAVERN_OPTIONS[target];
  const task = asRecord(
    callTask(locator, 'GetServerTaskDataByTaskID', option.taskId)
    || callTask(locator, 'GetAllTaskDataByTaskID', option.taskId)
  );
  if (!task) {
    return { key: target, current: 0, target: option.targetSeconds, completed: false, available: false };
  }
  const conditions = Array.isArray(task.task_condition) ? task.task_condition as UnknownRecord[]
    : Array.isArray(task.taskConditions) ? task.taskConditions as UnknownRecord[]
      : [];
  const first = conditions.find((item) => Number(item?.condition_id ?? 0) === 0) || conditions[0] || null;
  const matched = conditions.find((item) => Number(item?.condition_id ?? option.taskId) === option.taskId) || first;
  const current = Math.max(0, Number(first?.condition_cnt ?? matched?.progress ?? 0) || 0);
  const goal = Math.max(
    1,
    Number(matched?.condition_max ?? asRecord(task.baseVo)?.TaskCount ?? option.targetSeconds) || option.targetSeconds
  );
  const completed = Number(task.task_state) === 3
    || Number(task.award_cnt) >= 1
    || Number(task.complete_cnt) >= 1
    || task.IsGetAward === true
    || task.isGetAward === true
    || current >= goal;
  return {
    key: target,
    current: completed ? goal : Math.min(current, goal),
    target: goal,
    completed,
    available: true
  };
}

/** 把酒馆进度收成设置页上的一行状态。 */
export function tavernStatusText(progress: TavernProgress | null, target: AutoBotTavernTarget): string {
  if (target === 'none') return '未设置';
  if (!progress || !progress.available) return '等待酒馆任务数据';
  if (progress.completed) return `${AUTO_BOT_TAVERN_OPTIONS[target].label}已完成`;
  return `进度：${formatTavernSeconds(progress.current)}`;
}
