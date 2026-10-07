/**
 * 八人自选身份的座位顺序对应身份：主公、忠臣、忠臣、内奸，其余为反贼。
 * 身份编号与牌局内 Figure 一致。
 */
const FIGURE_BY_SEAT_ORDER = [1, 2, 2, 4, 3, 3, 3, 3] as const;

/** 按房间座位序号取身份。越界时返回 0，调用方应跳过。 */
export function figureForChooseIdentityOrder(order: number): number {
  return FIGURE_BY_SEAT_ORDER[order] ?? 0;
}

/**
 * 用房间座位表里的账号顺序决定该玩家的身份。
 * 表长不是 8，或账号对不上时返回 0，避免把别的模式写成身份。
 */
export function figureByClientOrder(clientIds: readonly unknown[], clientId: unknown): number {
  if (clientIds.length !== FIGURE_BY_SEAT_ORDER.length) return 0;
  const key = normalizeClientId(clientId);
  if (!key) return 0;
  const order = clientIds.findIndex((id) => normalizeClientId(id) === key);
  return figureForChooseIdentityOrder(order);
}

/** 账号编号统一成字符串再比较，避免数字和字符串对不上。 */
function normalizeClientId(value: unknown): string {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? String(id) : '';
}
