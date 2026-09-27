<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { DeckRecordStore } from '../../features/deck-record/deck-record-store.ts';
import type {
  DeckRecordInteraction,
  DeckRecordListKind
} from '../../features/deck-record/deck-record-interaction.ts';
import type { SeatStateStore } from '../../features/seat-display/seat-state-store.ts';

type SortMode = 'suit-type-number' | 'type-suit-number' | 'number-suit-type';

/**
 * 局内顶/底/弃按钮与官方牌面弹层由 native-deck-record-controller 负责。
 * 这里只处理快捷键 1–5，避免与 Laya 入口叠两套 DOM 按钮。
 */
const props = defineProps<{
  configStore: XiaochaoConfigStore;
  deckRecordStore: DeckRecordStore;
  deckRecordInteraction: DeckRecordInteraction;
  seatStateStore: SeatStateStore;
}>();

const enabled = ref(props.configStore.get('display.deckHudEnabled'));
const inGame = ref(props.seatStateStore.getSnapshot().inGame);

const stops = [
  props.seatStateStore.subscribe((value) => {
    inGame.value = value.inGame;
    if (!value.inGame) props.deckRecordInteraction.setActiveList(null);
  }),
  props.configStore.subscribe('display.deckHudEnabled', ({ value }) => {
    enabled.value = value;
    if (!value) props.deckRecordInteraction.setActiveList(null);
  })
];

const shortcuts: Record<string, { list: DeckRecordListKind; sortMode?: SortMode }> = {
  '1': { list: 'top' },
  '2': { list: 'bottom' },
  '3': { list: 'discard', sortMode: 'suit-type-number' },
  '4': { list: 'discard', sortMode: 'type-suit-number' },
  '5': { list: 'discard', sortMode: 'number-suit-type' }
};

const canHandle = computed(() => enabled.value && inGame.value);

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('blur', closeList);
});
onBeforeUnmount(() => {
  stops.forEach((stop) => stop());
  window.removeEventListener('keydown', handleKeyDown, true);
  window.removeEventListener('keyup', handleKeyUp, true);
  window.removeEventListener('blur', closeList);
});

function handleKeyDown(event: KeyboardEvent): void {
  if (!canHandle.value || event.repeat || isTypingTarget(event.target)) return;
  const shortcut = shortcuts[event.key];
  if (!shortcut) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (shortcut.sortMode) props.configStore.set('display.discardSortMode', shortcut.sortMode);
  props.deckRecordInteraction.setActiveList(shortcut.list);
}
function handleKeyUp(event: KeyboardEvent): void {
  if (shortcuts[event.key]) closeList();
}
function closeList(): void {
  props.deckRecordInteraction.setActiveList(null);
}
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}
</script>

<template>
  <!-- 快捷键桥；可见 UI 在 Laya native controller。 -->
  <span class="xc-deck-shortcut-bridge" aria-hidden="true" />
</template>

<style scoped>
.xc-deck-shortcut-bridge {
  display: none;
}
</style>
