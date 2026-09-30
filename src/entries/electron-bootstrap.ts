import { createElectronPlatform } from '../adapters/electron-platform';
import { bootstrapXiaochao } from '../core/bootstrap';
import { installPanelShellStyles } from '../ui/panel/panel-shell-styles';

// 脚本一注入就装上面板壳样式，避免等 Vue mount；正式微端 Chromium 偏旧时也能尽早生效。
installPanelShellStyles();

// 必须在 legacy 模块执行前完成。legacy 顶层会立即读取生命周期桥接。
bootstrapXiaochao(createElectronPlatform());
