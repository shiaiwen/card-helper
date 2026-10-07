/**
 * 礼包码自动兑换：登录后拉取远程码列表，对本账号尚未尝试过的码逐个填入游戏兑换窗。
 * 尝试记录按 ClientID 写入 localStorage，避免重复兑换。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createTaskScope } from '../skin-background/skin-runtime.ts';
import { createAutoTaskWindows } from '../auto-task/auto-task-windows.ts';

type UnknownRecord = Record<string, unknown>;

export interface GiftCodeControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  endpoint?: string;
  fetcher?: typeof fetch;
}

const DEFAULT_ENDPOINT = 'https://95chong.cn/api/game-gift-codes';
const ATTEMPT_SUFFIX = '::XC_GAME_GIFT_CODE_ATTEMPTS';
const ACCOUNT_POLL_MS = 1_000;
const LOGIN_DELAY_MS = 5_000;
const EXCHANGE_INTERVAL_MS = 12_000;
const WINDOW_RELEASE_MS = 10_000;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 从 UserInfoManger 读取当前 ClientID，作为账号维度的兑换记录键。 */
function accountId(locator: LayaObjectLocator): string {
  const manager = locator.manager('UserInfoManger');
  const self = asRecord(manager?.Self) ?? asRecord(manager?.self);
  const value = self?.ClientID
    ?? self?.ClientId
    ?? self?.clientID
    ?? self?.clientId
    ?? manager?.ClientID
    ?? manager?.ClientId;
  return value == null ? '' : String(value);
}

/** 规范化远程返回的码列表：去空、去重、保序。 */
function normalizeCodes(value: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const code = String(typeof item === 'string' ? item : asRecord(item)?.code ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

function readAttempts(storage: GiftCodeControllerOptions['storage'], id: string): Set<string> {
  try {
    const parsed = JSON.parse(storage?.getItem(`${id}${ATTEMPT_SUFFIX}`) || '[]');
    return new Set((Array.isArray(parsed) ? parsed : []).map(String).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeAttempts(
  storage: GiftCodeControllerOptions['storage'],
  id: string,
  attempts: Set<string>
): void {
  try {
    storage?.setItem(`${id}${ATTEMPT_SUFFIX}`, JSON.stringify([...attempts]));
  } catch {
    // 无存储权限时仍允许本次运行继续兑换。
  }
}

/** 安装礼包码控制器；返回 dispose（清定时器与窗口引用）。 */
export function installGiftCodeController(options: GiftCodeControllerOptions = {}): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const tasks = createTaskScope();
  const windows = createAutoTaskWindows(globalObject, locator, tasks);
  const scheduledAccounts = new Set<string>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  /** GET 远程礼包码接口，校验 ok 字段后返回码数组。 */
  async function fetchCodes(): Promise<string[]> {
    if (!fetcher) return [];
    const response = await fetcher(endpoint, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error(`礼包码服务返回 ${response.status}`);
    const payload = asRecord(await response.json());
    if (!payload?.ok) throw new Error(String(payload?.error || payload?.message || '礼包码服务异常'));
    return normalizeCodes(payload.codes);
  }

  /** 对指定账号尝试兑换所有尚未记录过的码；窗口未就绪则放弃等待下次登录。 */
  async function redeemAccount(id: string): Promise<void> {
    // 延迟期间若切换账号，不为旧账号继续执行。
    if (!id || accountId(locator) !== id || tasks.disposed) return;
    let codes: string[];
    try {
      codes = await fetchCodes();
    } catch (error) {
      console.warn('[礼包码] 拉取失败:', error);
      return;
    }
    const attempts = readAttempts(storage, id);
    const pending = codes.filter((code) => !attempts.has(code));
    if (!pending.length) return;
    console.info(`[礼包码] 发现 ${pending.length} 个新礼包码，开始自动兑换`);
    for (const code of pending) {
      if (tasks.disposed || accountId(locator) !== id) return;
      const exchange = windows.get('GiftExchangeWindow');
      const input = asRecord(exchange?.giftInput);
      if (!exchange || !input || typeof exchange.getClicked !== 'function') {
        console.warn('[礼包码] 游戏兑换窗口尚未就绪，稍后登录时重试');
        return;
      }
      try {
        input.text = code;
        (exchange.getClicked as () => void).call(exchange);
        attempts.add(code);
        writeAttempts(storage, id, attempts);
        console.info('[礼包码] 已尝试兑换:', code);
      } catch (error) {
        console.warn('[礼包码] 兑换失败:', code, error);
      } finally {
        windows.release('GiftExchangeWindow', WINDOW_RELEASE_MS);
      }
      if (code !== pending[pending.length - 1]) {
        await new Promise<void>((resolve) => tasks.later(resolve, EXCHANGE_INTERVAL_MS));
      }
    }
  }

  /** 新账号首次出现时延迟 LOGIN_DELAY_MS 再开始兑换。 */
  function scheduleCurrentAccount(): void {
    const id = accountId(locator);
    if (!id || scheduledAccounts.has(id)) return;
    scheduledAccounts.add(id);
    tasks.later(() => void redeemAccount(id), LOGIN_DELAY_MS);
  }

  scheduleCurrentAccount();
  pollTimer = setInterval(scheduleCurrentAccount, ACCOUNT_POLL_MS);

  return () => {
    if (pollTimer != null) clearInterval(pollTimer);
    pollTimer = null;
    windows.dispose();
    tasks.dispose();
  };
}
