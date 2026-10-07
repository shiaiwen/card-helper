/**
 * 明牌引擎：维护已知牌分区、牌堆顺序与 findKZ 查询索引。
 */

import {
  createKnownCardRegistry,
  type KnownCardLocation,
  type KnownCardMovement,
  type KnownCardRecord
} from '../seat-display/known-card-registry.ts';
import { MINGPAI_ZONE } from './mingpai-zones.ts';
import { createDrawPileOrder } from './draw-pile-order.ts';
import { DRAW_PILE_POSITION } from './rules/reveal-types.ts';

export interface MingpaiZoneRef {
  ownerId: number;
  zone: number;
}

export interface MingpaiFindResult {
  /** 已知牌以 cardId 为键；归属不明时可能使用 0（本实现用 cardId 与 0）。 */
  keys: readonly number[];
  /** 分区键列表，如 `5-3`、`1-255`、`unknown`、`?`。 */
  zones: readonly string[];
}

export interface MingpaiEngineSnapshot {
  /** 分区 → 已知正数卡号（技能条 / 调试用）。 */
  zones: Readonly<Record<string, readonly number[]>>;
  /** 全部已登记已知牌。 */
  records: readonly Readonly<{
    cardId: number;
    tags: readonly string[];
    persistentTags: readonly string[];
    originalOwnerSeatId: number | null;
    location: KnownCardLocation | null;
    zoneId: string | null;
  }>[];
  /** 牌堆有序已知牌：top[0] 下一张被摸到，bottom 最后一张最底部；0 表示该位置不可见。 */
  drawPile: Readonly<{ top: readonly number[]; bottom: readonly number[] }>;
}

export interface MingpaiEngine {
  getSnapshot(): Readonly<MingpaiEngineSnapshot>;
  getZoneCardIds(zoneId: string): readonly number[];
  setZoneCardIds(zoneId: string, cardIds: readonly number[]): void;
  addZoneCardIds(zoneId: string, cardIds: readonly number[]): void;
  removeZoneCardIds(zoneId: string, cardIds: readonly number[]): void;
  clearZone(zoneId: string): void;
  /** 按登记位置推断某张牌可能所在的分区。 */
  findKZ(cardIdOrNode: number): MingpaiFindResult;
  /** 手牌区已知牌 ID。 */
  getHandCardIds(seatId: number): readonly number[];
  /** 牌堆区（zone=1）已知牌 ID。 */
  getDrawPileCardIds(): readonly number[];
  clearKnownDrawPileOrder(): void;
  /**
   * 重连后按场上仍公开的手牌重登记。
   * 不在快照里的手牌改成位置未知；牌堆顺序不在这里恢复。
   */
  reconcileVisibleHands(hands: readonly { seatId: number; cardIds: readonly number[] }[]): void;
  observeKnownHandCard(cardId: number, seatId: number, tags?: readonly string[]): void;
  rememberPersistentCardTag(cardId: number, tag: string, originalOwnerSeatId?: number | null): void;
  forgetPersistentCardTag(cardId: number, tag: string): void;
  /** 鉴定牌堆内已知牌，并标记相对位置（顶 / 底 / 未指定）。 */
  observeKnownDrawPileCards(cardIds: readonly number[], position: number): void;
  getPersistentTags(cardId: number): string[];
  getOriginalOwnerSeatId(cardId: number): number | null;
  resolveHiddenMovement(
    movement: KnownCardMovement,
    preferredOriginalOwnerSeatId?: number | null
  ): number[];
  applyMovement(movement: KnownCardMovement, effectiveCardIds: readonly number[]): void;
  /** 技能把候选牌写入专用展示分区（宴戏等）。 */
  projectSkillCards(zoneId: string, cardIds: readonly number[]): void;
  hasRestoredRecords(): boolean;
  clear(): void;
  subscribe(listener: (snapshot: Readonly<MingpaiEngineSnapshot>) => void): () => void;
}

const HAND_ZONE = 5;
const DRAW_PILE_ZONE = 1;
const DISCARD_ZONE = 2;
// 3=处理区、8=判定展示区、10=技能临时区；需要保留各层顺序以便暗移反推。
const TEMPORARY_CARD_ZONES = new Set([3, 8, 10]);
const GLOBAL_OWNER = 0xff;

/**
 * 明牌引擎：维护身份、位置、分区投影和已知牌查找，
 * 不依赖 legacy。完整链表 pack/swap 键网在可观测协议面上用位置登记表等价实现。
 */
export function createMingpaiEngine(
  storage: Storage | null = getSessionStorage()
): MingpaiEngine {
  const registry = createKnownCardRegistry(storage);
  const drawPileOrder = createDrawPileOrder(storage);
  const skillZones = new Map<string, number[]>();
  const cardIndex = new Map<number, KnownCardRecord>();
  const listeners = new Set<(snapshot: Readonly<MingpaiEngineSnapshot>) => void>();

  hydrateIndexFromRegistryStorage(cardIndex, storage);
  let snapshot = buildSnapshot();

  function buildSnapshot(): Readonly<MingpaiEngineSnapshot> {
    const derived = deriveLocationZones();
    const zones: Record<string, readonly number[]> = { ...derived };
    for (const [zoneId, cardIds] of skillZones) {
      zones[zoneId] = Object.freeze([...cardIds]);
    }
    const unknown = uniquePositive([
      ...(derived[MINGPAI_ZONE.UNKNOWN] ?? []),
      ...(skillZones.get(MINGPAI_ZONE.UNKNOWN) ?? [])
    ]);
    if (unknown.length) zones[MINGPAI_ZONE.UNKNOWN] = Object.freeze(unknown);
    else delete zones[MINGPAI_ZONE.UNKNOWN];

    const records = [...cardIndex.values()].map((record) => Object.freeze({
      cardId: record.cardId,
      tags: Object.freeze([...record.tags]) as readonly string[],
      persistentTags: Object.freeze([...record.persistentTags]) as readonly string[],
      originalOwnerSeatId: record.originalOwnerSeatId,
      location: record.location,
      zoneId: record.location ? formatZoneId(record.location.seatId, record.location.zone) : null
    }));
    const order = drawPileOrder.getSnapshot();
    return Object.freeze({
      zones: Object.freeze(zones),
      records: Object.freeze(records),
      drawPile: Object.freeze({ top: Object.freeze([...order.top]), bottom: Object.freeze([...order.bottom]) })
    });
  }

  function publish(): void {
    const next = buildSnapshot();
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  function deriveLocationZones(): Record<string, number[]> {
    const zones: Record<string, number[]> = {};
    for (const record of cardIndex.values()) {
      if (!record.location || record.cardId <= 0) continue;
      const zoneId = formatZoneId(record.location.seatId, record.location.zone);
      if (!zones[zoneId]) zones[zoneId] = [];
      if (!zones[zoneId].includes(record.cardId)) zones[zoneId].push(record.cardId);
      if (TEMPORARY_CARD_ZONES.has(record.location.zone)) {
        if (!zones[MINGPAI_ZONE.UNKNOWN]) zones[MINGPAI_ZONE.UNKNOWN] = [];
        if (!zones[MINGPAI_ZONE.UNKNOWN].includes(record.cardId)) {
          zones[MINGPAI_ZONE.UNKNOWN].push(record.cardId);
        }
      }
    }
    return zones;
  }

  function syncIndexFromObserve(cardId: number, seatId: number, tags: readonly string[]): void {
    registry.observeKnownHandCard(cardId, seatId, tags);
    const persistent = registry.getPersistentTags(cardId);
    const existing = cardIndex.get(cardId);
    const tagSet = new Set([...(existing?.tags ?? []), ...tags, ...persistent]);
    const persistentSet = new Set(persistent);
    cardIndex.set(cardId, {
      cardId,
      tags: tagSet,
      persistentTags: persistentSet,
      originalOwnerSeatId: registry.getOriginalOwnerSeatId(cardId),
      location: {
        seatId,
        zone: HAND_ZONE,
        position: 0,
        zoneParam: 0
      }
    });
  }

  function syncIndexFromMovement(
    movement: KnownCardMovement,
    effectiveCardIds: readonly number[]
  ): void {
    registry.applyMovement(movement, effectiveCardIds);
    for (const cardId of effectiveCardIds) {
      if (!(cardId > 0)) continue;
      const existing = cardIndex.get(cardId);
      const persistent = new Set(registry.getPersistentTags(cardId));
      cardIndex.set(cardId, {
        cardId,
        tags: existing ? new Set([...existing.tags, ...persistent]) : new Set(persistent),
        persistentTags: persistent,
        originalOwnerSeatId: registry.getOriginalOwnerSeatId(cardId),
        location: {
          seatId: movement.toId,
          zone: movement.toZone,
          position: movement.toPosition,
          zoneParam: movement.toZoneParam
        }
      });
      if (movement.fromZone === HAND_ZONE && movement.toZone !== HAND_ZONE) {
        const record = cardIndex.get(cardId)!;
        record.tags = new Set(record.persistentTags);
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    getZoneCardIds(zoneId) {
      return snapshot.zones[zoneId] ?? EMPTY;
    },
    setZoneCardIds(zoneId, cardIds) {
      const normalized = uniquePositive(cardIds);
      if (!normalized.length) skillZones.delete(zoneId);
      else skillZones.set(zoneId, normalized);
      publish();
    },
    addZoneCardIds(zoneId, cardIds) {
      const incoming = uniquePositive(cardIds);
      if (!incoming.length) return;
      skillZones.set(zoneId, uniquePositive([...(skillZones.get(zoneId) ?? []), ...incoming]));
      publish();
    },
    removeZoneCardIds(zoneId, cardIds) {
      const removing = new Set(uniquePositive(cardIds));
      if (!removing.size) return;
      const next = (skillZones.get(zoneId) ?? []).filter((id) => !removing.has(id));
      if (next.length) skillZones.set(zoneId, next);
      else skillZones.delete(zoneId);
      publish();
    },
    clearZone(zoneId) {
      if (!skillZones.has(zoneId) && !(zoneId in (snapshot.zones))) return;
      skillZones.delete(zoneId);
      publish();
    },
    findKZ(cardIdOrNode) {
      const cardId = Number(cardIdOrNode);
      if (!Number.isInteger(cardId) || cardId <= 0) {
        return { keys: Object.freeze([0]), zones: Object.freeze(['?']) };
      }
      const record = cardIndex.get(cardId);
      if (!record?.location) {
        return {
          keys: Object.freeze([cardId]),
          zones: Object.freeze([MINGPAI_ZONE.UNKNOWN])
        };
      }
      const zoneId = formatZoneId(record.location.seatId, record.location.zone);
      const zones = TEMPORARY_CARD_ZONES.has(record.location.zone)
        ? [zoneId, MINGPAI_ZONE.UNKNOWN]
        : [zoneId];
      return {
        keys: Object.freeze([cardId]),
        zones: Object.freeze(zones)
      };
    },
    getHandCardIds(seatId) {
      return snapshot.zones[formatZoneId(seatId, HAND_ZONE)] ?? EMPTY;
    },
    getDrawPileCardIds() {
      return snapshot.zones[formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE)] ?? EMPTY;
    },
    reconcileVisibleHands(hands) {
      const visibleIds = new Set<number>();
      const bySeat = new Map<number, number[]>();
      for (const hand of hands) {
        const cardIds = uniquePositive(hand.cardIds);
        bySeat.set(hand.seatId, cardIds);
        cardIds.forEach((cardId) => visibleIds.add(cardId));
      }
      const handSeats = new Set(bySeat.keys());
      for (const record of cardIndex.values()) {
        if (record.location?.zone !== HAND_ZONE) continue;
        handSeats.add(record.location.seatId);
        if (!visibleIds.has(record.cardId)) record.location = null;
      }
      for (const seatId of handSeats) registry.clearLocations(seatId, HAND_ZONE);
      for (const [seatId, cardIds] of bySeat) {
        cardIds.forEach((cardId) => syncIndexFromObserve(cardId, seatId, []));
      }
      publish();
    },
    clearKnownDrawPileOrder() {
      drawPileOrder.invalidate();
      const zoneId = formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE);
      registry.clearLocations(GLOBAL_OWNER, DRAW_PILE_ZONE);
      for (const [cardId, record] of cardIndex) {
        if (record.location?.zone === DRAW_PILE_ZONE && record.location.seatId === GLOBAL_OWNER) {
          cardIndex.delete(cardId);
        }
      }
      publish();
    },
    observeKnownHandCard(cardId, seatId, tags = []) {
      syncIndexFromObserve(cardId, seatId, tags);
      publish();
    },
    rememberPersistentCardTag(cardId, tag, originalOwnerSeatId = null) {
      registry.rememberPersistentTag(cardId, tag, originalOwnerSeatId);
      const existing = cardIndex.get(cardId);
      if (existing) {
        existing.tags.add(tag);
        existing.persistentTags.add(tag);
        if (existing.originalOwnerSeatId === null && originalOwnerSeatId !== null) {
          existing.originalOwnerSeatId = originalOwnerSeatId;
        }
        publish();
      }
    },
    forgetPersistentCardTag(cardId, tag) {
      const normalizedTag = String(tag).trim();
      if (!normalizedTag) return;
      registry.forgetPersistentTag(cardId, normalizedTag);
      const existing = cardIndex.get(cardId);
      if (!existing) {
        publish();
        return;
      }
      existing.tags.delete(normalizedTag);
      existing.persistentTags.delete(normalizedTag);
      publish();
    },
    observeKnownDrawPileCards(cardIds, position) {
      const ids = uniquePositive(cardIds);
      if (!ids.length) return;
      drawPileOrder.reveal(position, ids);
      // 鉴定不是移动：用「原地」伪移动写位置，fromZone=牌堆，不会清掉手牌标签。
      syncIndexFromMovement({
        cardCount: ids.length,
        cardIds: ids,
        fromId: GLOBAL_OWNER,
        fromZone: DRAW_PILE_ZONE,
        fromPosition: position,
        fromZoneParam: 0,
        toId: GLOBAL_OWNER,
        toZone: DRAW_PILE_ZONE,
        toPosition: position,
        toZoneParam: 0
      }, ids);
      publish();
    },
    getPersistentTags(cardId) {
      return registry.getPersistentTags(cardId);
    },
    getOriginalOwnerSeatId(cardId) {
      return registry.getOriginalOwnerSeatId(cardId);
    },
    resolveHiddenMovement(movement, preferredOriginalOwnerSeatId = null) {
      if (
        isDrawPile(movement.fromId, movement.fromZone)
        && !movement.cardIds.some((cardId) => cardId > 0)
        && (movement.fromPosition === DRAW_PILE_POSITION.TOP || movement.fromPosition === DRAW_PILE_POSITION.BOTTOM)
      ) {
        // 牌堆有序：顶 / 底只能按顺序推算，不能用无序候选凑数量。
        return drawPileOrder.peek(movement.fromPosition, movement.cardCount);
      }
      return registry.resolveHiddenMovement(movement, preferredOriginalOwnerSeatId);
    },
    applyMovement(movement, effectiveCardIds) {
      if (isDrawPile(movement.fromId, movement.fromZone)) {
        drawPileOrder.remove(movement.fromPosition, movement.cardCount, effectiveCardIds);
      }
      if (isDrawPile(movement.toId, movement.toZone)) {
        drawPileOrder.add(movement.toPosition, movement.cardCount, effectiveCardIds);
      }
      syncIndexFromMovement(movement, effectiveCardIds);
      // 离开临时区时从 unknown 技能投影去掉
      if (TEMPORARY_CARD_ZONES.has(movement.fromZone)) {
        const known = effectiveCardIds.filter((id) => id > 0);
        if (known.length) {
          const next = (skillZones.get(MINGPAI_ZONE.UNKNOWN) ?? [])
            .filter((id) => !known.includes(id));
          if (next.length) skillZones.set(MINGPAI_ZONE.UNKNOWN, next);
          else skillZones.delete(MINGPAI_ZONE.UNKNOWN);
        }
      }
      publish();
    },
    projectSkillCards(zoneId, cardIds) {
      const normalized = uniquePositive(cardIds);
      if (!normalized.length) skillZones.delete(zoneId);
      else skillZones.set(zoneId, normalized);
      publish();
    },
    hasRestoredRecords() {
      return registry.hasRestoredRecords() || cardIndex.size > 0;
    },
    clear() {
      registry.clear();
      drawPileOrder.clear();
      cardIndex.clear();
      skillZones.clear();
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }
  };
}

export function formatZoneId(ownerId: number, zone: number): string {
  return `${zone}-${ownerId}`;
}

export function parseZoneId(zoneId: string): MingpaiZoneRef | null {
  if (zoneId === MINGPAI_ZONE.UNKNOWN || zoneId === '?') return null;
  const match = /^(\d+)-(\d+)$/.exec(zoneId);
  if (!match) return null;
  return { zone: Number(match[1]), ownerId: Number(match[2]) };
}

const EMPTY: readonly number[] = Object.freeze([]);

function isDrawPile(ownerId: number, zone: number): boolean {
  return ownerId === GLOBAL_OWNER && zone === DRAW_PILE_ZONE;
}

function uniquePositive(cardIds: readonly number[]): number[] {
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

function sameSnapshot(
  left: Readonly<MingpaiEngineSnapshot>,
  right: Readonly<MingpaiEngineSnapshot>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hydrateIndexFromRegistryStorage(
  cardIndex: Map<number, KnownCardRecord>,
  storage: Storage | null
): void {
  if (!storage) return;
  try {
    const document = JSON.parse(storage.getItem('XC::knownCardRegistry') || 'null');
    if (!document || !Array.isArray(document.records)) return;
    if (Date.now() - Number(document.savedAt) > 3 * 60 * 60 * 1000) return;
    for (const value of document.records) {
      const cardId = Number(value?.cardId);
      if (!Number.isInteger(cardId) || cardId <= 0) continue;
      const location = value.location && typeof value.location === 'object'
        ? {
            seatId: Number(value.location.seatId),
            zone: Number(value.location.zone),
            position: Number(value.location.position),
            zoneParam: Number(value.location.zoneParam)
          }
        : null;
      if (location && ![location.seatId, location.zone, location.position, location.zoneParam]
        .every((n) => Number.isInteger(n) && n >= 0)) continue;
      cardIndex.set(cardId, {
        cardId,
        tags: new Set(Array.isArray(value.tags) ? value.tags.map(String) : []),
        persistentTags: new Set(
          Array.isArray(value.persistentTags) ? value.persistentTags.map(String) : []
        ),
        originalOwnerSeatId: Number.isInteger(Number(value.originalOwnerSeatId))
          ? Number(value.originalOwnerSeatId)
          : null,
        location
      });
    }
  } catch {
    // 忽略异常
  }
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export { HAND_ZONE, DRAW_PILE_ZONE, DISCARD_ZONE, TEMPORARY_CARD_ZONES, GLOBAL_OWNER };
