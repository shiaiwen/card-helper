<script setup>
/**
 * 面板标题栏：左侧插槽展示回合/出杀等状态，右侧折叠按钮。
 * pointerdown 冒泡给父级启动拖拽；折叠按钮自身 stop 以免误拖。
 */
defineProps({
  collapsed: {
    type: Boolean,
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
    <div class="xc-frame-header__status">
      <slot />
    </div>
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
