/**
 * 经典场房间过滤：按设置隐藏密码房等，补丁大厅房间列表渲染。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { locateSceneManager, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';

type Node = Record<string, any>;
const CONFIG_KEY = 'rooms.hidePassword' as const;
const CHECKBOX_KEY = '__xcClassicNoPasswordCheckBox';
const SOURCE_KEY = '__xcClassicRoomFilterSource';
const PATCHED_KEY = '__xcClassicRoomFilterInstalled';
const PATCH_VERSION = 1;

/** 大厅房间列表筛选，以及底栏勾选框。 */
export function installClassicRoomFilterController(
  config: XiaochaoConfigStore,
  options: { globalObject?: GameRuntimeWindow; pollIntervalMs?: number } = {}
): { dispose(): void } {
  const win = options.globalObject ?? window as GameRuntimeWindow;
  const global = win as GameRuntimeWindow & Node;
  const patcher = createMethodPatcher();
  const intervalMs = options.pollIntervalMs ?? 400;
  let disposed = false;
  let currentRoomList: Node | null = null;
  let currentScene: Node | null = null;
  let checkboxParent: Node | null = null;
  let checkbox: Node | null = null;
  let changeHandler: (() => void) | null = null;
  let replaying = false;

  const timer = global.setInterval(() => {
    try { sync(); } catch (error) { console.warn('[room-filter] sync failed', error); }
  }, intervalMs);
  const unsubscribe = config.subscribe(CONFIG_KEY, () => replay());
  sync();

  function sync(): void {
    if (disposed) return;
    const scene = currentHallScene(global);
    const roomList = asNode(scene?.roomListView);
    if (sceneName(scene) !== 'HallScene' || !roomList) {
      detachCheckbox();
      currentScene = null;
      currentRoomList = null;
      return;
    }

    currentScene = scene;
    currentRoomList = roomList;
    mountCheckbox(scene, roomList);
    patchReload(roomList);
  }

  function patchReload(roomList: Node): void {
    // 脚本热更新保留了房间列表对象及旧 marker，仍需让新过滤实现覆盖旧实现。
    if (roomList[PATCHED_KEY] === PATCH_VERSION || typeof roomList.ReloadRoomList !== 'function') return;
    delete roomList[PATCHED_KEY];
    if (patcher.wrap(roomList, 'ReloadRoomList', (original) => function (this: Node, rows: unknown, ...args: unknown[]) {
      if (Array.isArray(rows) && !replaying) this[SOURCE_KEY] = rows;
      sync();
      const nextArgs = [rows, ...args];
      const activeScene = currentHallScene(global);
      if (activeScene?.roomListView === this && config.get(CONFIG_KEY) && Array.isArray(rows)) {
        const source = (this[SOURCE_KEY] as unknown[] | undefined) ?? rows;
        nextArgs[0] = source.filter((room) => asNode(room)?.hasPass !== true);
      }
      return original.apply(this, nextArgs);
    })) {
      roomList[PATCHED_KEY] = PATCH_VERSION;
    }
  }

  function mountCheckbox(scene: Node, roomList: Node): void {
    if (scene.roomListView !== roomList) return;
    // 控件挂在 roomListView 下，紧挨「仅等待中」勾选框。
    const anchor = asNode(roomList.isWaitCheckBox);
    if (!anchor) return;
    const CheckBox = anchor.constructor;
    if (typeof CheckBox !== 'function') return;

    let control = asNode(roomList[CHECKBOX_KEY]);
    if (!control) {
      control = new CheckBox('不显示密码房') as Node;
      control.selected = config.get(CONFIG_KEY);
      const changeEvent = global.Laya?.Event?.CHANGE ?? 'change';
      changeHandler = () => {
        config.set(CONFIG_KEY, control?.selected === true);
        replay();
      };
      control.on?.(changeEvent, roomList, changeHandler);
      roomList.addChild?.(control);
      roomList[CHECKBOX_KEY] = control;
    }
    control.selected = config.get(CONFIG_KEY);
    control.visible = true;
    control.pos?.(Number(anchor.x || 0) + Number(anchor.width || 0) + 12, Number(anchor.y || 0));
    checkbox = control;
    checkboxParent = roomList;
  }

  function replay(): void {
    sync();
    const source = currentRoomList?.[SOURCE_KEY]
      ?? currentRoomList?.tableDataList
      ?? currentRoomList?.hallManager?.roomList;
    if (currentRoomList && Array.isArray(source)) {
      replaying = true;
      try { currentRoomList.ReloadRoomList(source); }
      finally { replaying = false; }
    }
  }

  function detachCheckbox(): void {
    if (!checkbox) return;
    const changeEvent = global.Laya?.Event?.CHANGE ?? 'change';
    try { checkbox.off?.(changeEvent, checkboxParent, changeHandler); } catch { /* already detached */ }
    try { checkbox.removeSelf?.(); } catch { /* already detached */ }
    try { checkbox.destroy?.(true); } catch { /* already destroyed */ }
    if (checkboxParent?.[CHECKBOX_KEY] === checkbox) delete checkboxParent[CHECKBOX_KEY];
    checkbox = null;
    checkboxParent = null;
    changeHandler = null;
  }

  return {
    dispose() {
      disposed = true;
      global.clearInterval(timer);
      unsubscribe();
      detachCheckbox();
      patcher.restoreAll();
      if (currentRoomList) {
        delete currentRoomList[PATCHED_KEY];
        delete currentRoomList[SOURCE_KEY];
      }
    }
  };
}

function asNode(value: unknown): Node | null {
  return value !== null && typeof value === 'object' ? value as Node : null;
}

/** SceneManager 只在部分版本注册为可构造类；其他版本的活动场景直接位于 Laya SceneLayer。 */
function currentHallScene(global: GameRuntimeWindow & Node): Node | null {
  const manager = asNode(locateSceneManager(global));
  const managed = asNode(manager?.CurrentScene);
  if (managed && (sceneName(managed) === 'HallScene' || managed.roomListView)) return managed;

  const stageChildren = asNode(global.Laya?.stage)?._children;
  if (!Array.isArray(stageChildren)) return managed;
  const sceneLayer = stageChildren.find((child) => Number(asNode(child)?.layerOrder) === 2);
  const roots = asNode(sceneLayer)?._children;
  if (!Array.isArray(roots)) return managed;
  const pending = roots.map((node) => ({ node: asNode(node), depth: 0 }));
  while (pending.length) {
    const { node, depth } = pending.shift()!;
    if (!node) continue;
    if (sceneName(node) === 'HallScene' || node.roomListView) return node;
    if (depth >= 2 || !Array.isArray(node._children)) continue;
    for (const child of node._children) pending.push({ node: asNode(child), depth: depth + 1 });
  }
  return managed;
}

function sceneName(scene: Node | null | undefined): string {
  return String(scene?.SceneName ?? scene?.sceneName ?? '');
}
