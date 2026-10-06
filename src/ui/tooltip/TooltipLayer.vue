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
  const element = eventTarget instanceof Element
    ? eventTarget
    : eventTarget instanceof Node
      ? eventTarget.parentElement
      : null;
  if (!element) return null;
  return element.closest('[data-tooltip]');
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
  moveIntoTopLayerHost(target);
  isVisible.value = true;
  nextTick(refreshPosition);
}

/** 模态 dialog 位于浏览器顶层，body 下的提示层会被盖住，需随目标进入同一个 dialog。 */
function moveIntoTopLayerHost(target) {
  const element = tooltipElement.value;
  if (!element) return;
  const host = target.closest('dialog[open]') || document.body;
  if (element.parentNode !== host) host.appendChild(element);
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
