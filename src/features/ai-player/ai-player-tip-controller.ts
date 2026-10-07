/**
 * 排位或斗地主遇到人机时提示一次；打开资料且对方是人机时再提示。
 */

import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import { isAiClientId, isAiTipModeLabel } from './ai-client.ts';

type UnknownRecord = Record<string, unknown>;

export function installAiPlayerTipController(
  gameEvents: GameEventBus,
  globalObject: GameRuntimeWindow = window
): () => void {
  let rankedTipKey = '';
  let profileTipId = 0;
  const stopEvents = gameEvents.subscribe((event) => {
    if (event.type === 'game-started' || event.type === 'game-ended') rankedTipKey = '';
  });
  const timer = globalObject.setInterval(scan, 500);
  scan();

  return () => {
    stopEvents();
    globalObject.clearInterval(timer);
  };

  function scan(): void {
    try {
      scanRankedOpponents();
      scanProfile();
    } catch {
      // 场景未就绪时跳过，下一轮再看。
    }
  }

  function scanRankedOpponents(): void {
    const scene = asRecord(locateGameScene(globalObject));
    if (!scene) {
      rankedTipKey = '';
      return;
    }
    if (!isAiTipModeLabel(readModeLabel(scene, globalObject))) return;
    const selfId = readSeatId(asRecord(asRecord(scene.SelfSeatUi)?.seat));
    const opponents = readSeatUis(scene).filter((seatUi) => {
      const seat = asRecord(seatUi.seat);
      const seatId = readSeatId(seat);
      if (selfId !== null && seatId === selfId) return false;
      return isAiClientId(readClientId(seat));
    });
    if (!opponents.length) return;
    const key = opponents.map((seatUi) => String(readClientId(asRecord(seatUi.seat)))).sort().join(',');
    if (key === rankedTipKey) return;
    rankedTipKey = key;
    showToast('对战AI小杀！', 'warning', 4000);
  }

  function scanProfile(): void {
    const view = findUserInfoView(globalObject);
    if (!view || view.visible === false || view.destroyed === true) {
      profileTipId = 0;
      return;
    }
    const userData = asRecord(view.userData);
    const clientId = Number(readClientId(userData) ?? userData?.ClientId ?? userData?.clientId);
    if (!isAiClientId(clientId)) {
      profileTipId = 0;
      return;
    }
    if (profileTipId === clientId) return;
    profileTipId = clientId;
    showToast('小抄: 这是个人机', 'warning', 5000);
  }
}

function findUserInfoView(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const stage = asRecord(asRecord(globalObject.Laya)?.stage);
  return stage ? findNamedView(stage, 'UserInfoView', 0) : null;
}

function findNamedView(node: UnknownRecord, name: string, depth: number): UnknownRecord | null {
  if (depth > 8 || node.destroyed === true || node.visible === false) return null;
  const ctor = typeof node.constructor === 'function' ? node.constructor.name : '';
  if (ctor === name || node.name === name) return node;
  const children = Array.isArray(node._children) ? node._children : [];
  for (const child of children) {
    const record = asRecord(child);
    if (!record) continue;
    const found = findNamedView(record, name, depth + 1);
    if (found) return found;
  }
  return null;
}

function readModeLabel(scene: UnknownRecord, globalObject: GameRuntimeWindow): string {
  const parts: unknown[] = [];
  const topMenu = asRecord(scene.topMenu);
  const area = asRecord(topMenu?.areaServerLabel);
  parts.push(area?.text, scene.modeName, scene.ModeName, scene.gameModeName);
  const context = asRecord((globalObject as UnknownRecord).GameContext);
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    parts.push(vo?.ModeName, vo?.modeName, vo?.Name, vo?.name, vo?.SectionName, vo?.sectionName);
  } catch {
    // 模式名读失败时不当成排位。
  }
  return parts.filter((part) => typeof part === 'string').join(' ');
}

function readSeatUis(scene: UnknownRecord): UnknownRecord[] {
  const container = asRecord(scene.seatContainer);
  const list = container?.seatUIs ?? container?.seatUis;
  if (!Array.isArray(list)) return [];
  return list.map(asRecord).filter((seat): seat is UnknownRecord => seat !== null);
}

function readClientId(seat: UnknownRecord | null): unknown {
  const info = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo) ?? seat;
  return info?.ClientId ?? info?.clientId ?? info?.ClientID;
}

function readSeatId(seat: UnknownRecord | null): number | null {
  if (!seat) return null;
  for (const key of ['seatID', 'seatId', 'SeatID', 'index', 'Index']) {
    const value = Number(seat[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
