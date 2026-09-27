import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';
import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import type { SkillAssistStore } from './skill-assist-store.ts';

export interface SkillAssistControllerOptions {
  pollIntervalMs?: number;
}

/**
 * 轮询座位技能可见性，并把协议事件交给 skill-assist-store。
 * 不读写 legacy DOM。
 */
export function installSkillAssistController(
  store: SkillAssistStore,
  gameEvents: GameEventBus,
  getScene: () => GameSceneSeatSource | null = () => locateGameScene(window),
  globalObject: GameRuntimeWindow = window,
  { pollIntervalMs = 500 }: SkillAssistControllerOptions = {}
): () => void {
  let stopped = false;
  const refresh = () => {
    if (stopped) return;
    store.refreshVisibility(getScene());
  };
  const unsubscribe = gameEvents.subscribe((event) => {
    store.handleGameEvent(event, getScene());
    if (
      event.type === 'game-started'
      || event.type === 'game-ended'
      || event.type === 'turn-started'
      || event.type === 'player-died'
      || event.type === 'seat-state-changed'
    ) {
      refresh();
    }
  });
  refresh();
  const intervalId = globalObject.setInterval(refresh, pollIntervalMs);
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    globalObject.clearInterval(intervalId);
  };
}
