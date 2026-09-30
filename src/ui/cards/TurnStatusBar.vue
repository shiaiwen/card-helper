<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import {
  formatPhase,
  formatShaRemaining,
  type TurnStatusStore
} from '../../features/turn-status/turn-status-store.ts';

const props = defineProps<{
  turnStatusStore: TurnStatusStore;
  /** 折叠标题栏：上下两行，压窄长宽比。 */
  compact?: boolean;
}>();

const snapshot = ref(props.turnStatusStore.getSnapshot());
const stop = props.turnStatusStore.subscribe((next) => {
  snapshot.value = next;
});
onBeforeUnmount(stop);
</script>

<template>
  <div
    class="xc-turn-status"
    :class="{ 'xc-turn-status--compact': compact }"
    aria-label="当前阶段与出杀次数"
  >
    <span class="xc-turn-status__item" title="当前阶段">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
      </svg>
      {{ formatPhase(snapshot.phase) }}
    </span>
    <span
      class="xc-turn-status__item xc-turn-status__item--sha"
      title="当前行动角色本回合剩余出杀次数"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m11 19-6-6M5 21l-2-2M8 16l-4 4M9.5 17.5 21 6V3h-3L6.5 14.5" />
      </svg>
      <template v-if="compact">出杀次数 {{ formatShaRemaining(snapshot.shaRemaining) }}</template>
      <template v-else>剩余：{{ formatShaRemaining(snapshot.shaRemaining) }}</template>
    </span>
  </div>
</template>

<style scoped>
.xc-turn-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1 1 auto;
  min-width: 0;
  gap: 6px;
  margin: 0;
  padding: 0 2px 0 4px;
  pointer-events: none;
  color: #f2de9c;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.xc-turn-status--compact {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  padding: 4px 2px 4px 10px;
  font-size: 11px;
  line-height: 1.15;
  letter-spacing: 0.01em;
}

.xc-turn-status__item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xc-turn-status__item svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: 0 0 auto;
}

.xc-turn-status--compact .xc-turn-status__item svg {
  width: 11px;
  height: 11px;
}

.xc-turn-status__item--sha {
  color: #f04155;
  flex: 0 0 auto;
}

.xc-turn-status--compact .xc-turn-status__item--sha {
  font-size: 10px;
  font-weight: 800;
}
</style>
