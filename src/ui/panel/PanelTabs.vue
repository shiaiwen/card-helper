<script setup>
import { XIAOCHAO_PANEL_TABS } from './panel-model';

defineProps({
  activeTabId: {
    type: String,
    required: true,
  },
  toolsHasUpdate: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['select']);
</script>

<template>
  <nav
    class="xc-main-tabs xiaochao-panel__tabs"
    style="pointer-events: auto; flex: 0 0 auto"
    aria-label="小抄功能分类"
  >
    <button
      v-for="tab in XIAOCHAO_PANEL_TABS"
      :key="tab.id"
      type="button"
      role="tab"
      class="xc-main-tab"
      :aria-selected="tab.id === activeTabId"
      :class="{
        active: tab.id === activeTabId,
        'xc-main-tab--update': tab.id === 'tools' && toolsHasUpdate
      }"
      @click="$emit('select', tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>
