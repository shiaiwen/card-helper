<script setup>
import { onBeforeUnmount, ref } from 'vue';

const props = defineProps({
  clearRedDots: {
    type: Function,
    required: true,
  },
});

const pressed = ref(false);
const status = ref('');
let timer = 0;

onBeforeUnmount(() => window.clearTimeout(timer));

function onClick() {
  pressed.value = true;
  const result = props.clearRedDots();
  status.value = result.found
    ? (result.count ? `已清除 ${result.count}` : '没有红点')
    : '未就绪';
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    pressed.value = false;
    status.value = '';
  }, 1400);
}
</script>

<template>
  <section class="xiaochao-settings-section" aria-label="清除红点">
    <div class="xiaochao-settings-section__body">
      <button
        type="button"
        class="xiaochao-block-entry"
        :class="{ 'xiaochao-block-entry--flash': pressed }"
        data-tooltip="清除消不掉的红点"
        @click="onClick"
      >
        <span>清除红点</span>
        <span class="xiaochao-block-entry__count">{{ status }}</span>
      </button>
    </div>
  </section>
</template>
