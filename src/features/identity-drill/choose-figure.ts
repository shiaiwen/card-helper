/**
 * 八人自选身份的座位顺序对应身份：主公、忠臣、忠臣、内奸，其余为反贼。
 * 身份编号与牌局内 Figure 一致。
 */
const FIGURE_BY_SEAT_ORDER = [1, 2, 2, 4, 3, 3, 3, 3] as const;

export function figureForChooseIdentityOrder(order: number): number {
  return FIGURE_BY_SEAT_ORDER[order] ?? 0;
}

export function figureByClientOrder(clientIds: readonly unknown[], clientId: unknown): number {
  if (clientIds.length !== FIGURE_BY_SEAT_ORDER.length) return 0;
  const key = normalizeClientId(clientId);
  if (!key) return 0;
  const order = clientIds.findIndex((id) => normalizeClientId(id) === key);
  return figureForChooseIdentityOrder(order);
}

function normalizeClientId(value: unknown): string {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? String(id) : '';
}
