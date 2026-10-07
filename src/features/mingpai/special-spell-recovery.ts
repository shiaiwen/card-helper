/**
 * 特殊技能看牌恢复：标准规则外的补充揭示逻辑。
 */

import type { GameEvent } from '../../runtime/game-event-bus.ts';
import { DRAW_PILE_POSITION } from './rules/reveal-types.ts';

/**
 * 个别技能的暗牌还原。
 * 技能先在 UseSpell / SpellOptRep / 同区展示里亮出卡号，
 * 随后的 MoveCard 却把 CardIDs 藏成 0；这里记住线索并在移动时补回。
 *
 * 新技能：在 observe 里记线索、在 recover 里消费，
 * 只有数量严格吻合时才补，宁缺毋错。
 */

type MoveCardEvent = Extract<GameEvent, { type: 'cards-moved' }>;

export interface SpecialSpellRecoveryContext {
  /** 座位手牌：已知卡号 + 未知张数。 */
  hand(seatId: number): { known: readonly number[]; unknownCount: number };
  /** 座位某分区当前已知卡号（判定区等）。 */
  zoneCardIds(seatId: number, zone: number): readonly number[];
  isControlledSeat(seatId: number): boolean;
  /** 红色 true，黑色 false，配置未就绪 null。 */
  isRedCard(cardId: number): boolean | null;
}

export interface SpecialSpellRecovery {
  observe(event: Readonly<GameEvent>): void;
  /** 暗牌移动时返回补回的卡号；无法确定返回 null。 */
  recover(move: Readonly<MoveCardEvent>): number[] | null;
  /** 移动结算后的卡号（含 recover 的结果），用于积累后续线索。 */
  record(move: Readonly<MoveCardEvent>, cardIds: readonly number[]): void;
  clear(): void;
}

const HAND = 5;
const DRAW_PILE = 1;
const DISCARD = 2;
const PROCESSING = 3;
const EQUIP = 4;
const JUDGE_SHOW = 8;
const SKILL_TEMP = 10;
const PILE_OWNER = 0xff;

/** 361 狭书：展示目标手牌后由施法者选择拿走展示牌（1）或其余牌（2）。 */
const XIASHU = 361;
const XIASHU_TAKE_SHOWN = 1;
const XIASHU_TAKE_REST = 2;
/** 3065 周旋：EffectIndex=1 亮出的牌随后暗置于武将牌上。 */
const ZHOUXUAN = 3065;
/** 3157：UseSpell 亮出的牌随后从弃牌堆暗置入手。 */
const QINGYI = 3157;
/** 3750 / 3753：EffectIndex=2 亮出的牌随后从弃牌堆暗置牌堆顶。 */
const QIANFU = new Set([3750, 3753]);
/** 3511：本家 UseSpell 亮出的牌随后从弃牌堆暗置入手。 */
const SPELL_3511 = 3511;
/** 3488：展示一张 → 暗置于技能区 → 再暗置入牌堆 / 弃牌堆。 */
const SPELL_3488 = 3488;
/** 3543：从弃牌堆暗置牌堆的是最近进入弃牌堆的红色牌。 */
const SPELL_3543 = 3543;
/** 3571：判定牌按座位颜色（1 红 / 2 黑）回到手牌。 */
const SPELL_3571 = 3571;
const COLOR_RED = 1;
const COLOR_BLACK = 2;
/** 780：当前回合角色交出的一张牌，被对方放回牌堆。 */
const SPELL_780 = 780;

export function createSpecialSpellRecovery(ctx: SpecialSpellRecoveryContext): SpecialSpellRecovery {
  let currentSeatId: number | null = null;
  let xiashu: { casterSeatId: number; targetSeatId: number; shown: number[]; choice: number } | null = null;
  const zhouxuanPending = new Map<number, number[]>();
  const qingyiPending = new Map<number, number[]>();
  const qianfuPending = new Map<string, number[]>();
  let spell3511Pending: number[] | null = null;
  const spell3488Shown = new Map<number, number>();
  let spell3488Stack: number | null = null;
  const discardOrder: number[] = [];
  const spell3571ColorBySeat = new Map<number, number>();
  const spell3571StateColorBySeat = new Map<number, number>();
  const spell3571JudgmentsBySeat = new Map<number, number[]>();
  let spell780Given: number | null = null;

  function observe(event: Readonly<GameEvent>): void {
    if (event.type === 'game-started' || event.type === 'game-ended') {
      clear();
      return;
    }
    if (event.type === 'phase-changed') {
      currentSeatId = event.seatId;
      return;
    }
    if (event.type === 'seat-state-changed' && event.stateId === SPELL_3571) {
      spell3571StateColorBySeat.set(event.seatId, Math.trunc(event.value / 100));
      return;
    }
    if (event.type === 'spell-data-updated' && event.dataId === SPELL_3571) {
      const color = event.datas[0];
      if (color === COLOR_RED || color === COLOR_BLACK) spell3571ColorBySeat.set(event.seatId, color);
      return;
    }
    if (event.type === 'spell-opt-rep') {
      if (
        xiashu && event.spellId === XIASHU && event.optType === 22 && event.seatId === xiashu.casterSeatId
        && (event.datas[0] === XIASHU_TAKE_SHOWN || event.datas[0] === XIASHU_TAKE_REST)
      ) {
        xiashu.choice = event.datas[0];
      }
      return;
    }
    if (event.type !== 'spell-targeted') return;
    const cardIds = positive(event.cardIds);
    if (event.spellId === XIASHU) {
      const targets = event.targetSeatIds.filter((seatId) => seatId !== event.seatId);
      xiashu = targets.length === 1 && event.targetSeatIds.length === 1
        ? { casterSeatId: event.seatId, targetSeatId: targets[0], shown: [], choice: 0 }
        : xiashu;
      return;
    }
    if (event.spellId === ZHOUXUAN && event.effectIndex === 1 && cardIds.length) {
      zhouxuanPending.set(event.seatId, cardIds);
      return;
    }
    if (event.spellId === QINGYI && cardIds.length) {
      qingyiPending.set(event.seatId, cardIds);
      return;
    }
    if (QIANFU.has(event.spellId)) {
      const key = `${event.spellId}-${event.seatId}`;
      qianfuPending.delete(key);
      if (event.effectIndex === 2 && !event.targetSeatIds.length && cardIds.length) qianfuPending.set(key, cardIds);
      return;
    }
    if (event.spellId === SPELL_3511 && cardIds.length && ctx.isControlledSeat(event.seatId)) {
      spell3511Pending = cardIds;
      return;
    }
    if (event.spellId === SPELL_3571 && event.effectIndex === 1) {
      spell3571JudgmentsBySeat.set(event.seatId, []);
    }
  }

  function recover(move: Readonly<MoveCardEvent>): number[] | null {
    const known = positive(move.cardIds);
    const hidden = known.length === 0;
    const count = move.cardCount;

    if (move.spellId === XIASHU && xiashu) {
      const state = xiashu;
      if (
        move.moveType === 21 && move.fromZone === HAND && move.toZone === HAND
        && move.fromId === state.targetSeatId && move.toId === state.targetSeatId
        && known.length === count
      ) {
        state.shown = known;
        return null;
      }
      if (
        move.moveType === 18 && move.fromZone === HAND && move.toZone === HAND
        && move.fromId === state.targetSeatId && move.toId === state.casterSeatId
      ) {
        xiashu = null;
        if (!hidden || !state.shown.length) return null;
        const hand = ctx.hand(state.targetSeatId);
        const shownInHand = state.shown.filter((cardId) => hand.known.includes(cardId));
        if (shownInHand.length !== state.shown.length) return null;
        if (state.choice === XIASHU_TAKE_SHOWN) return exactly(shownInHand, count);
        if (state.choice === XIASHU_TAKE_REST && hand.unknownCount === 0) {
          return exactly(hand.known.filter((cardId) => !state.shown.includes(cardId)), count);
        }
        return null;
      }
    }

    if (
      move.spellId === ZHOUXUAN && move.moveType === 15 && move.fromZone === HAND && move.toZone === EQUIP
      && move.toZoneParam === ZHOUXUAN && move.toId === move.fromId
    ) {
      const pending = take(zhouxuanPending, move.fromId);
      return hidden && pending ? exactly(pending, count) : null;
    }

    if (move.spellId === QINGYI && move.fromZone === DISCARD && move.toZone === HAND) {
      const pending = take(qingyiPending, move.toId);
      return hidden && pending ? exactly(pending, count) : null;
    }

    if (
      QIANFU.has(move.spellId) && move.fromZone === DISCARD && move.toZone === DRAW_PILE
      && move.toPosition === DRAW_PILE_POSITION.TOP && move.moveType === 15 && move.srcSeatId !== null
      && move.srcSeatId !== undefined
    ) {
      const pending = take(qianfuPending, `${move.spellId}-${move.srcSeatId}`);
      return hidden && pending ? exactly(pending, count) : null;
    }

    if (move.spellId === SPELL_3511 && move.fromZone === DISCARD && move.toZone === HAND && spell3511Pending) {
      const pending = spell3511Pending;
      if (!hidden || pending.length !== count) return null;
      spell3511Pending = null;
      return [...pending];
    }

    if (move.spellId === SPELL_3488 && hidden && move.moveType === 11) {
      if (move.fromZone === HAND && move.toZone === SKILL_TEMP) {
        const shown = spell3488Shown.get(move.fromId) ?? null;
        spell3488Stack = shown;
        return shown ? exactly([shown], count) : null;
      }
      if (move.fromZone === SKILL_TEMP && (move.toZone === DRAW_PILE || move.toZone === DISCARD)) {
        const stack = spell3488Stack;
        spell3488Stack = null;
        return stack ? exactly([stack], count) : null;
      }
    }

    if (move.spellId === SPELL_3543 && hidden && move.fromZone === DISCARD && move.toZone === DRAW_PILE) {
      const reds = [...discardOrder].reverse().filter((cardId) => ctx.isRedCard(cardId) === true);
      return exactly(reds.slice(0, count), count);
    }

    if (move.spellId === SPELL_3571 && move.fromZone === JUDGE_SHOW && move.toZone === HAND && move.moveType === 8) {
      const recovered = hidden ? recover3571(move) : null;
      spell3571JudgmentsBySeat.delete(move.toId);
      return recovered;
    }

    if (
      move.spellId === SPELL_780 && hidden && move.fromZone === HAND && move.toZone === DRAW_PILE
      && move.fromPosition === DRAW_PILE_POSITION.UNSPECIFIED && count === 1
      && move.fromId !== currentSeatId && spell780Given !== null
      && ctx.hand(move.fromId).known.includes(spell780Given)
    ) {
      const given = spell780Given;
      spell780Given = null;
      return [given];
    }
    return null;
  }

  function recover3571(move: Readonly<MoveCardEvent>): number[] | null {
    const stateColor = spell3571StateColorBySeat.get(move.toId);
    const color = stateColor === COLOR_RED || stateColor === COLOR_BLACK
      ? stateColor
      : spell3571ColorBySeat.get(move.toId);
    if (color !== COLOR_RED && color !== COLOR_BLACK) return null;
    const judgments = spell3571JudgmentsBySeat.get(move.toId);
    if (!judgments?.length) return null;
    const inZone = new Set(ctx.zoneCardIds(move.fromId, JUDGE_SHOW));
    const matched = judgments.filter((cardId) => (
      inZone.has(cardId) && ctx.isRedCard(cardId) === (color === COLOR_RED)
    ));
    return exactly(matched, move.cardCount);
  }

  function record(move: Readonly<MoveCardEvent>, cardIds: readonly number[]): void {
    const known = positive(cardIds);
    if (move.toZone === DISCARD && move.toId === PILE_OWNER && known.length) {
      discardOrder.push(...known);
      if (discardOrder.length > 200) discardOrder.splice(0, discardOrder.length - 200);
    }
    if (move.fromZone === DISCARD && move.fromId === PILE_OWNER && known.length) {
      const leaving = new Set(known);
      for (let index = discardOrder.length - 1; index >= 0; index -= 1) {
        if (leaving.has(discardOrder[index])) discardOrder.splice(index, 1);
      }
    }
    if (
      move.spellId === SPELL_3488 && move.moveType === 21 && move.fromZone === HAND && move.toZone === HAND
      && known.length === 1
    ) {
      spell3488Shown.set(move.fromId, known[0]);
    }
    if (
      move.spellId === SPELL_3571 && move.fromZone === PROCESSING && move.toZone === JUDGE_SHOW
      && move.moveType === 6 && move.srcSeatId !== null && move.srcSeatId !== undefined
      && known.length === move.cardCount
    ) {
      const previous = spell3571JudgmentsBySeat.get(move.srcSeatId) ?? [];
      spell3571JudgmentsBySeat.set(move.srcSeatId, [...new Set([...previous, ...known])]);
    }
    if (
      move.spellId === SPELL_780 && move.fromZone === HAND && move.toZone === HAND
      && move.fromPosition === DRAW_PILE_POSITION.UNSPECIFIED && move.cardCount === 1
      && move.fromId === currentSeatId
    ) {
      spell780Given = known[0] ?? null;
    }
  }

  function clear(): void {
    xiashu = null;
    zhouxuanPending.clear();
    qingyiPending.clear();
    qianfuPending.clear();
    spell3511Pending = null;
    spell3488Shown.clear();
    spell3488Stack = null;
    discardOrder.length = 0;
    spell3571ColorBySeat.clear();
    spell3571StateColorBySeat.clear();
    spell3571JudgmentsBySeat.clear();
    spell780Given = null;
  }

  return { observe, recover, record, clear };
}

function positive(values: readonly number[]): number[] {
  return values.filter((value) => Number.isInteger(value) && value > 0);
}

function exactly(cardIds: readonly number[], count: number): number[] | null {
  return cardIds.length === count && count > 0 ? [...cardIds] : null;
}

function take<K>(pending: Map<K, number[]>, key: K): number[] | null {
  const value = pending.get(key) ?? null;
  pending.delete(key);
  return value;
}
