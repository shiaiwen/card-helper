<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { SeatStateStore } from '../../features/seat-display/seat-state-store';
import type { SeatStateSnapshot } from '../../features/seat-display/seat-state';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import GameCardFace from './GameCardFace.vue';

const props = defineProps<{
  seatStateStore: SeatStateStore;
  gameCardCatalog: GameCardCatalog;
}>();
const snapshot = ref<Readonly<SeatStateSnapshot>>(props.seatStateStore.getSnapshot());
const unsubscribe = props.seatStateStore.subscribe((nextSnapshot) => {
  snapshot.value = nextSnapshot;
});
onBeforeUnmount(unsubscribe);

/** 只列出有已知牌的座位，全是牌背的座位没有信息量。 */
const visibleSeats = computed(() =>
  snapshot.value.seats.filter((seat) => seat.knownCards.length > 0)
);

function seatHandTotal(seat: SeatStateSnapshot['seats'][number]): number {
  return seat.knownCards.length + seat.unknownCardCount;
}

function seatTitle(seat: SeatStateSnapshot['seats'][number]): string {
  const identity = seat.isSelf ? '（自己）' : '';
  if (seat.playerName) return `${seat.playerName}${identity}`;
  return `${seat.displayOrder} 号位${identity}`;
}

function unknownPlaceholders(count: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(count, 12)) }, (_, index) => index);
}
</script>

<template>
  <section v-if="snapshot.inGame && visibleSeats.length" class="xc-vue-seat-hands">
    <h3 class="xc-vue-seat-hands__title">座位已知手牌</h3>
    <article
      v-for="seat in visibleSeats"
      :key="seat.seatId"
      class="xc-vue-seat-hand"
      :class="{ 'xc-vue-seat-hand--dead': !seat.isAlive }"
    >
      <header class="xc-vue-seat-hand__header">
        <span>{{ seatTitle(seat) }}</span>
        <span>手牌 {{ seatHandTotal(seat) }}</span>
      </header>
      <div
        v-if="seat.knownCards.length || seat.unknownCardCount"
        class="xc-vue-seat-hand__cards"
      >
        <GameCardFace
          v-for="card in seat.knownCards"
          :key="`k-${card.cardId}`"
          :card-id="card.cardId"
          :game-card-catalog="gameCardCatalog"
          :tags="card.tags"
          size="small"
        />
        <GameCardFace
          v-for="index in unknownPlaceholders(seat.unknownCardCount)"
          :key="`u-${seat.seatId}-${index}`"
          :card-id="0"
          :game-card-catalog="gameCardCatalog"
          size="small"
        />
        <span
          v-if="seat.unknownCardCount > 12"
          class="xc-vue-seat-hand__unknown-more"
          :title="`另有 ${seat.unknownCardCount - 12} 张未展开`"
        >
          +{{ seat.unknownCardCount - 12 }}
        </span>
      </div>
      <p v-else class="xc-vue-seat-hand__empty">暂无手牌</p>
    </article>
  </section>
</template>

<style scoped>
.xc-vue-seat-hands {
  clear: both;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(242, 222, 156, .25);
}
.xc-vue-seat-hands__title {
  margin: 0 2px 5px;
  color: #f2de9c;
  font-size: 12px;
  line-height: 1.4;
}
.xc-vue-seat-hand {
  margin: 3px 1px;
  padding: 5px;
  overflow: hidden;
  border: 1px solid rgba(242, 222, 156, .18);
  border-radius: 5px;
  background: rgba(30, 26, 23, .55);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .28), inset 0 1px 0 rgba(242, 222, 156, .06);
}
.xc-vue-seat-hand--dead { opacity: .58; }
.xc-vue-seat-hand__header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  color: #d8c69c;
  font-size: 11px;
}
.xc-vue-seat-hand__cards {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}
.xc-vue-seat-hand__unknown-more {
  padding: 2px 5px;
  border: 1px dashed rgba(201, 161, 93, .45);
  border-radius: 3px;
  color: #a99a7a;
  font: 11px/1.4 SimSun, serif;
}
.xc-vue-seat-hand__empty {
  margin: 3px 0;
  color: rgba(183, 170, 139, .7);
  font-size: 11px;
}
</style>
