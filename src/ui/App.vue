<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
// Vite/Vue resolves these SFC imports at build time; TS may still complain without
// the project's Vue shim declarations, so suppress the false-positive here.
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import PanelHeader from './panel/PanelHeader.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import PanelTabs from './panel/PanelTabs.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import TooltipLayer from './tooltip/TooltipLayer.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import DisplaySettingsSection from './settings/DisplaySettingsSection.vue';
import BlockSettingsSection from './settings/BlockSettingsSection.vue';
import ClearRedDotSection from './settings/ClearRedDotSection.vue';
import GuanxingEntry from './settings/GuanxingEntry.vue';
import SkinBackgroundSettingsSection from './settings/SkinBackgroundSettingsSection.vue';
import AutoTaskSettingsSection from './settings/AutoTaskSettingsSection.vue';
import RogueSettingsSection from './settings/RogueSettingsSection.vue';
import GameAssistSettingsSection from './settings/GameAssistSettingsSection.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import VersionNoticeSection from './settings/VersionNoticeSection.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import DeckRecordSection from './cards/DeckRecordSection.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import DeckRecordOverlay from './deck-record/DeckRecordOverlay.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import SkillAssistSection from './cards/SkillAssistSection.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import TurnStatusBar from './cards/TurnStatusBar.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import BaseDialog from './dialog/BaseDialog.vue';
import {
  createXiaochaoPanelModel,
  XIAOCHAO_PANEL_TABS,
  type XiaochaoPanelTabId
} from './panel/panel-model';
import type { TurnStatusStore } from '../features/turn-status/turn-status-store';
import type { XiaochaoConfigStore } from '../config/config-store';
import type { SeatStateStore } from '../features/seat-display/seat-state-store';
import type { RecentCardStore } from '../features/recent-cards/recent-card-store';
import type { GameCardCatalog } from '../features/cards/game-card-catalog';
import type { DeckRecordStore } from '../features/deck-record/deck-record-store';
import type { DeckRecordInteraction } from '../features/deck-record/deck-record-interaction';
import type { SkillAssistStore } from '../features/skill-assist/skill-assist-store';
import type { PeixiuRouteStore } from '../features/extra-assist/peixiu-route-store';
import type { AutoTaskController } from '../features/auto-task';
import type { RogueController } from '../features/rogue';
import type { UpdateNoticeController } from '../features/update-notice';
import type { XiaochaoPanelLayout } from './mount-xiaochao-app';
import { showToast } from './toast/show-toast';
import { createElectronPlatform } from '../adapters/electron-platform';
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { constrainPanelPosition, hasExceededDragThreshold, shouldDockToRight } from './panel/panel-drag';
import {
  getOwnedPanelLayoutValue,
  setOwnedPanelLayout
} from './panel/panel-layout-ownership';
import {
  reserveGameAreaForDockedPanel,
  restoreFullGameArea
} from './panel/game-layout-docking';

const props = defineProps<{
  platform: 'electron' | 'userscript';
  layout: XiaochaoPanelLayout;
  configStore: XiaochaoConfigStore;
  seatStateStore: SeatStateStore;
  recentCardStore: RecentCardStore;
  deckRecordStore: DeckRecordStore;
  deckRecordInteraction: DeckRecordInteraction;
  gameCardCatalog: GameCardCatalog;
  skillAssistStore: SkillAssistStore;
  peixiuRouteStore: PeixiuRouteStore;
  turnStatusStore: TurnStatusStore;
  autoTaskController: AutoTaskController | null;
  clearRedDots: () => { found: boolean; count: number };
  rogueController: RogueController | null;
  updateNoticeController: UpdateNoticeController | null;
}>();
/** 折叠态做成近 3:1 胶囊：两行叠阶段/出杀，避免扁长条。 */
const COLLAPSED_PANEL_HEIGHT = '48px';
const COLLAPSED_PANEL_WIDTH = '148px';
const savedTabId = props.configStore.get('panel.activeTab');
const initialTabId: XiaochaoPanelTabId = XIAOCHAO_PANEL_TABS.some((tab) => tab.id === savedTabId)
  ? savedTabId
  : 'cards';
const initialCollapsed = props.configStore.get('panel.collapsed');
const panel = createXiaochaoPanelModel(
  initialTabId,
  showTabContent,
  initialCollapsed,
  persistCollapsedState
);
const panelElement = ref<HTMLElement>();
const isDockedRight = ref(props.configStore.get('panel.dockedRight'));
const isDockPreviewVisible = ref(false);
const isDockPreviewActive = ref(false);
const toolsHasUpdate = ref(props.updateNoticeController?.getSnapshot().hasUpdate ?? false);
const stopUpdateNotice = props.updateNoticeController?.subscribe((snapshot) => {
  toolsHasUpdate.value = snapshot.hasUpdate;
});
const isResetDialogOpen = ref(false);

function openXiaochaoSite(): void {
  const adapter = props.platform === 'electron'
    ? createElectronPlatform()
    : createUserscriptPlatform();
  void adapter.openExternal('https://xc.95chong.cn/');
}
let expandedHeight = '';
let expandedWidth = '';
let stopDragging: (() => void) | undefined;
let stopResizing: (() => void) | undefined;

onMounted(() => {
  const shell = panelElement.value;
  if (!shell) return;
  setOwnedPanelLayout(shell, {
    top: `${props.layout.top}px`,
    right: `${props.layout.right}px`,
    width: props.layout.width,
    height: `${props.layout.height}px`
  });
  shell.style.fontFamily = props.layout.fontFamily;
  expandedHeight = `${props.layout.height}px`;
  expandedWidth = props.layout.width;
  if (isDockedRight.value) applyRightDock(shell);
  else restoreSavedPosition(shell);
  if (panel.isCollapsed.value) applyCollapsedDimensions(shell);
  window.addEventListener('resize', keepPanelInsideViewport);
});

onBeforeUnmount(() => {
  stopDragging?.();
  stopResizing?.();
  stopUpdateNotice?.();
  window.removeEventListener('resize', keepPanelInsideViewport);
  restoreFullGameArea();
});

function toggleCollapsed(): void {
  const shell = panelElement.value;
  if (!shell) return;
  if (!panel.isCollapsed.value) {
    expandedHeight = getOwnedPanelLayoutValue(shell, 'height') || `${shell.offsetHeight}px`;
    expandedWidth = getOwnedPanelLayoutValue(shell, 'width') || props.layout.width;
    applyCollapsedDimensions(shell);
  } else {
    setOwnedPanelLayout(shell, {
      height: expandedHeight,
      width: expandedWidth,
      minWidth: undefined,
      maxWidth: undefined,
      minHeight: undefined,
      maxHeight: undefined
    });
  }
  panel.toggleCollapsed();
  // 停靠状态的展开高度始终跟随游戏窗口；折叠时则只保留标题栏。
  if (isDockedRight.value) applyRightDock(shell);
  else syncDockedGameLayout(shell);
}

function resetXiaochaoConfig(): void {
  try {
    props.configStore.resetAll();
    const credentialKeys = ['sgsol.rememberedCredentials.v2', 'sgsol.rememberedCredentials.v2.4399'];
    for (const key of credentialKeys) {
      window.localStorage.removeItem(key);
      window.xiaochaoStorage?.saveCredentials?.(key.endsWith('.4399') ? '4399' : 'official', []);
    }
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith('XC') || key.toLowerCase().includes('xiaochao')) window.sessionStorage.removeItem(key);
    }
    showToast('小抄配置已重置，正在刷新页面', 'success', 1800);
    window.setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    console.warn('[reset-xiaochao] 清除配置失败:', error);
    showToast('清除配置失败，请查看控制台', 'error', 4000);
  } finally {
    isResetDialogOpen.value = false;
  }
}

/** 折叠态只保留标题栏，固定宽高做成状态胶囊。 */
function applyCollapsedDimensions(shell: HTMLElement): void {
  setOwnedPanelLayout(shell, {
    height: COLLAPSED_PANEL_HEIGHT,
    minHeight: COLLAPSED_PANEL_HEIGHT,
    maxHeight: COLLAPSED_PANEL_HEIGHT,
    width: COLLAPSED_PANEL_WIDTH,
    minWidth: COLLAPSED_PANEL_WIDTH,
    maxWidth: COLLAPSED_PANEL_WIDTH
  });
}

/** 保存纯 UI 状态，刷新游戏 webview 后仍恢复用户上次选择。 */
function persistCollapsedState(collapsed: boolean): void {
  props.configStore.set('panel.collapsed', collapsed);
}

/** 保存当前标签，并把内容区滚动位置复位。 */
function showTabContent(tabId: XiaochaoPanelTabId): void {
  props.configStore.set('panel.activeTab', tabId);
  const contentElement = document.getElementById('iframe-source');
  if (!contentElement) return;
  contentElement.scrollTop = 0;
}

function handleDragStart(event: PointerEvent): void {
  if (event.button !== 0 || !panelElement.value) return;
  event.preventDefault();
  const shell = panelElement.value;
  const header = event.currentTarget as HTMLElement;
  header.setPointerCapture?.(event.pointerId);
  const startedDocked = isDockedRight.value;
  const startBounds = shell.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const floatingStartLeft = startedDocked ? startX - startBounds.width / 2 : startBounds.left;
  const floatingStartTop = startedDocked ? startY - 15 : startBounds.top;
  let dragStarted = false;
  let latestMoveEvent: PointerEvent | undefined;
  let animationFrameId = 0;

  const renderMove = () => {
    animationFrameId = 0;
    const moveEvent = latestMoveEvent;
    if (!moveEvent) return;
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (!dragStarted && !hasExceededDragThreshold(deltaX, deltaY)) return;
    if (!dragStarted) {
      dragStarted = true;
      if (startedDocked) detachFromRightDock(shell, moveEvent.clientX, moveEvent.clientY);
      setOwnedPanelLayout(shell, { right: 'auto' });
      shell.classList.add('xiaochao-panel--dragging');
      isDockPreviewVisible.value = true;
    }
    const position = constrainPanelPosition(
      {
        left: floatingStartLeft + deltaX,
        top: floatingStartTop + deltaY
      },
      { width: shell.offsetWidth, height: shell.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setOwnedPanelLayout(shell, {
      left: `${position.left}px`,
      top: `${position.top}px`
    });
    isDockPreviewActive.value = shouldDockToRight(
      moveEvent.clientX,
      position.left + shell.offsetWidth,
      window.innerWidth
    );
  };
  const handleMove = (moveEvent: PointerEvent) => {
    latestMoveEvent = moveEvent;
    if (!animationFrameId) animationFrameId = window.requestAnimationFrame(renderMove);
  };
  const handleUp = (upEvent: PointerEvent) => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
      renderMove();
    }
    if (!dragStarted) return stopDragging?.();
    const bounds = shell.getBoundingClientRect();
    if (shouldDockToRight(upEvent.clientX, bounds.right, window.innerWidth)) {
      applyRightDock(shell);
    } else {
      persistFloatingPosition(shell);
    }
    stopDragging?.();
  };
  stopDragging = () => {
    if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleInterruptedDrag);
    window.removeEventListener('blur', handleInterruptedDrag);
    header.removeEventListener('lostpointercapture', handleInterruptedDrag);
    if (header.hasPointerCapture?.(event.pointerId)) header.releasePointerCapture(event.pointerId);
    shell.classList.remove('xiaochao-panel--dragging');
    isDockPreviewVisible.value = false;
    isDockPreviewActive.value = false;
    stopDragging = undefined;
  };
  const handleInterruptedDrag = () => {
    if (dragStarted) persistFloatingPosition(shell);
    stopDragging?.();
  };
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp, { once: true });
  window.addEventListener('pointercancel', handleInterruptedDrag, { once: true });
  window.addEventListener('blur', handleInterruptedDrag, { once: true });
  header.addEventListener('lostpointercapture', handleInterruptedDrag, { once: true });
}

function applyRightDock(shell: HTMLElement): void {
  isDockedRight.value = true;
  setOwnedPanelLayout(shell, {
    left: 'auto',
    right: '0px',
    top: '0px',
    height: panel.isCollapsed.value ? COLLAPSED_PANEL_HEIGHT : '100vh'
  });
  props.configStore.set('panel.dockedRight', true);
  syncDockedGameLayout(shell);
}

function detachFromRightDock(shell: HTMLElement, pointerX: number, pointerY: number): void {
  isDockedRight.value = false;
  const width = shell.offsetWidth;
  const height = Math.min(props.layout.height, window.innerHeight);
  // 必须先归还游戏宽度，再把面板切回悬浮坐标。
  restoreFullGameArea();
  setOwnedPanelLayout(shell, {
    right: 'auto',
    width: expandedWidth,
    height: `${height}px`,
    left: `${Math.max(0, pointerX - width / 2)}px`,
    top: `${Math.max(0, pointerY - 15)}px`
  });
  props.configStore.set('panel.dockedRight', false);
}

function persistFloatingPosition(shell: HTMLElement): void {
  const floatingPosition = { left: shell.offsetLeft, top: shell.offsetTop };
  isDockedRight.value = false;
  props.configStore.set('panel.dockedRight', false);
  restoreFullGameArea();
  setOwnedPanelLayout(shell, {
    left: `${floatingPosition.left}px`,
    top: `${floatingPosition.top}px`,
    right: 'auto'
  });
  props.configStore.set('panel.position', floatingPosition);
}

function restoreSavedPosition(shell: HTMLElement): void {
  const saved = props.configStore.get('panel.position');
  if (!saved) return;
  const position = constrainPanelPosition(saved, {
    width: shell.offsetWidth,
    height: shell.offsetHeight
  }, {
    width: window.innerWidth,
    height: window.innerHeight
  });
  setOwnedPanelLayout(shell, { left: `${position.left}px`, top: `${position.top}px`, right: 'auto' });
}

function keepPanelInsideViewport(): void {
  const shell = panelElement.value;
  if (!shell) return;
  if (isDockedRight.value) return applyRightDock(shell);
  const bounds = shell.getBoundingClientRect();
  const position = constrainPanelPosition(bounds, bounds, {
    width: window.innerWidth,
    height: window.innerHeight
  });
  setOwnedPanelLayout(shell, { left: `${position.left}px`, top: `${position.top}px`, right: 'auto' });
}

/** 展开停靠时压缩游戏区域；折叠后立即归还空间，避免留下无意义空白。 */
function syncDockedGameLayout(shell: HTMLElement): void {
  if (isDockedRight.value && !panel.isCollapsed.value) {
    reserveGameAreaForDockedPanel(shell.getBoundingClientRect().width);
  } else {
    restoreFullGameArea();
  }
}

/** 调整面板高度；限制在标题栏以下和当前窗口可见区域以内。 */
function handleResizeStart(event: PointerEvent): void {
  if (event.button !== 0 || !panelElement.value) return;
  const shell = panelElement.value;
  const startY = event.clientY;
  const startHeight = shell.offsetHeight;
  const maximumHeight = Math.max(160, window.innerHeight - shell.offsetTop);

  const handleMove = (moveEvent: PointerEvent) => {
    const nextHeight = Math.min(
      maximumHeight,
      Math.max(160, startHeight + moveEvent.clientY - startY)
    );
    expandedHeight = `${nextHeight}px`;
    setOwnedPanelLayout(shell, { height: expandedHeight });
  };
  const handleUp = () => stopResizing?.();
  stopResizing = () => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    stopResizing = undefined;
  };
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp, { once: true });
}
</script>

<template>
  <section
    ref="panelElement"
    id="createIframe"
    class="createIframe xiaochao-panel"
    :class="{
      'xiaochao-panel--collapsed': panel.isCollapsed.value,
      'xiaochao-panel--docked-right': isDockedRight
    }"
    aria-label="三国杀小抄"
  >
    <PanelHeader
      :collapsed="panel.isCollapsed.value"
      @toggle="toggleCollapsed"
      @drag-start="handleDragStart"
    >
      <TurnStatusBar
        :turn-status-store="turnStatusStore"
        :compact="panel.isCollapsed.value"
      />
    </PanelHeader>
    <PanelTabs
      v-show="!panel.isCollapsed.value"
      :active-tab-id="panel.activeTabId.value"
      :tools-has-update="toolsHasUpdate"
      @select="panel.selectTab"
    />
    <main
      v-show="!panel.isCollapsed.value && panel.activeTabId.value === 'cards'"
      class="xiaochao-panel__content xiaochao-cards-pane"
    >
      <SkillAssistSection
        :skill-assist-store="skillAssistStore"
        :game-card-catalog="gameCardCatalog"
      />
      <DeckRecordSection
        :config-store="configStore"
        :deck-record-store="deckRecordStore"
        :game-card-catalog="gameCardCatalog"
      />
      <DisplaySettingsSection :config-store="configStore" />
      <GameAssistSettingsSection :config-store="configStore" />
      <div class="xiaochao-quick-tools" aria-label="快捷工具">
        <BlockSettingsSection :config-store="configStore" />
        <ClearRedDotSection :clear-red-dots="clearRedDots" />
        <SkinBackgroundSettingsSection :config-store="configStore" />
        <AutoTaskSettingsSection :config-store="configStore" />
      </div>
    </main>
    <main
      v-show="!panel.isCollapsed.value && panel.activeTabId.value === 'rogue'"
      class="xiaochao-panel__content xiaochao-rogue-entry"
    >
      <RogueSettingsSection
        :config-store="configStore"
        :open-shop="() => rogueController?.openShop() ?? false"
        :get-shop-preview="() => rogueController?.getShopPreview() ?? []"
        :subscribe-shop-preview="(listener) => rogueController?.subscribeShopPreview(listener) ?? (() => {})"
      />
    </main>
    <main
      v-show="!panel.isCollapsed.value && panel.activeTabId.value === 'tools'"
      class="xiaochao-panel__content xiaochao-tools-entry"
    >
      <VersionNoticeSection :update-notice-controller="updateNoticeController" />
      <section class="xiaochao-settings-section" aria-label="工具栏">
        <div class="xiaochao-settings-section__body xiaochao-tools-entry__actions">
          <GuanxingEntry :platform="platform" />
          <button
            type="button"
            class="xiaochao-block-entry xiaochao-block-entry--center"
            data-tooltip="在浏览器新页面打开小抄官网"
            @click="openXiaochaoSite"
          >
            <span>小抄官网</span>
          </button>
          <button
            type="button"
            class="xiaochao-block-entry xiaochao-block-entry--center"
            data-tooltip="清除小抄配置和授权缓存"
            @click="isResetDialogOpen = true"
          >
            <span>重置小抄</span>
          </button>
        </div>
      </section>
    </main>
    <main
      id="iframe-source"
      class="xiaochao-panel__content"
      :style="{ display: panel.isCollapsed.value || panel.activeTabId.value === 'cards' || panel.activeTabId.value === 'tools' || panel.activeTabId.value === 'rogue' ? 'none' : '' }"
    />
    <div
      v-show="!panel.isCollapsed.value"
      id="frame-resize-handle"
      data-tooltip="拖动调整高度"
      @pointerdown.stop="handleResizeStart"
    />
  </section>
  <div
    v-show="isDockPreviewVisible"
    class="xiaochao-dock-preview"
    :class="{ 'xiaochao-dock-preview--active': isDockPreviewActive }"
    aria-hidden="true"
  />
  <TooltipLayer />
  <BaseDialog
    :open="isResetDialogOpen"
    title="重置小抄"
    dialog-class="xiaochao-reset-dialog"
    @close="isResetDialogOpen = false"
  >
    <p>确定清除小抄配置数据吗？此操作无法撤销。</p>
    <template #footer>
      <button type="button" class="xiaochao-reset-dialog__cancel" @click="isResetDialogOpen = false">取消</button>
      <button type="button" class="xiaochao-reset-dialog__confirm" @click="resetXiaochaoConfig">清除并重载</button>
    </template>
  </BaseDialog>
  <DeckRecordOverlay
    :config-store="configStore"
    :deck-record-store="deckRecordStore"
    :deck-record-interaction="deckRecordInteraction"
    :seat-state-store="seatStateStore"
  />
</template>
