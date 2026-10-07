/**
 * 百胜点将：根据成就列表挑选未完成武将并自动点将。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { HIDDEN_BAI_SHENG_GENERAL_IDS, pickBaiShengGeneralId } from './auto-bot-mode.ts';

type UnknownRecord = Record<string, unknown>;

const FIGURE_REBEL = 2;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function hasGeneral(locator: LayaObjectLocator, generalId: number): boolean {
  const manager = locator.manager('GameGeneralManager');
  if (!manager || typeof manager.HasGeneral !== 'function') return true;
  try {
    return !!manager.HasGeneral(generalId);
  } catch {
    return true;
  }
}

/** 从成就列表里挑出还没完成、且账号拥有的百胜武将。 */
export function unfinishedBaiShengIds(achList: unknown[], locator: LayaObjectLocator): number[] {
  const ids: number[] = [];
  for (const item of achList) {
    const record = asRecord(item);
    if (!record || Number(record.flags) !== 0x800) continue;
    const generalId = Number(record.characterId ?? record.CharacterId ?? 0);
    if (!(generalId > 0) || HIDDEN_BAI_SHENG_GENERAL_IDS.has(generalId)) continue;
    if (!hasGeneral(locator, generalId)) continue;
    if (record.completed === true || Number(record.finishTime) > 0) continue;
    ids.push(generalId);
  }
  return ids;
}

function applyFigure(manager: UnknownRecord, generalId: number): boolean {
  if (typeof manager.clearFigureState !== 'function' || typeof manager.updateAllFigureState !== 'function') {
    return false;
  }
  if (typeof manager.getfigureState !== 'function') return false;
  try {
    manager.figureId = FIGURE_REBEL;
    manager.clearFigureState();
    manager.event?.('DJ_TAP_FIGURE_CHANGE', FIGURE_REBEL);
    if (generalId > 0 && typeof manager.updateAllFigureState === 'function') {
      manager.updateAllFigureState(generalId);
    }
    manager.event?.('DJ_SELECT_GENERAL', { ItemID: generalId, Id: generalId });
    manager.saveFigureConfiger?.();
    return Number(manager.getfigureState(FIGURE_REBEL) || 0) === generalId || generalId === 0;
  } catch {
    return false;
  }
}

/**
 * 桌上点将未完成百胜的反贼武将。
 * 禁将方案整表暂存/恢复体量大，有问题再补；这里只做点将。
 */
export function tryBaiShengDianjiang(
  locator: LayaObjectLocator,
  tableScene: UnknownRecord,
  unfinished: number[],
  currentId = 0
): number {
  const view = asRecord(tableScene.dianjiangView);
  const manager = asRecord(view?.figureManager) ?? asRecord(view?.manager) ?? asRecord(tableScene.figureManager);
  if (!view || !manager) return 0;
  if (typeof view.onOpenDJClick === 'function') {
    try { view.onOpenDJClick(); } catch { /* ignore */ }
  }
  const picked = pickBaiShengGeneralId(unfinished, currentId);
  if (!picked) return 0;
  if (typeof manager.canDianJiang === 'function' && !manager.canDianJiang()) return 0;
  if (!applyFigure(manager, picked)) return 0;
  tableScene.__xcBaiShengDianjiang = { generalId: picked, at: Date.now() };
  return picked;
}

/** 读取已加载的成就配置。 */
export function readAchList(globalObject: LayaRuntimeWindow): unknown[] {
  const xc = asRecord((globalObject as UnknownRecord).XC);
  const card = asRecord(xc?.cardConfig) ?? asRecord(xc?.CardConfig) ?? asRecord((globalObject as UnknownRecord).__XIAOCHAO_CARD_CONFIG__);
  const ach = card?.Ach ?? card?.ach;
  return Array.isArray(ach) ? ach : [];
}
