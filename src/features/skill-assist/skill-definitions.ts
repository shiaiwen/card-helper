/** 卡牌页技能辅助模块的静态定义；新增技能只注册，不改 UI 壳。 */
export interface SkillAssistDefinition {
  id: string;
  title: string;
  /** 游戏内技能 ID；可与 spellNames 解析结果合并。 */
  skillIds: number[];
  spellNames?: string[];
  generalNames?: string[];
  /** 该技能面板展示的明牌分区；多数技能读 unknown 或自有 zone。 */
  shownCardZoneId?: string;
  /** 是否展示花色序列（权变 / 乱击等）。 */
  showSuitSequence?: boolean;
  /** 是否展示结果文案区（宴戏等）。 */
  showResult?: boolean;
}

export const QUANBIAN_SKILL_ID = 0x1eb;
export const YANJIAO_SKILL_ID = 0x3b1;
export const YANJIAO_PANEL_ID = 'yanjiao';
export const ZIYUAN_PANEL_ID = 'mizhu';
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
    id: 'yanxi',
    title: '宴戏',
    skillIds: [0x1b68, 0x1b69],
    spellNames: ['宴戏'],
    shownCardZoneId: 'yanxi',
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
    skillIds: [],
    spellNames: ['资援', '界资援'],
    showResult: true
  }
]);

export function getSkillAssistDefinition(id: string): SkillAssistDefinition | null {
  return SKILL_ASSIST_DEFINITIONS.find((definition) => definition.id === id) ?? null;
}
