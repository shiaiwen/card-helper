import { createApp, type App as VueApp } from 'vue';
import XiaochaoApp from './App.vue';
import type { XiaochaoPlatform } from '../adapters/platform';
import { installPanelShellStyles } from './panel/panel-shell-styles';
import { prepareLegacyTabPanes } from './legacy/prepare-legacy-tab-panes';
import type { XiaochaoConfigStore } from '../config/config-store';
import type { SeatStateStore } from '../features/seat-display/seat-state-store';
import type { RecentCardStore } from '../features/recent-cards/recent-card-store';
import type { GameCardCatalog } from '../features/cards/game-card-catalog';
import type { DeckRecordStore } from '../features/deck-record/deck-record-store';
import type { DeckRecordInteraction } from '../features/deck-record/deck-record-interaction';
import type { SkillAssistStore } from '../features/skill-assist/skill-assist-store';
import type { TurnStatusStore } from '../features/turn-status/turn-status-store';
import type { AutoTaskController } from '../features/auto-task';
import type { RogueController } from '../features/rogue';

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
  prepareLegacyTabPanes(): void;
  unmount(): void;
}

/** 创建由 Vue 独立拥有的面板外壳，不再接管 legacy 创建的外层 DOM。 */
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
  turnStatusStore: TurnStatusStore,
  autoTaskController: AutoTaskController | null = null,
  clearRedDots: () => { found: boolean; count: number } = () => ({ found: false, count: 0 }),
  rogueController: RogueController | null = null
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
    turnStatusStore,
    autoTaskController,
    clearRedDots,
    rogueController
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
    prepareLegacyTabPanes() {
      prepareLegacyTabPanes(contentElement);
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      app.unmount();
      rootElement.remove();
      removePanelShellStyles();
    }
  };
}
