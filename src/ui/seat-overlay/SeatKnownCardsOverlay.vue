<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { SeatStateStore } from '../../features/seat-display/seat-state-store.ts';
import type { SeatStateSnapshot } from '../../features/seat-display/seat-state.ts';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import { calculateSeatOverlayLayout } from '../../features/seat-display/seat-overlay-layout.ts';
import {
  observeGameViewport,
  type GameViewportBounds
} from '../../features/seat-display/game-viewport-observer.ts';
import GameCardFace from '../cards/GameCardFace.vue';

const props = defineProps<{
  configStore: XiaochaoConfigStore;
  seatStateStore: SeatStateStore;
  gameCardCatalog: GameCardCatalog;
}>();
const snapshot = ref<Readonly<SeatStateSnapshot>>(props.seatStateStore.getSnapshot());
const enabled = ref(props.configStore.get('display.seatUiEnabled'));
const viewport = ref<GameViewportBounds>({
  left: 0,
  top: 0,
  width: window.innerWidth,
  height: window.innerHeight
});
let stopViewportObservation: (() => void) | undefined;
const unsubscribeSeatState = props.seatStateStore.subscribe((nextSnapshot) => {
  snapshot.value = nextSnapshot;
});
const unsubscribeConfig = props.configStore.subscribe('display.seatUiEnabled', ({ value }) => {
  enabled.value = value;
});

const overlayEntries = computed(() => {
  const orderedSeats = orderSeatsFromSelf(snapshot.value);
  const visibleSeats = orderedSeats.filter((seat) => !seat.isSelf);
  const layoutSeatCount = visibleSeats.length + 1;
  const positions = calculateSeatOverlayLayout(layoutSeatCount, viewport.value);
  return visibleSeats.map((seat, index) => ({
    seat,
    position: positionFromNativeAnchor(seat.anchor) ?? positions[index]
  }))
    .filter((entry) => entry.position && entry.seat.knownCards.length > 0);
});

function positionFromNativeAnchor(anchor: SeatStateSnapshot['seats'][number]['anchor']) {
  if (!anchor) return null;
  const scaleX = viewport.value.width / anchor.stageWidth;
  const scaleY = viewport.value.height / anchor.stageHeight;
  if (!(scaleX > 0 && scaleY > 0)) return null;
  const centerX = (anchor.x + anchor.width / 2) * scaleX;
  const side = centerX < viewport.value.width * .34
    ? 'left'
    : centerX > viewport.value.width * .66 ? 'right' : 'top';
  const width = Math.max(112, Math.min(190, anchor.width * scaleX));
  return {
    left: Math.max(0, Math.min(viewport.value.width - width, centerX - width / 2)),
    top: Math.max(0, Math.min(viewport.value.height - 34, (anchor.y + anchor.height) * scaleY - 4)),
    width,
    side
  } as const;
}
const isActive = computed(() => (
  enabled.value
  && snapshot.value.inGame
  && overlayEntries.value.length > 0
));
const rootStyle = computed(() => ({
  left: `${viewport.value.left}px`,
  top: `${viewport.value.top}px`,
  width: `${viewport.value.width}px`,
  height: `${viewport.value.height}px`
}));
onMounted(() => {
  stopViewportObservation = observeGameViewport((nextViewport) => {
    viewport.value = nextViewport;
  });
});
onBeforeUnmount(() => {
  unsubscribeSeatState();
  unsubscribeConfig();
  stopViewportObservation?.();
});

function orderSeatsFromSelf(state: Readonly<SeatStateSnapshot>) {
  const seats = [...state.seats];
  const selfIndex = seats.findIndex((seat) => seat.seatId === state.selfSeatId);
  return selfIndex < 0 ? seats : [...seats.slice(selfIndex), ...seats.slice(0, selfIndex)];
}

</script>

<template>
  <div
    v-show="isActive"
    id="xiaochao-vue-seat-overlay"
    :style="rootStyle"
    aria-hidden="true"
  >
    <div
      v-for="entry in overlayEntries"
      :key="entry.seat.seatId"
      class="xc-seat-known-cards"
      :class="`xc-seat-known-cards--${entry.position.side}`"
      :style="{
        left: `${entry.position.left}px`,
        top: `${entry.position.top}px`,
        width: `${entry.position.width}px`
      }"
    >
      <span class="xc-seat-known-cards__header">
        <span class="xc-seat-known-cards__title">{{ entry.seat.displayOrder }}号位明牌</span>
        <span
          v-if="entry.seat.unknownCardCount"
          class="xc-seat-known-cards__unknown"
          :title="`另有 ${entry.seat.unknownCardCount} 张未知手牌`"
        >
          <i aria-hidden="true" />×{{ entry.seat.unknownCardCount }}
        </span>
      </span>
      <span class="xc-seat-known-cards__list">
        <GameCardFace
          v-for="card in entry.seat.knownCards"
          :key="card.cardId"
          :card-id="card.cardId"
          :game-card-catalog="gameCardCatalog"
          :tags="card.tags"
          size="tiny"
        />
      </span>
    </div>
  </div>
</template>

<style scoped>
#xiaochao-vue-seat-overlay {
  position: fixed;
  z-index: 2147483500;
  overflow: visible;
  pointer-events: none;
}
.xc-seat-known-cards {
  position: absolute;
  box-sizing: border-box;
  min-height: 30px;
  padding: 3px;
  overflow: visible;
  border: 1px solid rgba(242, 222, 156, .58);
  border-radius: 4px;
  background: rgba(30, 26, 23, .82);
  box-shadow: 0 2px 7px rgba(0, 0, 0, .32);
  color: #f2de9c;
  font: 11px/1.35 SimSun, serif;
  text-align: left;
}
.xc-seat-known-cards__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  margin-bottom: 2px;
}
.xc-seat-known-cards__title {
  color: #c9a15d;
  font-weight: 700;
}
.xc-seat-known-cards__unknown {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: rgba(214, 197, 156, .66);
  font-size: 10px;
  white-space: nowrap;
}
.xc-seat-known-cards__unknown i {
  display: inline-block;
  width: 8px;
  height: 12px;
  border: 1px solid rgba(224, 198, 132, .54);
  border-radius: 2px;
  background:
    repeating-linear-gradient(45deg, rgba(230, 196, 119, .22) 0 1px, transparent 1px 3px),
    #3a261b;
  box-shadow: 1px 0 #211710, 2px 0 rgba(224, 198, 132, .35);
}
.xc-seat-known-cards__list {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
</style>
