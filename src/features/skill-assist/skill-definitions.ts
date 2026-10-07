/** 卡牌页技能辅助模块的静态定义；新增技能只注册，不改 UI 壳。 */
export interface SkillAssistDefinition {
  id: string;
  title: string;
  /** 游戏内技能 ID；可与 spellNames 解析结果合并。 */
  skillIds: number[];
  spellNames?: string[];
  generalNames?: string[];
  /** 只在本家拥有该技能时显示（资援）。 */
  selfOnly?: boolean;
  /** 不随座位技能显示，只在技能发动算出结果后弹出（称象）。 */
  triggerOnly?: boolean;
  /** 该技能面板展示的明牌分区；多数技能读 unknown 或自有 zone。 */
  shownCardZoneId?: string;
  /** 是否展示花色序列（权变 / 渐营 / 乱击）。 */
  showSuitSequence?: boolean;
  /** 是否展示结果文案区（宴戏等）。 */
  showResult?: boolean;
}

/** 权变（7011）：首次使用某花色手牌时看牌堆顶；出牌阶段至多使用 X 张非装备手牌。 */
export const QUANBIAN_SKILL_ID = 7011;
/** 渐营（491）：本阶段使用的牌与上一张点数或花色相同时摸牌。 */
export const JIANYING_SKILL_ID = 491;
export const YANJIAO_SKILL_ID = 0x3b1;
export const YANJIAO_PANEL_ID = 'yanjiao';
export const ZIYUAN_PANEL_ID = 'mizhu';
/** 乱击（2143）：不能使用本回合乱击用过的花色。 */
export const LUANJI_SKILL_ID = 2143;
export const CHENGXIANG_SKILL_ID = 441;
export const JIE_CHENGXIANG_SKILL_ID = 3492;
export const YICHENG_SKILL_ID = 3440;
export const SHUANGXIONG_SKILL_ID = 3269;
export const JIZHAN_SKILL_ID = 3033;
export const HEZHONG_SKILL_ID = 3329;
/** 权道（神孙权）：按手牌里杀与普通锦囊的张数选择效果。 */
export const QUANDAO_SKILL_ID = 3184;
export { YANXI_SKILL_IDS } from './yanxi.ts';
export { MINGPAI_ZONE } from '../mingpai/mingpai-zones.ts';

export const SKILL_ASSIST_DEFINITIONS: readonly SkillAssistDefinition[] = Object.freeze([
  {
    id: 'quanbian',
    title: '权变',
    skillIds: [QUANBIAN_SKILL_ID],
    spellNames: ['权变'],
    shownCardZoneId: 'unknown',
    showSuitSequence: true
  },
  {
    id: 'jianying',
    title: '渐营',
    skillIds: [JIANYING_SKILL_ID],
    spellNames: ['渐营'],
    showSuitSequence: true
  },
  {
    id: 'yanxi',
    title: '宴戏',
    skillIds: [0x1b68, 0x1b69],
    spellNames: ['宴戏'],
    shownCardZoneId: 'yanxi',
    showResult: true
  },
  {
    id: 'zhouxuan',
    title: '周旋',
    skillIds: [3065],
    spellNames: ['周旋'],
    selfOnly: true,
    showResult: true
  },
  {
    id: YANJIAO_PANEL_ID,
    title: '严教',
    skillIds: [YANJIAO_SKILL_ID],
    spellNames: ['严教'],
    showResult: true
  },
  {
    id: ZIYUAN_PANEL_ID,
    title: '资援',
    skillIds: [291],
    spellNames: ['资援', '界资援'],
    selfOnly: true,
    showResult: true
  },
  // 乱击暂时停用，实测前不显示。
  // {
  //   id: 'luanji',
  //   title: '乱击',
  //   skillIds: [LUANJI_SKILL_ID],
  //   showSuitSequence: true
  // },
  {
    id: 'chengxiang',
    title: '称象',
    skillIds: [CHENGXIANG_SKILL_ID, JIE_CHENGXIANG_SKILL_ID],
    spellNames: ['称象', '界称象'],
    triggerOnly: true,
    showResult: true
  },
  {
    id: 'yicheng',
    title: '易城',
    skillIds: [YICHENG_SKILL_ID],
    spellNames: ['易城'],
    showResult: true
  },
  {
    id: 'shuangxiong',
    title: '双雄',
    // 101 是标准版（判定获得牌），不需要提示；不按名字解析以免把它带进来。
    skillIds: [SHUANGXIONG_SKILL_ID, 14169],
    selfOnly: true,
    showResult: true
  },
  {
    id: 'jizhan',
    title: '吉占',
    skillIds: [JIZHAN_SKILL_ID],
    spellNames: ['吉占'],
    showResult: true
  },
  {
    id: 'hezhong',
    title: '和衷',
    skillIds: [HEZHONG_SKILL_ID],
    spellNames: ['和衷'],
    showResult: true
  },
  {
    id: 'quandao',
    title: '权道',
    skillIds: [QUANDAO_SKILL_ID],
    spellNames: ['权道'],
    generalNames: ['神孙权'],
    selfOnly: true,
    showResult: true
  }
]);
