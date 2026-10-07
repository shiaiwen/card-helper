<script setup>
/** 自动任务设置：总开关与各项跳过选项，可手动触发领取。 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import BaseDialog from '../dialog/BaseDialog.vue';
import {
  AUTO_TASK_ENABLED_KEY,
  AUTO_TASK_ENABLED_TOOLTIP,
  AUTO_TASK_SKIP_SETTINGS,
} from '../../features/auto-task/auto-task-settings';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
});

const isOpen = ref(false);
const enabled = ref(props.configStore.get(AUTO_TASK_ENABLED_KEY));
const skipValues = reactive(Object.fromEntries(
  AUTO_TASK_SKIP_SETTINGS.map(({ key }) => [key, props.configStore.get(key)])
));

const unsubscribe = [
  props.configStore.subscribe(AUTO_TASK_ENABLED_KEY, ({ value }) => {
    enabled.value = value;
  }),
  ...AUTO_TASK_SKIP_SETTINGS.map(({ key }) => props.configStore.subscribe(key, ({ value }) => {
    skipValues[key] = value;
  })),
];

const skipCount = computed(() => AUTO_TASK_SKIP_SETTINGS.filter(({ key }) => skipValues[key]).length);

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function updateEnabled(event) {
  props.configStore.set(AUTO_TASK_ENABLED_KEY, event.currentTarget.checked);
}

function updateSkip(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}
</script>

<template>
  <section class="xiaochao-settings-section" aria-label="自动领取">
    <div class="xiaochao-settings-section__body">
      <button
        type="button"
        class="xiaochao-block-entry"
        :data-tooltip="AUTO_TASK_ENABLED_TOOLTIP"
        @click="isOpen = true"
      >
        <span>自动领取</span>
        <span class="xiaochao-block-entry__count">{{ enabled ? `开·跳过${skipCount}` : '关' }}</span>
      </button>
    </div>
    <BaseDialog
      :open="isOpen"
      title="自动领取"
      dialog-class="xiaochao-block-dialog"
      @close="isOpen = false"
    >
      <section class="xiaochao-block-group">
        <h4 class="xiaochao-block-group__title">总开关</h4>
        <div class="xiaochao-block-group__grid">
          <div
            class="xiaochao-block-switch"
            :data-tooltip="AUTO_TASK_ENABLED_TOOLTIP"
          >
            <span class="xiaochao-block-switch__label">自动领取</span>
            <label
              class="xiaochao-block-switch__toggle"
              :data-tooltip="AUTO_TASK_ENABLED_TOOLTIP"
              :title="AUTO_TASK_ENABLED_TOOLTIP"
            >
              <input
                type="checkbox"
                aria-label="自动领取"
                :checked="enabled"
                @change="updateEnabled"
              >
              <span class="xiaochao-block-switch__slider" />
            </label>
          </div>
        </div>
      </section>
      <section class="xiaochao-block-group">
        <h4 class="xiaochao-block-group__title">跳过项（勾选 = 不领）</h4>
        <div class="xiaochao-block-group__grid">
          <label
            v-for="setting in AUTO_TASK_SKIP_SETTINGS"
            :key="setting.key"
            class="xiaochao-block-check"
            :class="{ 'xiaochao-block-check--disabled': !enabled }"
            :data-tooltip="setting.tooltip"
            :title="setting.tooltip"
          >
            <input
              type="checkbox"
              :aria-label="setting.label"
              :checked="skipValues[setting.key]"
              :disabled="!enabled"
              @change="updateSkip(setting.key, $event)"
            >
            <span class="xiaochao-block-check__box" />
            <span class="xiaochao-block-check__label">{{ setting.label }}</span>
          </label>
        </div>
      </section>
    </BaseDialog>
  </section>
</template>
