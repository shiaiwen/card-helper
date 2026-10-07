/**
 * 自动任务领奖逻辑：识别可领任务并触发领取请求。
 */

const DAILY_RECORD_SUFFIX = '::XC_DAILY_AUTO_CLAIM_RECORD';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 同一个请求键 15 秒内不重复发送。 */
export const CLAIM_THROTTLE_MS = 15_000;

type ClaimStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface DailyRecord {
  day: string;
  keys: string[];
}

/** 北京时间日期串，服务器按北京时间跨天。 */
export function beijingDate(now: number): string {
  return new Date(now + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 北京时间的天序号，用于判断跨天。 */
export function beijingDayIndex(now: number): number {
  return Math.floor((now + BEIJING_OFFSET_MS) / DAY_MS);
}

export interface AutoTaskClaims {
  /** 每日一次：今天没领过才执行；返回 false 表示没发请求，不记为已领。 */
  onceToday(key: string, action: () => unknown): boolean;
  claimedToday(key: string): boolean;
  markClaimedToday(key: string): void;
  /** 节流：15 秒内同键只执行一次。 */
  throttled(key: string, action: () => unknown): boolean;
  /** 仅占用节流窗口，不执行动作。 */
  acquire(key: string): boolean;
}

export function createAutoTaskClaims(
  storage: ClaimStorage | undefined,
  account: () => string,
  now: () => number = Date.now,
  warn: (message: string, ...details: unknown[]) => void = console.warn
): AutoTaskClaims {
  const lastAttempt = new Map<string, number>();

  function storageKey(): string {
    return `${account()}${DAILY_RECORD_SUFFIX}`;
  }

  function readRecord(): DailyRecord {
    const day = beijingDate(now());
    try {
      const parsed = JSON.parse(storage?.getItem(storageKey()) || 'null') as Partial<DailyRecord> | null;
      if (parsed?.day === day && Array.isArray(parsed.keys)) return { day, keys: parsed.keys.map(String) };
    } catch {
      // 记录损坏时视为今天还没领过。
    }
    return { day, keys: [] };
  }

  function claimedToday(key: string): boolean {
    return Boolean(key) && readRecord().keys.includes(key);
  }

  function markClaimedToday(key: string): void {
    if (!key) return;
    const record = readRecord();
    if (record.keys.includes(key)) return;
    record.keys.push(key);
    try {
      storage?.setItem(storageKey(), JSON.stringify(record));
    } catch {
      // 存储不可用时本次运行内仍靠节流防重复。
    }
  }

  function acquire(key: string): boolean {
    const time = now();
    if (time - (lastAttempt.get(key) ?? -Infinity) < CLAIM_THROTTLE_MS) return false;
    lastAttempt.set(key, time);
    return true;
  }

  function run(key: string, action: () => unknown, label: string): unknown {
    try {
      return action();
    } catch (error) {
      warn(`[自动领取] ${label}失败:`, key, error);
      return false;
    }
  }

  return {
    claimedToday,
    markClaimedToday,
    acquire,
    onceToday(key, action) {
      if (!key || claimedToday(key)) return false;
      const result = run(key, action, '每日领取');
      if (result === false) return false;
      markClaimedToday(key);
      return true;
    },
    throttled(key, action) {
      if (!key || !acquire(key)) return false;
      return run(key, action, '领取') !== false;
    }
  };
}
