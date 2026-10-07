/**
 * 自动托管底层动作：按钮优先级、托管请求条件、决策状态刷新与回退。
 */

export const DEAL_INTERVAL_MS = 400;
export const OFFICIAL_WAIT_MS = 1000;
export const LOCAL_BEFORE_TRUSTEE_MS = 3000;
export const TRUSTEE_COOLDOWN_MS = 3000;
export const SKIP_SELECT_SKILL_ID = 700;

export type AutoBotMode = 'off' | 'ai' | 'local' | 'trustee';

export interface AutoBotDecisionState {
  key: string;
  firstSeenAt: number;
  fallbackLevel: 0 | 1 | 2;
  localStartedAt: number;
  lastOfficialActionAt: number;
  trusteeRequestedAt: number;
  trusteeAttempts: number;
}

export interface AutoBotHelpRequest {
  skillId?: number;
  cardIds: number[];
  seatIds: number[];
  buttonName?: string;
  optionIndex?: number;
  actionable: boolean;
}

/** 新建一次出牌决策的计时状态。 */
export function emptyDecisionState(key: string, now: number): AutoBotDecisionState {
  return {
    key,
    firstSeenAt: now,
    fallbackLevel: 0,
    localStartedAt: 0,
    lastOfficialActionAt: 0,
    trusteeRequestedAt: 0,
    trusteeAttempts: 0
  };
}

/** 局面没变就沿用旧计时，局面变了就重新计时。 */
export function refreshDecisionState(
  previous: AutoBotDecisionState | null,
  key: string,
  now: number
): AutoBotDecisionState {
  if (!previous || previous.key !== key) return emptyDecisionState(key, now);
  return previous;
}

/**
 * 官方推荐超时后改用本地规则，本地超时再点托管。
 */
export function advanceFallback(
  state: AutoBotDecisionState,
  now: number,
  options: { officialActed?: boolean; officialAvailable?: boolean }
): AutoBotDecisionState {
  if (options.officialActed) {
    return { ...state, lastOfficialActionAt: now };
  }
  if (state.fallbackLevel === 0) {
    const waited = now - state.firstSeenAt;
    if (!options.officialAvailable || waited >= OFFICIAL_WAIT_MS) {
      return { ...state, fallbackLevel: 1, localStartedAt: now };
    }
    return state;
  }
  if (state.fallbackLevel === 1 && state.localStartedAt && now - state.localStartedAt >= LOCAL_BEFORE_TRUSTEE_MS) {
    return { ...state, fallbackLevel: 2 };
  }
  return state;
}

/** 本家回合、回退已经两档、且冷却结束时才请求托管。 */
export function canRequestTrustee(state: AutoBotDecisionState, now: number, isSelfTurn: boolean): boolean {
  if (!isSelfTurn) return false;
  if (state.fallbackLevel < 2) return false;
  if (state.trusteeAttempts >= 1) return false;
  if (state.trusteeRequestedAt && now - state.trusteeRequestedAt < TRUSTEE_COOLDOWN_MS) return false;
  return true;
}

/** 判断当前模式能否使用官方托管。 */
export function officialAiAllowed(input: {
  enabled: boolean;
  modeType?: number;
  modeLabel?: string;
  trusteeAiManual?: boolean | null;
  canOpenAiHelp?: boolean | null;
}): boolean {
  if (!input.enabled) return false;
  if (input.modeType === 74 || /身份(?:军争)?演武|军争演武/.test(String(input.modeLabel || ''))) return true;
  if (input.trusteeAiManual === false && input.canOpenAiHelp === false) return false;
  if (input.trusteeAiManual === true || input.canOpenAiHelp === true) return true;
  return input.trusteeAiManual !== false;
}

/** 把多组输入收成非 0 的数字列表。 */
export function collectNumberList(...groups: unknown[]): number[] {
  const result: number[] = [];
  for (const group of groups) {
    const items = Array.isArray(group) ? group : group == null || group === '' ? [] : [group];
    for (const item of items) {
      const value = Number(item);
      if (!Number.isFinite(value) || value === 0) continue;
      result.push(value);
    }
  }
  return result;
}

/** 把一次求助请求收成指纹，用来判断是不是同一次操作。 */
export function helpFingerprint(help: AutoBotHelpRequest, extras = ''): string {
  return [
    help.skillId || 0,
    help.cardIds.join(','),
    help.seatIds.join(','),
    help.buttonName || '',
    help.optionIndex ?? '',
    help.actionable ? 1 : 0,
    extras
  ].join('|');
}

/** 选将列表里取第一张还能选的武将。 */
export function firstSelectableGeneral(generalUis: unknown): unknown | null {
  if (!Array.isArray(generalUis) || !generalUis.length) return null;
  return generalUis.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return record.CanSelect !== false && record.visible !== false;
  }) ?? generalUis[0];
}

/** 按牌名决定确认按钮的点击顺序。 */
export function buttonOrderForCard(name: string, dyingAlly: boolean, vsWeakAi: boolean): number[] {
  if (['铁索'].includes(name)) return [0];
  if (['无懈', '国无'].includes(name) && vsWeakAi) return [3, 1, 0, 2];
  if ((['桃', '粽', '生死'].includes(name) || name === '落井') && dyingAlly) return [1, 2, 3, 0];
  return [0, 1, 2, 3];
}
