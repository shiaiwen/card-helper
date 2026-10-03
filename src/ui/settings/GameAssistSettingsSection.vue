<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import {
  AUTO_BOT_ENABLED_KEY,
  AUTO_HG_ENABLED_KEY,
  BAI_SHENG_ENABLED_KEY,
  GAME_ASSIST_SWITCH_SETTINGS,
} from '../../features/extra-assist/extra-assist-settings';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
});

const values = reactive(Object.fromEntries(
  GAME_ASSIST_SWITCH_SETTINGS.map(({ key }) => [key, props.configStore.get(key)])
));
const hoverKey = ref('');
const hoverTip = computed(() => (
  GAME_ASSIST_SWITCH_SETTINGS.find((setting) => setting.key === hoverKey.value)?.tooltip || ''
));

const unsubscribe = [
  ...GAME_ASSIST_SWITCH_SETTINGS.map(({ key }) => (
    props.configStore.subscribe(key, ({ value }) => {
      values[key] = value;
    })
  )),
];

// 自动化入口已下线；同步关闭历史遗留的开启状态，避免功能隐藏后仍在后台运行。
for (const key of [AUTO_BOT_ENABLED_KEY, AUTO_HG_ENABLED_KEY, BAI_SHENG_ENABLED_KEY]) {
  if (props.configStore.get(key) === true) props.configStore.set(key, false);
}

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function updateSetting(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}

</script>

<template>
  <section class="xiaochao-settings-section" aria-label="辅助功能">
    <div class="xiaochao-settings-section__body">
      <div class="xiaochao-settings-grid xiaochao-display-switch-grid">
        <div
          v-for="setting in GAME_ASSIST_SWITCH_SETTINGS"
          :key="setting.key"
          class="xiaochao-block-switch xiaochao-game-assist-switch"
          :data-tooltip="setting.tooltip"
          @mouseenter="hoverKey = setting.key"
          @mouseleave="hoverKey = ''"
        >
          <span class="xiaochao-block-switch__label">
            {{ setting.label }}
          </span>
          <label class="xiaochao-block-switch__toggle" :data-tooltip="setting.tooltip">
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
      <p v-if="hoverTip" class="xiaochao-game-assist-tip">{{ hoverTip }}</p>
    </div>
  </section>
</template>

<style scoped>
.xiaochao-game-assist-switch {
  position: relative;
  pointer-events: auto;
}

.xiaochao-game-assist-tip {
  margin: 4px 0 0;
  padding: 5px 8px;
  border: 1px solid rgba(242, 222, 156, .5);
  border-radius: 5px;
  background: rgba(29, 27, 24, .96);
  color: #eee5d2;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-line;
  pointer-events: none;
}

</style>
