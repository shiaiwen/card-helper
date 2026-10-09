/**
 * 场上有人机时提示一次；打开资料时，人机再提示，真人露出资料页上的编号按钮。
 * 真人的武将头顶用游戏自己的名字，人机关掉。
 */

import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import { clearSeatGeneralTips, collectSeatTipTargets } from '../extra-assist/seat-general-tips.ts';
import { aiKind, isAiClientId, readNestedClientId } from './ai-client.ts';

type UnknownRecord = Record<string, unknown>;

/** 安装人机提示。同一局只提示一次，开新局后允许再提示。 */
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
      clearDrawnIds();
      scanSeats();
      scanProfile();
    } catch {
      // 场景未就绪时跳过，下一轮再看。
    }
  }

  /** 清掉以前写在武将牌上的编号。 */
  function clearDrawnIds(): void {
    const scene = asRecord(locateGameScene(globalObject));
    clearSeatGeneralTips(collectSeatTipTargets(asRecord(scene?.seatContainer)?.seatUIs), 'player-id');
  }

  /** 有人机就提示。真人显示头顶名字，人机关掉。山河图不提示。 */
  function scanSeats(): void {
    const scene = asRecord(locateGameScene(globalObject));
    if (!scene) {
      rankedTipKey = '';
      return;
    }
    const seats = readSeatUis(scene)
      .map((seatUi) => ({ seatUi, seat: asRecord(seatUi.seat) }))
      .filter((item) => item.seat && item.seat.isHide !== true);
    for (const { seatUi, seat } of seats) {
      const info = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo);
      const clientId = info?.ClientId ?? info?.clientId;
      if (clientId == null || clientId === '') continue;
      const manager = asRecord(seatUi.otherTopManager);
      const showName = typeof manager?.SetPlayNameVisible === 'function' ? manager.SetPlayNameVisible : null;
      if (showName) showName.call(manager, Number(clientId) < 0xee6b2800);
    }
    if (isShanHeTu(scene, globalObject)) return;
    const aiIds = seats
      .map(({ seat }) => seatClientKind(seat))
      .filter((kind) => kind.kind !== 0)
      .map((kind) => kind.id);
    if (!aiIds.length) return;
    const key = aiIds.sort().join(',');
    if (key === rankedTipKey) return;
    rankedTipKey = key;
    showToast('对战AI小杀！', 'warning', 4000);
  }

  /** 资料页打开后：人机提示，真人显示编号按钮。 */
  function scanProfile(): void {
    hookUserInfoView(globalObject, tipProfile);
    const view = findUserInfoView(globalObject);
    if (!view) {
      profileTipId = 0;
      return;
    }
    const clientId = Number(view.userData && (view.userData as UnknownRecord).ClientId);
    if (!Number.isFinite(clientId)) return;
    const button = asRecord(view.result7Btn);
    if (button) button.visible = clientId < 0xee6b2800;
    if (!isAiClientId(clientId)) {
      profileTipId = 0;
      return;
    }
    tipProfile(clientId);
  }

  function tipProfile(clientId: number): void {
    if (!isAiClientId(clientId) || profileTipId === clientId) return;
    profileTipId = clientId;
    showToast('小抄: 这是个人机', 'warning', 5000);
  }
}

/** 资料刷新结束后立刻判断，不等下一轮扫描。 */
function hookUserInfoView(globalObject: GameRuntimeWindow, tip: (clientId: number) => void): void {
  const classUtils = asRecord(asRecord(globalObject.Laya)?.ClassUtils);
  const getClass = classUtils?.getClass;
  if (typeof getClass !== 'function') return;
  let ctor: { prototype?: UnknownRecord } | null = null;
  try {
    ctor = getClass.call(classUtils, 'UserInfoView') as { prototype?: UnknownRecord } | null;
  } catch {
    return;
  }
  const proto = ctor?.prototype;
  const original = proto?.onWinInfo;
  if (!proto || typeof original !== 'function' || original.__xcAiProfileWrapped === true) return;
  const wrapped = function (this: UnknownRecord, ...args: unknown[]) {
    const result = original.apply(this, args);
    const clientId = Number(this.userData && (this.userData as UnknownRecord).ClientId);
    if (isAiClientId(clientId)) tip(clientId);
    const button = asRecord(this.result7Btn);
    if (button && Number.isFinite(clientId)) button.visible = clientId < 0xee6b2800;
    return result;
  };
  wrapped.__xcAiProfileWrapped = true;
  try {
    Object.defineProperty(proto, 'onWinInfo', { configurable: true, writable: true, value: wrapped });
  } catch {
    // 方法不能改时，靠窗口层轮询补按钮。
  }
}

function findUserInfoView(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const stage = asRecord(asRecord(globalObject.Laya)?.stage);
  if (!stage) return null;
  const layers = childNodes(stage).filter((child) => [4, 5, 6].includes(Number(child.layerOrder)));
  let scanned = 0;
  for (const layer of layers) {
    const found = findView(layer, 0, () => scanned++ < 4000);
    if (found) return found;
  }
  return null;
}

function findView(node: UnknownRecord, depth: number, allow: () => boolean): UnknownRecord | null {
  if (depth > 16 || node.destroyed === true || node.visible === false || !allow()) return null;
  const ctor = typeof node.constructor === 'function' ? node.constructor.name : '';
  if (ctor === 'UserInfoView' || node.name === 'UserInfoView') return node;
  for (const child of childNodes(node)) {
    const found = findView(child, depth + 1, allow);
    if (found) return found;
  }
  return null;
}

function seatClientKind(seat: UnknownRecord | null): { kind: 0 | 1 | 2; id: string } {
  const info = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo);
  const id = info?.ClientId ?? info?.clientId;
  return { kind: aiKind(id, info?.IsNormalRobot), id: String(id ?? '') };
}

function isShanHeTu(scene: UnknownRecord, globalObject: GameRuntimeWindow): boolean {
  const ctor = typeof scene.constructor === 'function' ? scene.constructor.name : '';
  const name = String(scene.sceneName ?? scene.name ?? ctor);
  if (name.includes('Rogue') || name.includes('山河')) return true;
  return readModeLabel(scene, globalObject).includes('山河图');
}

function readModeLabel(scene: UnknownRecord, globalObject: GameRuntimeWindow): string {
  const parts: unknown[] = [scene.modeName, scene.ModeName, scene.gameModeName];
  const context = asRecord((globalObject as UnknownRecord).GameContext);
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    parts.push(vo?.ModeName, vo?.modeName, vo?.Name, vo?.name);
  } catch {
    // 模式名读不到时不当成山河图。
  }
  return parts.filter((part) => typeof part === 'string').join(' ');
}

function readSeatUis(scene: UnknownRecord): UnknownRecord[] {
  const container = asRecord(scene.seatContainer);
  const list = container?.seatUIs ?? container?.seatUis;
  if (!Array.isArray(list)) return [];
  return list.map(asRecord).filter((seat): seat is UnknownRecord => seat !== null);
}

function childNodes(node: UnknownRecord): UnknownRecord[] {
  const lists = [node._children, node.children];
  const result: UnknownRecord[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const child of list) {
      const record = asRecord(child);
      if (record) result.push(record);
    }
  }
  return result;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
