import type { SeatStateStore } from './seat-state-store.ts';
import { locateGameScene, type GameRuntimeWindow } from './game-scene-locator.ts';
import { readSeatStateFromGameScene } from './seat-game-adapter.ts';

export interface SeatStateControllerOptions {
  pollIntervalMs?: number;
  /** 场景重建期间保留上一快照，避免一次轮询空窗误判离局。 */
  sceneMissingGraceMs?: number;
}

/** 周期读取游戏座位；返回值用于统一生命周期清理。 */
export function installSeatStateController(
  store: SeatStateStore,
  globalObject: GameRuntimeWindow = window,
  { pollIntervalMs = 500, sceneMissingGraceMs = 8000 }: SeatStateControllerOptions = {}
): () => void {
  let stopped = false;
  let sceneMissingSince = 0;
  const refresh = () => {
    if (stopped) return;
    const scene = locateGameScene(globalObject);
    if (!scene && store.getSnapshot().inGame) {
      if (!sceneMissingSince) sceneMissingSince = Date.now();
      if (Date.now() - sceneMissingSince < sceneMissingGraceMs) return;
    } else {
      sceneMissingSince = 0;
    }
    store.replace(readSeatStateFromGameScene(scene));
  };
  refresh();
  const intervalId = globalObject.setInterval(refresh, pollIntervalMs);

  return () => {
    if (stopped) return;
    stopped = true;
    globalObject.clearInterval(intervalId);
    store.clear();
  };
}
