/**
 * 谋周瑜醉锋：本回合可用次数等于体力上限，发动一次减一次。
 * 只在持有醉锋的武将牌上显示剩余次数。
 */

import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';
import { resolveSkillIds } from '../skill-assist/skill-visibility.ts';

type UnknownRecord = Record<string, unknown>;

const ZUIFENG_DEFINITION = {
  id: 'zuifeng',
  title: '醉锋',
  skillIds: [] as number[],
  spellNames: ['醉锋']
};

export function zuifengSkillIds(scene: GameSceneSeatSource | null): number[] {
  return resolveSkillIds(ZUIFENG_DEFINITION, scene);
}

export function createZuifengUses() {
  const usedBySeat = new Map<number, number>();
  return {
    noteUse(seatId: number) {
      if (!Number.isInteger(seatId) || seatId < 0) return;
      usedBySeat.set(seatId, (usedBySeat.get(seatId) ?? 0) + 1);
    },
    resetSeat(seatId: number) {
      usedBySeat.delete(seatId);
    },
    resetAll() {
      usedBySeat.clear();
    },
    used(seatId: number) {
      return usedBySeat.get(seatId) ?? 0;
    }
  };
}

export function zuifengRemaining(maxHp: number, used: number): number {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
  const spent = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  return Math.max(0, Math.floor(maxHp) - spent);
}

export function formatZuifengTip(seat: unknown, skillIds: readonly number[], used: number): string {
  const record = asRecord(seat);
  if (!record || !skillIds.length || !seatHasAnySkill(record, skillIds)) return '';
  const maxHp = readMaxHp(record);
  if (maxHp <= 0) return '';
  return `醉锋${zuifengRemaining(maxHp, used)}`;
}

function seatHasAnySkill(seat: UnknownRecord, skillIds: readonly number[]): boolean {
  const hasSkill = seat.HasSkill;
  if (typeof hasSkill !== 'function') return false;
  return skillIds.some((skillId) => {
    try {
      return Boolean(hasSkill.call(seat, skillId));
    } catch {
      return false;
    }
  });
}

function readMaxHp(seat: UnknownRecord): number {
  for (const key of ['MaxHp', 'maxHp', 'MaxHP', 'hpMax', 'HpMax']) {
    const value = Number(seat[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  for (const key of ['GetMaxHp', 'GetMaxHP']) {
    const reader = seat[key];
    if (typeof reader !== 'function') continue;
    try {
      const value = Number(reader.call(seat));
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      // 换下一个读法。
    }
  }
  return 0;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
