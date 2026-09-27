import { locateGameScene } from '../seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

/** legacy 自带的明牌 Laya 节点；座位明牌改由 native-mingpai-preview-controller 的 Laya 小牌条显示。legacy 删除后连同本文件一起删除。 */
const LEGACY_MINGPAI_NODE_NAMES = new Set(['xcMingpaiPreviewRoot', 'xcMingpaiCardList']);
const SEARCH_DEPTH = 4;
const POLL_INTERVAL_MS = 250;

/** legacy 会在节点被移除后立即重建，所以只隐藏不删除。 */
export function installLegacyMingpaiSuppressor(globalObject: Window = window): () => void {
  const timer = globalObject.setInterval(() => {
    const scene = asRecord(locateGameScene(globalObject));
    const roundParent = asRecord(asRecord(scene?.gameRoundInfo)?._parent);
    const stage = asRecord(asRecord((globalObject as unknown as UnknownRecord).Laya)?.stage);
    for (const root of [roundParent, scene, stage]) {
      if (root) hideNamedNodes(root, SEARCH_DEPTH);
    }
  }, POLL_INTERVAL_MS);
  return () => globalObject.clearInterval(timer);
}

function hideNamedNodes(node: UnknownRecord, depth: number): void {
  const children = Array.isArray(node._children) ? node._children as unknown[] : [];
  for (const child of children) {
    const record = asRecord(child);
    if (!record) continue;
    if (LEGACY_MINGPAI_NODE_NAMES.has(String(record.name ?? ''))) {
      if (record.visible !== false) record.visible = false;
      record.mouseEnabled = false;
      continue;
    }
    if (depth > 0) hideNamedNodes(record, depth - 1);
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
