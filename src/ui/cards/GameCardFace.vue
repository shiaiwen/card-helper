<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import { resolveOfficialCardArtworkUrl } from '../../features/cards/official-card-renderer.ts';

const props = withDefaults(defineProps<{
  cardId: number;
  gameCardCatalog: GameCardCatalog;
  size?: 'tiny' | 'small' | 'normal';
  tags?: readonly string[];
}>(), {
  size: 'small',
  tags: () => []
});
const artworkFailed = ref(false);
const artworkUrl = ref('');
const metadataRevision = ref(0);
let metadataRetryTimer = 0;
const card = computed(() => {
  metadataRevision.value;
  return props.gameCardCatalog.resolve(props.cardId);
});
const isUnknown = computed(() => props.cardId <= 0);
const tooltip = computed(() => {
  if (isUnknown.value) return '未知牌';
  const identity = [card.value.name || '未知牌', card.value.suitGlyph, card.value.rank]
    .filter(Boolean).join(' ');
  return props.tags.length ? `${identity}\n标签：${props.tags.join('、')}` : identity;
});

function refreshArtwork(): void {
  if (props.cardId <= 0) {
    artworkUrl.value = '';
    return;
  }
  artworkFailed.value = false;
  const fromCatalog = props.gameCardCatalog.resolve(props.cardId).artworkUrl;
  const resolved = fromCatalog || resolveOfficialCardArtworkUrl(props.cardId, props.size === 'normal' ? 0.72 : 0.5);
  artworkUrl.value = resolved;
}

watch(() => props.cardId, () => {
  artworkFailed.value = false;
  refreshArtwork();
}, { immediate: true });

onMounted(() => {
  refreshArtwork();
  metadataRetryTimer = window.setInterval(() => {
    metadataRevision.value += 1;
    if (!artworkUrl.value || artworkFailed.value) refreshArtwork();
    if (card.value.name && artworkUrl.value && !artworkFailed.value) {
      window.clearInterval(metadataRetryTimer);
      metadataRetryTimer = 0;
    }
  }, 400);
});
onBeforeUnmount(() => {
  if (metadataRetryTimer) window.clearInterval(metadataRetryTimer);
});
</script>

<template>
  <span
    class="xc-game-card"
    :class="[
      `xc-game-card--${size}`,
      {
        'xc-game-card--red': card.isRed,
        'xc-game-card--unknown': isUnknown,
        'xc-game-card--artwork': Boolean(artworkUrl) && !artworkFailed
      }
    ]"
    :title="tooltip"
  >
    <img
      v-if="artworkUrl && !artworkFailed"
      class="xc-game-card__art"
      :src="artworkUrl"
      alt=""
      @error="artworkFailed = true"
    >
    <template v-if="!isUnknown && (!artworkUrl || artworkFailed)">
      <span class="xc-game-card__corner">
        <b>{{ card.rank || '?' }}</b><i>{{ card.suitGlyph }}</i>
      </span>
      <span class="xc-game-card__name">{{ card.name || '未知' }}</span>
    </template>
    <small v-if="!isUnknown && tags.length" class="xc-game-card__tag">{{ tags.join('/') }}</small>
    <span v-if="isUnknown" class="xc-game-card__back"><i>杀</i></span>
  </span>
</template>

<style scoped>
.xc-game-card {
  position: relative;
  display: inline-grid;
  flex: 0 0 auto;
  grid-template-columns: 20% minmax(0, 1fr);
  align-items: center;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid #8f6b35;
  border-radius: 4px;
  background:
    radial-gradient(circle at 72% 52%, rgba(152, 55, 31, .13), transparent 34%),
    linear-gradient(145deg, #fff4d6, #ddc792 68%, #b68c4c);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.24), 0 1px 3px rgba(0,0,0,.38);
  color: #21170e;
  font-family: KaiTi, STKaiti, SimSun, serif;
  vertical-align: top;
  user-select: none;
}
.xc-game-card--tiny { width: 46px; height: 32px; padding: 2px; }
.xc-game-card--small { width: 46px; height: 64px; padding: 3px; grid-template-columns: 14px 1fr; }
.xc-game-card--normal { width: 67px; height: 94px; padding: 0; grid-template-columns: 1fr; border-radius: 3px; }
.xc-game-card--red { color: #a01818; }
.xc-game-card--artwork {
  border-color: rgba(159, 125, 73, .85);
  background: #1d1712;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45);
}
.xc-game-card__art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; background: #1d1712; }
.xc-game-card__corner,
.xc-game-card__name,
.xc-game-card__tag { position: relative; z-index: 1; }
.xc-game-card__corner { display: flex; flex-direction: column; align-items: center; font: 8px/.9 Georgia, serif; }
.xc-game-card--small .xc-game-card__corner { align-self: start; font-size: 9px; }
.xc-game-card--normal .xc-game-card__corner { align-self: start; font-size: 13px; }
.xc-game-card__corner b { font-size: 1.1em; }
.xc-game-card__corner i { font-style: normal; }
.xc-game-card__name { overflow: hidden; font-size: 10px; font-weight: 700; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.xc-game-card--small .xc-game-card__name { font-size: 11px; white-space: normal; }
.xc-game-card--normal .xc-game-card__name { font-size: 14px; white-space: normal; }
.xc-game-card__tag { position: absolute; right: 2px; bottom: 1px; max-width: 72%; overflow: hidden; color: #6f361a; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.xc-game-card--unknown { display: inline-flex; align-items: center; justify-content: center; padding: 2px; border-color: #9a7440; background: #2b1712; }
.xc-game-card__back { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; box-sizing: border-box; border: 1px solid rgba(235,199,117,.52); border-radius: 3px; background: repeating-linear-gradient(45deg, rgba(232,194,109,.18) 0 2px, transparent 2px 5px), radial-gradient(circle, #7d1e18, #2c1713 72%); color: #e6ca89; }
.xc-game-card__back i { font: 700 13px/1 KaiTi, serif; font-style: normal; text-shadow: 0 1px 2px #000; }
</style>
