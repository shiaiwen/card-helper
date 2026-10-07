/**
 * 自动换将（盖主速刷）常量与纯函数：黄盖识别、苦肉节拍、确认按钮索引、挂机踢出判定。
 */

export const KUROU_SKILL_ID = 62;
export const HUANG_GAI_NAME = '黄盖';
export const LEAVE_TABLE_IDLE_WHY = 25;
export const CONFIRM_BUTTON_INDICES = [3, 1, 0] as const;
export const KUROU_INTERVAL_MS = 500;
export const RESTART_DELAY_MS = 1200;
export const AI_PROMPT_TITLE = '系统提示';
export const AI_PROMPT_LABEL = '小杀(普通)';

export type KurouTickAction = 'skill' | 'confirm';

/** 苦肉节拍：偶数拍点技能，奇数拍点确认。 */
export function nextKurouAction(tick: number): KurouTickAction {
  return tick % 2 === 0 ? 'skill' : 'confirm';
}

export function isIdleKickWhy(why: unknown): boolean {
  return Number(why) === LEAVE_TABLE_IDLE_WHY;
}

export function generalDisplayName(generalUi: unknown): string {
  if (!generalUi || typeof generalUi !== 'object') return '';
  const record = generalUi as Record<string, unknown>;
  const general = (record.general ?? record.General ?? record.card ?? record.Card) as Record<string, unknown> | undefined;
  return String(general?.name ?? general?.Name ?? record.name ?? '');
}

/** 在选将列表中按显示名查找黄盖。 */
export function findHuangGaiGeneral(generalUis: unknown): unknown | null {
  if (!Array.isArray(generalUis)) return null;
  return generalUis.find((item) => generalDisplayName(item) === HUANG_GAI_NAME) ?? null;
}

export function firstEnabledIndex(items: Array<{ enabled?: boolean } | null | undefined>, indices: readonly number[]): number {
  for (const index of indices) {
    if (items[index]?.enabled) return index;
  }
  return -1;
}

export function skillItemId(item: unknown): number {
  if (!item || typeof item !== 'object') return 0;
  const record = item as Record<string, unknown>;
  const skill = (record.Skill ?? record.skill) as Record<string, unknown> | undefined;
  return Number(skill?.SkillId ?? skill?.ID ?? skill?.id ?? record.SkillId ?? record.skillId ?? 0) || 0;
}

export function isEnabledFlag(item: unknown, key = '_enabled'): boolean {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  return record[key] !== false && record.enabled !== false;
}

export function buttonName(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  return String((item as Record<string, unknown>).name ?? '');
}

export function shouldClickFallbackConfirm(name: string): boolean {
  return /btnOK|btnSure|确定|确认|出牌/.test(name);
}

export function shouldClickFallbackCancel(name: string): boolean {
  return /btnCancel|取消|不出|pass/i.test(name);
}
