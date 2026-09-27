<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import {
  formatPhase,
  formatShaRemaining,
  type TurnStatusStore
} from '../../features/turn-status/turn-status-store.ts';

const props = defineProps<{
  turnStatusStore: TurnStatusStore;
}>();

const snapshot = ref(props.turnStatusStore.getSnapshot());
const stop = props.turnStatusStore.subscribe((next) => {
  snapshot.value = next;
});
onBeforeUnmount(stop);
</script>

<template>
  <div class="xc-turn-status" aria-label="当前阶段与出杀次数">
    <span class="xc-turn-status__item" title="当前阶段">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
      </svg>
      {{ formatPhase(snapshot.phase) }}
    </span>
    <span class="xc-turn-status__item xc-turn-status__item--sha" title="当前行动角色本回合剩余出杀次数">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m11 19-6-6M5 21l-2-2M8 16l-4 4M9.5 17.5 21 6V3h-3L6.5 14.5" />
      </svg>
      剩余：{{ formatShaRemaining(snapshot.shaRemaining) }}
    </span>
  </div>
</template>

<style scoped>
.xc-turn-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 8px;
  margin: 0;
  padding: 6px 10px;
  pointer-events: auto;
  border-bottom: 1px solid rgba(242, 222, 156, .25);
  color: #f2de9c;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.xc-turn-status__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.xc-turn-status__item svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.xc-turn-status__item--sha {
  color: #f04155;
}
</style>
