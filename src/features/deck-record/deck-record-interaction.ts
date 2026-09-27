export type DeckRecordListKind = 'top' | 'bottom' | 'discard';

export interface DeckRecordAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DeckRecordInteractionSnapshot {
  activeList: DeckRecordListKind | null;
  anchor: DeckRecordAnchor | null;
}

export interface DeckRecordInteraction {
  getSnapshot(): Readonly<DeckRecordInteractionSnapshot>;
  setActiveList(list: DeckRecordListKind | null, options?: { force?: boolean }): void;
  setAnchor(anchor: DeckRecordAnchor | null): void;
  subscribe(listener: (snapshot: Readonly<DeckRecordInteractionSnapshot>) => void): () => void;
  clear(): void;
}

/**
 * 局内牌堆入口由 Laya 按钮驱动，弹层仍由 Vue 渲染。
 * 该状态只同步“当前展开哪一组”和按钮锚点，不保存牌局数据。
 */
export function createDeckRecordInteraction(): DeckRecordInteraction {
  let snapshot = freezeSnapshot({ activeList: null, anchor: null });
  const listeners = new Set<(snapshot: Readonly<DeckRecordInteractionSnapshot>) => void>();

  const publish = (next: DeckRecordInteractionSnapshot) => {
    snapshot = freezeSnapshot(next);
    listeners.forEach((listener) => listener(snapshot));
  };

  return {
    getSnapshot: () => snapshot,
    setActiveList(list, options) {
      // force：鼠标从 Laya 按钮移到 Vue 弹层时再次声明“仍打开”，用于取消延迟关闭。
      if (snapshot.activeList === list && !options?.force) return;
      publish({ ...snapshot, activeList: list });
    },
    setAnchor(anchor) {
      if (sameAnchor(snapshot.anchor, anchor)) return;
      publish({ ...snapshot, anchor: anchor ? { ...anchor } : null });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    clear() {
      listeners.clear();
      snapshot = freezeSnapshot({ activeList: null, anchor: null });
    }
  };
}

function sameAnchor(
  left: DeckRecordAnchor | null,
  right: DeckRecordAnchor | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.left === right.left
    && left.top === right.top
    && left.width === right.width
    && left.height === right.height;
}

function freezeSnapshot(
  snapshot: DeckRecordInteractionSnapshot
): Readonly<DeckRecordInteractionSnapshot> {
  if (snapshot.anchor) Object.freeze(snapshot.anchor);
  return Object.freeze(snapshot);
}
