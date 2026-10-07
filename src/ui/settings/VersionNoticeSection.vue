<script setup lang="ts">
/** 版本更新提示：展示远程更新信息与打开下载页。 */
import { onBeforeUnmount, ref } from 'vue';
import type { UpdateNoticeController, UpdateNoticeSnapshot } from '../../features/update-notice';
import { getXiaochaoVersion, XIAOCHAO_UPDATE_PAGE_URL } from '../../features/update-notice';

const props = defineProps<{
  updateNoticeController: UpdateNoticeController | null;
}>();

const snapshot = ref<UpdateNoticeSnapshot>(
  props.updateNoticeController?.getSnapshot() ?? {
    currentVersion: getXiaochaoVersion(),
    latestVersion: null,
    notes: '',
    pageUrl: XIAOCHAO_UPDATE_PAGE_URL,
    hasUpdate: false,
    dialogOpen: false,
    failureMessage: ''
  }
);

const checking = ref(false);
const hint = ref('');

const unsubscribe = props.updateNoticeController?.subscribe((next) => {
  snapshot.value = next;
});

onBeforeUnmount(() => unsubscribe?.());

function openPage(): void {
  void props.updateNoticeController?.openUpdatePage();
}

async function onVersionClick(): Promise<void> {
  if (snapshot.value.hasUpdate) {
    openPage();
    return;
  }
  if (checking.value) return;
  checking.value = true;
  hint.value = '';
  try {
    const next = await props.updateNoticeController?.checkNow();
    if (!next || next.hasUpdate) return;
    hint.value = next.latestVersion ? '已是最新' : (next.failureMessage || '检查失败');
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <section class="xiaochao-settings-section" aria-label="小抄版本">
    <div class="xiaochao-settings-section__body">
      <div class="xiaochao-version-row">
        <span>小抄 {{ snapshot.currentVersion }}</span>
        <button
          type="button"
          class="xiaochao-version-row__update"
          :data-tooltip="snapshot.latestVersion ? `线上 ${snapshot.latestVersion}` : '检查门户上的版本'"
          @click="onVersionClick"
        >
          {{ checking ? '正在检查' : snapshot.hasUpdate ? '有更新' : '检查更新' }}
        </button>
        <span v-if="hint">{{ hint }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.xiaochao-version-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 4px 0 2px;
  color: #f2de9c;
  font-size: 13px;
  line-height: 1.4;
}
.xiaochao-version-row__update {
  padding: 1px 7px;
  border: 1px solid rgba(217, 0, 0, 0.55);
  border-radius: 10px;
  background: rgba(217, 0, 0, 0.16);
  color: #ffb4b4;
  font-size: 11px;
  cursor: pointer;
}
.xiaochao-version-dialog__lead,
.xiaochao-version-dialog__notes {
  margin: 0 0 8px;
  color: #c9c1b1;
  font-size: 13px;
  line-height: 1.45;
}
.xiaochao-version-dialog__button {
  padding: 4px 10px;
  border: 1px solid rgba(242, 222, 156, 0.45);
  border-radius: 4px;
  background: rgba(57, 47, 34, 0.85);
  color: #f2de9c;
  cursor: pointer;
}
.xiaochao-version-dialog__button--primary {
  border-color: rgba(242, 222, 156, 0.7);
  background: rgba(90, 72, 48, 0.95);
}
</style>
