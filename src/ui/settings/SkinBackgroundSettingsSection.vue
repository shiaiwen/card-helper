<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import BaseDialog from '../dialog/BaseDialog.vue';
import {
  ALL_SKIN_BACKGROUND_SETTINGS,
  BACKGROUND_SETTINGS,
  SKIN_SETTINGS,
} from '../../features/skin-background/skin-background-settings';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
});

const groups = [
  { id: 'skin', title: '皮肤设置', settings: SKIN_SETTINGS },
  { id: 'background', title: '背景设置', settings: BACKGROUND_SETTINGS },
];

const isOpen = ref(false);
const values = reactive(Object.fromEntries(
  ALL_SKIN_BACKGROUND_SETTINGS.map(({ key }) => [key, props.configStore.get(key)])
));
const unsubscribe = ALL_SKIN_BACKGROUND_SETTINGS.map(({ key }) => props.configStore.subscribe(key, ({ value }) => {
  values[key] = value;
}));
const enabledCount = computed(() => ALL_SKIN_BACKGROUND_SETTINGS.filter(({ key }) => values[key]).length);

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function isVisible(setting) {
  return !setting.visibleWhen || values[setting.visibleWhen];
}

function updateSetting(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}
</script>

<template>
  <section class="xiaochao-settings-section" aria-label="皮肤与背景">
    <div class="xiaochao-settings-section__body">
      <button
        type="button"
        class="xiaochao-block-entry"
        :data-tooltip="'本地解锁自己与他人的武将皮肤\n本地解锁官方主题背景\n本地解锁将任意皮肤做背景'"
        @click="isOpen = true"
      >
        <span>皮肤与背景</span>
        <span class="xiaochao-block-entry__count">{{ enabledCount }}/{{ ALL_SKIN_BACKGROUND_SETTINGS.length }}</span>
      </button>
    </div>
    <BaseDialog
      :open="isOpen"
      title="皮肤与背景"
      dialog-class="xiaochao-block-dialog"
      @close="isOpen = false"
    >
      <section
        v-for="group in groups"
        :key="group.id"
        class="xiaochao-block-group"
      >
        <h4 class="xiaochao-block-group__title">{{ group.title }}</h4>
        <div class="xiaochao-block-group__grid">
          <template v-for="setting in group.settings" :key="setting.key">
            <div
              v-if="isVisible(setting)"
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
                <span class="xiaochao-block-switch__state" />
              </label>
            </div>
          </template>
        </div>
      </section>
    </BaseDialog>
  </section>
</template>
