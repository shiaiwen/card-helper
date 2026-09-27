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
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import DeckRecordSection from './cards/DeckRecordSection.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import DeckRecordOverlay from './deck-record/DeckRecordOverlay.vue';
// @ts-expect-error - Vue SFC module is provided by the project Vue runtime.
import SkillAssistSection from './cards/SkillAssistSection.vue';
import {
  createXiaochaoPanelModel,
  type XiaochaoPanelTabId
} from './panel/panel-model';
import type { XiaochaoConfigStore } from '../config/config-store';
import type { SeatStateStore } from '../features/seat-display/seat-state-store';
import type { RecentCardStore } from '../features/recent-cards/recent-card-store';
import type { GameCardCatalog } from '../features/cards/game-card-catalog';
import type { DeckRecordStore } from '../features/deck-record/deck-record-store';
import type { DeckRecordInteraction } from '../features/deck-record/deck-record-interaction';
import type { SkillAssistStore } from '../features/skill-assist/skill-assist-store';
import type { XiaochaoPanelLayout } from './mount-xiaochao-app';
import {
  LEGACY_TAB_CONTENT_READY_EVENT,
  VUE_SETTINGS_DISPLAY_MOUNT_ID
} from './legacy/prepare-legacy-tab-panes';
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
}>();
const COLLAPSED_PANEL_HEIGHT = '28px';
const initialTabId = props.configStore.get('panel.activeTab');
const initialCollapsed = props.configStore.get('panel.collapsed');
const panel = createXiaochaoPanelModel(
  initialTabId,
  showLegacyTabContent,
  initialCollapsed,
  persistCollapsedState
);
const platformLabel = props.platform === 'electron' ? '微端' : '油猴';
const panelElement = ref<HTMLElement>();
const isDockedRight = ref(props.configStore.get('panel.dockedRight'));
const isDockPreviewVisible = ref(false);
const isDockPreviewActive = ref(false);
const isLegacyContentReady = ref(false);
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
  window.addEventListener(LEGACY_TAB_CONTENT_READY_EVENT, handleLegacyContentReady);
  window.addEventListener('resize', keepPanelInsideViewport);
});

onBeforeUnmount(() => {
  stopDragging?.();
  stopResizing?.();
  window.removeEventListener(LEGACY_TAB_CONTENT_READY_EVENT, handleLegacyContentReady);
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

/** 折叠态只保留标题栏，固定宽度避免旧内容尺寸影响悬浮框。 */
function applyCollapsedDimensions(shell: HTMLElement): void {
  setOwnedPanelLayout(shell, {
    height: COLLAPSED_PANEL_HEIGHT,
    minHeight: COLLAPSED_PANEL_HEIGHT,
    maxHeight: COLLAPSED_PANEL_HEIGHT,
    width: '168px',
    minWidth: '168px',
    maxWidth: '168px'
  });
}

/** 保存纯 UI 状态，刷新游戏 webview 后仍恢复用户上次选择。 */
function persistCollapsedState(collapsed: boolean): void {
  props.configStore.set('panel.collapsed', collapsed);
}

/** 迁移期间只控制旧页面内容的显示；主标签按钮和状态已经由 Vue 管理。 */
function showLegacyTabContent(tabId: XiaochaoPanelTabId): void {
  props.configStore.set('panel.activeTab', tabId);
  const contentElement = document.getElementById('iframe-source');
  if (!contentElement) return;
  const panes = Array.from(
    contentElement.querySelectorAll<HTMLElement>('.xc-main-tab-pane')
  );
  const tabOrder: XiaochaoPanelTabId[] = ['cards', 'rogue', 'settings', 'tools'];
  panes.forEach((pane, index) => {
    pane.classList.toggle('active', tabOrder[index] === tabId);
  });
  contentElement.scrollTop = 0;
}

/** 旧页面内容整理完成后，由 Vue 应用当前选中的标签状态。 */
function showSelectedTabContent(): void {
  showLegacyTabContent(panel.activeTabId.value);
}

/** legacy 内容整理完毕后挂载已经迁移的 Vue 配置区。 */
function handleLegacyContentReady(): void {
  isLegacyContentReady.value = true;
  showSelectedTabContent();
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
  // 必须先归还游戏宽度，再把面板切回悬浮坐标；否则 legacy 的延迟布局会
  // 把正在拖动的面板重新推回右侧。
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
      :platform-label="platformLabel"
      @toggle="toggleCollapsed"
      @drag-start="handleDragStart"
    />
    <PanelTabs
      v-show="!panel.isCollapsed.value"
      :active-tab-id="panel.activeTabId.value"
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
    </main>
    <main
      id="iframe-source"
      class="xiaochao-panel__content"
      :style="{ display: panel.isCollapsed.value || panel.activeTabId.value === 'cards' ? 'none' : '' }"
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
  <DeckRecordOverlay
    :config-store="configStore"
    :deck-record-store="deckRecordStore"
    :deck-record-interaction="deckRecordInteraction"
    :seat-state-store="seatStateStore"
  />
  <Teleport
    v-if="isLegacyContentReady"
    :to="`#${VUE_SETTINGS_DISPLAY_MOUNT_ID}`"
  >
    <DisplaySettingsSection :config-store="configStore" />
  </Teleport>
</template>
