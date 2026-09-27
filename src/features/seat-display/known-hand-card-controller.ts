/**
 * @deprecated 座位已知手牌已并入 `features/mingpai` 的 installMingpaiController。
 * 保留此文件避免旧引用炸裂；新代码请只装 mingpai 控制器。
 */
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import type { SeatStateStore } from './seat-state-store.ts';
import { installMingpaiController } from '../mingpai/mingpai-controller.ts';

export function installKnownHandCardController(
  gameEvents: GameEventBus,
  seatStateStore: SeatStateStore
): () => void {
  return installMingpaiController(seatStateStore, gameEvents).dispose;
}
