/**
 * Electron 注入引导：尽早挂上面板壳 CSS，再创建 Electron 平台适配器并启动核心 bootstrap。
 */
import { createElectronPlatform } from '../adapters/electron-platform';
import { bootstrapXiaochao } from '../core/bootstrap';
import { installPanelShellStyles } from '../ui/panel/panel-shell-styles';

// 脚本一注入就装上面板壳样式，避免等 Vue mount；正式微端 Chromium 偏旧时也能尽早生效。
installPanelShellStyles();

// 尽早安装运行时桥接，供游戏加载完成后的功能初始化使用。
bootstrapXiaochao(createElectronPlatform());
