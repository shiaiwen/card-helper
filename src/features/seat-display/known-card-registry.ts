/**
 * 已知牌登记：按座位维护已知手牌身份与标签。
 */

export interface KnownCardLocation {
  seatId: number;
  zone: number;
  position: number;
  zoneParam: number;
}

export interface KnownCardMovement {
  cardCount: number;
  cardIds: readonly number[];
  fromId: number;
  fromZone: number;
  fromPosition: number;
  fromZoneParam: number;
  toId: number;
  toZone: number;
  toPosition: number;
  toZoneParam: number;
}

export interface KnownCardRecord {
  cardId: number;
  tags: Set<string>;
  persistentTags: Set<string>;
  originalOwnerSeatId: number | null;
  location: KnownCardLocation | null;
}

const HAND_ZONE = 5;
const PERSISTENT_KNOWN_CARD_TAGS = new Set(['炁', '心幽']);
const REGISTRY_STORAGE_KEY = 'XC::knownCardRegistry';
const REGISTRY_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * 与座位 UI 解耦的已知卡牌注册表。
 * 它只维护卡牌身份、持续标签、原始归属和当前位置，不负责渲染。
 */
export function createKnownCardRegistry(storage: Storage | null = getSessionStorage()) {
  const records = new Map<number, KnownCardRecord>();
  restoreRecords(records, storage);

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({
        savedAt: Date.now(),
        records: [...records.values()].map((record) => ({
          cardId: record.cardId,
          tags: [...record.tags],
          persistentTags: [...record.persistentTags],
          originalOwnerSeatId: record.originalOwnerSeatId,
          location: record.location
        }))
      }));
    } catch {
      // sessionStorage 不可用时仅失去重载恢复，不影响本局实时记录。
    }
  }

  function getOrCreate(cardId: number): KnownCardRecord | null {
    if (!Number.isInteger(cardId) || cardId <= 0) return null;
    let record = records.get(cardId);
    if (!record) {
      record = {
        cardId,
        tags: new Set(),
        persistentTags: new Set(),
        originalOwnerSeatId: null,
        location: null
      };
      records.set(cardId, record);
    }
    return record;
  }

  return {
    rememberPersistentTag(cardId: number, tag: string, originalOwnerSeatId: number | null = null) {
      const record = getOrCreate(cardId);
      const normalizedTag = String(tag).trim();
      if (!record || !normalizedTag) return;
      record.tags.add(normalizedTag);
      record.persistentTags.add(normalizedTag);
      if (originalOwnerSeatId !== null && Number.isInteger(originalOwnerSeatId)
        && originalOwnerSeatId >= 0 && record.originalOwnerSeatId === null) {
        record.originalOwnerSeatId = originalOwnerSeatId;
      }
      persist();
    },

    forgetPersistentTag(cardId: number, tag: string) {
      const record = records.get(cardId);
      const normalizedTag = String(tag).trim();
      if (!record || !normalizedTag || !record.persistentTags.has(normalizedTag)) return;
      record.persistentTags.delete(normalizedTag);
      record.tags.delete(normalizedTag);
      persist();
    },

    observeKnownHandCard(cardId: number, seatId: number, tags: readonly string[]) {
      const record = getOrCreate(cardId);
      if (!record) return;
      record.tags = normalizeTags(tags);
      for (const tag of record.tags) {
        if (!PERSISTENT_KNOWN_CARD_TAGS.has(tag)) continue;
        record.persistentTags.add(tag);
        if (tag === '炁' && record.originalOwnerSeatId === null) {
          record.originalOwnerSeatId = seatId;
        }
      }
      record.location = { seatId, zone: HAND_ZONE, position: 0, zoneParam: 0 };
      persist();
    },

    getPersistentTags(cardId: number): string[] {
      return [...(records.get(cardId)?.persistentTags ?? [])];
    },

    getOriginalOwnerSeatId(cardId: number): number | null {
      return records.get(cardId)?.originalOwnerSeatId ?? null;
    },

    clearLocations(seatId: number, zone: number) {
      for (const record of records.values()) {
        if (record.location?.seatId === seatId && record.location.zone === zone) record.location = null;
      }
      persist();
    },

    /**
     * 协议省略卡号时只接受唯一解：来源位置内记录的卡牌数量必须与移动数量完全一致。
     */
    resolveHiddenMovement(
      movement: KnownCardMovement,
      preferredOriginalOwnerSeatId: number | null = null
    ): number[] {
      if (movement.cardIds.some((cardId) => cardId > 0)) return [...movement.cardIds];
      const candidates = [...records.values()].filter((record) => (
        locationMatches(record.location, movement)
        && (preferredOriginalOwnerSeatId === null
          || (record.originalOwnerSeatId === preferredOriginalOwnerSeatId
            && record.persistentTags.has('炁')))
      ));
      if (candidates.length !== movement.cardCount) return [...movement.cardIds];
      return candidates.map((record) => record.cardId);
    },

    applyMovement(movement: KnownCardMovement, effectiveCardIds: readonly number[]) {
      for (const cardId of effectiveCardIds) {
        const record = getOrCreate(cardId);
        if (!record) continue;
        record.location = {
          seatId: movement.toId,
          zone: movement.toZone,
          position: movement.toPosition,
          zoneParam: movement.toZoneParam
        };
        // 普通官方标签离开手牌后失效，持续标签仍由注册表保存。
        if (movement.fromZone === HAND_ZONE && movement.toZone !== HAND_ZONE) {
          record.tags = new Set(record.persistentTags);
        }
      }
      persist();
    },

    hasRestoredRecords() {
      return records.size > 0;
    },

    clear() {
      records.clear();
      try { storage?.removeItem(REGISTRY_STORAGE_KEY); } catch { /* 无存储权限时忽略。 */ }
    }
  };
}

function restoreRecords(records: Map<number, KnownCardRecord>, storage: Storage | null): void {
  if (!storage) return;
  try {
    const document = JSON.parse(storage.getItem(REGISTRY_STORAGE_KEY) || 'null');
    if (!document || Date.now() - Number(document.savedAt) > REGISTRY_MAX_AGE_MS
      || !Array.isArray(document.records)) return;
    for (const value of document.records) {
      const cardId = Number(value?.cardId);
      if (!Number.isInteger(cardId) || cardId <= 0) continue;
      const location = value.location && typeof value.location === 'object'
        ? normalizeLocation(value.location)
        : null;
      records.set(cardId, {
        cardId,
        tags: normalizeTags(Array.isArray(value.tags) ? value.tags : []),
        persistentTags: normalizeTags(Array.isArray(value.persistentTags) ? value.persistentTags : []),
        originalOwnerSeatId: Number.isInteger(Number(value.originalOwnerSeatId))
          ? Number(value.originalOwnerSeatId)
          : null,
        location
      });
    }
  } catch {
    // 损坏快照直接丢弃。
  }
}

function normalizeLocation(value: Record<string, unknown>): KnownCardLocation | null {
  const numbers = ['seatId', 'zone', 'position', 'zoneParam'].map((key) => Number(value[key]));
  return numbers.every((number) => Number.isInteger(number) && number >= 0)
    ? { seatId: numbers[0], zone: numbers[1], position: numbers[2], zoneParam: numbers[3] }
    : null;
}

function getSessionStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

function normalizeTags(tags: readonly string[]): Set<string> {
  return new Set(tags.map((tag) => String(tag ?? '').trim()).filter(Boolean));
}

function locationMatches(
  location: KnownCardLocation | null,
  movement: KnownCardMovement
): boolean {
  if (!location || location.seatId !== movement.fromId || location.zone !== movement.fromZone) {
    return false;
  }
  // 位置字段为 0 时通常表示协议未提供，不能用它排除候选。
  if (movement.fromPosition && location.position && location.position !== movement.fromPosition) {
    return false;
  }
  if (movement.fromZoneParam && location.zoneParam && location.zoneParam !== movement.fromZoneParam) {
    return false;
  }
  return true;
}
