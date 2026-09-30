/** 山河地图透视：对照 app.bak 的类型与常量。 */

export interface RogueCitySpot {
  id: string | number;
  event: string | number;
}

export interface RogueCityMeta {
  x: number;
  y: number;
  boss?: unknown;
  cp?: string;
  spell?: unknown;
  desc?: unknown;
  name?: string;
}

export interface RogueFightMeta {
  name?: string;
  text?: string;
  get?: string;
  lost?: string;
  fight?: string;
  generals?: unknown[];
  isSingle?: unknown;
  event?: string | number;
}

export interface RogueChooseMeta {
  get?: string;
  lost?: string;
  camp?: boolean;
  generals?: unknown[];
  name?: string;
  text?: string;
}

/** 同步包里的成长上下文（对照 app.bak `ic` / `RC`）。 */
export interface RogueMapRuntime {
  difficulty: number;
  seasonId: number;
  accday: number;
  passChapter: number;
  chapterId: number;
  seedItem: unknown[];
}

export interface RogueMapConfigData {
  Rcity: Record<string, RogueCityMeta>;
  Rfight: Record<string, RogueFightMeta>;
  Radventure: Record<string, string>;
  RadventureChoices: Record<string, Array<string | number>>;
  Rchoose: Record<string, RogueChooseMeta>;
  text: Record<string, string>;
  /** Tactics/Spell/Card 合并表，对照 app.bak `hG`/`Rplot`。 */
  Rplot: Record<string, RoguePlotMeta>;
  /** RewardGroup+Other，对照 app.bak `Lw`。 */
  Rreward: Record<string, string>;
  /** EnemyGrowth：`moon_diffnum` */
  Rgrow: Record<string, Record<string, unknown>>;
  /** EnemyNumGrowth：`type_num` */
  RnumGrow: Record<string, Record<string, unknown>>;
  /** EnemyDiffGrowth：`diffnum_chap` */
  RdiffGrow: Record<string, Record<string, unknown>>;
  /** DifficultySelection：seasonId → difID → row */
  Rdiff: Record<string, Record<string, Record<string, unknown>>>;
  /** Chapter boss 位：seasonId → chapterId → bosslocation */
  RchapBoss: Record<string, Record<string, number>>;
  RcurSeason: number;
}

export interface RoguePlotMeta {
  name: string;
  desc?: string;
  type?: number;
  spellid?: number;
  money?: unknown;
  level?: unknown;
  school?: unknown;
}

export type RoguePanelLineKind = 'general' | 'stats' | 'reward';

export interface RoguePanelLine {
  kind: RoguePanelLineKind;
  text: string;
  warning?: boolean;
}

export interface RogueRect {
  id?: string | number;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
}

export interface RogueCityGeometry extends RogueRect {
  visualArea: RogueRect;
}

export interface RogueMapPanelLayout {
  id: string | number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
  title: string;
  lines: RoguePanelLine[];
}

/** 面板与引导线常量（对照 app.bak Rc…Rt / Rd…RT）。 */
export const ROGUE_MAP_STYLE = Object.freeze({
  panelWidth: 190,
  labelPad: 6,
  topSpacer: 6,
  cornerRadius: 6,
  backgroundAlpha: 0.7,
  layoutGap: 4,
  viewportPad: 4,
  cityDefaultWidth: 250,
  cityDefaultHeight: 100,
  pollMs: 700,
  cityZOrder: 999,
  leaderZOrder: 998,
  dashLength: 7,
  dashGap: 5,
  leaderLineWidth: 3,
  leaderColor: '#e56666',
  // 对照 app.bak KQ：标题强制 #ff7043；RX.TITLE 其它字段仍用 17/bold
  titleColor: '#ff7043',
  titleSize: 17,
  // RX.GENERAL
  generalColor: '#f2de9c',
  generalWarningColor: 'rgb(240, 65, 85)',
  generalSize: 17,
  // RX.GET_INFO
  bodyColor: '#f2de9c',
  bodySize: 15,
  // Ro 属性行
  detailColor: '#c9b98f',
  detailSize: 14,
  panelFill: '#241f18',
  panelStroke: 'rgba(242,222,156,0.45)',
  dividerColor: 'rgba(242,222,156,0.35)',
  difficultyRaidGate: 100
});

export const EMPTY_ROGUE_MAP_RUNTIME: RogueMapRuntime = Object.freeze({
  difficulty: 0,
  seasonId: 1,
  accday: 0,
  passChapter: 0,
  chapterId: 0,
  seedItem: Object.freeze([]) as unknown[]
});
