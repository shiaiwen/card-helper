/**
 * 明牌视图分区 ID。
 * 技能面板、座位条、牌堆条都只订阅分区，不各自维护「我看到了哪些牌」。
 * 对照原版 nD 渲染目标：unknown→权变条，yanxi→宴戏条；座位手牌另由 seat-state 投影。
 */
export const MINGPAI_ZONE = Object.freeze({
  /** 身份已知、座位归属仍不确定（原版 #quanBian / unknown）。 */
  UNKNOWN: 'unknown',
  /** 宴戏候选展示条（原版 #yanXi）。 */
  YANXI: 'yanxi'
} as const);

export type MingpaiZoneId = (typeof MINGPAI_ZONE)[keyof typeof MINGPAI_ZONE] | string;
