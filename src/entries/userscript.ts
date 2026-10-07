/**
 * 油猴 / 浏览器脚本入口。
 * 使用 userscript 平台适配器启动与微端共用的 bootstrapXiaochao。
 */
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { bootstrapXiaochao } from '../core/bootstrap';

bootstrapXiaochao(createUserscriptPlatform());
