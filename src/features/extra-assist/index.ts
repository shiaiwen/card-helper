/**
 * 进阶辅助导出：南华/许劭/裴秀等技能提示，以及游戏辅助开关文案。
 */

export {
  installExtraAssistController,
  type ExtraAssistController,
  type ExtraAssistControllerOptions
} from './extra-assist-controller.ts';
export {
  AUTO_BOT_ENABLED_KEY,
  AUTO_HG_ENABLED_KEY,
  EXTRA_ASSIST_ENABLED_KEY,
  EXTRA_ASSIST_TOOLTIP,
  AUTO_BOT_TOOLTIP,
  AUTO_HG_TOOLTIP,
  GAME_ASSIST_SWITCH_SETTINGS,
  type GameAssistSwitchSetting
} from './extra-assist-settings.ts';
export {
  buildExtraAssistConfigData,
  type ExtraAssistConfigData
} from './extra-assist-config-data.ts';
export {
  formatQuanyuTipText,
  QUANYU_BUFF_LABELS,
  QUANYU_SKILL_ID
} from './quanyu-assist.ts';
export { findXuShaoMatches } from './xushao-assist.ts';
export { planPeixiuRoute } from './peixiu-route-planner.ts';
export { parsePeixiuMapConfig, classifyCardName } from './peixiu-map-model.ts';
export {
  createPeixiuRouteStore,
  type PeixiuRouteStore,
  type PeixiuRouteSnapshot
} from './peixiu-route-store.ts';
