import { createElectronPlatform } from '../adapters/electron-platform';
import { bootstrapXiaochao } from '../core/bootstrap';

// 必须在 legacy 模块执行前完成。legacy 顶层会立即读取生命周期桥接。
bootstrapXiaochao(createElectronPlatform());
