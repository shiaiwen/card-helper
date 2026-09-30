<script setup>
import { onBeforeUnmount, reactive, ref } from 'vue';
import {
  ROGUE_OPEN_SHOP_LABEL,
  ROGUE_OPEN_SHOP_TOOLTIP,
  ROGUE_SHOP_PREVIEW_LABEL,
  ROGUE_SHOP_PREVIEW_TOOLTIP,
  ROGUE_SWITCH_SETTINGS,
} from '../../features/rogue/rogue-settings';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
  openShop: {
    type: Function,
    required: true,
  },
  getShopPreview: {
    type: Function,
    default: null,
  },
  subscribeShopPreview: {
    type: Function,
    default: null,
  },
});

const values = reactive(Object.fromEntries(
  ROGUE_SWITCH_SETTINGS.map(({ key }) => [key, props.configStore.get(key)])
));
const unsubscribe = ROGUE_SWITCH_SETTINGS.map(({ key }) => props.configStore.subscribe(key, ({ value }) => {
  values[key] = value;
}));

const previewItems = ref(
  typeof props.getShopPreview === 'function' ? [...props.getShopPreview()] : []
);
const stopPreview = typeof props.subscribeShopPreview === 'function'
  ? props.subscribeShopPreview((items) => {
    previewItems.value = Array.isArray(items) ? [...items] : [];
  })
  : null;

onBeforeUnmount(() => {
  unsubscribe.forEach((stop) => stop());
  if (typeof stopPreview === 'function') stopPreview();
});

function updateSetting(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}

function handleOpenShop() {
  props.openShop();
}
</script>

<template>
  <section class="xiaochao-settings-section xiaochao-rogue-section" aria-label="山河图">
    <header class="xiaochao-settings-section__header">
      <h4 class="xiaochao-settings-section__title">山河图辅助</h4>
      <span class="xiaochao-settings-section__summary">地图透视 · 对白 · 集市</span>
    </header>
    <div class="xiaochao-settings-section__body">
      <div class="xiaochao-settings-grid xiaochao-rogue-switch-grid">
        <div
          v-for="setting in ROGUE_SWITCH_SETTINGS"
          :key="setting.key"
          class="xiaochao-block-switch"
          :data-tooltip="setting.tooltip"
        >
          <span class="xiaochao-block-switch__label">{{ setting.label }}</span>
          <label class="xiaochao-block-switch__toggle">
            <input
              type="checkbox"
              :aria-label="setting.label"
              :checked="values[setting.key]"
              @change="updateSetting(setting.key, $event)"
            >
            <span class="xiaochao-block-switch__slider" />
            <span class="xiaochao-block-switch__state" aria-hidden="true" />
          </label>
        </div>
      </div>
      <div
        v-if="previewItems.length"
        class="xiaochao-rogue-shop-preview"
        :data-tooltip="ROGUE_SHOP_PREVIEW_TOOLTIP"
        aria-label="集市透视"
      >
        <div class="xiaochao-rogue-shop-preview__title">{{ ROGUE_SHOP_PREVIEW_LABEL }}</div>
        <div class="xiaochao-rogue-shop-preview__list" role="list">
          <button
            v-for="item in previewItems"
            :key="item.id"
            type="button"
            class="xiaochao-rogue-shop-preview__item"
            :data-level="item.level >= 1 && item.level <= 4 ? item.level : 0"
            :title="item.title || item.label"
            role="listitem"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <button
        type="button"
        class="xiaochao-block-entry xiaochao-block-entry--center xiaochao-rogue-shop-btn"
        :data-tooltip="ROGUE_OPEN_SHOP_TOOLTIP"
        @click="handleOpenShop"
      >
        <span>{{ ROGUE_OPEN_SHOP_LABEL }}</span>
      </button>
    </div>
  </section>
</template>
