/**
 * 浏览器里单独挂 Vue 面板，不启动 Electron / 游戏。
 * 假数据只服务 UI 预览，不参与正式注入产物。
 */
import { getDefaultConfig } from '../../src/config/config-schema.ts';
import { createConfigStore } from '../../src/config/config-store.ts';
import { createTurnStatusStore } from '../../src/features/turn-status/turn-status-store.ts';
import { mountXiaochaoApp } from '../../src/ui/mount-xiaochao-app.ts';
import type { RecentCardStore } from '../../src/features/recent-cards/recent-card-store.ts';
import type { DeckRecordStore } from '../../src/features/deck-record/deck-record-store.ts';
import type { GameCardCatalog } from '../../src/features/cards/game-card-catalog.ts';
import type { SkillAssistStore } from '../../src/features/skill-assist/skill-assist-store.ts';

const memory = { ...getDefaultConfig(), 'panel.collapsed': false, 'panel.dockedRight': false };
const configStore = createConfigStore({
  read: () => ({ ...memory }),
  write: (next) => {
    Object.assign(memory, next);
  }
});

const turnStatusStore = createTurnStatusStore();
turnStatusStore.handleGameEvent({ type: 'phase-changed', seatId: 1, phase: 4 });
turnStatusStore.handleGameEvent({ type: 'sha-count-updated', seatId: 1, used: 0, limit: 1 });

const emptySubscribe = <T,>(snapshot: T) => (listener: (value: T) => void) => {
  listener(snapshot);
  return () => {};
};

const recentCardStore = {
  getSnapshot: () => ({
    displayMode: 'current',
    activeSeatId: null,
    lastPlayerCardId: null,
    currentTurnCardId: null,
    displayedCardId: null
  }),
  setDisplayMode: () => {},
  subscribe: emptySubscribe({
    displayMode: 'current',
    activeSeatId: null,
    lastPlayerCardId: null,
    currentTurnCardId: null,
    displayedCardId: null
  }),
  clear: () => {}
} as unknown as RecentCardStore;

const deckRecordStore = {
  getSnapshot: () => ({
    movements: [],
    discardCardIds: [],
    hiddenDiscardCount: 0,
    currentTurnDiscardCardIds: [],
    currentTurnHiddenDiscardCount: 0,
    currentTurnCount: 0,
    currentRound: 0,
    deckTopCardIds: [],
    deckBottomCardIds: []
  }),
  subscribe: emptySubscribe({
    movements: [],
    discardCardIds: [],
    hiddenDiscardCount: 0,
    currentTurnDiscardCardIds: [],
    currentTurnHiddenDiscardCount: 0,
    currentTurnCount: 0,
    currentRound: 0,
    deckTopCardIds: [],
    deckBottomCardIds: []
  }),
  clear: () => {}
} as unknown as DeckRecordStore;

const gameCardCatalog = {
  resolve: (cardId: number) => ({
    cardId,
    name: `牌${cardId}`,
    suit: '',
    suitGlyph: '',
    rank: '',
    isRed: false,
    cardType: 0,
    artworkUrl: ''
  }),
  clear: () => {}
} as unknown as GameCardCatalog;

const skillAssistStore = {
  getSnapshot: () => ({
    inGame: false,
    currentSeatId: null,
    panels: []
  }),
  setInGame: () => {},
  setCurrentSeatId: () => {},
  setPanelVisible: () => {},
  refreshVisibility: () => {},
  handleGameEvent: () => {},
  subscribe: emptySubscribe({
    inGame: false,
    currentSeatId: null,
    panels: []
  }),
  clear: () => {}
} as unknown as SkillAssistStore;

mountXiaochaoApp(
  'electron',
  {
    top: 48,
    right: 48,
    width: '360px',
    height: Math.max(520, window.innerHeight - 96),
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif'
  },
  configStore,
  recentCardStore,
  deckRecordStore,
  gameCardCatalog,
  skillAssistStore,
  turnStatusStore,
  null,
  () => ({ found: true, count: 3 }),
  {
    openShop: () => {
      window.alert('沙盒：打开集市（无游戏）');
      return true;
    },
    filterMessage: () => {},
    dispose: () => {}
  }
);
