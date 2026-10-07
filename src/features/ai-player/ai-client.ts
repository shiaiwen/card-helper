/** ClientId 大于该值视为人机。 */
export const AI_CLIENT_ID_MIN = 0xee6b2800;

export function isAiClientId(clientId: unknown): boolean {
  const id = Number(clientId);
  return Number.isFinite(id) && id > AI_CLIENT_ID_MIN;
}

export function isAiTipModeLabel(label: string): boolean {
  return label.includes('排位') || label.includes('斗地主');
}
