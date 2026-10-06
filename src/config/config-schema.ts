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
  'display.deckHudEnabled': boolean;
  'display.recentCardMode': 'current' | 'player';
  'display.deckRecordEnabled': boolean;
  'display.discardSortMode': 'suit-type-number' | 'type-suit-number' | 'number-suit-type';
  'display.cardLabelsEnabled': boolean;
  'display.countdownEnabled': boolean;
  'rooms.hidePassword': boolean;
  'cards.handSortEnabled': boolean;
  'cards.handSortLockedMode': '' | 'CardType' | 'CardFlower' | 'CardNumber';
  'cards.handSortPosition': { right: number; top: number } | null;
  'block.adWindow': boolean;
  'block.mvpWindow': boolean;
  'block.packageWindow': boolean;
  'block.noticeWindow': boolean;
  'block.laoXianWindow': boolean;
  'block.probWindow': boolean;
  'block.shaEffect': boolean;
  'block.healEffect': boolean;
  'block.jinnangEffect': boolean;
  'block.killEffect': boolean;
  'block.entranceEffect': boolean;
  'block.otherSkinState': boolean;
  'block.taskRedDot': boolean;
  'block.interactEffect': boolean;
  'block.factionSlogan': boolean;
  'skin.localSkin': boolean;
  'skin.otherLocalSkin': boolean;
  'skin.officialBackground': boolean;
  'skin.skinPaper': boolean;
  'skin.allPaper': boolean;
  'autoTask.enabled': boolean;
  'autoTask.skipTavern': boolean;
  'autoTask.skipMail': boolean;
  'autoTask.skipDailyGeneralBag': boolean;
  'autoTask.skipSignTrialCard': boolean;
  'autoTask.skipDiJiaQuan': boolean;
  'autoTask.skipHuanLeDou': boolean;
  'rogue.mapEnabled': boolean;
  'rogue.hideStory': boolean;
  'assist.extraEnabled': boolean;
  'assist.autoBotEnabled': boolean;
  'assist.autoHGEnabled': boolean;
  'assist.baiShengEnabled': boolean;
  'assist.autoBotTavernTarget': 'none' | 'dailyGame' | 'dailyWin' | 'weeklyWin';
  'update.dismissedVersion': string;
}

export type XiaochaoConfigKey = keyof XiaochaoConfig;

interface ConfigDefinition<Value> {
  defaultValue: Value;
  previousStorageKey?: string;
  parse(value: unknown): Value | undefined;
}

const booleanDefinition = (
  defaultValue: boolean,
  previousStorageKey?: string
): ConfigDefinition<boolean> => ({
  defaultValue,
  previousStorageKey,
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
  settings: 'cards',
  tools: 'tools',
  卡牌: 'cards',
  常规: 'cards',
  山河图: 'rogue',
  配置: 'cards',
  工具: 'tools'
};

/** 所有配置键、默认值、旧键迁移和输入校验的唯一声明位置。 */
export const CONFIG_SCHEMA: {
  [Key in XiaochaoConfigKey]: ConfigDefinition<XiaochaoConfig[Key]>;
} = {
  'panel.activeTab': {
    defaultValue: 'cards',
    previousStorageKey: 'XC::mainPanelActiveTab',
    parse: (value) => typeof value === 'string' ? PANEL_TAB_LABELS[value] : undefined
  },
  'panel.collapsed': booleanDefinition(false, 'XC::mainPanelCollapsed'),
  'panel.dockedRight': booleanDefinition(false, 'XC::mainPanelDockedRight'),
  'panel.position': {
    defaultValue: null,
    previousStorageKey: 'XC::mainPanelPosition',
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
  'display.deckHudEnabled': booleanDefinition(true),
  'display.recentCardMode': {
    defaultValue: 'current',
    parse: (value) => value === 'current' || value === 'player' ? value : undefined
  },
  'display.deckRecordEnabled': booleanDefinition(true, 'DECK_RECORD_SWITCH'),
  'display.discardSortMode': {
    defaultValue: 'suit-type-number',
    previousStorageKey: 'DISCARD_SORT_MODE',
    parse: (value) => {
      const mode = String(value);
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
  'display.countdownEnabled': booleanDefinition(true, 'COUNT_DOWN_SWITCH'),
  'rooms.hidePassword': booleanDefinition(false, 'onlyNoPasswordRoomSwitch'),
  'cards.handSortEnabled': booleanDefinition(true, 'HAND_SORT_SWITCH'),
  'cards.handSortLockedMode': {
    defaultValue: '',
    previousStorageKey: 'XC::handSortLockedMode',
    parse(value) {
      if (value === 'type-suit-number' || value === 'CardType') return 'CardType';
      if (value === 'suit-type-number' || value === 'CardFlower') return 'CardFlower';
      if (value === 'number-suit-type' || value === 'CardNumber') return 'CardNumber';
      if (value === '' || value === null) return '';
      return undefined;
    }
  },
  'cards.handSortPosition': {
    defaultValue: null,
    previousStorageKey: 'XC::handSortPosition',
    parse(value) {
      if (value === null) return null;
      if (!value || typeof value !== 'object') return undefined;
      const position = value as { right?: unknown; top?: unknown };
      const right = Number(position.right);
      const top = Number(position.top);
      if (!Number.isFinite(right) || !Number.isFinite(top) || right < 0 || top < 0) return undefined;
      return { right: Math.min(10000, right), top: Math.min(10000, top) };
    }
  },
  'block.adWindow': booleanDefinition(false, 'SKIP_AD_WINDOW_SWITCH'),
  'block.mvpWindow': booleanDefinition(false, 'SKIP_MVP_WINDOW_SWITCH'),
  'block.packageWindow': booleanDefinition(false, 'SKIP_PACKAGE_WINDOW_SWITCH'),
  'block.noticeWindow': booleanDefinition(false, 'SKIP_NOTICE_WINDOW_SWITCH'),
  'block.laoXianWindow': booleanDefinition(false, 'SKIP_LAOXIAN_WINDOW_SWITCH'),
  'block.probWindow': booleanDefinition(false, 'SKIP_PROB_WINDOW_SWITCH'),
  'block.shaEffect': booleanDefinition(false, 'BLOCK_SHA_EFFECT_SWITCH'),
  'block.healEffect': booleanDefinition(false, 'BLOCK_HEAL_EFFECT_SWITCH'),
  'block.jinnangEffect': booleanDefinition(false, 'BLOCK_JINNANG_EFFECT_SWITCH'),
  'block.killEffect': booleanDefinition(false, 'BLOCK_KILL_EFFECT_SWITCH'),
  'block.entranceEffect': booleanDefinition(false, 'BLOCK_ENTRANCE_EFFECT_SWITCH'),
  'block.otherSkinState': booleanDefinition(false, 'BLOCK_SKIN_STATE_SWITCH'),
  'block.taskRedDot': booleanDefinition(false, 'RED_DOT_BLOCK_SWITCH'),
  'block.interactEffect': booleanDefinition(false, 'BLOCK_INTERACT_EFFECT_SWITCH'),
  'block.factionSlogan': booleanDefinition(false, 'BLOCK_FACTION_SLOGAN_SWITCH'),
  'skin.localSkin': booleanDefinition(true, 'LOCAL_SKIN_SWITCH'),
  'skin.otherLocalSkin': booleanDefinition(false, 'OTHER_LOCAL_SKIN_SWITCH'),
  'skin.officialBackground': booleanDefinition(true, 'OFFICIAL_BACKGROUND_SWITCH'),
  'skin.skinPaper': booleanDefinition(true, 'SKIN_PAPER_SWITCH'),
  'skin.allPaper': booleanDefinition(false, 'ALL_PAPER_SWITCH'),
  'autoTask.enabled': booleanDefinition(false, 'AUTO_TASK_SWITCH'),
  'autoTask.skipTavern': booleanDefinition(true, 'AUTO_TASK_TAVERN'),
  'autoTask.skipMail': booleanDefinition(true, 'AUTO_TASK_SKIP_MAIL'),
  'autoTask.skipDailyGeneralBag': booleanDefinition(true, 'AUTO_TASK_SKIP_DAILY_WU_JIANG'),
  'autoTask.skipSignTrialCard': booleanDefinition(true, 'AUTO_SIGN_SKIP_SWITCH'),
  'autoTask.skipDiJiaQuan': booleanDefinition(true, 'AUTO_TASK_SKIP_DI_JIA_QUAN'),
  'autoTask.skipHuanLeDou': booleanDefinition(true, 'AUTO_TASK_SKIP_HUAN_LE_DOU'),
  'rogue.mapEnabled': booleanDefinition(true, 'ROGUE_CITY_SWITCH'),
  'rogue.hideStory': booleanDefinition(false, 'ROGUE_STORY_SWITCH'),
  'assist.extraEnabled': booleanDefinition(false, 'EXTRA_ASSIST_SWITCH'),
  'assist.autoBotEnabled': booleanDefinition(false),
  'assist.autoHGEnabled': booleanDefinition(false),
  'assist.baiShengEnabled': booleanDefinition(false),
  'assist.autoBotTavernTarget': {
    defaultValue: 'none',
    previousStorageKey: 'XC_AUTO_BOT_TAVERN_TARGET',
    parse(value) {
      return value === 'none' || value === 'dailyGame' || value === 'dailyWin' || value === 'weeklyWin'
        ? value
        : undefined;
    }
  },
  'update.dismissedVersion': {
    defaultValue: '',
    parse(value) {
      return typeof value === 'string' ? value : undefined;
    }
  }
};

export function getDefaultConfig(): XiaochaoConfig {
  return Object.fromEntries(
    Object.entries(CONFIG_SCHEMA).map(([key, definition]) => [key, definition.defaultValue])
  ) as unknown as XiaochaoConfig;
}
