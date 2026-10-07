/**
 * 将 Vue 根应用挂到页面：创建 #xiaochao-app，注入各 store/controller props，
 * 并校验面板壳 DOM（#createIframe / #iframe-source）已渲染。
 */

import { createApp, type App as VueApp } from 'vue';
import XiaochaoApp from './App.vue';
import type { XiaochaoPlatform } from '../adapters/platform';
import { installPanelShellStyles } from './panel/panel-shell-styles';
import type { XiaochaoConfigStore } from '../config/config-store';
import type { SeatStateStore } from '../features/seat-display/seat-state-store';
import type { RecentCardStore } from '../features/recent-cards/recent-card-store';
import type { GameCardCatalog } from '../features/cards/game-card-catalog';
import type { DeckRecordStore } from '../features/deck-record/deck-record-store';
import type { DeckRecordInteraction } from '../features/deck-record/deck-record-interaction';
import type { SkillAssistStore } from '../features/skill-assist/skill-assist-store';
import type { PeixiuRouteStore } from '../features/extra-assist/peixiu-route-store';
import type { TurnStatusStore } from '../features/turn-status/turn-status-store';
import type { AutoTaskController } from '../features/auto-task';
import type { RogueController } from '../features/rogue';
import type { UpdateNoticeController } from '../features/update-notice';

export interface XiaochaoPanelLayout {
  top: number;
  right: number;
  width: string;
  height: number;
  fontFamily: string;
}

export interface MountedXiaochaoApp {
  app: VueApp;
  rootElement: HTMLElement;
  panelElement: HTMLElement;
  contentElement: HTMLElement;
  unmount(): void;
}

/** 创建由 Vue 独立拥有的面板外壳。 */
export function mountXiaochaoApp(
  platform: XiaochaoPlatform,
  layout: XiaochaoPanelLayout,
  configStore: XiaochaoConfigStore,
  seatStateStore: SeatStateStore,
  recentCardStore: RecentCardStore,
  deckRecordStore: DeckRecordStore,
  deckRecordInteraction: DeckRecordInteraction,
  gameCardCatalog: GameCardCatalog,
  skillAssistStore: SkillAssistStore,
  peixiuRouteStore: PeixiuRouteStore,
  turnStatusStore: TurnStatusStore,
  autoTaskController: AutoTaskController | null = null,
  clearRedDots: () => { found: boolean; count: number } = () => ({ found: false, count: 0 }),
  rogueController: RogueController | null = null,
  updateNoticeController: UpdateNoticeController | null = null
): MountedXiaochaoApp {
  const removePanelShellStyles = installPanelShellStyles();
  const rootElement = document.createElement('div');
  rootElement.id = 'xiaochao-app';
  document.body.appendChild(rootElement);
  const app = createApp(XiaochaoApp, {
    platform,
    layout,
    configStore,
    seatStateStore,
    recentCardStore,
    deckRecordStore,
    deckRecordInteraction,
    gameCardCatalog,
    skillAssistStore,
    peixiuRouteStore,
    turnStatusStore,
    autoTaskController,
    clearRedDots,
    rogueController,
    updateNoticeController
  });
  app.mount(rootElement);
  const panelElement = rootElement.querySelector<HTMLElement>('#createIframe');
  const contentElement = rootElement.querySelector<HTMLElement>('#iframe-source');
  if (!panelElement || !contentElement) {
    app.unmount();
    rootElement.remove();
    throw new Error('Vue 面板外壳创建失败');
  }
  let unmounted = false;
  return {
    app,
    rootElement,
    panelElement,
    contentElement,
    unmount() {
      if (unmounted) return;
      unmounted = true;
      app.unmount();
      rootElement.remove();
      removePanelShellStyles();
    }
  };
}
