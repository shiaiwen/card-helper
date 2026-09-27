import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export interface BlockSetting {
  key: XiaochaoConfigKey & `block.${string}`;
  /** legacy 面板里对应开关的 input id，迁移时用于关闭并移除旧控件。 */
  legacyInputId: string;
  label: string;
  tooltip?: string;
}

export const BLOCK_EFFECT_SETTINGS: readonly BlockSetting[] = [
  {
    key: 'block.shaEffect',
    legacyInputId: 'blockShaEffectSwitch',
    label: '杀特效',
    tooltip: '屏蔽普通杀和属性杀的命中特效'
  },
  {
    key: 'block.healEffect',
    legacyInputId: 'blockHealEffectSwitch',
    label: '回血特效',
    tooltip: '屏蔽牌局中的回血动画'
  },
  {
    key: 'block.jinnangEffect',
    legacyInputId: 'blockJinnangEffectSwitch',
    label: '锦囊特效',
    tooltip: '屏蔽无中生有、南蛮、无懈等锦囊动画'
  },
  {
    key: 'block.killEffect',
    legacyInputId: 'blockKillEffectSwitch',
    label: '击杀特效',
    tooltip: '屏蔽角色被击杀时的终结特效'
  },
  {
    key: 'block.otherSkinState',
    legacyInputId: 'blockSkinStateSwitch',
    label: '他人动态',
    tooltip: '将其他角色的动态皮肤按静态形态显示'
  },
  {
    key: 'block.laoXianWindow',
    legacyInputId: 'skipLaoXianWindowSwitch',
    label: '老仙特效',
    tooltip: '自动关闭南华老仙的天书特效窗口'
  },
  {
    key: 'block.entranceEffect',
    legacyInputId: 'blockEntranceEffectSwitch',
    label: '登场动画',
    tooltip: '屏蔽武将、皮肤及山河首领进场动画'
  },
  {
    key: 'block.interactEffect',
    legacyInputId: 'blockInteractEffectSwitch',
    label: '牌局互动',
    tooltip: '屏蔽鲜花、鸡蛋等牌局互动动画'
  },
  {
    key: 'block.mvpWindow',
    legacyInputId: 'skipMvpWindowSwitch',
    label: 'MVP结算',
    tooltip: '跳过牌局结束后的MVP展示'
  }
];

export const BLOCK_OTHER_SETTINGS: readonly BlockSetting[] = [
  {
    key: 'block.adWindow',
    legacyInputId: 'skipAdWindowSwitch',
    label: '广告',
    tooltip: '屏蔽大厅自动弹出的活动广告'
  },
  {
    key: 'block.noticeWindow',
    legacyInputId: 'skipNoticeWindowSwitch',
    label: '狗托',
    tooltip: '屏蔽顶部滚动的狗托弹幕'
  },
  {
    key: 'block.factionSlogan',
    legacyInputId: 'blockFactionSloganSwitch',
    label: '口号',
    tooltip: '屏蔽开局时玩家自动发送的势力口号'
  },
  {
    key: 'block.taskRedDot',
    legacyInputId: 'redDotBlockSwitch',
    label: '任务红点',
    tooltip: '隐藏任务相关的红点提示'
  },
  {
    key: 'block.packageWindow',
    legacyInputId: 'skipPackageWindowSwitch',
    label: '开包动画',
    tooltip: '屏蔽武将、皮肤等开包结果弹窗'
  },
  {
    key: 'block.probWindow',
    legacyInputId: 'skipProbWindowSwitch',
    label: '出货动画',
    tooltip: '屏蔽祈愿台翻翻乐等出货弹窗'
  }
];

export const ALL_BLOCK_SETTINGS: readonly BlockSetting[] = [
  ...BLOCK_EFFECT_SETTINGS,
  ...BLOCK_OTHER_SETTINGS
];

export type BlockSettingKey = BlockSetting['key'];
