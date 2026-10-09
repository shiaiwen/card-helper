/**
 * 礼包码自动兑换：登录后拉取线上码列表，对本账号尚未尝试过的码逐个填入游戏兑换窗。
 * 不读自动领取开关。尝试记录按 UserData.Self.clientId 写入 localStorage，避免重复兑换。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createTaskScope } from '../skin-background/skin-runtime.ts';
import { createAutoTaskWindows } from '../auto-task/auto-task-windows.ts';
import { showToast } from '../../ui/toast/show-toast.ts';

type UnknownRecord = Record<string, unknown>;

export interface GiftCodeControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  endpoint?: string;
  fetcher?: typeof fetch;
  loginDelayMs?: number;
  exchangeIntervalMs?: number;
}

const DEFAULT_ENDPOINT = 'https://95chong.cn/api/game-gift-codes';
const ATTEMPT_SUFFIX = '::XC_GAME_GIFT_CODE_ATTEMPTS';
const ACCOUNT_POLL_MS = 1_000;
const LOGIN_DELAY_MS = 1_000;
const EXCHANGE_INTERVAL_MS = 2_000;
const WINDOW_RELEASE_MS = 2_000;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 账号编号。当前用户在 UserData.Self.clientId，类表上不一定能直接拿到。 */
function accountId(
  userDataSelf: UnknownRecord | null,
  locator: LayaObjectLocator
): string {
  const manager = locator.manager('UserInfoManger');
  const managerSelf = asRecord(manager?.Self) ?? asRecord(manager?.self);
  const value = userDataSelf?.clientId
    ?? userDataSelf?.ClientId
    ?? userDataSelf?.ClientID
    ?? managerSelf?.clientId
    ?? managerSelf?.ClientId
    ?? managerSelf?.ClientID
    ?? manager?.clientId
    ?? manager?.ClientId
    ?? manager?.userID
    ?? manager?.UserID;
  return value == null || value === '' ? '' : String(value);
}

/**
 * UserData 不在管理器事件表里。生日祝福窗不走 Init，调用 refreshIcon 后
 * userData 才指向当前用户。静态 Self 挂在 userData 的构造函数上。
 * 窗口未挂到舞台时立刻关掉。
 */
function readUserDataSelf(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  const classUtils = globalObject.Laya?.ClassUtils as {
    getClass?: (name: string) => { Self?: unknown };
    getInstance?: (name: string, args?: unknown) => UnknownRecord | null;
  } | undefined;
  if (!classUtils) return null;
  const direct = asRecord(classUtils.getClass?.('UserData')?.Self);
  if (direct?.clientId || direct?.ClientId || direct?.ClientID) return direct;
  let wish: UnknownRecord | null = null;
  try {
    wish = asRecord(classUtils.getInstance?.('BirthdayWishWin', null));
    if (typeof wish?.refreshIcon === 'function') (wish.refreshIcon as () => void).call(wish);
  } catch {
    wish = null;
  }
  const userData = asRecord(wish?.userData);
  const ctor = userData ? asRecord(Object.getPrototypeOf(userData)?.constructor) : null;
  const self = asRecord(ctor?.Self) ?? userData;
  if (wish && !wish.parent) {
    try {
      if (typeof wish.Close === 'function') (wish.Close as () => void).call(wish);
      else if (typeof wish.destroy === 'function') (wish.destroy as (all?: boolean) => void).call(wish, true);
    } catch {
      // 临时窗口关掉失败不影响读取账号。
    }
  }
  return self;
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
  const loginDelayMs = options.loginDelayMs ?? LOGIN_DELAY_MS;
  const exchangeIntervalMs = options.exchangeIntervalMs ?? EXCHANGE_INTERVAL_MS;
  const tasks = createTaskScope();
  const windows = createAutoTaskWindows(globalObject, locator, tasks);
  const seenAt = new Map<string, number>();
  const finished = new Set<string>();
  const startedAt = Date.now();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let runningId = '';
  let missingAccountLogged = false;
  let cachedUserDataSelf: UnknownRecord | null = null;
  console.info('[礼包码] 控制器已启动');

  function currentAccountId(): string {
    const cachedId = cachedUserDataSelf?.clientId ?? cachedUserDataSelf?.ClientId ?? cachedUserDataSelf?.ClientID;
    if (cachedId == null || cachedId === '') {
      const found = readUserDataSelf(globalObject);
      const foundId = found?.clientId ?? found?.ClientId ?? found?.ClientID;
      if (foundId != null && foundId !== '') cachedUserDataSelf = found;
    }
    return accountId(cachedUserDataSelf, locator);
  }

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

  /**
   * 兑换当前账号尚未记录的码。
   * 返回 done 表示列表已全部尝试过；retry 表示窗口或网络还没好，下次轮询再试。
   */
  async function redeemAccount(id: string): Promise<'done' | 'retry'> {
    if (!id || currentAccountId() !== id || tasks.disposed) return 'retry';
    let codes: string[];
    try {
      codes = await fetchCodes();
    } catch (error) {
      console.warn('[礼包码] 拉取失败:', error);
      return 'retry';
    }
    const attempts = readAttempts(storage, id);
    const pending = codes.filter((code) => !attempts.has(code));
    if (!pending.length) {
      console.info(`[礼包码] 账号 ${id} 的礼包码都已尝试过`);
      return 'done';
    }
    const notice = `发现 ${pending.length} 个新礼包码，开始自动兑换`;
    console.info(`[礼包码] ${notice}`);
    showToast(notice);
    for (const code of pending) {
      if (tasks.disposed || currentAccountId() !== id) return 'retry';
      const exchange = windows.get('GiftExchangeWindow');
      const input = asRecord(exchange?.giftInput);
      if (!exchange || !input || typeof exchange.getClicked !== 'function') {
        console.warn('[礼包码] 游戏兑换窗口尚未就绪，稍后重试');
        return 'retry';
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
        await new Promise<void>((resolve) => tasks.later(resolve, exchangeIntervalMs));
      }
    }
    return 'done';
  }

  /** 登录满延迟再兑换；窗口未就绪不记完成，下一轮继续。 */
  function scheduleCurrentAccount(): void {
    if (runningId || tasks.disposed) return;
    const id = currentAccountId();
    if (!id) {
      if (!missingAccountLogged && Date.now() - startedAt > 8_000) {
        missingAccountLogged = true;
        console.warn('[礼包码] 还没读到账号编号，兑换未开始');
      }
      return;
    }
    if (finished.has(id)) return;
    const now = Date.now();
    const firstSeen = seenAt.get(id);
    if (firstSeen == null) {
      seenAt.set(id, now);
      console.info(`[礼包码] 当前账号 ${id}，稍后自动兑换`);
      if (loginDelayMs > 0) return;
    }
    if (now - firstSeen < loginDelayMs) return;
    runningId = id;
    void redeemAccount(id).then((result) => {
      if (result === 'done') finished.add(id);
    }).finally(() => {
      if (runningId === id) runningId = '';
    });
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
