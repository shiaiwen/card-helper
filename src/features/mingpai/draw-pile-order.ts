import { DRAW_PILE_POSITION } from './rules/reveal-types.ts';

/**
 * 牌堆顶 / 底的有序已知牌（0 表示该位置的牌不可见）。
 * 对照原版 nb(1-255)：放回牌堆顶时消息里最后一张在最上面；从顶摸 N 张就是顶部前 N 张。
 */
export interface DrawPileOrder {
  /** 离开牌堆前按位置预判即将移出的牌；位置未指定时返回全 0。 */
  peek(position: number, count: number): number[];
  remove(position: number, count: number, cardIds: readonly number[]): void;
  add(position: number, count: number, cardIds: readonly number[]): void;
  /** 鉴定（观看）而非移动：按位置写入已知牌。 */
  reveal(position: number, cardIds: readonly number[]): void;
  getSnapshot(): { top: readonly number[]; bottom: readonly number[] };
  invalidate(): void;
  clear(): void;
}

const STORAGE_KEY = 'XC::mingpaiDrawPileOrder';
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function createDrawPileOrder(storage: Storage | null = null): DrawPileOrder {
  /** top[0] 是下一张会被摸到的牌。 */
  let top: number[] = [];
  /** bottom 最后一张是最底部。 */
  let bottom: number[] = [];
  restore();

  function persist(): void {
    if (!storage) return;
    try {
      if (!top.some(Boolean) && !bottom.some(Boolean)) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), top, bottom }));
    } catch { /* 存储失败不影响实时推算。 */ }
  }

  function restore(): void {
    if (!storage) return;
    try {
      const document = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (!document || Date.now() - Number(document.savedAt) > MAX_AGE_MS) return;
      top = normalizeList(document.top);
      bottom = normalizeList(document.bottom);
    } catch { /* 损坏快照直接丢弃。 */ }
  }

  function forget(cardIds: readonly number[]): void {
    const known = new Set(cardIds.filter((cardId) => cardId > 0));
    if (!known.size) return;
    top = top.map((cardId) => (known.has(cardId) ? 0 : cardId));
    bottom = bottom.map((cardId) => (known.has(cardId) ? 0 : cardId));
    trim();
  }

  /** 位置未指定但卡号已知：牌从中间抽走，后面的牌要顺次补位，不能只留空位。 */
  function extract(cardIds: readonly number[]): void {
    const known = new Set(cardIds.filter((cardId) => cardId > 0));
    if (!known.size) return;
    top = top.filter((cardId) => !known.has(cardId));
    bottom = bottom.filter((cardId) => !known.has(cardId));
    trim();
  }

  function trim(): void {
    while (top.length && !top[top.length - 1]) top.pop();
    while (bottom.length && !bottom[0]) bottom.shift();
  }

  return {
    peek(position, count) {
      const size = Math.max(0, count);
      if (position === DRAW_PILE_POSITION.TOP) {
        return Array.from({ length: size }, (_, index) => top[index] ?? 0);
      }
      if (position === DRAW_PILE_POSITION.BOTTOM) {
        const start = bottom.length - size;
        return Array.from({ length: size }, (_, index) => bottom[start + index] ?? 0).reverse();
      }
      return Array.from({ length: size }, () => 0);
    },
    remove(position, count, cardIds) {
      const size = Math.max(0, count);
      const known = [...new Set(cardIds.filter((cardId) => cardId > 0))];
      if (known.length) {
        // CardIDs are authoritative when present. Remove those exact positions so an
        // out-of-order known move cannot shift unrelated top/bottom predictions.
        const removed = new Set<number>();
        for (const cardId of known) {
          let index = top.indexOf(cardId);
          if (index >= 0) {
            top.splice(index, 1);
            removed.add(cardId);
            continue;
          }
          index = bottom.indexOf(cardId);
          if (index >= 0) {
            bottom.splice(index, 1);
            removed.add(cardId);
          }
        }
        const unresolvedCount = Math.max(0, size - removed.size);
        if (position === DRAW_PILE_POSITION.TOP && unresolvedCount) top.splice(0, unresolvedCount);
        else if (position === DRAW_PILE_POSITION.BOTTOM && unresolvedCount) {
          bottom.splice(Math.max(0, bottom.length - unresolvedCount), unresolvedCount);
        }
      } else if (position === DRAW_PILE_POSITION.TOP) top.splice(0, size);
      else if (position === DRAW_PILE_POSITION.BOTTOM) bottom.splice(Math.max(0, bottom.length - size), size);
      // Position-unspecified extraction still uses the explicit IDs to compact known slots.
      else extract(known);
      forget(known);
      trim();
      persist();
    },
    add(position, count, cardIds) {
      const moved = Array.from({ length: Math.max(0, count) }, (_, index) => (cardIds[index] > 0 ? cardIds[index] : 0));
      forget(moved);
      if (position === DRAW_PILE_POSITION.TOP) top.unshift(...moved.reverse());
      else if (position === DRAW_PILE_POSITION.BOTTOM) bottom.push(...moved);
      trim();
      persist();
    },
    reveal(position, cardIds) {
      const ids = cardIds.filter((cardId) => cardId > 0);
      if (!ids.length) return;
      if (position === DRAW_PILE_POSITION.TOP) {
        forget(ids);
        ids.forEach((cardId, index) => { top[index] = cardId; });
        top = Array.from({ length: top.length }, (_, index) => top[index] ?? 0);
      } else if (position === DRAW_PILE_POSITION.BOTTOM) {
        forget(ids);
        const missing = Math.max(0, ids.length - bottom.length);
        bottom = [...Array.from({ length: missing }, () => 0), ...bottom];
        const start = bottom.length - ids.length;
        ids.forEach((cardId, index) => { bottom[start + index] = cardId; });
      } else {
        return;
      }
      trim();
      persist();
    },
    getSnapshot: () => ({ top: [...top], bottom: [...bottom] }),
    invalidate() {
      // Reconnect/shuffle gaps make prior identities unsafe; discard stale order entirely.
      top = [];
      bottom = [];
      persist();
    },
    clear() {
      top = [];
      bottom = [];
      persist();
    }
  };
}

function normalizeList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((cardId) => (Number.isInteger(Number(cardId)) && Number(cardId) > 0 ? Number(cardId) : 0))
    : [];
}
