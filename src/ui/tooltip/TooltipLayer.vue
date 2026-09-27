<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { calculateTooltipPosition } from './tooltip-position';

const tooltipElement = ref();
const text = ref('');
const isVisible = ref(false);
const left = ref(0);
const top = ref(0);
const placement = ref('top');
let activeTarget;

onMounted(() => {
  document.addEventListener('mouseover', suppressLegacyTooltipEvent, true);
  document.addEventListener('mouseout', suppressLegacyTooltipEvent, true);
  // 旧版微端 Chromium 的 PointerEvent 支持不完整，鼠标事件作为兼容入口。
  document.addEventListener('mouseover', handlePointerOver, true);
  document.addEventListener('mouseout', handlePointerOut, true);
  document.addEventListener('pointerover', handlePointerOver, true);
  document.addEventListener('pointerout', handlePointerOut, true);
  document.addEventListener('focusin', handleFocusIn, true);
  document.addEventListener('focusout', handleFocusOut, true);
  window.addEventListener('resize', refreshPosition);
  window.addEventListener('scroll', refreshPosition, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('mouseover', suppressLegacyTooltipEvent, true);
  document.removeEventListener('mouseout', suppressLegacyTooltipEvent, true);
  document.removeEventListener('mouseover', handlePointerOver, true);
  document.removeEventListener('mouseout', handlePointerOut, true);
  document.removeEventListener('pointerover', handlePointerOver, true);
  document.removeEventListener('pointerout', handlePointerOut, true);
  document.removeEventListener('focusin', handleFocusIn, true);
  document.removeEventListener('focusout', handleFocusOut, true);
  window.removeEventListener('resize', refreshPosition);
  window.removeEventListener('scroll', refreshPosition, true);
});

/** 事件委托允许后续动态创建的按钮直接使用 data-tooltip，无需重复绑定监听器。 */
function findTooltipTarget(eventTarget) {
  if (!(eventTarget instanceof Element)) return null;
  return eventTarget.closest('[data-tooltip]');
}

/**
 * legacy 在 document 上监听 mouseover/mouseout 并创建第二个提示层。Vue 接管的
 * 面板内只阻断这两个旧提示事件，不影响 click、pointer 和游戏区域的事件。
 */
function suppressLegacyTooltipEvent(event) {
  const target = findTooltipTarget(event.target);
  if (target?.closest('#xiaochao-app')) event.stopPropagation();
}

function handlePointerOver(event) {
  const target = findTooltipTarget(event.target);
  if (target && !containsEventTarget(target, event.relatedTarget)) showTooltip(target);
}

function handlePointerOut(event) {
  if (activeTarget && !containsEventTarget(activeTarget, event.relatedTarget)) {
    hideTooltip(activeTarget);
  }
}

function handleFocusIn(event) {
  const target = findTooltipTarget(event.target);
  if (target) showTooltip(target);
}

function handleFocusOut(event) {
  if (activeTarget && !containsEventTarget(activeTarget, event.relatedTarget)) {
    hideTooltip(activeTarget);
  }
}

function containsEventTarget(container, eventTarget) {
  return eventTarget instanceof Node && container.contains(eventTarget);
}

function showTooltip(target) {
  const nextText = target.getAttribute('data-tooltip')?.trim();
  if (!nextText) return;
  activeTarget = target;
  text.value = nextText;
  isVisible.value = true;
  nextTick(refreshPosition);
}

function hideTooltip(target) {
  if (target !== activeTarget) return;
  activeTarget = undefined;
  isVisible.value = false;
}

function refreshPosition() {
  if (!activeTarget?.isConnected || !tooltipElement.value) {
    if (activeTarget && !activeTarget.isConnected) hideTooltip(activeTarget);
    return;
  }
  const targetBounds = activeTarget.getBoundingClientRect();
  const tooltipBounds = tooltipElement.value.getBoundingClientRect();
  const position = calculateTooltipPosition(
    targetBounds,
    { width: tooltipBounds.width, height: tooltipBounds.height },
    { width: window.innerWidth, height: window.innerHeight }
  );
  left.value = position.left;
  top.value = position.top;
  placement.value = position.placement;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-show="isVisible"
      ref="tooltipElement"
      class="xiaochao-tooltip"
      :class="`xiaochao-tooltip--${placement}`"
      :style="{ left: `${left}px`, top: `${top}px` }"
      role="tooltip"
    >
      {{ text }}
    </div>
  </Teleport>
</template>
