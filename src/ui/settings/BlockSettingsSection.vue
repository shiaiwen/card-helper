<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import BaseDialog from '../dialog/BaseDialog.vue';
import {
  ALL_BLOCK_SETTINGS,
  BLOCK_EFFECT_SETTINGS,
  BLOCK_OTHER_SETTINGS,
} from '../../features/block-effects/block-effect-settings';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
});

const groups = [
  { id: 'effect', title: '特效屏蔽（开启以屏蔽）', settings: BLOCK_EFFECT_SETTINGS },
  { id: 'other', title: '其他屏蔽（开启以屏蔽）', settings: BLOCK_OTHER_SETTINGS },
];

const isOpen = ref(false);
const values = reactive(Object.fromEntries(
  ALL_BLOCK_SETTINGS.map(({ key }) => [key, props.configStore.get(key)])
));
const unsubscribe = ALL_BLOCK_SETTINGS.map(({ key }) => props.configStore.subscribe(key, ({ value }) => {
  values[key] = value;
}));
const enabledCount = computed(() => ALL_BLOCK_SETTINGS.filter(({ key }) => values[key]).length);
const allEnabled = computed(() => enabledCount.value === ALL_BLOCK_SETTINGS.length);

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function updateSetting(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}

function setAll(enabled) {
  for (const { key } of ALL_BLOCK_SETTINGS) {
    props.configStore.set(key, enabled);
  }
}

function toggleSelectAll() {
  setAll(!allEnabled.value);
}
</script>

<template>
  <section class="xiaochao-settings-section" aria-label="屏蔽设置">
    <div class="xiaochao-settings-section__body">
      <button
        type="button"
        class="xiaochao-block-entry"
        data-tooltip="屏蔽各种恼人的元素"
        @click="isOpen = true"
      >
        <span>屏蔽设置</span>
        <span class="xiaochao-block-entry__count">{{ enabledCount }}/{{ ALL_BLOCK_SETTINGS.length }}</span>
      </button>
    </div>
    <BaseDialog
      :open="isOpen"
      title="屏蔽设置"
      dialog-class="xiaochao-block-dialog"
      @close="isOpen = false"
    >
      <div class="xiaochao-block-select-bar">
        <button
          type="button"
          class="xiaochao-block-select-btn"
          :data-tooltip="allEnabled ? '关闭全部屏蔽项' : '开启全部屏蔽项'"
          @click="toggleSelectAll"
        >
          {{ allEnabled ? '一键取消' : '一键全选' }}
        </button>
      </div>
      <section
        v-for="group in groups"
        :key="group.id"
        class="xiaochao-block-group"
      >
        <h4 class="xiaochao-block-group__title">{{ group.title }}</h4>
        <div class="xiaochao-block-group__grid">
          <div
            v-for="setting in group.settings"
            :key="setting.key"
            class="xiaochao-block-switch"
            :data-tooltip="setting.tooltip"
          >
            <span class="xiaochao-block-switch__label">{{ setting.label }}</span>
            <label
              class="xiaochao-block-switch__toggle"
              :data-tooltip="setting.tooltip"
              :title="setting.tooltip"
            >
              <input
                type="checkbox"
                :aria-label="setting.label"
                :checked="values[setting.key]"
                @change="updateSetting(setting.key, $event)"
              >
              <span class="xiaochao-block-switch__slider" />
            </label>
          </div>
        </div>
      </section>
    </BaseDialog>
  </section>
</template>
