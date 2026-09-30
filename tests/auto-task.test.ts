import assert from 'node:assert/strict';
import test from 'node:test';
import { beijingDate, beijingDayIndex, createAutoTaskClaims } from '../src/features/auto-task/auto-task-claims.ts';
import {
  buildAutoTaskConfigData,
  configDayStamp,
  isConfigEntryActive
} from '../src/features/auto-task/auto-task-config-data.ts';
import {
  claimTask,
  collectTasks,
  isTaskExcluded,
  isUnacceptedTask,
  rewardsBlocked,
  rewardsContainDiJiaQuan,
  rewardsContainHuanLeDou,
  taskClaimKey,
  type TaskManagerAccess,
  type TaskRuleContext
} from '../src/features/auto-task/auto-task-rules.ts';
import type { PlatformAdapter } from '../src/adapters/platform.ts';
import { createPlatformConfigStorage } from '../src/config/config-storage.ts';
import { createConfigStore } from '../src/config/config-store.ts';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(key) { return map.has(key) ? map.get(key)! : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    key() { return null; }
  };
}

function context(overrides: Partial<TaskRuleContext> = {}): TaskRuleContext {
  return {
    skipTavern: false,
    skipDiJiaQuan: false,
    skipHuanLeDou: false,
    taskIds: new Set([1001, 1002]),
    goodsName: () => '',
    goodsHasPropItem: () => false,
    ...overrides
  };
}

function taskAccess(tasks: Record<string, unknown>, methods: Record<string, (...args: unknown[]) => unknown> = {}): TaskManagerAccess {
  const manager = {
    allTasks: Object.values(tasks),
    GetServerTaskDataByTaskID(id: unknown) { return tasks[String(id)]; },
    GetAllTaskDataByTaskID(id: unknown) { return tasks[String(id)]; },
    GetNoGetTaskDataByTaskID() { return null; },
    RequestTaskAward() { return true; },
    ...methods
  };
  return {
    manager,
    has(method) { return typeof manager[method as keyof typeof manager] === 'function'; },
    call(method, ...args) {
      const fn = manager[method as keyof typeof manager];
      return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown).apply(manager, args) : undefined;
    }
  };
}

test('北京时间日期与跨天序号按 UTC+8 计算', () => {
  // 2026-09-26 23:30 UTC = 2026-09-27 07:30 北京
  const utc = Date.UTC(2026, 8, 26, 23, 30);
  assert.equal(beijingDate(utc), '2026-09-27');
  assert.equal(beijingDayIndex(utc), beijingDayIndex(utc + 60_000));
});

test('每日领取记录按账号与北京日去重，失败不记为已领', () => {
  const storage = memoryStorage({ LastUserName: 'u1' });
  let clock = Date.UTC(2026, 8, 27, 4, 0);
  const claims = createAutoTaskClaims(storage, () => 'u1', () => clock);
  assert.equal(claims.onceToday('a', () => true), true);
  assert.equal(claims.onceToday('a', () => true), false);
  assert.equal(claims.onceToday('b', () => false), false);
  assert.equal(claims.claimedToday('b'), false);
  clock += 24 * 60 * 60 * 1000;
  assert.equal(claims.onceToday('a', () => true), true);
});

test('节流 15 秒内同键只执行一次', () => {
  let clock = 1000;
  const claims = createAutoTaskClaims(undefined, () => 'x', () => clock);
  let count = 0;
  assert.equal(claims.throttled('k', () => { count += 1; }), true);
  assert.equal(claims.throttled('k', () => { count += 1; }), false);
  clock += 14_999;
  assert.equal(claims.throttled('k', () => { count += 1; }), false);
  clock += 1;
  assert.equal(claims.throttled('k', () => { count += 1; }), true);
  assert.equal(count, 2);
});

test('配置有效期与自动任务静态数据解析', () => {
  const today = '20260927T000002';
  assert.equal(isConfigEntryActive({ ClientTimeStart: '20260101T000000', ClientTimeEnd: '20261231T000000' }, today), true);
  assert.equal(isConfigEntryActive({ ClientTimeEnd: '20260926T000000' }, today), false);
  assert.equal(isConfigEntryActive({ duration: '20260901T000000,20260930T000000' }, today), true);
  assert.equal(configDayStamp(new Date(2026, 8, 27, 12, 0, 0)), '20260927T000002');

  const data = buildAutoTaskConfigData({
    'sys_h5_quest.sgs': { root: { Task: [{ Id: 11, ClientTimeStart: '20260101T000000' }, { Id: 12, ClientTimeEnd: '20260101T000000' }] } },
    'ff_task_daily.sgs': { root: { taskteam: [{ id: 0, taskid: 21 }, { id: 1, taskid: 22 }] } },
    'gn_new_fuli.sgs': { root: { taskteam: [{ taskid: 31 }] } },
    'cha_dbs_general_series.sgs': { root: { Collection: [{ seriesList: '1,2,3' }] } },
    'sys_gs_dbs_fs_goodsbaseinfo.sgs': { root: { goodslist: { goods: [{ a: 1, b: '抵价券甲' }, { a: 9020101, b: '欢乐豆' }] } } }
  }, today);
  assert.deepEqual([...data.taskIds].sort((a, b) => a - b), [11, 21, 31]);
  assert.deepEqual(data.seriesList, [1, 2, 3]);
  assert.equal(data.goodsNames.get(1), '抵价券甲');
});

test('奖励过滤识别抵价券与欢乐豆', () => {
  const ctx = context({
    goodsName: (id) => (Number(id) === 1 ? '抵价券甲' : Number(id) === 9020101 ? '豆子' : '')
  });
  assert.equal(rewardsContainDiJiaQuan([{ ItemID: 1 }], ctx), true);
  assert.equal(rewardsContainHuanLeDou([{ ItemID: 9020101 }], ctx), true);
  assert.equal(rewardsContainHuanLeDou([{ ItemID: 2, name: '欢乐豆礼包' }], ctx), true);
  assert.equal(rewardsBlocked([{ ItemID: 1 }], { ...ctx, skipDiJiaQuan: true }), true);
  assert.equal(rewardsBlocked([{ ItemID: 1 }], { ...ctx, skipDiJiaQuan: false }), false);
});

test('任务排除：过期、自选、消耗、隐藏、酒馆跳过', () => {
  const ctx = context({ skipTavern: true });
  assert.equal(isTaskExcluded({ CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } }, ctx, 1001), false);
  assert.equal(isTaskExcluded({ CanAward: false, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } }, ctx, 1001), true);
  assert.equal(isTaskExcluded({ CanAward: true, HasExpired: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } }, ctx, 1001), true);
  assert.equal(isTaskExcluded({ CanAward: true, HaveSelectReward: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } }, ctx, 1001), true);
  assert.equal(isTaskExcluded({ CanAward: true, baseVo: { _name: '兑换礼包', TaskRewardItem: [{ ItemID: 9 }] } }, ctx, 1001), true);
  assert.equal(isTaskExcluded({ CanAward: true, baseVo: {} }, ctx, 9999), true);
  assert.equal(isTaskExcluded({ CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } }, ctx, 161114), true);
});

test('免费兑换任务不受消耗/自选道具规则拦截', () => {
  const ctx = context({ goodsHasPropItem: () => true });
  assert.equal(isTaskExcluded({
    CanAward: true,
    baseVo: { clientTaskType: 34, TaskRewardItem: [{ ItemID: 9 }], _name: '兑换' }
  }, ctx, 1001), false);
});

test('收集任务去重并附加酒馆，领取时区分接取与领奖键', () => {
  const access = taskAccess({
    1001: { _id: 1001, CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } },
    161114: { _id: 161114, CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } }
  });
  access.manager.allTasks = [
    { _id: 1001, CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } },
    { _id: 1001, CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 8 }] } },
    { _id: 161114, CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 9 }] } }
  ];
  const collected = collectTasks(access, context({ taskIds: new Set([1001]) }));
  assert.equal(collected.filter((task) => String((task as { _id: number })._id) === '1001').length, 1);
  assert.ok(collected.some((task) => (task as { _id: number })._id === 161114));

  const pending = { id: 7, CanAward: true, baseVo: { TaskRewardItem: [{ ItemID: 1 }] } };
  const acceptAccess = taskAccess({}, {
    GetNoGetTaskDataByTaskID: () => pending,
    GetServerTaskDataByTaskID: () => null,
    GetAllTaskDataByTaskID: () => pending,
    et: () => 'accepted'
  });
  assert.equal(isUnacceptedTask(acceptAccess, 7), true);
  assert.equal(taskClaimKey(acceptAccess, 7, pending), 'taskAccept:7');
  assert.equal(claimTask(acceptAccess, 7, pending, context()), 'accepted');
});

test('旧 AUTO_TASK_* 存储键迁移到 autoTask.*', () => {
  const values = new Map(Object.entries({
    AUTO_TASK_SWITCH: 'true',
    AUTO_TASK_TAVERN: 'false',
    AUTO_TASK_SKIP_MAIL: 'false',
    AUTO_SIGN_SKIP_SWITCH: 'false'
  }));
  const platform: PlatformAdapter = {
    platform: 'electron',
    openExternal: async () => {},
    getSetting: (key) => values.get(key) ?? null,
    setSetting: (key, value) => { values.set(key, value); }
  };
  const store = createConfigStore(createPlatformConfigStorage(platform), undefined);
  assert.equal(store.get('autoTask.enabled'), true);
  assert.equal(store.get('autoTask.skipTavern'), false);
  assert.equal(store.get('autoTask.skipMail'), false);
  assert.equal(store.get('autoTask.skipSignTrialCard'), false);
  assert.equal(store.get('autoTask.skipDiJiaQuan'), true);
  assert.equal(store.get('autoTask.skipHuanLeDou'), true);
});
