<script setup lang="ts">
/** 自助观星外链入口。 */
import { createElectronPlatform } from '../../adapters/electron-platform';
import { createUserscriptPlatform } from '../../adapters/userscript-platform';

const props = defineProps<{ platform: 'electron' | 'userscript' }>();

function openPage(): void {
  const adapter = props.platform === 'electron'
    ? createElectronPlatform()
    : createUserscriptPlatform();
  void adapter.openExternal('https://gx.95chong.cn/');
}
</script>

<template>
  <button
    type="button"
    class="xiaochao-block-entry xiaochao-block-entry--center"
    data-tooltip="在浏览器新页面打开自助观星"
    @click="openPage"
  >
    <span>自助观星</span>
  </button>
</template>
