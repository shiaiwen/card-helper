/**
 * 死后离桌判断与执行：托管局结束后延时离开，避免卡在结算。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { clickLayaNode, confirmNamedPrompt } from '../auto-hg/auto-hg-runtime.ts';
import { allOthersAreAi } from './auto-bot-mode.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 自己阵亡且其余座位都是人机时才退出。 */
export function shouldLeaveAfterDeath(input: {
  deadSeatId: number;
  selfSeatId: number;
  seats: Array<{ ai?: unknown }>;
}): boolean {
  if (input.deadSeatId !== input.selfSeatId) return false;
  return allOthersAreAi(input.seats.slice(1), -1);
}

/** 读取本家座位号。 */
export function readSelfSeatId(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): number {
  const scene = asRecord(locateGameScene(globalObject));
  const seat = asRecord(asRecord(scene?.SelfSeatUi)?.seat);
  return Number(seat?.SeatID ?? seat?.seatID ?? seat?.index ?? -1);
}

/** 读取各座位是否人机。 */
export function readSeatAiFlags(globalObject: LayaRuntimeWindow): Array<{ ai?: unknown }> {
  const scene = asRecord(locateGameScene(globalObject));
  const seats = (asRecord(scene?.seatContainer)?.seatUIs as unknown[]) || [];
  return seats.map((item) => asRecord(item) ?? {});
}

/** 自己阵亡且其余全是 AI 时，点返回并确认退出。 */
export function leaveGameAfterDeath(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  const scene = asRecord(locateGameScene(globalObject));
  const back = asRecord(asRecord(scene?.topMenu)?.backBtn);
  const clicked = clickLayaNode(back, globalObject);
  confirmNamedPrompt(locator, '退出游戏', '确定');
  return clicked;
}
