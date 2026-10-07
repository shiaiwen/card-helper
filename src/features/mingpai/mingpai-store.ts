/**
 * 明牌分区投影仓（兼容层）：向权变/宴戏等面板提供分区卡号。
 */

import type { MingpaiZoneId } from './mingpai-zones.ts';

/**
 * 明牌一等公民仓库：全局「我看见了哪些牌、挂在哪个展示分区」。
 * 技能辅助、座位明牌、牌堆已知面都应读这里（或由此投影），禁止在技能里私自猜牌。
 *
 * 现阶段落地「分区卡号」投影，供权变/宴戏等面板消费。
 * 后续把 known-card-registry 的身份/位置记录也收敛进本仓，再补 findKZ 级键网。
 */
export interface MingpaiSnapshot {
  zones: Readonly<Record<string, readonly number[]>>;
}

export interface MingpaiStore {
  getSnapshot(): Readonly<MingpaiSnapshot>;
  getZoneCardIds(zoneId: MingpaiZoneId): readonly number[];
  setZoneCardIds(zoneId: MingpaiZoneId, cardIds: readonly number[]): void;
  addZoneCardIds(zoneId: MingpaiZoneId, cardIds: readonly number[]): void;
  removeZoneCardIds(zoneId: MingpaiZoneId, cardIds: readonly number[]): void;
  clearZone(zoneId: MingpaiZoneId): void;
  clear(): void;
  subscribe(listener: (snapshot: Readonly<MingpaiSnapshot>) => void): () => void;
}

export function createMingpaiStore(): MingpaiStore {
  let snapshot = freezeSnapshot({});
  const listeners = new Set<(snapshot: Readonly<MingpaiSnapshot>) => void>();

  function publish(zones: Record<string, readonly number[]>): void {
    const next = freezeSnapshot(zones);
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  return {
    getSnapshot: () => snapshot,
    getZoneCardIds(zoneId) {
      return snapshot.zones[zoneId] ?? EMPTY_CARD_IDS;
    },
    setZoneCardIds(zoneId, cardIds) {
      const normalized = uniquePositiveIds(cardIds);
      const zones = { ...snapshot.zones };
      if (!normalized.length) delete zones[zoneId];
      else zones[zoneId] = Object.freeze(normalized);
      publish(zones);
    },
    addZoneCardIds(zoneId, cardIds) {
      const incoming = uniquePositiveIds(cardIds);
      if (!incoming.length) return;
      const merged = uniquePositiveIds([...(snapshot.zones[zoneId] ?? []), ...incoming]);
      publish({ ...snapshot.zones, [zoneId]: Object.freeze(merged) });
    },
    removeZoneCardIds(zoneId, cardIds) {
      const removing = new Set(uniquePositiveIds(cardIds));
      if (!removing.size) return;
      const current = snapshot.zones[zoneId] ?? [];
      const remaining = current.filter((cardId) => !removing.has(cardId));
      const zones = { ...snapshot.zones };
      if (!remaining.length) delete zones[zoneId];
      else zones[zoneId] = Object.freeze(remaining);
      publish(zones);
    },
    clearZone(zoneId) {
      if (!(zoneId in snapshot.zones)) return;
      const zones = { ...snapshot.zones };
      delete zones[zoneId];
      publish(zones);
    },
    clear() {
      publish({});
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }
  };
}

const EMPTY_CARD_IDS: readonly number[] = Object.freeze([]);

function uniquePositiveIds(cardIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const raw of cardIds) {
    const cardId = Number(raw);
    if (!Number.isInteger(cardId) || cardId <= 0 || seen.has(cardId)) continue;
    seen.add(cardId);
    result.push(cardId);
  }
  return result;
}

function freezeSnapshot(zones: Record<string, readonly number[]>): Readonly<MingpaiSnapshot> {
  const frozenZones: Record<string, readonly number[]> = {};
  for (const [zoneId, cardIds] of Object.entries(zones)) {
    frozenZones[zoneId] = Object.freeze([...cardIds]);
  }
  return Object.freeze({ zones: Object.freeze(frozenZones) });
}

function sameSnapshot(
  left: Readonly<MingpaiSnapshot>,
  right: Readonly<MingpaiSnapshot>
): boolean {
  const leftKeys = Object.keys(left.zones);
  const rightKeys = Object.keys(right.zones);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((zoneId) => {
    const leftCards = left.zones[zoneId] ?? [];
    const rightCards = right.zones[zoneId] ?? [];
    return leftCards.length === rightCards.length
      && leftCards.every((cardId, index) => cardId === rightCards[index]);
  });
}
