/**
 * 人机判断与需要提示的玩法。
 * 账号编号大于 AI_CLIENT_ID_MIN 视为人机；目前只在排位和斗地主提示。
 */

/** 大于该编号的账号是人机。 */
export const AI_CLIENT_ID_MIN = 0xee6b2800;

/** 编号无效或不超过阈值时不是人机。 */
export function isAiClientId(clientId: unknown): boolean {
  const id = Number(clientId);
  return Number.isFinite(id) && id > AI_CLIENT_ID_MIN;
}

/** 模式名里出现排位或斗地主时，才检查对局里有没有人机。 */
export function isAiTipModeLabel(label: string): boolean {
  return label.includes('排位') || label.includes('斗地主');
}
