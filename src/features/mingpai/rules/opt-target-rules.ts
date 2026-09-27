import {
  deckReveal,
  DRAW_PILE_OWNER,
  handReveal,
  isSeat,
  positiveIds,
  type CardReveal,
  type OptTargetContext,
  type OptTargetRule
} from './reveal-types.ts';

/**
 * GsCRoleOptTargetNtf 看牌规则表（对照 app.bak 约 44634–45572）。
 *
 * 维护方式：新增「看牌进明牌」的技能只在这里加一行，
 * 选一个 Params 切片器即可；不要在控制器 / 技能面板里写 spellId 判断。
 */

// ---------- Params 切片器（对照原版各分支的取牌方式） ----------

/** 整段 Params 就是目标手牌（攻心类）。 */
const wholeTargetHand = (partial = false): OptTargetRule => (ctx) => (
  isSeat(ctx.targetSeatId) ? handReveal(ctx.targetSeatId, [...ctx.params], partial) : []
);

/** Params = [count, ...ids]：取前 count 张，记为施法者手牌。 */
const prefixCountSrcHand: OptTargetRule = (ctx) => {
  const count = ctx.params[0] ?? 0;
  if (count <= 0 || !isSeat(ctx.srcSeatId)) return [];
  return handReveal(ctx.srcSeatId, ctx.params.slice(1, count + 1), true);
};

/** Params[1] = 数量：取尾部 N 张，记为目标手牌。 */
const tailCountTargetHand: OptTargetRule = (ctx) => {
  const take = ctx.params[1] ?? 0;
  if (take <= 0 || ctx.params.length <= 2 || !isSeat(ctx.targetSeatId)) return [];
  return handReveal(ctx.targetSeatId, ctx.params.slice(-take), true);
};

/** 私有看牌：仅本家施法可见（观星类看牌堆）。 */
const selfOnly = (rule: OptTargetRule): OptTargetRule => (ctx) => (ctx.isSelfSrc ? rule(ctx) : []);

/** 仅在 Param 为指定值时生效。 */
const whenParam = (param: number, rule: OptTargetRule): OptTargetRule => (ctx) => (
  ctx.param === param ? rule(ctx) : []
);

// ---------- 规则登记 ----------

const RULES = new Map<number, OptTargetRule>();

function register(spellIds: readonly number[], rule: OptTargetRule): void {
  for (const spellId of spellIds) RULES.set(spellId, rule);
}

/** 攻心 / 内训等：整段 Params → 目标完整手牌。 */
register([4, 5, 921, 372, 811, 357, 3119, 501, 3437, 4025], wholeTargetHand());
/** 同上，但仅 Param=0 时是看牌。 */
register([851, 361, 774, 3310, 3876], whenParam(0, wholeTargetHand()));

/** 898：[count, ...ids] → 施法者手牌。 */
register([898], whenParam(0, prefixCountSrcHand));

/** 987/988/3483：Param=1 时尾部 N 张 → 目标手牌。 */
register([987, 988, 3483], whenParam(1, tailCountTargetHand));

/** 943：单张 → 牌堆顶。 */
register([943], whenParam(0, (ctx) => {
  const ids = positiveIds(ctx.params);
  return ids.length === 1 ? deckReveal(ids, 'top') : [];
}));

/** 3266：每 3 个取下标 1；目标 255 → 牌堆顶，否则目标手牌。 */
register([3266], whenParam(0, selfOnly((ctx) => {
  const ids = ctx.params.filter((_, index) => index % 3 === 1);
  if (ctx.targetSeatId === DRAW_PILE_OWNER) return deckReveal(ids, 'top');
  return isSeat(ctx.targetSeatId) ? handReveal(ctx.targetSeatId, ids, true) : [];
})));

/** 3903：[count, x, ...ids] → 牌堆顶（目标 255）。 */
register([3903], whenParam(0, selfOnly((ctx) => {
  if (ctx.targetSeatId !== DRAW_PILE_OWNER) return [];
  const count = ctx.params[0] ?? 0;
  return count > 0 ? deckReveal(ctx.params.slice(2, 2 + count), 'top') : [];
})));

/** 7010/7011：整段 → 牌堆顶，并 pack 进 unknown。 */
register([7010, 7011], selfOnly((ctx) => (
  ctx.targetSeatId === DRAW_PILE_OWNER ? deckReveal([...ctx.params], 'top', true) : []
)));

export function resolveOptTargetReveals(ctx: Readonly<OptTargetContext>): CardReveal[] {
  return RULES.get(ctx.spellId)?.(ctx) ?? [];
}

export function hasOptTargetRule(spellId: number): boolean {
  return RULES.has(spellId);
}
