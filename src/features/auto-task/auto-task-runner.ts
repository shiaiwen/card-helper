import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import type { TaskScope } from '../skin-background/skin-runtime.ts';
import type { AutoTaskClaims } from './auto-task-claims.ts';
import type { AutoTaskConfigData } from './auto-task-config-data.ts';
import {
  TAVERN_TASK_IDS,
  claimTask,
  collectTasks,
  flattenGameCollection,
  isHuanLeDouItem,
  isTaskExcluded,
  rewardsBlocked,
  rewardsContainDiJiaQuan,
  rewardsContainHuanLeDou,
  taskClaimKey,
  taskIdOf,
  taskRewards,
  type TaskManagerAccess,
  type TaskRuleContext
} from './auto-task-rules.ts';
import type { AutoTaskWindows } from './auto-task-windows.ts';

type UnknownRecord = Record<string, unknown>;

export interface AutoTaskOptions {
  skipTavern: boolean;
  skipMail: boolean;
  skipDailyGeneralBag: boolean;
  skipSignTrialCard: boolean;
  skipDiJiaQuan: boolean;
  skipHuanLeDou: boolean;
}

export interface AutoTaskRunnerDeps {
  locator: LayaObjectLocator;
  windows: AutoTaskWindows;
  claims: AutoTaskClaims;
  tasks: TaskScope;
  enabled(): boolean;
  options(): AutoTaskOptions;
  configData(): AutoTaskConfigData | null;
}

export interface AutoTaskRunner {
  /** 执行一轮全部子步骤（不等待签到等延后动作）。 */
  runPass(): void;
  /** 每日免费武将包。 */
  claimDailyGeneralBag(): void;
  /** 大厅场景切换后补领低欢乐豆（对照 app.bak ga）。 */
  scheduleLowBeanFree(reason: string): void;
}

const LOW_BEAN_THRESHOLD = 600;
const LOW_BEAN_RETRY_DELAYS = [1200, 5000, 11000, 18000, 35000];
const MONTH_CARD_TYPES = [2, 3];
const MONTH_CARD_SYNC_METHODS = [
  'SendClientPrivilegeCardInfoReq',
  'SendClientPrivilegeInfoReq',
  'ReqPrivilegeCardInfo',
  'ReqClientPrivilegeCardInfo',
  'SendPrivilegeCardInfoReq'
];
const TREE_USING_KEY = 'kanshu:treeUsing';
const TREE_ITEM_BASE = 12130001;
const FREE_SHOP_GOODS = [13360001, 11578201];
const DAILY_GENERAL_BAG = { id: 8100101, type: 3 };
const MAIL_SKIP_TITLES = new Set(['道具过期提醒', '不良游戏行为警告']);
const MAIL_UNKNOWN_SENDER = '系统未知好友';
const NEW_FESTIVAL_SIGN_IDS = [71, 72];
const FESTIVAL_SYNC_METHODS: ReadonlyArray<readonly [string, string]> = [
  ['festivalSign:sync:config', 'SendFestivalSignConfigReq'],
  ['festivalSign:sync:data', 'SendClientFestivalSignDataReq'],
  ['festivalSign:sync:newConfig', 'SendNewFestivalSignConfigReq'],
  ['accumulatedSign:sync:config', 'SendAccumlateSignConfigReq'],
  ['accumulatedSign:sync:login', 'SendAccumlateLoginReq']
];
const ACCUMULATED_STATE_METHODS = [
  'GetAccumlateAwdState',
  'GetAccumlateSignAwdState',
  'GetAccumlateLoginAwdState',
  'GetAccumulateAwdState',
  'GetAccumSignAwdState'
];
const ACCUMULATED_REWARD_METHODS = [
  'SendNewClientAccumlateSignGetRewardReq',
  'SendClientAccumlateSignGetRewardReq',
  'SendNewClientAccumlateLoginGetRewardReq',
  'SendClientAccumlateLoginGetRewardReq',
  'SendAccumulateSignGetRewardReq',
  'SendAccumSignGetRewardReq'
];

export function createAutoTaskRunner(deps: AutoTaskRunnerDeps): AutoTaskRunner {
  const { locator, windows, claims, tasks } = deps;
  const newJunDianRuns = new WeakMap<object, Promise<boolean>>();
  let mailRunning = false;
  let generalBagTimerArmed = false;
  let goodsConfigLookup: ((id: unknown) => unknown) | null | undefined;

  const delay = (ms: number) => new Promise<void>((resolve) => tasks.later(resolve, ms));
  const active = () => !tasks.disposed && deps.enabled();

  async function poll<T>(probe: () => T | null | undefined | false, attempts: number, interval: number): Promise<T | null> {
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      if (tasks.disposed) return null;
      try {
        const value = probe();
        if (value) return value;
      } catch {
        // 继续等待。
      }
      if (attempt < attempts) await delay(interval);
    }
    return null;
  }

  function manager(name: string): UnknownRecord | null {
    return locator.manager(name);
  }

  function resolveMethod(target: UnknownRecord | null, owner: string, method: string): ((...args: unknown[]) => unknown) | null {
    if (!target) return null;
    const direct = target[method];
    if (typeof direct === 'function') return direct as (...args: unknown[]) => unknown;
    const name = locator.obfuscatedMethodName(target, owner, method);
    const resolved = name ? target[name] : null;
    return typeof resolved === 'function' ? resolved as (...args: unknown[]) => unknown : null;
  }

  function invoke(target: UnknownRecord | null, owner: string, method: string, ...args: unknown[]): unknown {
    const fn = resolveMethod(target, owner, method);
    return fn ? fn.apply(target, args) : undefined;
  }

  function has(target: UnknownRecord | null, method: string): boolean {
    return typeof target?.[method] === 'function';
  }

  function call(target: UnknownRecord | null, method: string, ...args: unknown[]): unknown {
    const fn = target?.[method];
    return typeof fn === 'function' ? fn.apply(target, args) : undefined;
  }

  /** 物品对象（SgxFPreviewWindow.getGoodConfig），用于读名称与 CheckHasPropItem。 */
  function goodsConfig(itemId: unknown): UnknownRecord | null {
    if (goodsConfigLookup === undefined) {
      const preview = windows.get('SgxFPreviewWindow', null);
      const lookup = preview?.getGoodConfig;
      goodsConfigLookup = typeof lookup === 'function' ? lookup as (id: unknown) => unknown : null;
      windows.release('SgxFPreviewWindow');
    }
    if (!goodsConfigLookup) return null;
    try {
      const found = goodsConfigLookup(itemId);
      return found !== null && typeof found === 'object' ? found as UnknownRecord : null;
    } catch {
      return null;
    }
  }

  function goodsName(itemId: unknown): string {
    const fromConfig = deps.configData()?.goodsNames.get(Number(itemId));
    if (fromConfig) return fromConfig;
    const goods = goodsConfig(itemId);
    const baseInfo = asRecord(goods?.baseInfo);
    return String(baseInfo?.name || baseInfo?.Name || goods?.name || goods?.Name || '');
  }

  function ruleContext(): TaskRuleContext {
    const options = deps.options();
    return {
      skipTavern: options.skipTavern,
      skipDiJiaQuan: options.skipDiJiaQuan,
      skipHuanLeDou: options.skipHuanLeDou,
      taskIds: deps.configData()?.taskIds ?? null,
      goodsName,
      goodsHasPropItem: (itemId) => Boolean(goodsConfig(itemId)?.CheckHasPropItem)
    };
  }

  function blocked(rewards: unknown): boolean {
    return rewardsBlocked(rewards, ruleContext());
  }

  function waitForEvent(target: UnknownRecord, eventName: unknown, action: () => unknown, timeout = 5000): Promise<boolean> {
    if (!eventName || typeof target.once !== 'function') {
      action();
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      const caller = {};
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        call(target, 'off', eventName, caller, onEvent);
        resolve(value);
      };
      const onEvent = () => finish(true);
      const timer = setTimeout(() => finish(false), timeout);
      call(target, 'once', eventName, caller, onEvent);
      try {
        action();
      } catch (error) {
        clearTimeout(timer);
        call(target, 'off', eventName, caller, onEvent);
        reject(error);
      }
    });
  }

  function eventConstant(target: UnknownRecord, name: string): unknown {
    return asRecord(target.constructor)?.[name] ?? target[name];
  }

  // ---------- 任务 ----------

  async function claimTasks(): Promise<void> {
    const taskManager = manager('TaskManager');
    if (!active() || !taskManager) return;
    try {
      await Promise.resolve(call(taskManager, 'getTaskListFromServer'));
    } catch {
      // 同步失败时用本地已有任务。
    }
    const options = deps.options();
    if (!options.skipTavern && has(taskManager, 'reqTaskProgressByIds')) {
      claims.throttled('tavern:sync', () => call(taskManager, 'reqTaskProgressByIds', [...TAVERN_TASK_IDS]));
    }
    await delay(500);
    if (!active()) return;
    const access: TaskManagerAccess = {
      manager: taskManager,
      has: (method) => resolveMethod(taskManager, 'TaskManager', method) !== null,
      call: (method, ...args) => invoke(taskManager, 'TaskManager', method, ...args)
    };
    const context = ruleContext();
    for (const task of collectTasks(access, context).filter((item) => !isTaskExcluded(item, context))) {
      const id = taskIdOf(task);
      if (id === undefined || id === null) continue;
      const rewards = taskRewards(task);
      if (options.skipDiJiaQuan && rewardsContainDiJiaQuan(rewards, context)) continue;
      if (options.skipHuanLeDou && rewardsContainHuanLeDou(rewards, context)) continue;
      if (!claims.acquire(taskClaimKey(access, id, task))) continue;
      let result: unknown = false;
      try {
        result = claimTask(access, id, task, context);
      } catch (error) {
        console.warn('[自动领取] 任务领取失败:', id, error);
        continue;
      }
      if (result !== false) await delay(600);
    }
  }

  // ---------- 活动 ----------

  async function syncNewJunDian(activity: UnknownRecord): Promise<boolean> {
    if (!has(activity, 'SendGetNewJDInfoReq')) return true;
    return waitForEvent(activity, eventConstant(activity, 'NEW_JD_INFO_SUC'), () => call(activity, 'SendGetNewJDInfoReq'));
  }

  async function claimNewJunDianOnce(activity: UnknownRecord): Promise<boolean> {
    if (!has(activity, 'SendGetNewJDRewardReq')) return false;
    if (!await syncNewJunDian(activity) || !activity.HasNewJDRewardRed) return false;
    const level = Number(activity.NewJDLevel);
    if (!Number.isInteger(level) || level < 0) return false;
    const hasBattlePass = level >= 1;
    const pending: Array<{ id: unknown; isBp: boolean }> = [];
    const view = windows.get('NewJunDianViewCtrl', null);
    if (!view) return false;
    try {
      const subView = asRecord(call(view, 'createSubView', 1));
      if (!Array.isArray(subView?.curScoreAwards)) return false;
      for (const award of subView.curScoreAwards as UnknownRecord[]) {
        if (!(Number(subView.currentScore) >= Number(award.Point))) continue;
        for (const isBp of [false, true]) {
          if (isBp && !hasBattlePass) continue;
          const itemId = isBp ? award.FfItemId : award.ItemId;
          const claimed = isBp ? activity.NewJDHaveRewardList_bp : activity.NewJDHaveRewardList;
          if (!(Number(itemId) > 0) || !Array.isArray(claimed) || claimed.includes(award.Id)) continue;
          if (blocked([{ itemId }])) continue;
          pending.push({ id: award.Id, isBp });
        }
      }
    } finally {
      windows.release('NewJunDianViewCtrl');
    }
    let claimedAny = false;
    const rewardEvent = eventConstant(activity, 'NEW_JD_REWARD_REP');
    for (const { id, isBp } of pending) {
      const claimed = isBp ? activity.NewJDHaveRewardList_bp : activity.NewJDHaveRewardList;
      if (Array.isArray(claimed) && claimed.includes(id)) continue;
      if (!claims.acquire(`activity:newJD:${String(id)}:${String(isBp)}`)) continue;
      try {
        const replied = await waitForEvent(activity, rewardEvent, () => call(activity, 'SendGetNewJDRewardReq', id, isBp, false));
        claimedAny = true;
        if (!replied) break;
      } catch (error) {
        console.warn('[自动领取] 节钺令领取失败:', id, isBp, error);
        break;
      }
    }
    if (claimedAny) await syncNewJunDian(activity);
    return claimedAny;
  }

  function claimNewJunDian(activity: UnknownRecord): Promise<boolean> {
    const running = newJunDianRuns.get(activity);
    if (running) return running;
    const run = claimNewJunDianOnce(activity).finally(() => {
      if (newJunDianRuns.get(activity) === run) newJunDianRuns.delete(activity);
    });
    newJunDianRuns.set(activity, run);
    return run;
  }

  function claimWyqjTrialCard(activity: UnknownRecord, taskManager: UnknownRecord): void {
    if (!taskManager.canGetWYQJCard || !resolveMethod(activity, 'ActivityManager', 'SendGetWyqjTiyanCardReq')) return;
    let generalIds: number[] = [];
    try {
      const view = windows.get('WyqjSmallView', { NeedLevel: 0 });
      const items = Array.isArray(view?.items) ? view.items as UnknownRecord[] : [];
      generalIds = items.map((item) => Number(asRecord(item?.vo)?.generalId || 0)).filter((id) => id > 0);
    } catch {
      generalIds = [];
    } finally {
      windows.release('WyqjSmallView');
    }
    if (!generalIds.length) return;
    claims.throttled('activity:wyqj:card', () => invoke(activity, 'ActivityManager', 'SendGetWyqjTiyanCardReq', [generalIds[0]]));
  }

  function claimInviteLogin(activity: UnknownRecord): void {
    if (has(activity, 'SendReqInviteLoginCfg')) claims.throttled('activity:inviteLogin:sync:cfg', () => call(activity, 'SendReqInviteLoginCfg'));
    if (has(activity, 'SendReqInviteLoginInfo')) claims.throttled('activity:inviteLogin:sync:info', () => call(activity, 'SendReqInviteLoginInfo'));
    if (has(activity, 'SendReqInviteLoginAssitRecords')) {
      claims.throttled('activity:inviteLogin:sync:assistRecords', () => call(activity, 'SendReqInviteLoginAssitRecords'));
    }
    let hasRedPoint = false;
    try {
      hasRedPoint = has(activity, 'IsHaveInviteLoginRedPoint')
        ? Boolean(call(activity, 'IsHaveInviteLoginRedPoint'))
        : Boolean(activity.inviteNew_GetCoinnum);
    } catch {
      hasRedPoint = false;
    }
    if (hasRedPoint && has(activity, 'SendReqInviteLoginGetCoin')) {
      claims.throttled('activity:inviteLogin:getCoin', () => call(activity, 'SendReqInviteLoginGetCoin'));
    }
  }

  function huanLeDouInBag(): number | undefined {
    const goodsManager = manager('GameGoodsManager');
    const seen = new Set<unknown>();
    const items: UnknownRecord[] = [];
    for (const key of ['goodsList', 'goodsDict', 'goodsDic', 'GoodsDict', 'goodsMap', 'allGoods']) {
      for (const item of bagEntries(goodsManager?.[key])) {
        if (!seen.has(item)) {
          seen.add(item);
          items.push(item);
        }
      }
    }
    const beans = items.filter((item) => isHuanLeDouItem(goodsBaseId(item)));
    if (!beans.length) return undefined;
    return beans.reduce((sum, item) => {
      const count = Number(item.Count ?? item.count ?? item.Num ?? item.num ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);
  }

  function claimLowBeanFree(gameData: UnknownRecord | null): void {
    if (deps.options().skipHuanLeDou || !has(gameData, 'SendClientGetWeekFreeBeanReq')) return;
    const beans = huanLeDouInBag();
    const ddz = asRecord(gameData?.ddzData) ?? asRecord(gameData?.DdzData);
    const rawFree = ddz?.FreeBeanCount ?? ddz?.freeBeanCount;
    const freeCount = Number(rawFree);
    if (rawFree === undefined || rawFree === null || rawFree === '' || !Number.isFinite(freeCount)) return;
    if (!(beans !== undefined && beans < LOW_BEAN_THRESHOLD && freeCount > 0)) return;
    claims.throttled('activity:lowBeanFree', () => call(gameData, 'SendClientGetWeekFreeBeanReq'));
  }

  function setOutPassRewards(pass: UnknownRecord): unknown[] {
    const rewards: unknown[] = [];
    const vo = asRecord(pass.vo);
    const configured = Number(vo?.reward ?? vo?.Reward ?? pass.rewardLevels ?? pass.reward ?? 0);
    const levels = Number.isFinite(configured) && configured > 0
      ? configured
      : Math.max(arrayLength(pass.awardsLow), arrayLength(pass.awardsHigh));
    const collect = (level: number, high: boolean) => {
      if (has(pass, 'HasGetReward') && call(pass, 'HasGetReward', level, high)) return;
      const claimed = pass[high ? 'awardsHigh' : 'awardsLow'];
      if (Array.isArray(claimed) && claimed[level]) return;
      const reward = asRecord(call(pass, 'GetRewardVO', level, high));
      const list = [reward?.Awards, reward?.awards, reward?.reward, reward?.rewards].find(Array.isArray);
      if (list) rewards.push(...list);
      else if (reward?.ItemID || reward?.itemId || reward?.goodsId) rewards.push(reward);
    };
    for (let level = 1; level <= levels; level += 1) {
      collect(level, false);
      collect(level, true);
    }
    return rewards;
  }

  function claimNewFuLiSetOut(fuli: UnknownRecord): void {
    if (!has(fuli, 'SendSetOutRewardAllReq')) return;
    if (has(fuli, 'SendAllSetOutGidtInfoReq')) claims.throttled('newFuLi:setOut:sync:info', () => call(fuli, 'SendAllSetOutGidtInfoReq'));
    if (has(fuli, 'SendAllTaskInfoReq')) claims.throttled('newFuLi:setOut:sync:task', () => call(fuli, 'SendAllTaskInfoReq'));
    const passes = new Map<string, { id: unknown; data: unknown }>();
    for (const data of flattenGameCollection(fuli.passDataDic)) {
      const record = asRecord(data);
      const rawId = asRecord(record?.vo)?.id ?? record?.passId ?? record?.PassID ?? record?.id ?? record?.ID;
      if (rawId === undefined || rawId === null || rawId === '') continue;
      const numeric = Number(rawId);
      const id = Number.isFinite(numeric) && String(rawId).trim() !== '' ? numeric : rawId;
      if (!passes.has(String(id))) passes.set(String(id), { id, data });
    }
    passes.forEach(({ id, data }) => {
      const pass = asRecord(call(fuli, 'GetPassData', id)) ?? asRecord(data);
      if (!pass || !has(pass, 'HasCanGetReward') || !call(pass, 'HasCanGetReward')) return;
      const rewards = setOutPassRewards(pass);
      if (rewards.length && blocked(rewards)) return;
      claims.throttled(`newFuLi:setOut:${String(id)}`, () => call(fuli, 'SendSetOutRewardAllReq', id));
    });
  }

  async function claimActivities(): Promise<void> {
    const activity = manager('ActivityManager');
    const taskManager = manager('TaskManager');
    if (!active() || !activity || !taskManager) return;
    call(activity, 'SendDDZTLLInfoReq');
    call(activity, 'SendGetJDInfoReq');
    await claimNewJunDian(activity);
    if (!active()) return;
    claimWyqjTrialCard(activity, taskManager);
    claimInviteLogin(activity);
    claimLowBeanFree(manager('ActivityGameDataManager'));
    if (activity.HasDDZTLLRewardRed && !blocked(activity.tllLastCanRewardInfo)) {
      claims.throttled('activity:DDZTLL:0', () => call(activity, 'SendDDZTLLAwardReq', 0, false, true));
    }
    if (activity.HasJDRewardRed && has(activity, 'ReqDrawAllJDRwd') && !blocked(activity.JDShowRewardList)) {
      claims.throttled('activity:JD:all', () => call(activity, 'ReqDrawAllJDRwd'));
    }
    const calcCount = Math.min(Math.floor(Number(taskManager.jdTaskRewardNum ?? taskManager.JdTaskRewardNum ?? 0) / 3), 3);
    for (let index = 1; index <= calcCount; index += 1) {
      if (!call(taskManager, 'HasRewardQuest', index)) {
        claims.throttled(`task:JDCalcQuest:${index}`, () => call(taskManager, 'SendGetJdCalcQuestRewardReq', index));
      }
    }
    const fuli = manager('NewFuLiManager');
    if (fuli) claimNewFuLiSetOut(fuli);
  }

  // ---------- 邮件 ----------

  async function claimMail(): Promise<void> {
    if (mailRunning || !active() || deps.options().skipMail) return;
    mailRunning = true;
    try {
      const mailManager = await poll(() => manager('MailManager'), 20, 500);
      if (!mailManager) return;
      for (const method of ['GetSystemMailList', 'SendClientGetMailListReq']) {
        if (!has(mailManager, method)) continue;
        try {
          call(mailManager, method);
          await delay(1500);
          break;
        } catch (error) {
          console.warn('[自动领取] 同步邮件列表失败:', error);
        }
      }
      await poll(() => Array.isArray(mailManager.systemMailList), 20, 500);
      const mailList = mailManager.systemMailList;
      if (!Array.isArray(mailList)) return;
      const pending = (mailList as UnknownRecord[]).filter((mail) => mail?.mid && mail.hasAttachMent && !mail.Geted);
      if (!pending.length) return;
      const needsWindow = pending.some((mail) => Number(mail.AttachmentType) === 1);
      const mailWindow = needsWindow ? windows.opened('MailWindow') ?? windows.get('MailWindow') : null;
      if (mailWindow && !windows.opened('MailWindow')) windows.release('MailWindow', 30000);
      const content = asRecord(mailWindow?.mailContentWindow);
      const owner = asRecord(mailWindow?.manager) ?? mailManager;
      const activity = manager('ActivityManager');
      if (has(activity, 'AskRechargeInfoAgain')) call(activity, 'AskRechargeInfoAgain');
      await delay(500);
      for (const mail of pending) {
        if (!active()) return;
        const mailId = mail.mid;
        try {
          if (MAIL_SKIP_TITLES.has(String(mail.title)) || !mail.hasAttachMent) continue;
          if (!mail.read && has(owner, 'ReadMail')) {
            call(owner, 'ReadMail', mailId);
            await delay(300);
          }
          const attachmentType = Number(mail.AttachmentType);
          const keys = call(asRecord(mail.attachment), 'getStringKey', 'key');
          const key = Array.isArray(keys) ? keys[0] ?? '' : '';
          const sender = mail.fromUserName && mail.fromUserName !== MAIL_UNKNOWN_SENDER ? mail.fromUserName : '';
          if (attachmentType === 1) {
            if (!content) continue;
            const tab = sender ? 2 : 0;
            call(content, 'ChangeWindow', tab, mail);
            await delay(300);
            const page = asRecord(asRecord(content.winArr)?.[tab]);
            if (!page || !has(page, 'getBtnClick')) continue;
            call(page, 'getBtnClick');
            call(page, 'Close');
            call(content, 'close');
          } else if (attachmentType === 2 && has(owner, 'SendClientDbsGetgmawardReq')) {
            call(owner, 'SendClientDbsGetgmawardReq', key, mailId, sender);
            await delay(800);
          }
          await delay(500);
        } catch (error) {
          console.warn('[自动领取] 单封邮件领取失败:', mailId, mail?.title, error);
        }
      }
    } finally {
      mailRunning = false;
    }
  }

  // ---------- 福利：砍树、月卡 ----------

  function syncWelfare(welfare: UnknownRecord): boolean {
    let synced = false;
    for (const method of MONTH_CARD_SYNC_METHODS) {
      if (!has(welfare, method)) continue;
      try {
        call(welfare, method);
        synced = true;
        break;
      } catch {
        // 尝试下一个同步方法。
      }
    }
    if (has(welfare, 'ReqJbpInfo')) {
      try {
        call(welfare, 'ReqJbpInfo');
        synced = true;
      } catch {
        // 忽略。
      }
    }
    return synced;
  }

  function freeBlessItemEnough(): boolean {
    const bless = manager('BlessManager');
    if (!bless) return false;
    const value = bless.FreeBlessItemEnough;
    if (typeof value === 'function') {
      try {
        return Boolean(value.call(bless));
      } catch {
        return false;
      }
    }
    return Boolean(value);
  }

  function treeItemId(userData: unknown): number {
    const record = asRecord(userData);
    if (!record || Number(record.Status) !== 1) return 0;
    const level = Number(record.Level);
    return Number.isFinite(level) ? level * 100 + TREE_ITEM_BASE : 0;
  }

  function refreshTree(welfare: UnknownRecord): void {
    try {
      call(welfare, 'SaveKanShuPhpData');
    } catch {
      // 忽略。
    }
    try {
      call(welfare, 'ReqJbpInfo');
    } catch {
      // 忽略。
    }
  }

  function refreshTreeOnAward(welfare: UnknownRecord): (() => void) | null {
    const eventName = asRecord(welfare.constructor)?.KANSHU_GET_AWARD;
    if (!eventName || !has(welfare, 'once')) return null;
    const caller = {};
    const handler = () => refreshTree(welfare);
    call(welfare, 'once', eventName, caller, handler);
    return () => call(welfare, 'off', eventName, caller, handler);
  }

  async function claimBlessingTree(welfare: UnknownRecord): Promise<boolean> {
    const itemId = treeItemId(welfare.JbpUserData);
    if (itemId && claims.claimedToday(`kanshu:${itemId}`)) {
      refreshTree(welfare);
      return false;
    }
    if (!itemId) {
      const status = Number(asRecord(welfare.JbpUserData)?.Status);
      if (status !== 0) {
        if (status === 2) refreshTree(welfare);
        return false;
      }
      if (!claims.claimedToday(TREE_USING_KEY)) {
        if (!has(welfare, 'ReqJbpTreeUsing')) return false;
        try {
          if (call(welfare, 'ReqJbpTreeUsing') === false) return false;
          claims.markClaimedToday(TREE_USING_KEY);
        } catch (error) {
          console.warn('[自动领取] 砍树请求失败:', error);
          return false;
        }
      }
      await poll(() => {
        const found = treeItemId(welfare.JbpUserData);
        if (found) return found;
        call(welfare, 'ReqJbpInfo');
        return treeItemId(welfare.JbpUserData) || false;
      }, 12, 500);
    }
    const waterItemId = treeItemId(welfare.JbpUserData);
    if (!waterItemId || claims.claimedToday(`kanshu:${waterItemId}`) || !freeBlessItemEnough()) return false;
    let detach: (() => void) | null = null;
    try {
      const shop = manager('GameShopManager');
      if (!resolveMethod(shop, 'GameShopManager', 'BuySingleItem')) return false;
      const bought = invoke(shop, 'GameShopManager', 'BuySingleItem', waterItemId);
      if (bought === false || (typeof bought === 'number' && bought !== 0)) return false;
      const goodsManager = manager('GameGoodsManager');
      const arrived = await poll(() => has(goodsManager, 'GetGoodsByBaseID') && call(goodsManager, 'GetGoodsByBaseID', waterItemId), 20, 500);
      if (!arrived) {
        console.warn('[自动领取] 浇树道具未到账，稍后重试:', waterItemId);
        return false;
      }
      if (!has(welfare, 'ReqJbpAwd')) return false;
      detach = refreshTreeOnAward(welfare);
      if (call(welfare, 'ReqJbpAwd', waterItemId) === false) {
        detach?.();
        return false;
      }
      claims.markClaimedToday(`kanshu:${waterItemId}`);
      if (!detach) refreshTree(welfare);
      return true;
    } catch (error) {
      detach?.();
      console.warn('[自动领取] 浇树领取失败:', error);
      return false;
    }
  }

  function claimMonthCards(welfare: UnknownRecord): void {
    for (const type of MONTH_CARD_TYPES) {
      const card = asRecord(call(welfare, 'GetCardDataByType', type));
      if (card?.bActive && card.bReward) {
        claims.onceToday(`yueka:reward:${type}:${String(card.rewardDays)}`, () => call(welfare, 'SendClientPrivilegeRewardReq', card.rewardDays, type));
      }
      if (card?.bActive && type === 3) {
        tasks.later(() => {
          const list = call(card, 'AddAwardsCanAwardList');
          if (!Array.isArray(list)) return;
          list.forEach((canAward, index) => {
            if (!canAward) return;
            const day = Number(card.days) + index + 1;
            claims.onceToday(`yueka:addAward:${type}:${day}`, () => call(welfare, 'SendClientPrivilegeRewardReq', day, type));
          });
        }, 5000);
      }
      if (call(welfare, 'CanShowPrivilegeDaliyReward', type)) {
        claims.onceToday(`yueka:daily:${type}`, () => call(welfare, 'PrivilegeCardDaliyRewardReq', type));
      }
    }
  }

  async function claimWelfare(): Promise<void> {
    const welfare = manager('WelfareManger');
    if (!active() || !welfare) return;
    syncWelfare(welfare);
    await delay(800);
    if (!active()) return;
    await claimBlessingTree(welfare);
    if (!active()) return;
    claimMonthCards(welfare);
  }

  // ---------- 公会三敲 ----------

  async function beatGuildDrums(): Promise<void> {
    if (!active()) return;
    const drumWindow = windows.get('GuildDrumWindow');
    if (!drumWindow) return;
    call(drumWindow, 'initDrums');
    call(drumWindow, 'updateItems');
    await delay(1000);
    const items = Array.isArray(drumWindow.itemList) ? drumWindow.itemList as UnknownRecord[] : [];
    const drum = items.find((item) => item?.leftTime);
    let remaining = Math.max(1, Number(drum?.leftTime) || 0);
    const tick = () => {
      if (!active()) {
        windows.release('GuildDrumWindow', 500);
        return;
      }
      call(drum ?? null, 'btnClick');
      remaining -= 1;
      if (remaining <= 0) windows.release('GuildDrumWindow', 500);
      else tasks.later(tick, 300);
    };
    tasks.later(tick, 300);
  }

  // ---------- 签到 ----------

  function claimOldFestivalSigns(activity: UnknownRecord): void {
    const configs = flattenGameCollection(activity.FestivalSignConfigDic);
    const records = flattenGameCollection(activity.FestivalSignDataDic);
    configs.forEach((config, index) => {
      const signId = activityIdOf(config);
      if (signId === undefined || signId === null) return;
      const record = asRecord(records.find((item) => String(activityIdOf(item)) === String(signId)) ?? records[index]);
      if (record?.isActive === false) return;
      const signDays = Number(record?.signDays || 0);
      if (!signDays) return;
      let data = record;
      if (has(activity, 'GetFestivalSignData')) {
        try {
          data = asRecord(call(activity, 'GetFestivalSignData', signId)) ?? record;
        } catch {
          data = record;
        }
      }
      const claimedDays = new Set((Array.isArray(data?.awardData) ? data.awardData : []).map(Number).filter((day) => Number.isFinite(day) && day > 0));
      const awards = asRecord(config)?.awards;
      (Array.isArray(awards) ? awards : []).forEach((award) => {
        const day = Number(asRecord(award)?.days ?? asRecord(award)?.day);
        if (!Number.isFinite(day) || day <= 0 || day > signDays || claimedDays.has(day) || blocked(award)) return;
        claims.onceToday(`festivalSign:old:${String(signId)}:${day}`, () => (
          has(activity, 'SendClientFestivalSignGetRewardReq') ? call(activity, 'SendClientFestivalSignGetRewardReq', signId, day) : false
        ));
      });
    });
  }

  function claimNewFestivalSigns(activity: UnknownRecord): void {
    const signs = new Map<string, UnknownRecord>();
    flattenGameCollection(activity.NewFestivalSignDataDic).forEach((item) => {
      const id = activityIdOf(item);
      const record = asRecord(item);
      if (id !== undefined && id !== null && record) signs.set(String(id), record);
    });
    NEW_FESTIVAL_SIGN_IDS.forEach((signId) => {
      const data = asRecord(call(activity, 'GetNewFestivalSignData', signId));
      if (data) signs.set(String(activityIdOf(data) ?? signId), data);
    });
    signs.forEach((sign) => {
      const signId = activityIdOf(sign);
      (Array.isArray(sign.awards) ? sign.awards : []).forEach((award) => {
        const date = asRecord(award)?.date;
        if (!date || !has(activity, 'GetFesSignAwdState') || Number(call(activity, 'GetFesSignAwdState', award)) !== 2) return;
        if (blocked(award)) return;
        claims.onceToday(`festivalSign:new:${String(signId)}:${String(date)}`, () => (
          has(activity, 'SendNewClientFestivalSignGetRewardReq') ? call(activity, 'SendNewClientFestivalSignGetRewardReq', signId, date) : false
        ));
      });
    });
  }

  function accumulatedAwardState(
    activity: UnknownRecord,
    signId: unknown,
    award: unknown,
    day: number,
    index: number,
    data: unknown
  ): number | undefined {
    let fallback: number | undefined;
    for (const method of ACCUMULATED_STATE_METHODS) {
      if (!has(activity, method)) continue;
      for (const args of [[signId, award], [signId, day], [award]]) {
        try {
          const state = Number(call(activity, method, ...args));
          if (state === 2) return 2;
          if (Number.isFinite(state) && state > 0 && fallback === undefined) fallback = state;
        } catch {
          // 尝试下一组参数。
        }
      }
    }
    const awardRecord = asRecord(award);
    if (awardRecord?.stat === true || awardRecord?.Stat === true || awardRecord?.claimed === true
      || awardRecord?.Claimed === true || awardRecord?.hasReward === true || awardRecord?.HasReward === true) {
      return 1;
    }
    const dataRecord = asRecord(data);
    const states = [dataRecord?.awardStates, dataRecord?.AwardStates, dataRecord?.awardsState, dataRecord?.rewardStates,
      dataRecord?.states, dataRecord?.awardData, dataRecord?.AwardData].find(Array.isArray) as unknown[] | undefined;
    const rawState = states?.[index];
    const state = Number(rawState);
    if (state === 2) return 2;
    if (Number.isFinite(state) && state > 0) return state;
    if (rawState !== undefined && rawState !== null) return state;
    if (fallback !== undefined) return fallback;
    if (accumulatedProgress(data) >= day && !accumulatedClaimedDays(data).has(day)) return 2;
    if (awardRecord?.CanAward || awardRecord?.canAward || awardRecord?.CanGet || awardRecord?.canGet
      || awardRecord?.CanReceive || awardRecord?.canReceive) {
      return 2;
    }
    return undefined;
  }

  function claimAccumulatedSigns(activity: UnknownRecord): void {
    const dataList = [activity.AccumlateLoginDic, activity.AccumlateSignDataDic, activity.AccumlateLoginDataDic,
      activity.AccumulateLoginDic, activity.AccumulateSignDataDic, activity.AccumulateLoginDataDic,
      activity.AccumSignDataDic, activity.AccumLoginDataDic].flatMap(flattenGameCollection);
    const dataById = new Map<string, unknown>();
    dataList.forEach((item) => {
      const id = activityIdOf(item);
      if (id !== undefined && id !== null) dataById.set(String(id), item);
    });
    const configs = uniqueActivities(activity.AccumlateSignConfigDic, activity.AccumlateLoginConfigDic,
      activity.AccumulateSignConfigDic, activity.AccumulateLoginConfigDic, activity.AccumSignConfigDic,
      activity.AccumLoginConfigDic, ...dataList);
    configs.forEach((config, index) => {
      const signId = activityIdOf(config);
      if (signId === undefined || signId === null) return;
      const data = dataById.get(String(signId)) ?? dataList[index] ?? config;
      const awards = awardListOf(config).length ? awardListOf(config) : awardListOf(data);
      awards.forEach((award, awardIndex) => {
        const day = accumulatedAwardDay(award, awardIndex + 1);
        if (!Number.isFinite(day) || day <= 0) return;
        if (accumulatedAwardState(activity, signId, award, day, awardIndex, data) !== 2 || blocked(award)) return;
        claims.onceToday(`accumulatedSign:${String(signId)}:${day}`, () => {
          for (const method of ACCUMULATED_REWARD_METHODS) {
            if (has(activity, method)) return call(activity, method, signId, day, award);
          }
          return false;
        });
      });
    });
  }

  async function claimActivitySigns(activity: UnknownRecord): Promise<void> {
    FESTIVAL_SYNC_METHODS.forEach(([key, method]) => {
      if (has(activity, method)) claims.throttled(key, () => call(activity, method));
    });
    await delay(800);
    if (!active()) return;
    claimOldFestivalSigns(activity);
    claimNewFestivalSigns(activity);
    claimAccumulatedSigns(activity);
  }

  function isDailySignItemAllowed(itemId: unknown, skipTrialCard: boolean): boolean {
    const text = String(itemId ?? '');
    return !skipTrialCard || text === '9020101' || !text.startsWith('90');
  }

  function dailySignItemId(item: UnknownRecord, fallback: number): unknown {
    return asRecord(item.baseData)?.ID ?? asRecord(item.data)?.ID ?? asRecord(item.vo)?.ID ?? item.id ?? fallback;
  }

  function dailySignTotalDay(item: UnknownRecord, fallback: number): unknown {
    const days = Number(item.days ?? asRecord(item.baseData)?.days ?? asRecord(item.data)?.days ?? asRecord(item.vo)?.days);
    return Number.isFinite(days) && days > 0 ? days : dailySignItemId(item, fallback);
  }

  function clickSign(item: UnknownRecord, prefix: string, id: unknown): boolean {
    if (!has(item, 'OnSignClick')) return false;
    return claims.onceToday(`${prefix}:${String(id)}`, () => call(item, 'OnSignClick'));
  }

  async function clickDailySign(view: UnknownRecord, skipTrialCard: boolean, checkIn: boolean): Promise<boolean> {
    let checkedIn = false;
    const items = Array.isArray(view.itemList) ? view.itemList as UnknownRecord[] : [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemId = dailySignItemId(item, index);
      if (!isDailySignItemAllowed(itemId, skipTrialCard)) continue;
      const type = Number(item.type);
      if (checkIn && type === 1 && Number(view.signState) === 2) {
        if (!clickSign(item, 'sign:checkIn', itemId)) continue;
        checkedIn = true;
        await delay(500);
      } else if ((type === 1 && Number(view.signState) !== 2) || type === 2 || type === 3) {
        if (!clickSign(item, 'sign:itemReward', itemId)) continue;
        await delay(500);
      }
    }
    const totals = Array.isArray(view.totalItemList) ? view.totalItemList as UnknownRecord[] : [];
    for (let index = 0; index < totals.length; index += 1) {
      const item = totals[index];
      const type = Number(item.type);
      if (type !== 2 && type !== 3) continue;
      const success = asRecord(item.success);
      if (success?.visible || success?._visible) continue;
      if (!clickSign(item, 'sign:totalReward', dailySignTotalDay(item, index))) continue;
      await delay(500);
    }
    return checkedIn;
  }

  function buyFreeShopGoods(goodsId: number): unknown {
    const buyWindow = windows.get('NormalShopBuyWindow');
    if (!buyWindow || !has(buyWindow, 'enterWindow') || !has(buyWindow, 'confirmBuy')) {
      windows.release('NormalShopBuyWindow');
      return false;
    }
    call(buyWindow, 'enterWindow', goodsId, 1);
    call(buyWindow, 'confirmBuy');
    windows.release('NormalShopBuyWindow');
    return true;
  }

  async function claimDailySignAndOfficer(skipTrialCard: boolean): Promise<void> {
    await delay(10000);
    if (!active()) return;
    try {
      const view = windows.get('DailySignNewView');
      if (view) {
        windows.release('DailySignNewView', 10000);
        if (await clickDailySign(view, skipTrialCard, true)) {
          await delay(1500);
          await clickDailySign(view, skipTrialCard, false);
        }
      }
      const shop = manager('GameShopManager');
      for (const goodsId of FREE_SHOP_GOODS) {
        const goods = goodsConfig(goodsId);
        if (goods && has(shop, 'CheckGoodsLimit') && call(shop, 'CheckGoodsLimit', goods) === false) {
          claims.onceToday(`shop:free:${goodsId}`, () => buyFreeShopGoods(goodsId));
        }
      }
      const officer = manager('OfficerManager');
      if (call(officer, 'CanGetOfficerWeekReward')) claims.onceToday('officer:week', () => call(officer, 'sendGetWeekReward'));
      if (call(officer, 'CanGetOfficerDayReward') && !deps.options().skipHuanLeDou) {
        claims.onceToday('officer:day', () => call(officer, 'sendGetDayReward'));
      }
    } catch (error) {
      console.error('[自动领取] 签到失败:', error);
    }
  }

  async function claimSigns(): Promise<void> {
    const activity = manager('ActivityManager');
    if (!active() || !activity) return;
    await claimActivitySigns(activity);
    if (!active()) return;
    void claimDailySignAndOfficer(deps.options().skipSignTrialCard);
    const generalManager = manager('GameGeneralManager');
    if (!generalManager) return;
    for (const series of deps.configData()?.seriesList ?? []) {
      if (call(generalManager, 'LampRewardCanAward', series) && !call(generalManager, 'LampHasReward', series)) {
        claims.onceToday(`generalLamp:${series}`, () => call(generalManager, 'LampRewardReq', series));
      }
    }
    const atlas = asRecord(asRecord(generalManager.atlasGeneralDict)?._maps) ?? {};
    Object.entries(atlas)
      .filter(([, canAward]) => canAward)
      .map(([id]) => Number(id))
      .forEach((id) => claims.onceToday(`generalAtlas:${id}`, () => call(generalManager, 'GeneralAtlasRewardReq', id)));
  }

  // ---------- 武将包 ----------

  function openDailyGeneralBag(): void {
    if (!active() || deps.options().skipDailyGeneralBag) return;
    const bagWindow = windows.get('GeneralOpenWindow');
    if (!bagWindow) return;
    const text = asRecord(asRecord(asRecord(bagWindow.newView)?.freeTimeTxt))?._text;
    const parts = typeof text === 'string' ? text.split(':').map(Number) : [];
    const waitMs = (parts.reduce((sum, value, index) => sum + value * Math.pow(60, 2 - index), 0) || 0) * 1000;
    if (waitMs) {
      if (!generalBagTimerArmed) {
        generalBagTimerArmed = true;
        tasks.later(() => {
          generalBagTimerArmed = false;
          openDailyGeneralBag();
        }, waitMs);
      }
    } else {
      const claimed = claims.onceToday(`wujiang:bag:${DAILY_GENERAL_BAG.id}:${DAILY_GENERAL_BAG.type}`, () => (
        call(bagWindow, 'onNewOpenBag', DAILY_GENERAL_BAG.id, DAILY_GENERAL_BAG.type)
      ));
      if (claimed) windows.closeOpened('GeneralOpenResultWindow', 8, 500);
    }
    windows.release('GeneralOpenWindow', 5000);
  }

  function runStep(name: string, step: () => Promise<void>): void {
    step().catch((error) => console.warn(`[自动领取] ${name}失败:`, error));
  }

  return {
    runPass() {
      if (!active()) return;
      runStep('任务', claimTasks);
      runStep('活动', claimActivities);
      runStep('邮件', claimMail);
      runStep('福利', claimWelfare);
      runStep('公会三敲', beatGuildDrums);
      runStep('签到', claimSigns);
    },
    claimDailyGeneralBag() {
      try {
        openDailyGeneralBag();
      } catch (error) {
        console.warn('[自动领取] 武将包失败:', error);
      }
    },
    scheduleLowBeanFree(_reason) {
      if (!active()) return;
      LOW_BEAN_RETRY_DELAYS.forEach((wait) => {
        tasks.later(() => {
          if (active()) claimLowBeanFree(manager('ActivityGameDataManager'));
        }, wait);
      });
    }
  };
}

function activityIdOf(item: unknown): unknown {
  const record = asRecord(item);
  return record?.id ?? record?.ID ?? record?.activityId ?? record?.ActivityID ?? record?.activity_id ?? record?.signId ?? record?.SignID;
}

function uniqueActivities(...sources: unknown[]): unknown[] {
  const result = new Map<string, unknown>();
  const add = (item: unknown) => {
    const id = activityIdOf(item);
    if (id !== undefined && id !== null && !result.has(String(id))) result.set(String(id), item);
  };
  sources.forEach((source) => {
    add(source);
    flattenGameCollection(source).forEach(add);
  });
  return [...result.values()];
}

function awardListOf(item: unknown): unknown[] {
  const record = asRecord(item);
  return ([record?.awards, record?.Awards, record?.awardList, record?.AwardList, record?.rewardList,
    record?.RewardList, record?.rewards, record?.Rewards].find(Array.isArray) as unknown[] | undefined) ?? [];
}

function accumulatedAwardDay(award: unknown, fallback: number): number {
  const record = asRecord(award);
  const day = Number(record?.day ?? record?.Day ?? record?.days ?? record?.Days ?? record?.loginDay ?? record?.LoginDay
    ?? record?.loginDays ?? record?.LoginDays ?? record?.logindays ?? record?.needDay ?? record?.needDays
    ?? record?.needLoginDays ?? record?.requiredLoginDays ?? fallback);
  return Number.isFinite(day) ? day : fallback;
}

function accumulatedProgress(data: unknown): number {
  if (typeof data === 'number') return Number.isFinite(data) ? data : 0;
  const record = asRecord(data);
  const value = Number(record?.signDays ?? record?.SignDays ?? record?.loginDays ?? record?.LoginDays ?? record?.logindays
    ?? record?.days ?? record?.Days ?? record?.currentDay ?? record?.CurrentDay ?? record?.progress ?? record?.Progress ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function accumulatedClaimedDays(data: unknown): Set<number> {
  const record = asRecord(data);
  const list = ([record?.claimedDays, record?.ClaimedDays, record?.claimedRewardDays, record?.ClaimedRewardDays,
    record?.getRewardDays, record?.GetRewardDays].find(Array.isArray) as unknown[] | undefined) ?? [];
  return new Set(list.map(Number).filter((day) => Number.isFinite(day) && day > 0));
}

function bagEntries(value: unknown): UnknownRecord[] {
  const record = asRecord(value);
  if (!value) return [];
  const pick = (list: unknown[]) => list.map(asRecord).filter((item): item is UnknownRecord => item !== null);
  if (Array.isArray(value)) return pick(value);
  if (Array.isArray(record?.datum)) return pick(record.datum);
  if (Array.isArray(record?._objDatum)) return pick(record._objDatum);
  if (asRecord(record?._maps)) return pick(Object.values(record!._maps as UnknownRecord));
  if (asRecord(record?._map)) return pick(Object.values(record!._map as UnknownRecord));
  return [];
}

function goodsBaseId(item: UnknownRecord): unknown {
  const baseInfo = asRecord(item.baseInfo);
  return item.BaseID ?? item.baseID ?? item.baseId ?? item.GoodsBaseID ?? item.goodsBaseID ?? item.goodsBaseId
    ?? baseInfo?.ID ?? baseInfo?.id;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
