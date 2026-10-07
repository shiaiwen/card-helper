/**
 * 自动托管模式检测：识别当前玩法种类、建房默认参数、百胜武将选择。
 */

export type AutoBotKind = 1 | 11 | 28 | 29;

export const ROGUE_1V1_SCENE = 'RogueLike1v1Scene';
export const CREATE_TABLE_PASSWORD = '439';
export const HIDDEN_BAI_SHENG_GENERAL_IDS = new Set([
  0x166, 0x1b59, 0x1b5a, 0x1b5b, 0x1b5c, 0x1b5d, 0x1b5f, 0x1b60
]);

/** 按场景和模式名区分山河图、老友和普通托管。 */
export function detectAutoBotKind(input: {
  sceneName?: string;
  modeId?: number;
  modeLabel?: string;
}): AutoBotKind {
  if (input.sceneName === ROGUE_1V1_SCENE) return 11;
  const label = String(input.modeLabel || '');
  if (label.includes('国战老友')) return 28;
  if (label.includes('身份老友')) return 29;
  return 1;
}

export type HallCreatePlan = 'none' | 'country' | 'junzheng-drill' | 'identity-drill';

/** 只在这三个大厅页建房：身份演武、国战演武、欢乐。 */
export function hallCreatePlan(label: string): HallCreatePlan {
  const text = String(label || '').replace(/\s/g, '');
  if (text.includes('国战演武')) return 'identity-drill';
  if (text.includes('身份演武')) return 'identity-drill';
  if (text.includes('欢乐') && !text.includes('演武')) return 'identity-drill';
  return 'none';
}

/** 非托管房、非百胜时，房主只接管出牌，不补人机、不代开。 */
export function shouldHostFillAndStart(input: {
  managedRoom: boolean;
  baiSheng: boolean;
  kind: AutoBotKind;
}): boolean {
  if (input.kind === 28 || input.kind === 29) return true;
  return input.managedRoom || input.baiSheng;
}

/** 把难度数字换成建房界面上的小杀文案。 */
export function aiPromptLabel(level: number): string {
  if (level >= 3) return '小杀(王者)';
  if (level === 2) return '小杀(高级)';
  return '小杀(普通)';
}

/** 建房窗口填上模式、时间和密码。 */
export function applyCreateTableDefaults(windowInstance: {
  showMoreHandler?: () => void;
  modeBox?: { labels?: unknown[]; selectedIndex?: number };
  timeBox?: { selectedIndex?: number };
  banItemBox?: { selected?: boolean };
  passwordInput?: { text?: string };
}, options: { preferIdentity?: boolean } = {}): void {
  windowInstance.showMoreHandler?.();
  const labels = windowInstance.modeBox?.labels;
  if (Array.isArray(labels) && labels.length && windowInstance.modeBox) {
    const identity = options.preferIdentity
      ? labels.findIndex((label) => String(label).trim() === '自选身份')
      : -1;
    windowInstance.modeBox.selectedIndex = identity >= 0 ? identity : labels.length - 1;
  }
  if (windowInstance.timeBox) windowInstance.timeBox.selectedIndex = 1;
  if (windowInstance.banItemBox) windowInstance.banItemBox.selected = true;
  if (windowInstance.passwordInput) windowInstance.passwordInput.text = CREATE_TABLE_PASSWORD;
}

/** 百胜点将优先沿用当前武将，否则换一个未完成的。 */
export function pickBaiShengGeneralId(
  unfinished: number[],
  currentId: number,
  hidden: ReadonlySet<number> = HIDDEN_BAI_SHENG_GENERAL_IDS
): number {
  const usable = unfinished.filter((id) => id > 0 && !hidden.has(id));
  if (currentId > 0 && usable.includes(currentId)) return currentId;
  return usable.find((id) => id !== currentId) || 0;
}

/** 除指定座位外是否全是人机。 */
export function allOthersAreAi(seats: Array<{ ai?: unknown }>, selfIndex = 0): boolean {
  return seats.every((seat, index) => index === selfIndex || !!seat.ai);
}
