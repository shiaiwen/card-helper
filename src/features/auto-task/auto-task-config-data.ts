/**
 * 自动任务配置数据：任务 ID、武将灯系列与物品名等表结构构建。
 */

type UnknownRecord = Record<string, unknown>;

/** 自动任务需要的静态配置（来自 Config_w.sgs）。 */
export interface AutoTaskConfigData {
  /** 当前有效的任务 id：sys_h5_quest / ff_task_daily / gn_new_fuli。 */
  taskIds: ReadonlySet<number>;
  /** 武将灯系列 id：cha_dbs_general_series。 */
  seriesList: readonly number[];
  /** 物品 id → 名称：sys_gs_dbs_fs_goodsbaseinfo。 */
  goodsNames: ReadonlyMap<number, string>;
}

export const AUTO_TASK_CONFIG_FILES = [
  'sys_h5_quest.sgs',
  'ff_task_daily.sgs',
  'gn_new_fuli.sgs',
  'cha_dbs_general_series.sgs',
  'sys_gs_dbs_fs_goodsbaseinfo.sgs'
] as const;

export type AutoTaskConfigFileName = typeof AUTO_TASK_CONFIG_FILES[number];

/** 配置里的时间形如 20260927T000000，与本地当天 T000002 按字符串比较。 */
export function configDayStamp(now: Date): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}T000002`;
}

function withinRange(start: unknown, end: unknown, today: string): boolean {
  return (!start || String(start) <= today) && (!end || String(end) >= today);
}

function withinDuration(duration: unknown, today: string): boolean {
  if (!duration) return true;
  const text = String(duration);
  const parts = text.match(/[0-9]{8}T[0-9]{6}/g) ?? text.split(',');
  return withinRange(parts[0], parts[1], today);
}

/** 配置项当天是否有效。 */
export function isConfigEntryActive(entry: unknown, today: string): boolean {
  const record = asRecord(entry);
  if (!record) return false;
  const start = record.ClientTimeStart ?? record.clientTimeStart ?? record.TimeStart ?? record.timeStart
    ?? record.begintime ?? record.BeginTime;
  const end = record.ClientTimeEnd ?? record.clientTimeEnd ?? record.TimeEnd ?? record.timeEnd
    ?? record.endtime ?? record.EndTime;
  const duration = record.duration ?? record.Duration ?? record.duration2 ?? record.Duration2;
  return withinRange(start, end, today) && withinDuration(duration, today);
}

/** 把任务配置文件收成当日可领取的任务数据。 */
export function buildAutoTaskConfigData(
  files: Partial<Record<AutoTaskConfigFileName, unknown>>,
  today: string
): AutoTaskConfigData {
  const taskIds = new Set<number>();
  const addTaskId = (value: unknown) => {
    const id = Number(value);
    if (Number.isFinite(id) && id > 0) taskIds.add(id);
  };
  for (const task of asArray(rootOf(files['sys_h5_quest.sgs'])?.Task)) {
    if (isConfigEntryActive(task, today)) addTaskId(asRecord(task)?.Id);
  }
  for (const team of asArray(rootOf(files['ff_task_daily.sgs'])?.taskteam)) {
    const record = asRecord(team);
    if (record && Number(record.id) === 0 && Number(record.taskid) > 0 && isConfigEntryActive(record, today)) {
      addTaskId(record.taskid);
    }
  }
  for (const team of asArray(rootOf(files['gn_new_fuli.sgs'])?.taskteam)) {
    if (isConfigEntryActive(team, today)) addTaskId(asRecord(team)?.taskid);
  }

  const seriesList: number[] = [];
  for (const collection of asArray(rootOf(files['cha_dbs_general_series.sgs'])?.Collection)) {
    const text = asRecord(collection)?.seriesList;
    if (typeof text !== 'string' && typeof text !== 'number') continue;
    for (const part of String(text).split(',')) {
      const id = Number(part);
      if (Number.isFinite(id) && id > 0) seriesList.push(id);
    }
  }

  const goodsNames = new Map<number, string>();
  for (const goods of asArray(asRecord(rootOf(files['sys_gs_dbs_fs_goodsbaseinfo.sgs'])?.goodslist)?.goods)) {
    const record = asRecord(goods);
    const id = Number(record?.a);
    if (Number.isFinite(id) && typeof record?.b === 'string') goodsNames.set(id, record.b);
  }

  return { taskIds, seriesList, goodsNames };
}

function rootOf(file: unknown): UnknownRecord | null {
  return asRecord(asRecord(file)?.root);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
