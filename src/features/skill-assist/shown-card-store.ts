/**
 * @deprecated 请使用 `features/mingpai`。保留兼容旧 import。
 */
export {
  createMingpaiEngine as createShownCardStore,
  createMingpaiEngine as createMingpaiStore,
  type MingpaiEngine as ShownCardStore,
  type MingpaiEngine as MingpaiStore,
  type MingpaiEngineSnapshot as ShownCardSnapshot,
  type MingpaiEngineSnapshot as MingpaiSnapshot
} from '../mingpai/mingpai-engine.ts';
export { MINGPAI_ZONE } from '../mingpai/mingpai-zones.ts';
export const SHOWN_CARD_ZONE_UNKNOWN = 'unknown';
