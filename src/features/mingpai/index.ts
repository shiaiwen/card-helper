export {
  createMingpaiEngine,
  formatZoneId,
  parseZoneId,
  type MingpaiEngine,
  type MingpaiEngineSnapshot,
  type MingpaiFindResult
} from './mingpai-engine.ts';

/** @deprecated 使用 createMingpaiEngine */
export { createMingpaiEngine as createMingpaiStore } from './mingpai-engine.ts';
export type { MingpaiEngine as MingpaiStore } from './mingpai-engine.ts';
export type { MingpaiEngineSnapshot as MingpaiSnapshot } from './mingpai-engine.ts';

export { MINGPAI_ZONE, type MingpaiZoneId } from './mingpai-zones.ts';
export { installMingpaiController } from './mingpai-controller.ts';
export { applyCardReveals } from './reveal-sink.ts';
export { resolveOptTargetReveals, hasOptTargetRule } from './rules/opt-target-rules.ts';
export { resolveSpellOptRepReveals } from './rules/spell-opt-rep-rules.ts';
export {
  isSameZoneShow,
  remapDrawPileFromPosition,
  sanitizeMoveCardIds
} from './rules/move-card-rules.ts';
export {
  DRAW_PILE_OWNER,
  DRAW_PILE_POSITION,
  type CardReveal,
  type OptTargetContext,
  type SpellOptRepContext
} from './rules/reveal-types.ts';
export {
  partitionCandidatesByKnownFaces,
  partitionCandidatesByMingpai,
  collectHandAndDeckFaces
} from './mingpai-queries.ts';
