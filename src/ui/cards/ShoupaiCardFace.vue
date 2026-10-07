<script setup lang="ts">
import { computed } from 'vue';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';

/**
 * 卡牌页牌堆区用的迷你牌面（非 Laya 官方立绘）。
 * 局内悬停弹层仍由 createNormalCardUi 画官方牌。
 */
const props = defineProps<{
  cardId: number;
  gameCardCatalog: GameCardCatalog;
}>();

const card = computed(() => props.gameCardCatalog.resolve(props.cardId));
const isUnknown = computed(() => !(props.cardId > 0));
const shortName = computed(() => (card.value.name || '？').slice(0, 2));
const suitClass = computed(() => {
  const suit = card.value.suit;
  if (suit === 'heart') return 'suit-heart';
  if (suit === 'diamond') return 'suit-diamond';
  if (suit === 'spade') return 'suit-spade';
  if (suit === 'club') return 'suit-club';
  return '';
});
const cornerClass = computed(() => {
  const base = `${card.value.suitGlyph || ''}${card.value.rank || ''}`.length >= 3
    ? 'card-cn-long'
    : 'card-cn';
  return suitClass.value ? `${base} ${suitClass.value}` : base;
});
const tooltip = computed(() => {
  if (isUnknown.value) return '未知牌';
  return [card.value.name || '未知牌', card.value.suitGlyph, card.value.rank]
    .filter(Boolean)
    .join(' ');
});
</script>

<template>
  <button
    type="button"
    class="shoupai"
    :class="{ R: card.isRed, G: isUnknown }"
    disabled
    :title="tooltip"
    :data-card-id="cardId > 0 ? String(cardId) : undefined"
  >
    <template v-if="isUnknown">？</template>
    <template v-else>
      <span :class="cornerClass">
        <span class="suit-glyph">{{ card.suitGlyph }}</span><span class="rank-glyph">{{ card.rank }}</span>
      </span>
      <br>
      {{ shortName }}
    </template>
  </button>
</template>

<style scoped>
.shoupai {
  color: #000;
  --shoupai-width: 33px;
  box-sizing: border-box;
  padding: 0;
  font-weight: bolder;
  margin: 0 calc(32px - var(--shoupai-width)) 2px 0;
  float: left;
  width: var(--shoupai-width);
  min-width: var(--shoupai-width);
  height: 38px;
  border: 1px solid #000;
  text-align: center;
  background: rgba(210, 200, 160, .5);
  border-radius: 5px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif;
  white-space: nowrap;
  text-shadow:
    1px 0 0 rgba(255, 255, 255, .7),
    0 1px 0 rgba(255, 255, 255, .7),
    -1px 0 0 rgba(255, 255, 255, .7),
    0 -1px 0 rgba(255, 255, 255, .7);
  font-size: 13px;
  line-height: 1.1;
  cursor: default;
  appearance: none;
}
.shoupai :deep(.card-cn),
.shoupai :deep(.card-cn-long) {
  display: inline-block;
  line-height: 1;
  font-family: "Segoe UI Symbol", "Segoe UI", Tahoma, Arial, sans-serif;
}
.shoupai :deep(.card-cn-long) {
  font-size: 12px;
  letter-spacing: -1px;
}
.shoupai :deep(.suit-glyph) {
  display: inline-block;
  min-width: .56em;
  font-size: 1.45em;
  margin-right: 0;
  line-height: 1;
  font-weight: 700;
  vertical-align: -.08em;
}
.shoupai :deep(.card-cn-long .suit-glyph) {
  font-size: 1.3em;
}
.shoupai :deep(.rank-glyph) {
  display: inline-block;
  margin-left: 1px;
}
.shoupai :deep(.suit-diamond),
.shoupai :deep(.suit-heart) {
  color: #f04155;
}
.shoupai :deep(.suit-spade) {
  color: #2c2c2c;
}
.shoupai :deep(.suit-club) {
  color: #787878;
}
.shoupai.R {
  color: red;
}
.shoupai.G {
  background: transparent;
}
</style>
