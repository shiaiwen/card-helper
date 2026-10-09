/**
 * 人机判断。
 * 账号编号小于 AI_CLIENT_ID_MIN 是真人；达到阈值后，普通机器人和其他高编号分开记。
 */

/** 大于等于该编号的账号是人机。 */
export const AI_CLIENT_ID_MIN = 0xee6b2800;

/** 0 真人，1 其他人机，2 普通机器人。 */
export function aiKind(clientId: unknown, isNormalRobot: unknown): 0 | 1 | 2 {
  const id = Number(clientId);
  if (!Number.isFinite(id) || id < AI_CLIENT_ID_MIN) return 0;
  return isNormalRobot ? 2 : 1;
}

/** 编号达到阈值就是人机。 */
export function isAiClientId(clientId: unknown): boolean {
  return aiKind(clientId, false) !== 0;
}

const CLIENT_ID_KEYS = ['ClientId', 'clientId', 'ClientID'] as const;

/** 只读 ClientId。旁边的小编号不能拿来判断人机。 */
export function readNestedClientId(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return null;
  const bags = [
    record,
    asRecord(record.userData),
    asRecord(record.playerInfo),
    asRecord(record.PlayerInfo)
  ].filter((bag): bag is Record<string, unknown> => bag !== null);
  for (const key of CLIENT_ID_KEYS) {
    for (const bag of bags) {
      const id = bag[key];
      if (id != null && id !== '') return id;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}
