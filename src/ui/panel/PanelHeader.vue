<script setup>
defineProps({
  collapsed: {
    type: Boolean,
    required: true,
  },
  platformLabel: {
    type: String,
    required: true,
  },
});

defineEmits(['toggle', 'drag-start']);
</script>

<template>
  <header
    id="header"
    class="xc-frame-header xiaochao-panel__header"
    @pointerdown="$emit('drag-start', $event)"
  >
    <span id="mini-label">三国杀小抄 · {{ platformLabel }}</span>
    <button
      type="button"
      id="toggle-me"
      class="xc-frame-toggle xiaochao-panel__toggle"
      :data-collapsed="collapsed ? '1' : '0'"
      :aria-expanded="String(!collapsed)"
      :aria-label="collapsed ? '展开小抄' : '折叠小抄'"
      :data-tooltip="collapsed ? '展开小抄' : '折叠小抄'"
      @pointerdown.stop
      @click="$emit('toggle')"
    >
      <span class="xc-frame-toggle__icon" aria-hidden="true">
        <span class="xc-frame-toggle__arrow xc-frame-toggle__arrow--bottom-left" />
        <span class="xc-frame-toggle__arrow xc-frame-toggle__arrow--top-right" />
      </span>
    </button>
  </header>
</template>
