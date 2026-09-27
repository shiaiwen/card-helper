import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { bootstrapXiaochao } from '../core/bootstrap';

bootstrapXiaochao(createUserscriptPlatform());

// 迁移期与 Electron 共用旧功能，确保两种发行物行为一致。
import '../legacy/xiaochao-legacy.js';
