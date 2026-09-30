<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { openGuanxingPage } from '../legacy/prepare-legacy-tab-panes';
import { startToolsIdentitySync } from './tools-identity';

let stopIdentitySync: (() => void) | undefined;

onMounted(() => {
  stopIdentitySync = startToolsIdentitySync();
});

onBeforeUnmount(() => {
  stopIdentitySync?.();
});
</script>

<template>
  <section class="xiaochao-settings-section" aria-label="自助观星">
    <div class="xiaochao-settings-section__body">
      <button
        type="button"
        class="xiaochao-block-entry xiaochao-block-entry--center"
        data-tooltip="在微端窗口打开观星页面"
        @click="openGuanxingPage"
      >
        <span>自助观星</span>
      </button>
      <div id="xiaochao-tools-identity" class="xiaochao-tools-identity">
        <!-- 文案由脚本写入，模板不要写死，否则会被 Vue 盖掉 -->
        <div class="uuid id" id="uuid"></div>
        <div class="xiaochao-tools-identity__divider" aria-hidden="true"></div>
        <div class="uuid nickName" id="nickName"></div>
      </div>
    </div>
  </section>
</template>
