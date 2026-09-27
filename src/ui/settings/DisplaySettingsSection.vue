<script setup>
import { onBeforeUnmount, reactive } from 'vue';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
});

const settings = [
  {
    key: 'display.seatUiEnabled',
    label: '显示明牌',
    tooltip: '在其他武将牌下方显示明牌',
  },
  {
    key: 'display.recentCardsEnabled',
    label: '最近用牌',
    tooltip: '局内显示最近使用的一张牌',
  },
  {
    key: 'display.deckRecordEnabled',
    label: '牌堆记录',
    tooltip: '局内显示牌堆顶、牌堆底与弃牌记录入口',
  },
  {
    key: 'display.cardLabelsEnabled',
    label: '卡牌标签',
    tooltip: '在自己的手牌上显示卡牌来源标签',
  },
  {
    key: 'display.countdownEnabled',
    label: '出牌读秒',
    tooltip: '在游戏原有倒计时进度条上显示具体剩余秒数，不会隐藏游戏进度条',
  },
];

const values = reactive(Object.fromEntries(
  settings.map(({ key }) => [key, props.configStore.get(key)])
));
const unsubscribe = settings.map(({ key }) => props.configStore.subscribe(key, ({ value }) => {
  values[key] = value;
}));

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function updateSetting(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}
</script>

<template>
  <section class="xiaochao-settings-section" aria-labelledby="display-settings-title">
    <header class="xiaochao-settings-section__header">
      <h4 id="display-settings-title" class="xiaochao-settings-section__title">局内显示</h4>
      <span class="xiaochao-settings-section__summary">对局界面辅助信息</span>
    </header>
    <div class="xiaochao-settings-section__body">
      <div class="xiaochao-settings-grid">
        <label
          v-for="setting in settings"
          :key="setting.key"
          class="xiaochao-setting-switch"
          :data-tooltip="setting.tooltip"
          :title="setting.tooltip"
        >
          <span class="xiaochao-setting-switch__label">{{ setting.label }}</span>
          <input
            class="xiaochao-setting-switch__input"
            type="checkbox"
            :checked="values[setting.key]"
            @change="updateSetting(setting.key, $event)"
          >
          <span class="xiaochao-setting-switch__track" aria-hidden="true">
            <span class="xiaochao-setting-switch__thumb" />
            <span class="xiaochao-setting-switch__status">{{ values[setting.key] ? '开' : '关' }}</span>
          </span>
        </label>
      </div>
    </div>
  </section>
</template>
