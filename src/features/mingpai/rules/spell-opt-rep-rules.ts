import {
  deckReveal,
  handReveal,
  isSeat,
  type CardReveal,
  type SpellOptRepContext,
  type SpellOptRepRule
} from './reveal-types.ts';

/**
 * CGsRoleSpellOptRep 看牌规则表（对照 app.bak 约 45604–45730）。
 * 同样只登记「技能 → Datas 落到哪」，状态写入交给 reveal-sink。
 */

const RULES = new Map<number, SpellOptRepRule>();

function register(spellIds: readonly number[], rule: SpellOptRepRule): void {
  for (const spellId of spellIds) RULES.set(spellId, rule);
}

const whenType = (predicate: (optType: number) => boolean, rule: SpellOptRepRule): SpellOptRepRule => (
  (ctx) => (predicate(ctx.optType) ? rule(ctx) : [])
);

/** 3659：展示自己的手牌。 */
register([3659], (ctx) => (isSeat(ctx.seatId) ? handReveal(ctx.seatId, [...ctx.datas], true) : []));

/** 3744：Type≠73 → 牌堆顶。 */
register([3744], whenType((type) => type !== 73, (ctx) => deckReveal([...ctx.datas], 'top')));

/** 3868：Type=50 → 牌堆顶。 */
register([3868], whenType((type) => type === 50, (ctx) => deckReveal([...ctx.datas], 'top')));

/** 7009：7010/7011 收尾，牌堆顶。 */
register([7009], (ctx) => deckReveal([...ctx.datas], 'top'));

/** 3336：Type=50 → 牌堆底（Datas 倒序）。 */
register([3336], whenType((type) => type === 50, (ctx) => deckReveal([...ctx.datas].reverse(), 'bottom')));

export function resolveSpellOptRepReveals(ctx: Readonly<SpellOptRepContext>): CardReveal[] {
  return RULES.get(ctx.spellId)?.(ctx) ?? [];
}
