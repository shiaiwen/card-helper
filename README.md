# Electron 本地开发工程

这是完整的本地窗口工程：主进程、两个 preload、HTML 窗口、res 图片和 xiaochao 用户脚本。游戏页面由 webview 从官方地址加载，游戏服务端不在本地工程里。

## 启动

使用 Node.js 22.12 或以上版本，在此目录运行：

```sh
npm ci
npm start
```

依赖已在当前机器安装，后续可直接 `npm start`。也可在上一级目录执行 `npm start`。

## 开发

- `main.js`：Electron 主进程、IPC、窗口和配置。
- `index_wd.html`、`res/`：窗口框架和图片。
- `script/electron_frame.js`：窗口 preload、webview 控制和脚本注入。
- `script/electron_renderer.js`：游戏 webview 的 preload 和 IPC 接口。
- `xiaochao.js`：实际加载的用户脚本，默认使用原始快照。
- `dev-main.cjs`：本地开发入口，配置独立数据目录并记录启动诊断。

修改后关闭本地开发窗口并重新 `npm start`。用户脚本会在启动时同步到开发缓存中，同版本内容变化也会同步。

开发数据、窗口截图和日志在 `.dev-data/`，其中 `runtime.log` 记录页面加载和 preload 错误，`startup-status.json` 与 `startup.png` 在窗口加载后约 15 秒生成。该目录可能包含登录数据，不要提交。

本地开发关闭自动更新，避免更新器覆盖正在编辑的代码。原安装程序和它的数据不受影响。当前使用 Electron 44.3.0，主窗口 preload 使用现有 Node 集成模式；尚未进行生产环境安全改造。

`npm run check` 检查 JS 语法以及 HTML 引用的本地资源。运行工程仍需要网络，登录后的游戏功能需要在账户登录后验证。

当前机器已实际启动并通过桌面窗口确认：官方登录背景、账号密码输入框和登录按钮正常显示，webview preload 桥接存在，未记录 preload 加载错误。Electron 内部截图在窗口没有可捕获显示表面时可能失败或为空白，不能仅凭该截图判断页面是否显示。

登录后检查：游戏大厅和房间列表已显示；运行日志曾出现 49 次配置初始化错误和 2 次小抄运行时等待超时。小抄的运行时等待函数限定 120 秒，超时会断开 MutationObserver 并移除加载监听，没有在该等待流程内继续重试。因此游戏登录成功不代表小抄已经初始化成功。插件面板、对局辅助和报告功能尚未通过验证。需要继续处理慢加载下的初始化恢复，并核对当前游戏版本的运行时对象兼容性。

后续修复：`script/runtime-startup.cjs` 实现每秒一次就绪检查，替换原固定 120 秒超时。`tools/patch-startup.cjs` 将其写入本工程的 `xiaochao.js`（重新运行会覆盖此文件的手工修改）。已通过慢加载、仅初始化一次、退出清理和初始化异常测试；实际运行记录 `startup.state = ready`、`panel = true`、`modules = 1`。实时结果见 `.dev-data/game-health.json`。此状态仅表示插件启动完成，不代表账号登录成功或全部业务功能通过验证。重启必须使用官方登录入口，旧游戏链接中的登录票据不能用于恢复会话。
