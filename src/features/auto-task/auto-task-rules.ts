/**
 * 自动任务规则：判断任务是否可领、是否应跳过等纯逻辑。
 */

type UnknownRecord = Record<string, unknown>;

/** 酒馆碎片任务。 */
export const TAVERN_TASK_IDS: readonly number[] = [161114, 161115, 161116];
/** 不自动领取的任务。 */
const EXCLUDED_TASK_IDS = new Set([97, 98, 126, 127]);
const HUAN_LE_DOU_ITEM_IDS = new Set(['9020101', '9030101']);
const COST_TASK_PATTERN = /兑换|兑取|换取|消费|消耗|扣除|合成|盲盒/;
const COST_REQ_TYPE = 30;
const FREE_EXCHANGE_CLIENT_TASK_TYPES = new Set([34, 35]);

export interface RewardFilterContext {
  skipDiJiaQuan: boolean;
  skipHuanLeDou: boolean;
  goodsName(itemId: unknown): string;
}

export interface TaskRuleContext extends RewardFilterContext {
  skipTavern: boolean;
  /** 配置中的有效任务 id；配置未加载时为 null。 */
  taskIds: ReadonlySet<number> | null;
  /** 物品是否为需要自选的道具（游戏物品对象的 CheckHasPropItem）。 */
  goodsHasPropItem(itemId: unknown): boolean;
}

/** 游戏 TaskManager 的访问入口；方法名可能被压缩，由调用方解析。 */
export interface TaskManagerAccess {
  readonly manager: UnknownRecord;
  has(method: string): boolean;
  call(method: string, ...args: unknown[]): unknown;
}

export function taskIdOf(task: unknown): unknown {
  const record = asRecord(task);
  const base = asRecord(record?.baseVo);
  return record?._id ?? record?.id ?? record?.taskId ?? base?._id ?? base?.id;
}

export function taskRewards(task: unknown): unknown[] {
  const record = asRecord(task);
  const base = asRecord(record?.baseVo);
  const rewards = base?.TaskRewardItem || base?.taskRewardItem || record?.TaskRewardItem || record?.taskRewardItem;
  return Array.isArray(rewards) ? rewards : [];
}

export function rewardItemId(item: unknown): unknown {
  const record = asRecord(item);
  return record?.ItemID ?? record?.itemID ?? record?.itemId ?? record?.id ?? record?.ID
    ?? record?.goodsId ?? record?.GoodsID ?? record?.baseId ?? record?.BaseID;
}

function rewardItemName(item: unknown, context: RewardFilterContext): string {
  const record = asRecord(item);
  return String(
    context.goodsName(rewardItemId(item))
    || record?.itemName || record?.ItemName || record?.name || record?.Name
    || record?.goodsName || record?.GoodsName || ''
  );
}

function someReward(
  rewards: unknown,
  context: RewardFilterContext,
  predicate: (itemId: unknown, name: string) => boolean
): boolean {
  const list = Array.isArray(rewards) ? rewards : rewards ? [rewards] : [];
  return list.some((item) => predicate(rewardItemId(item), rewardItemName(item, context)));
}

export function rewardsContainDiJiaQuan(rewards: unknown, context: RewardFilterContext): boolean {
  return someReward(rewards, context, (_, name) => name.includes('抵价券'));
}

export function isHuanLeDouItem(itemId: unknown): boolean {
  return HUAN_LE_DOU_ITEM_IDS.has(String(itemId));
}

export function rewardsContainHuanLeDou(rewards: unknown, context: RewardFilterContext): boolean {
  return someReward(rewards, context, (itemId, name) => name.includes('欢乐豆') || isHuanLeDouItem(itemId));
}

/** 奖励含用户选择跳过的抵价券 / 欢乐豆。 */
export function rewardsBlocked(rewards: unknown, context: RewardFilterContext): boolean {
  return (context.skipDiJiaQuan && rewardsContainDiJiaQuan(rewards, context))
    || (context.skipHuanLeDou && rewardsContainHuanLeDou(rewards, context));
}

/** 按数组 / datum / _objDatum / _maps 展开游戏容器。 */
export function flattenGameCollection(value: unknown): unknown[] {
  try {
    const record = asRecord(value);
    if (Array.isArray(value)) return value.filter(isPresent);
    if (Array.isArray(record?.datum)) return record.datum.filter(isPresent);
    if (Array.isArray(record?._objDatum) && record._objDatum.length) return record._objDatum.filter(isPresent);
    const maps = asRecord(record?._maps);
    if (maps) return Object.values(maps).flat().filter(isPresent);
  } catch {
    // 容器访问器抛错时视为空。
  }
  return [];
}

function lookupTask(access: TaskManagerAccess, id: unknown): unknown {
  return access.call('GetServerTaskDataByTaskID', id) || access.call('GetAllTaskDataByTaskID', id);
}

/** 收集候选任务：配置任务 id、TaskManager 中的任务表、未跳过时的酒馆任务，按 id 去重。 */
export function collectTasks(access: TaskManagerAccess, context: TaskRuleContext): unknown[] {
  const tasks = new Map<string, unknown>();
  const add = (task: unknown) => {
    const id = taskIdOf(task);
    if (id === undefined || id === null || tasks.has(String(id)) || EXCLUDED_TASK_IDS.has(Number(id))) return;
    tasks.set(String(id), task);
  };
  for (const id of context.taskIds ?? []) add(lookupTask(access, id));
  for (const key of ['allTasks', 'taskLocalConditionDict', 'typeTaskDict']) {
    flattenGameCollection(access.manager[key]).forEach(add);
  }
  if (!context.skipTavern) TAVERN_TASK_IDS.forEach((id) => add(lookupTask(access, id)));
  return [...tasks.values()];
}

function isExpired(task: UnknownRecord): boolean {
  try {
    if (task.HasExpired === true || task.hasExpired === true) return true;
  } catch {
    // 访问器抛错时继续判断。
  }
  const base = asRecord(task.baseVo) ?? task;
  try {
    if (base.EffectClientTime === false || base.effectClientTime === false) return true;
  } catch {
    // 访问器抛错时视为未过期。
  }
  return false;
}

function hasSelectReward(task: UnknownRecord): boolean {
  const base = asRecord(task.baseVo);
  return Boolean(base?.HaveSelectReward || base?.haveSelectReward || task.HaveSelectReward || task.haveSelectReward);
}

function isFreeExchangeTask(task: UnknownRecord): boolean {
  const base = asRecord(task.baseVo) ?? task;
  const type = Number(base.clientTaskType ?? base.ClientTaskType ?? task.clientTaskType ?? task.ClientTaskType ?? 0);
  return FREE_EXCHANGE_CLIENT_TASK_TYPES.has(type);
}

function rewardsNeedPropSelection(task: UnknownRecord, context: TaskRuleContext): boolean {
  if (isFreeExchangeTask(task)) return false;
  return taskRewards(task).some((item) => {
    const record = asRecord(item);
    return context.goodsHasPropItem(record?.ItemID ?? record?.itemID ?? record?.itemId ?? record?.id);
  });
}

/** 无奖励且不在当前配置里的任务视为隐藏或旧任务。 */
function isHiddenOrLegacyTask(id: unknown, task: UnknownRecord, context: TaskRuleContext): boolean {
  if (taskRewards(task).length > 0) return false;
  if (context.taskIds) return ![...context.taskIds].some((taskId) => String(taskId) === String(id));
  return task.currentConfig === false || task.hiddenOrLegacyTask === true;
}

function conditionsOf(task: UnknownRecord): UnknownRecord[] {
  return Array.isArray(task.taskConditions)
    ? task.taskConditions.map(asRecord).filter((item): item is UnknownRecord => item !== null)
    : [];
}

/** 需要消耗物品或可重复完成的任务不自动领取。 */
function isCostOrRepeatTask(task: UnknownRecord): boolean {
  if (isFreeExchangeTask(task)) return false;
  const base = asRecord(task.baseVo) ?? task;
  const text = [
    base._name, base.name, base.Name, base._desc, base.desc, base.Desc,
    task._name, task.name, task.Name, task._desc, task.desc, task.Desc,
    ...conditionsOf(task).map((condition) => condition._desc || condition.desc || condition.Desc)
  ].filter(Boolean).join(' ');
  if (COST_TASK_PATTERN.test(text)) return true;
  if (conditionsOf(task).some((condition) => Number(condition._reqType ?? condition.reqType ?? condition.ReqType) === COST_REQ_TYPE)) {
    return true;
  }
  const maxComplete = Number(base.maxComplete ?? base._maxComplete ?? task.maxComplete ?? task._maxComplete ?? 0);
  const canRewardCount = Number(task.CanRewardCount ?? task.canRewardCount ?? 0);
  return (Number.isFinite(maxComplete) && maxComplete > 1) || (Number.isFinite(canRewardCount) && canRewardCount > 1);
}

/** 任务是否不应自动领取。 */
export function isTaskExcluded(task: unknown, context: TaskRuleContext, id: unknown = taskIdOf(task)): boolean {
  const record = asRecord(task);
  if (!record) return true;
  const numericId = Number(id);
  if (Number.isFinite(numericId) && TAVERN_TASK_IDS.includes(numericId) && context.skipTavern) return true;
  return !record.CanAward
    || isExpired(record)
    || hasSelectReward(record)
    || rewardsNeedPropSelection(record, context)
    || isHiddenOrLegacyTask(id, record, context)
    || isCostOrRepeatTask(record);
}

/** 任务还没接取：本地有未接取数据，服务器侧没有。 */
export function isUnacceptedTask(access: TaskManagerAccess, id: unknown, task?: unknown): boolean {
  try {
    if (!access.call('GetNoGetTaskDataByTaskID', id)) return false;
    if (access.call('GetServerTaskDataByTaskID', id)) return false;
    const data = asRecord(task || access.call('GetAllTaskDataByTaskID', id));
    return !(data?.isFromServer || data?.IsFromServer);
  } catch {
    return false;
  }
}

function canRewardCount(task: unknown): number {
  const record = asRecord(task);
  const count = Number(record?.CanRewardCount ?? record?.canRewardCount ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** 节流键：未接取的任务先接取，否则领取奖励。 */
export function taskClaimKey(access: TaskManagerAccess, id: unknown, task: unknown): string {
  const accepting = isUnacceptedTask(access, id, task) && access.has('et');
  return `${accepting ? 'taskAccept:' : 'task:'}${String(id)}`;
}

/** 接取或领取单个任务；返回 false 表示没有发出请求。 */
export function claimTask(access: TaskManagerAccess, id: unknown, task: unknown, context: TaskRuleContext): unknown {
  const current = access.call('GetServerTaskDataByTaskID', id) || access.call('GetAllTaskDataByTaskID', id) || task;
  if (isTaskExcluded(current, context, id)) return false;
  if (isUnacceptedTask(access, id, current) && access.has('et')) return access.call('et', id, id, 0);
  if (!access.has('RequestTaskAward')) return false;
  const count = canRewardCount(current);
  const result = access.call('RequestTaskAward', id, 0, count);
  return result === false && count !== 0 ? access.call('RequestTaskAward', id, 0, 0) : result;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
