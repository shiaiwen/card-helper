/**
 * 自动任务设置项：总开关与各项「跳过」选项声明。
 */

import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export type AutoTaskSkipKey = XiaochaoConfigKey & `autoTask.skip${string}`;

export interface AutoTaskSkipSetting {
  key: AutoTaskSkipKey;
  label: string;
  tooltip: string;
}

export const AUTO_TASK_ENABLED_KEY = 'autoTask.enabled' satisfies XiaochaoConfigKey;

export const AUTO_TASK_ENABLED_TOOLTIP = '自动完成砍树、敲鼓等枯燥的点击流程\n'
  + '自动领取活跃任务、月卡、签到、活动等奖励\n'
  + '这是总开关，下面的选项可在此基础上排除部分内容\n'
  + '自动化操作存在账号风险，请自行斟酌';

/** 开启表示跳过该类奖励。 */
export const AUTO_TASK_SKIP_SETTINGS: readonly AutoTaskSkipSetting[] = [
  { key: 'autoTask.skipTavern', label: '酒馆', tooltip: '跳过酒馆碎片任务，也不同步酒馆进度' },
  { key: 'autoTask.skipMail', label: '邮件', tooltip: '跳过邮件附件' },
  { key: 'autoTask.skipDailyGeneralBag', label: '武将包', tooltip: '跳过每日免费武将包' },
  { key: 'autoTask.skipSignTrialCard', label: '体验卡', tooltip: '签到会有体验武将，领取会污染将池\n开启表示跳过，月底记得手动领取' },
  { key: 'autoTask.skipDiJiaQuan', label: '抵价券', tooltip: '不领取任何含抵价券的奖励' },
  { key: 'autoTask.skipHuanLeDou', label: '欢乐豆', tooltip: '不领取任何含欢乐豆的奖励\n低于600豆时的免费领豆也会跳过' }
];

export const ALL_AUTO_TASK_KEYS: readonly XiaochaoConfigKey[] = [
  AUTO_TASK_ENABLED_KEY,
  ...AUTO_TASK_SKIP_SETTINGS.map(({ key }) => key)
];
