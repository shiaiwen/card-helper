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

type UnknownRecord = Record<string, unknown>;

/**
 * 面板内官方牌面：优先用游戏 createNormalCardUi 快照到 canvas，
 * 失败时再试资源 URL，最后才降级为语义牌面。
 */
const props = withDefaults(defineProps<{
  cardId: number;
  gameCardCatalog: GameCardCatalog;
  size?: 'tiny' | 'small' | 'normal';
}>(), {
  size: 'normal'
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
const artworkUrl = ref('');
const artworkFailed = ref(false);
const metadataRevision = ref(0);
let retryTimer = 0;
let paintToken = 0;

const scale = () => (props.size === 'normal' ? 0.72 : props.size === 'small' ? 0.5 : 0.35);
const width = () => Math.max(1, Math.round(OFFICIAL_CARD_BASE_WIDTH * scale()));
const height = () => Math.max(1, Math.round(OFFICIAL_CARD_BASE_HEIGHT * scale()));

function cardMeta() {
  metadataRevision.value;
  return props.gameCardCatalog.resolve(props.cardId);
}

watch(() => props.cardId, () => {
  artworkFailed.value = false;
  artworkUrl.value = '';
  void paint();
}, { immediate: true });

onMounted(() => {
  retryTimer = window.setInterval(() => {
    metadataRevision.value += 1;
    if (!artworkUrl.value || artworkFailed.value) void paint();
    if (artworkUrl.value && !artworkFailed.value && cardMeta().name) {
      window.clearInterval(retryTimer);
      retryTimer = 0;
    }
  }, 500);
});
onBeforeUnmount(() => {
  paintToken += 1;
  if (retryTimer) window.clearInterval(retryTimer);
});

async function paint(): Promise<void> {
  if (!(props.cardId > 0)) {
    artworkUrl.value = '';
    return;
  }
  const token = ++paintToken;
  const dataUrl = paintOfficialCardToDataUrl(props.cardId, width(), height())
    || resolveOfficialCardArtworkUrl(props.cardId, scale());
  if (token !== paintToken) return;
  if (dataUrl) {
    artworkUrl.value = dataUrl;
    artworkFailed.value = false;
    drawToCanvas(dataUrl);
    return;
  }
  artworkUrl.value = '';
}

function drawToCanvas(url: string): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const w = width();
  const h = height();
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = new Image();
  image.onload = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);
  };
  image.onerror = () => { artworkFailed.value = true; };
  image.src = url;
}

function paintOfficialCardToDataUrl(cardId: number, w: number, h: number): string {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const Sprite = laya?.Sprite;
  const stage = asRecord(laya?.stage);
  if (typeof Sprite !== 'function' || !stage) return '';
  let host: UnknownRecord | null = null;
  let view: OfficialCardView | null = null;
  try {
    host = asRecord(new (Sprite as unknown as new () => object)());
    if (!host) return '';
    host.name = 'xcPanelOfficialCardHost';
    host.mouseEnabled = false;
    host.mouseThrough = true;
    host.visible = true;
    host.alpha = 0.01;
    call(host, 'size', w, h);
    call(host, 'pos', 0, 0);
    call(stage, 'addChild', host);
    view = createOfficialCardView(host, cardId, w, h);
    if (!view) return '';
    call(stage, 'render');
    call(host, 'repaint');
    call(view.ui, 'repaint');
    for (const candidate of [
      call(view.ui, 'drawToCanvas', w, h, 0, 0),
      call(host, 'drawToCanvas', w, h, 0, 0)
    ]) {
      const dataUrl = canvasLikeToDataUrl(candidate);
      if (dataUrl && dataUrl.length > 100) return dataUrl;
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
</script>

<template>
  <span
    class="xc-official-card"
    :class="[`xc-official-card--${size}`, { 'xc-official-card--fallback': !artworkUrl || artworkFailed }]"
    :title="cardMeta().name || '未知牌'"
  >
    <canvas
      v-show="artworkUrl && !artworkFailed"
      ref="canvasRef"
      class="xc-official-card__canvas"
    />
    <template v-if="!artworkUrl || artworkFailed">
      <span class="xc-official-card__corner" :class="{ 'xc-official-card__corner--red': cardMeta().isRed }">
        <b>{{ cardMeta().rank || '?' }}</b><i>{{ cardMeta().suitGlyph }}</i>
      </span>
      <span class="xc-official-card__name" :class="{ 'xc-official-card__name--red': cardMeta().isRed }">
        {{ cardMeta().name || '未知' }}
      </span>
    </template>
  </span>
</template>

<style scoped>
.xc-official-card {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid rgba(159, 125, 73, .85);
  border-radius: 3px;
  background: #1d1712;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45);
  vertical-align: top;
  user-select: none;
}
.xc-official-card--tiny { width: 46px; height: 32px; }
.xc-official-card--small { width: 46px; height: 64px; }
.xc-official-card--normal { width: 67px; height: 94px; }
.xc-official-card--fallback {
  display: inline-grid;
  grid-template-columns: 20% minmax(0, 1fr);
  align-items: center;
  padding: 3px;
  border-color: #8f6b35;
  background: linear-gradient(145deg, #fff4d6, #ddc792 68%, #b68c4c);
  color: #21170e;
  font-family: KaiTi, STKaiti, SimSun, serif;
}
.xc-official-card__canvas { width: 100%; height: 100%; display: block; }
.xc-official-card__corner { display: flex; flex-direction: column; align-items: center; align-self: start; font: 13px/.9 Georgia, serif; }
.xc-official-card__corner--red,
.xc-official-card__name--red { color: #a01818; }
.xc-official-card__corner i { font-style: normal; }
.xc-official-card__name { overflow: hidden; font-size: 14px; font-weight: 700; text-align: center; }
</style>
