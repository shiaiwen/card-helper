// 先安装工程运行时，再加载迁移期 legacy。
import './electron-bootstrap';

declare const __XC_WITH_LEGACY__: boolean;

// 临时兼容层：入口、生命周期、Vue UI 和事件迁移完成后删除此导入。
if (__XC_WITH_LEGACY__) void import('../legacy/xiaochao-legacy.js');
