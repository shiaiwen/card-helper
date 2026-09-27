<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { calculateDialogPosition } from './dialog-position';

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  anchorSelector: {
    type: String,
    default: '#createIframe',
  },
  closeOnBackdrop: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['close']);
const dialogElement = ref();
const titleId = `xiaochao-dialog-title-${Math.random().toString(36).slice(2)}`;
let previouslyFocusedElement;

watch(() => props.open, synchronizeNativeDialog);

onMounted(() => {
  synchronizeNativeDialog();
  window.addEventListener('resize', updatePosition);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePosition);
  closeNativeDialog();
});

/** Vue 状态是唯一真源；原生 dialog 只负责 top-layer、焦点圈定和 Esc。 */
function synchronizeNativeDialog() {
  const dialog = dialogElement.value;
  if (!dialog) return;
  if (props.open && !dialog.open) {
    previouslyFocusedElement = document.activeElement;
    dialog.showModal();
    nextTick(updatePosition);
  } else if (!props.open && dialog.open) {
    closeNativeDialog();
  }
}

function requestClose() {
  emit('close');
}

function handleCancel(event) {
  event.preventDefault();
  requestClose();
}

function handleBackdropClick(event) {
  if (props.closeOnBackdrop && event.target === dialogElement.value) requestClose();
}

function closeNativeDialog() {
  const dialog = dialogElement.value;
  if (dialog?.open) dialog.close();
  if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
  previouslyFocusedElement = undefined;
}

function updatePosition() {
  const dialog = dialogElement.value;
  if (!dialog?.open) return;
  const anchor = document.querySelector(props.anchorSelector);
  const anchorBounds = anchor?.getBoundingClientRect() || {
    left: 0,
    right: window.innerWidth,
    top: 0,
    bottom: window.innerHeight,
  };
  const dialogBounds = dialog.getBoundingClientRect();
  const position = calculateDialogPosition(
    anchorBounds,
    { width: dialogBounds.width, height: dialogBounds.height },
    { width: window.innerWidth, height: window.innerHeight }
  );
  dialog.style.left = `${position.left}px`;
  dialog.style.top = `${position.top}px`;
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogElement"
      class="xiaochao-dialog"
      :aria-labelledby="titleId"
      @cancel="handleCancel"
      @click="handleBackdropClick"
    >
      <header class="xiaochao-dialog__header">
        <h2 :id="titleId" class="xiaochao-dialog__title">{{ title }}</h2>
        <button
          type="button"
          class="xiaochao-dialog__close"
          :aria-label="`关闭${title}`"
          @click="requestClose"
        >
          ×
        </button>
      </header>
      <section class="xiaochao-dialog__content">
        <slot />
      </section>
      <footer v-if="$slots.footer" class="xiaochao-dialog__footer">
        <slot name="footer" />
      </footer>
    </dialog>
  </Teleport>
</template>
