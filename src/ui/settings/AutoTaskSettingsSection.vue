<script setup>
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
  autoTaskController: {
    type: Object,
    default: null,
  },
});

const isOpen = ref(false);
const enabled = ref(props.configStore.get(AUTO_TASK_ENABLED_KEY));
const skipValues = reactive(Object.fromEntries(
  AUTO_TASK_SKIP_SETTINGS.map(({ key }) => [key, props.configStore.get(key)])
));
const status = ref(props.autoTaskController?.getStatus?.() ?? {
  phase: 'idle',
  lastReason: '',
  lastStartedAt: 0,
  lastFinishedAt: 0,
  message: '未安装',
});

const unsubscribe = [
  props.configStore.subscribe(AUTO_TASK_ENABLED_KEY, ({ value }) => {
    enabled.value = value;
  }),
  ...AUTO_TASK_SKIP_SETTINGS.map(({ key }) => props.configStore.subscribe(key, ({ value }) => {
    skipValues[key] = value;
  })),
];
if (props.autoTaskController?.subscribe) {
  unsubscribe.push(props.autoTaskController.subscribe((next) => {
    status.value = next;
  }));
}

const skipCount = computed(() => AUTO_TASK_SKIP_SETTINGS.filter(({ key }) => skipValues[key]).length);
const statusText = computed(() => {
  const current = status.value;
  if (!enabled.value) return '总开关关闭';
  return current.message || '空闲';
});

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function updateEnabled(event) {
  props.configStore.set(AUTO_TASK_ENABLED_KEY, event.currentTarget.checked);
}

function updateSkip(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}

function runNow() {
  props.autoTaskController?.schedule?.('switch', true);
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
            <label class="xiaochao-block-switch__toggle">
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
        <p class="xiaochao-auto-task-status">状态：{{ statusText }}</p>
        <button
          type="button"
          class="xiaochao-auto-task-run"
          :disabled="!enabled"
          @click="runNow"
        >
          立即领取
        </button>
      </section>
      <section class="xiaochao-block-group">
        <h4 class="xiaochao-block-group__title">跳过项（开启 = 不领）</h4>
        <div class="xiaochao-block-group__grid">
          <div
            v-for="setting in AUTO_TASK_SKIP_SETTINGS"
            :key="setting.key"
            class="xiaochao-block-switch"
            :data-tooltip="setting.tooltip"
          >
            <span class="xiaochao-block-switch__label">{{ setting.label }}</span>
            <label class="xiaochao-block-switch__toggle">
              <input
                type="checkbox"
                :aria-label="setting.label"
                :checked="skipValues[setting.key]"
                :disabled="!enabled"
                @change="updateSkip(setting.key, $event)"
              >
              <span class="xiaochao-block-switch__slider" />
            </label>
          </div>
        </div>
      </section>
    </BaseDialog>
  </section>
</template>

<style scoped>
.xiaochao-auto-task-status {
  margin: 8px 0 0;
  color: #c9c1b1;
  font-size: 12px;
  line-height: 1.4;
}

.xiaochao-auto-task-run {
  margin-top: 8px;
  padding: 4px 10px;
  border: 1px solid rgba(242, 222, 156, 0.45);
  border-radius: 4px;
  background: rgba(57, 47, 34, 0.85);
  color: #f2de9c;
  cursor: pointer;
}

.xiaochao-auto-task-run:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
