/**
 * 自动任务导出：控制器状态机与设置项（跳过酒馆/邮件/签到等）。
 */

export {
  installAutoTaskController,
  type AutoTaskController,
  type AutoTaskControllerOptions,
  type AutoTaskPhase,
  type AutoTaskReason,
  type AutoTaskStatus
} from './auto-task-controller.ts';
export {
  ALL_AUTO_TASK_KEYS,
  AUTO_TASK_ENABLED_KEY,
  AUTO_TASK_ENABLED_TOOLTIP,
  AUTO_TASK_SKIP_SETTINGS,
  type AutoTaskSkipSetting
} from './auto-task-settings.ts';
