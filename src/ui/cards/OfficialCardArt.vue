<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  createOfficialCardView,
  OFFICIAL_CARD_BASE_HEIGHT,
  OFFICIAL_CARD_BASE_WIDTH,
  releaseOfficialCardView,
  resolveOfficialCardArtworkUrl,
  type OfficialCardView
} from '../../features/cards/official-card-renderer.ts';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import { locateGameScene } from '../../features/seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

/**
 * 面板用官方牌面：优先 createNormalCardUi 快照成 data URL，
 * 失败再退回纹理 URL，再失败才用语义牌面（由外层 GameCardFace 处理）。
 */
const props = withDefaults(defineProps<{
  cardId: number;
  gameCardCatalog: GameCardCatalog;
  size?: 'tiny' | 'small' | 'normal';
}>(), {
  size: 'normal'
});

const artworkUrl = ref('');
const failed = ref(false);
let retryTimer = 0;
let disposed = false;

const scale = () => (props.size === 'normal' ? 0.72 : props.size === 'small' ? 0.5 : 0.36);
const pixelSize = () => ({
  width: Math.max(1, Math.round(OFFICIAL_CARD_BASE_WIDTH * scale())),
  height: Math.max(1, Math.round(OFFICIAL_CARD_BASE_HEIGHT * scale()))
});

watch(() => props.cardId, () => {
  failed.value = false;
  artworkUrl.value = '';
  refresh();
}, { immediate: true });

onMounted(() => {
  retryTimer = window.setInterval(() => {
    if (disposed || (artworkUrl.value && !failed.value)) {
      if (artworkUrl.value && !failed.value && retryTimer) {
        window.clearInterval(retryTimer);
        retryTimer = 0;
      }
      return;
    }
    refresh();
  }, 500);
});
onBeforeUnmount(() => {
  disposed = true;
  if (retryTimer) window.clearInterval(retryTimer);
});

function refresh(): void {
  if (!(props.cardId > 0) || disposed) {
    artworkUrl.value = '';
    return;
  }
  failed.value = false;
  const fromCatalog = props.gameCardCatalog.resolve(props.cardId).artworkUrl;
  if (fromCatalog) {
    artworkUrl.value = fromCatalog;
    return;
  }
  const snapped = snapshotViaOfficialDraw(props.cardId, scale());
  if (snapped) {
    artworkUrl.value = snapped;
    return;
  }
  artworkUrl.value = resolveOfficialCardArtworkUrl(props.cardId, scale()) || '';
}

function snapshotViaOfficialDraw(cardId: number, cardScale: number): string {
  if (typeof document === 'undefined') return '';
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Sprite = laya?.Sprite;
  const stage = asRecord(laya?.stage);
  if (typeof Sprite !== 'function' || !stage) return '';
  const scene = asRecord(locateGameScene(window));
  if (!scene) return '';

  const { width, height } = {
    width: Math.max(1, Math.round(OFFICIAL_CARD_BASE_WIDTH * cardScale)),
    height: Math.max(1, Math.round(OFFICIAL_CARD_BASE_HEIGHT * cardScale))
  };
  let host: UnknownRecord | null = null;
  let view: OfficialCardView | null = null;
  try {
    host = asRecord(new (Sprite as unknown as new () => object)());
    if (!host) return '';
    host.name = 'xcPanelOfficialCardHost';
    host.mouseEnabled = false;
    host.mouseThrough = true;
    host.visible = true;
    host.alpha = 1;
    call(host, 'size', width, height);
    call(host, 'pos', -width - 80, -height - 80);
    call(stage, 'addChild', host);
    view = createOfficialCardView(host, cardId, width, height, scene);
    if (!view) return '';
    call(stage, 'render');
    call(host, 'repaint');
    call(view.ui, 'repaint');
    for (const target of [host, view.ui]) {
      const dataUrl = canvasLikeToDataUrl(call(target, 'drawToCanvas', width, height, 0, 0))
        || canvasLikeToDataUrl(call(target, 'drawToCanvas', width, height, Number(host.x || 0), Number(host.y || 0)));
      if (dataUrl && dataUrl.length > 64) return dataUrl;
    }
    return '';
  } catch {
    return '';
  } finally {
    releaseOfficialCardView(view);
    try {
      call(host, 'removeSelf');
      call(host, 'destroy', true);
    } catch {
      // ignore
    }
  }
}

function canvasLikeToDataUrl(value: unknown): string {
  if (!value) return '';
  if (value instanceof HTMLCanvasElement) {
    try { return value.toDataURL('image/png'); } catch { return ''; }
  }
  const canvas = asRecord(value);
  if (!canvas) return '';
  if (typeof canvas.getCanvas === 'function') {
    const nested = canvas.getCanvas();
    if (nested instanceof HTMLCanvasElement) {
      try { return nested.toDataURL('image/png'); } catch { return ''; }
    }
  }
  const source = canvas.source ?? canvas._source;
  if (source instanceof HTMLCanvasElement) {
    try { return source.toDataURL('image/png'); } catch { return ''; }
  }
  if (typeof canvas.toBase64 === 'function') {
    try {
      const base64 = canvas.toBase64('image/png');
      return typeof base64 === 'string' && base64
        ? (base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`)
        : '';
    } catch { return ''; }
  }
  return '';
}

function call(target: UnknownRecord | null | undefined, methodName: string, ...args: unknown[]): unknown {
  const method = target?.[methodName];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

defineExpose({ artworkUrl, failed, pixelSize });
</script>

<template>
  <img
    v-if="artworkUrl && !failed"
    class="xc-official-card-art"
    :src="artworkUrl"
    alt=""
    draggable="false"
    @error="failed = true"
  >
</template>

<style scoped>
.xc-official-card-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  background: #1d1712;
  pointer-events: none;
}
</style>

function withDefaults(arg0: any, arg1: { size: string; }) {
  throw new Error('Function not implemented.');
}
