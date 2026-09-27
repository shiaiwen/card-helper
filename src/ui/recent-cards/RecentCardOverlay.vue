<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type {
  RecentCardSnapshot,
  RecentCardStore
} from '../../features/recent-cards/recent-card-store.ts';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import {
  observeGameViewport,
  type GameViewportBounds
} from '../../features/seat-display/game-viewport-observer.ts';
import GameCardFace from '../cards/GameCardFace.vue';

const props = defineProps<{
  configStore: XiaochaoConfigStore;
  recentCardStore: RecentCardStore;
  gameCardCatalog: GameCardCatalog;
}>();
const enabled = ref(props.configStore.get('display.recentCardsEnabled'));
const snapshot = ref<Readonly<RecentCardSnapshot>>(props.recentCardStore.getSnapshot());
const viewport = ref<GameViewportBounds>({ left: 0, top: 0, width: 0, height: 0 });
const stopState = props.recentCardStore.subscribe((value) => { snapshot.value = value; });
const stopConfig = props.configStore.subscribe('display.recentCardsEnabled', ({ value }) => {
  enabled.value = value;
});
let stopViewport: (() => void) | undefined;

const overlayStyle = computed(() => ({
  left: `${Math.max(viewport.value.left + 8, viewport.value.left + viewport.value.width - 76)}px`,
  top: `${viewport.value.top + Math.max(8, viewport.value.height * .08)}px`
}));
const modeLabel = computed(() => snapshot.value.displayMode === 'current' ? '当前' : '玩家');

onMounted(() => {
  stopViewport = observeGameViewport((bounds) => { viewport.value = bounds; });
});
onBeforeUnmount(() => {
  stopState();
  stopConfig();
  stopViewport?.();
});

function toggleDisplayMode(): void {
  const mode = snapshot.value.displayMode === 'current' ? 'player' : 'current';
  props.recentCardStore.setDisplayMode(mode);
  props.configStore.set('display.recentCardMode', mode);
}
</script>

<template>
  <button
    v-if="enabled && snapshot.displayedCardId"
    id="xiaochao-recent-card"
    type="button"
    :style="overlayStyle"
    :aria-label="`最近用牌，当前显示${modeLabel}记录，点击切换`"
    data-tooltip="点击切换“当前回合 / 玩家最近”"
    @click="toggleDisplayMode"
  >
    <span class="xc-recent-card__mode">{{ modeLabel }}</span>
    <GameCardFace
      :card-id="snapshot.displayedCardId"
      :game-card-catalog="gameCardCatalog"
      size="normal"
    />
  </button>
</template>

<style scoped>
#xiaochao-recent-card {
  position: fixed;
  z-index: 2147483490;
  width: 72px;
  height: 100px;
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
  border: 1px solid #9f7d49;
  border-radius: 5px;
  background:
    linear-gradient(145deg, rgba(255, 235, 185, .09), transparent 42%),
    linear-gradient(180deg, #3c3022, #211912);
  box-shadow: 0 3px 9px rgba(0, 0, 0, .38), inset 0 0 0 2px rgba(242, 222, 156, .06);
  color: #f2de9c;
  font-family: SimSun, serif;
  cursor: pointer;
  user-select: none;
}
#xiaochao-recent-card:hover {
  border-color: #d2b66f;
  filter: brightness(1.08);
}
.xc-recent-card__mode {
  position: absolute;
  top: 2px;
  left: 2px;
  min-width: 26px;
  padding: 1px 3px;
  border: 1px solid rgba(242, 222, 156, .46);
  border-radius: 3px;
  background: rgba(34, 27, 19, .94);
  color: #fff3d0;
  font: 700 10px/1.3 system-ui, sans-serif;
  z-index: 2;
}
</style>
