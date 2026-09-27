// ES 模块按依赖顺序执行：先安装工程运行时，再加载迁移期 legacy。
import './electron-bootstrap';

// 临时兼容层：入口、生命周期、Vue UI 和事件迁移完成后删除此导入。
import '../legacy/xiaochao-legacy.js';
