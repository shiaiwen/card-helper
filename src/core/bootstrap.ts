import { createLifecycle } from '../runtime/lifecycle.js';
import { installRuntimeBridge } from '../runtime/wait-for-game-runtime.js';
import type { PlatformAdapter } from '../adapters/platform';
import {
  mountXiaochaoApp,
  type XiaochaoPanelLayout
} from '../ui/mount-xiaochao-app';
import { createConfigStore } from '../config/config-store';
import { createPlatformConfigStorage } from '../config/config-storage';
import { installSeatDisplayVisibility } from '../features/seat-display/seat-display-visibility';
import { createSeatStateStore } from '../features/seat-display/seat-state-store';
import { installSeatStateController } from '../features/seat-display/seat-state-controller';
import { createGameEventBus } from '../runtime/game-event-bus';
import { createRecentCardStore } from '../features/recent-cards/recent-card-store';
import { installGameLifecycleEvents } from '../runtime/game-lifecycle-events';
import { installMicroClientMessageSource } from '../adapters/micro-client-message-source';
import { createGameCardCatalog } from '../features/cards/game-card-catalog';
import { locateGameScene } from '../features/seat-display/game-scene-locator';
import { bindTurnStatusStoreToGameEvents, createTurnStatusStore } from '../features/turn-status/turn-status-store';
import { createDeckRecordStore } from '../features/deck-record/deck-record-store';
import { createDeckRecordInteraction } from '../features/deck-record/deck-record-interaction';
import { installNativeDeckRecordController } from '../features/deck-record/native-deck-record-controller';
import { installCountdownSecondsController } from '../features/countdown/countdown-seconds-controller';
import { installCardLabelController } from '../features/cards/card-label-controller';
import { installCardConfigSource } from '../adapters/card-config-source';
import { installNativeRecentCardController } from '../features/recent-cards/native-recent-card-controller';
import { createMingpaiEngine, installMingpaiController } from '../features/mingpai';
import { installNativeMingpaiPreviewController } from '../features/mingpai/native-mingpai-preview-controller';
import { createSkillAssistStore } from '../features/skill-assist/skill-assist-store';
import { installSkillAssistController } from '../features/skill-assist/skill-assist-controller';
import { registerSpellNameLookup } from '../features/skill-assist/skill-visibility';
import { installBlockEffectsController } from '../features/block-effects/block-effects-controller';
import {
  installOfficialBackgroundController,
  type OfficialBackgroundController
} from '../features/skin-background/official-background-controller';
import { installSkinChangeController } from '../features/skin-background/skin-change-controller';
import { installSkinPaperController } from '../features/skin-background/skin-paper-controller';
import { installAutoTaskController } from '../features/auto-task';
import { installRogueController } from '../features/rogue';
import { createPeixiuRouteStore, installExtraAssistController } from '../features/extra-assist';
import { installAutoHgController } from '../features/auto-hg';
import { installAutoBotController } from '../features/auto-bot';
import { installUpdateNoticeController } from '../features/update-notice';
import { installGiftCodeController } from '../features/gift-code';
import { installRuntimeSearchController } from '../features/runtime-search';
import { installHandSortController } from '../features/cards/hand-sort-controller';
import { installSelectionToolsController } from '../features/cards/selection-tools-controller';
import { installTiesuoRecastController } from '../features/cards/tiesuo-recast-controller';
import { installClassicRoomFilterController } from '../features/room-filter/classic-room-filter-controller';

/** Electron 和油猴共用的启动边界；平台差异只能通过 adapter 注入。 */
export function bootstrapXiaochao(platform: PlatformAdapter): void {
  const lifecycle = createLifecycle();
  const configStore = createConfigStore(createPlatformConfigStorage(platform));
  const seatStateStore = createSeatStateStore();
  const gameEvents = createGameEventBus();
  const cardConfigSource = installCardConfigSource(window);
  const gameCardCatalog = createGameCardCatalog(
    () => locateGameScene(window),
    (cardId) => cardConfigSource.getCard(cardId)
  );
  const recentCardStore = createRecentCardStore(
    gameEvents,
    configStore.get('display.recentCardMode')
  );
  const mingpaiEngine = createMingpaiEngine();
  const deckRecordStore = createDeckRecordStore(gameEvents, undefined, {
    getDrawPile: () => mingpaiEngine.getSnapshot().drawPile,
    subscribe: (listener) => mingpaiEngine.subscribe(listener)
  });
  const deckRecordInteraction = createDeckRecordInteraction();
  const mingpaiRuntime = installMingpaiController(seatStateStore, gameEvents, {
    engine: mingpaiEngine,
    isRedCard: (cardId) => {
      const card = gameCardCatalog.resolve(cardId);
      return card?.suit ? card.isRed : null;
    }
  });
  registerSpellNameLookup((name) => cardConfigSource.findSpellIdsByName(name));
  const skillAssistStore = createSkillAssistStore(
    mingpaiEngine,
    gameCardCatalog,
    {
      isSelfSeat(seatId) {
        const snapshot = seatStateStore.getSnapshot();
        return seatId === snapshot.selfSeatId
          || snapshot.controlledSeatIds.includes(seatId);
      },
      getControlledSeatIds() {
        const snapshot = seatStateStore.getSnapshot();
        const seatIds = snapshot.selfSeatId === null ? [] : [snapshot.selfSeatId];
        return [...new Set([...seatIds, ...snapshot.controlledSeatIds])];
      },
      getSeatLabel(seatId) {
        return seatStateStore.getSnapshot().seats.find((seat) => seat.seatId === seatId)?.playerName ?? '';
      }
    }
  );
  const peixiuRouteStore = createPeixiuRouteStore();
  lifecycle.register(cardConfigSource.dispose);
  lifecycle.register(installSeatDisplayVisibility(configStore));
  const classicRoomFilter = installClassicRoomFilterController(configStore);
  lifecycle.register(classicRoomFilter.dispose);
  lifecycle.register(installSeatStateController(seatStateStore));
  lifecycle.register(installGameLifecycleEvents(seatStateStore, gameEvents));
  lifecycle.register(mingpaiRuntime.dispose);
  lifecycle.register(installNativeMingpaiPreviewController(configStore, seatStateStore, gameCardCatalog, mingpaiEngine, gameEvents));
  lifecycle.register(installCountdownSecondsController(configStore));
  lifecycle.register(installCardLabelController(configStore));
  lifecycle.register(installHandSortController(configStore));
  lifecycle.register(installSelectionToolsController());
  lifecycle.register(installTiesuoRecastController());
  const blockEffects = installBlockEffectsController(configStore);
  lifecycle.register(blockEffects.dispose);
  const skinChange = installSkinChangeController(configStore);
  lifecycle.register(skinChange.dispose);
  let officialBackground: OfficialBackgroundController | undefined;
  const skinPaper = installSkinPaperController(configStore, {
    selfSeatId: () => seatStateStore.getSnapshot().selfSeatId,
    syncWallpaperMenu: () => officialBackground?.sync()
  });
  lifecycle.register(skinPaper.dispose);
  officialBackground = installOfficialBackgroundController(configStore, {
    menuExtension: skinPaper.menuExtension
  });
  lifecycle.register(officialBackground.dispose);
  const autoTask = installAutoTaskController(configStore, gameEvents, {
    cardConfigSource
  });
  lifecycle.register(autoTask.dispose);
  lifecycle.register(installGiftCodeController());
  lifecycle.register(installRuntimeSearchController());
  const extraAssist = installExtraAssistController(configStore, {
    getExtraAssistData: () => cardConfigSource.getExtraAssistData(),
    getSpellExtendRaw: () => cardConfigSource.getSpellExtendRaw(),
    getCard: (cardId) => cardConfigSource.getCard(cardId),
    peixiuRouteStore
  });
  lifecycle.register(extraAssist.dispose);
  const autoHg = installAutoHgController(configStore, { gameEvents });
  lifecycle.register(autoHg.dispose);
  const autoBot = installAutoBotController(configStore, { gameEvents });
  lifecycle.register(autoBot.dispose);
  const updateNotice = installUpdateNoticeController(configStore, (url) => platform.openExternal(url), {
    skipRemoteCheck: import.meta.env.DEV
  });
  lifecycle.register(updateNotice.dispose);
  const rogue = installRogueController(configStore, { cardConfigSource });
  lifecycle.register(rogue.dispose);
  const messageFilters = [
    blockEffects.filterMessage,
    skinChange.filterMessage,
    skinPaper.filterMessage,
    rogue.filterMessage,
    autoHg.filterMessage,
    autoBot.filterMessage
  ];
  lifecycle.register(installMicroClientMessageSource(gameEvents, window, {
    mutateMessage: (payload, className) => {
      for (const filter of messageFilters) {
        try {
          filter(payload, className);
        } catch (error) {
          console.warn('[xiaochao] 协议改写失败', className, error);
        }
      }
    }
  }));
  lifecycle.register(installNativeRecentCardController(configStore, recentCardStore));
  lifecycle.register(installNativeDeckRecordController(
    configStore,
    deckRecordStore,
    deckRecordInteraction,
    gameCardCatalog
  ));
  lifecycle.register(installSkillAssistController(
    skillAssistStore,
    gameEvents,
    () => locateGameScene(window)
  ));
  const turnStatusStore = createTurnStatusStore();
  lifecycle.register(bindTurnStatusStoreToGameEvents(turnStatusStore, gameEvents));
  lifecycle.register(turnStatusStore.clear);
  lifecycle.register(recentCardStore.clear);
  lifecycle.register(gameEvents.clear);
  lifecycle.register(gameCardCatalog.clear);
  lifecycle.register(deckRecordStore.clear);
  lifecycle.register(deckRecordInteraction.clear);
  lifecycle.register(skillAssistStore.clear);
  lifecycle.register(peixiuRouteStore.clear);
  lifecycle.register(mingpaiEngine.clear);
  let mountedApp: ReturnType<typeof mountXiaochaoApp> | undefined;
  function mountPanelShell(layout: XiaochaoPanelLayout = DEFAULT_PANEL_LAYOUT) {
    // 面板节点被宿主页面移除后允许重新创建。
    if (mountedApp?.panelElement.isConnected) return mountedApp;
    mountedApp?.unmount();
    mountedApp = mountXiaochaoApp(
      platform.platform,
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
      autoTask,
      () => blockEffects.clearRedDots(),
      rogue,
      updateNotice
    );
    lifecycle.register(mountedApp.unmount);
    return mountedApp;
  }
  const bridge = installRuntimeBridge(window, {
    lifecycle,
    platform,
    getSeatState: () => seatStateStore.getSnapshot(),
    getRecentCardState: () => recentCardStore.getSnapshot(),
    getDeckRecordState: () => deckRecordStore.getSnapshot(),
    getMingpaiState: () => mingpaiEngine.getSnapshot(),
    getSkillAssistState: () => skillAssistStore.getSnapshot(),
    resolveGameCard: (cardId: number) => gameCardCatalog.resolve(cardId),
    getCardConfigSize: () => cardConfigSource.size(),
    mountPanelShell
  });
  (window as unknown as Record<string, unknown>).__XIAOCHAO_STARTUP__ ??= panelStartupStatus;
  void bridge.waitForGameRuntime({
    probe: () => bridge.getMissingGameRuntimeDependencies({ globalObject: window }),
    initialize: () => {
      if (!document.body) return false;
      mountPanelShell();
      return true;
    },
    registerCleanup: (cleanup: () => void) => lifecycle.register(cleanup),
    status: panelStartupStatus
  }).catch((error: unknown) => console.error('[xiaochao] 面板挂载失败', error));
}

const panelStartupStatus: Record<string, unknown> = {};

const DEFAULT_PANEL_LAYOUT: XiaochaoPanelLayout = {
  top: 31,
  right: 155,
  width: '250px',
  height: readSavedPanelHeight(),
  fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Noto Sans SC",Arial,sans-serif'
};

function readSavedPanelHeight(): number {
  try {
    const saved = Number(localStorage.getItem('XC::mainFrameExpandedHeight'));
    return Number.isFinite(saved) && saved >= 160 ? Math.round(saved) : 480;
  } catch {
    return 480;
  }
}
