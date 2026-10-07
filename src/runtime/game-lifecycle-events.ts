/**
 * 座位 inGame 变化 → game-started / game-ended，供功能模块统一订阅。
 */

import type { SeatStateStore } from '../features/seat-display/seat-state-store.ts';
import type { GameEventBus } from './game-event-bus.ts';

/**
 * 将游戏场景出现/消失转换成通用生命周期事件。
 * 后续房间、回合和协议适配器都向同一事件总线发布，不让功能模块互相依赖。
 */
export function installGameLifecycleEvents(
  seatStateStore: SeatStateStore,
  gameEvents: GameEventBus
): () => void {
  let wasInGame = false;
  return seatStateStore.subscribe((snapshot) => {
    if (snapshot.inGame === wasInGame) return;
    wasInGame = snapshot.inGame;
    gameEvents.publish({ type: snapshot.inGame ? 'game-started' : 'game-ended' });
  });
}
