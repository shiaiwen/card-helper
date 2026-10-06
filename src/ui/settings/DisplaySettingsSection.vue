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
    key: 'display.deckHudEnabled',
    label: '局内牌堆',
    tooltip: '在游戏右上角轮次信息旁显示最近用牌与顶/底/弃入口，数字键 1–5 快速查看',
  },
  {
    key: 'display.deckRecordEnabled',
    label: '牌堆记录',
    tooltip: '在常规页显示牌堆顶、牌堆底与本回合弃牌',
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
  {
    key: 'cards.handSortEnabled',
    label: '扩展理牌',
    tooltip: '扩展原生整理手牌按钮\n可按类型花色点数整理\n长按可拖动，双击可锁定',
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
      <div class="xiaochao-settings-grid xiaochao-display-switch-grid">
        <div
          v-for="setting in settings"
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
            <span class="xiaochao-block-switch__state" aria-hidden="true" />
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
