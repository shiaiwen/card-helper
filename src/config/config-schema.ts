import type { XiaochaoPanelTabId } from '../ui/panel/panel-model';

export const CONFIG_DOCUMENT_VERSION = 1;
export const CONFIG_STORAGE_KEY = 'XC::config';

export interface PanelPositionConfig {
  left: number;
  top: number;
}

export interface XiaochaoConfig {
  'panel.activeTab': XiaochaoPanelTabId;
  'panel.collapsed': boolean;
  'panel.dockedRight': boolean;
  'panel.position': PanelPositionConfig | null;
  'display.seatUiEnabled': boolean;
  'display.recentCardsEnabled': boolean;
  'display.recentCardMode': 'current' | 'player';
  'display.deckRecordEnabled': boolean;
  'display.discardSortMode': 'suit-type-number' | 'type-suit-number' | 'number-suit-type';
  'display.cardLabelsEnabled': boolean;
  'display.countdownEnabled': boolean;
}

export type XiaochaoConfigKey = keyof XiaochaoConfig;

interface ConfigDefinition<Value> {
  defaultValue: Value;
  legacyStorageKey?: string;
  parse(value: unknown): Value | undefined;
}

const booleanDefinition = (
  defaultValue: boolean,
  legacyStorageKey?: string
): ConfigDefinition<boolean> => ({
  defaultValue,
  legacyStorageKey,
  parse(value) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1' || value === 1) return true;
    if (value === 'false' || value === '0' || value === 0) return false;
    return undefined;
  }
});

const PANEL_TAB_LABELS: Record<string, XiaochaoPanelTabId> = {
  cards: 'cards',
  rogue: 'rogue',
  settings: 'settings',
  tools: 'tools',
  卡牌: 'cards',
  山河图: 'rogue',
  配置: 'settings',
  工具: 'tools'
};

/** 所有配置键、默认值、旧键迁移和输入校验的唯一声明位置。 */
export const CONFIG_SCHEMA: {
  [Key in XiaochaoConfigKey]: ConfigDefinition<XiaochaoConfig[Key]>;
} = {
  'panel.activeTab': {
    defaultValue: 'settings',
    legacyStorageKey: 'XC::mainPanelActiveTab',
    parse: (value) => typeof value === 'string' ? PANEL_TAB_LABELS[value] : undefined
  },
  'panel.collapsed': booleanDefinition(false, 'XC::mainPanelCollapsed'),
  'panel.dockedRight': booleanDefinition(false, 'XC::mainPanelDockedRight'),
  'panel.position': {
    defaultValue: null,
    legacyStorageKey: 'XC::mainPanelPosition',
    parse(value) {
      if (value === null) return null;
      if (!value || typeof value !== 'object') return undefined;
      const position = value as Partial<PanelPositionConfig>;
      return Number.isFinite(position.left) && Number.isFinite(position.top)
        ? { left: Number(position.left), top: Number(position.top) }
        : undefined;
    }
  },
  'display.seatUiEnabled': booleanDefinition(true, 'SEAT_UI_SWITCH'),
  'display.recentCardsEnabled': booleanDefinition(true, 'RECENT_CARD_SWITCH'),
  'display.recentCardMode': {
    defaultValue: 'current',
    parse: (value) => value === 'current' || value === 'player' ? value : undefined
  },
  'display.deckRecordEnabled': booleanDefinition(true, 'DECK_RECORD_SWITCH'),
  'display.discardSortMode': {
    // 「先后顺序」无实际区分度，默认取第一项花色排序；旧配置 time 一并映射过来。
    defaultValue: 'suit-type-number',
    legacyStorageKey: 'DISCARD_SORT_MODE',
    parse: (value) => {
      const mode = String(value);
      if (mode === 'time') return 'suit-type-number';
      return [
        'suit-type-number',
        'type-suit-number',
        'number-suit-type'
      ].includes(mode)
        ? mode as XiaochaoConfig['display.discardSortMode']
        : undefined;
    }
  },
  'display.cardLabelsEnabled': booleanDefinition(true, 'CARD_LABEL_SWITCH'),
  'display.countdownEnabled': booleanDefinition(true, 'COUNT_DOWN_SWITCH')
};

export function getDefaultConfig(): XiaochaoConfig {
  return Object.fromEntries(
    Object.entries(CONFIG_SCHEMA).map(([key, definition]) => [key, definition.defaultValue])
  ) as unknown as XiaochaoConfig;
}
