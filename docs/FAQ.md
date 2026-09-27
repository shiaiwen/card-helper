# 常见问题复盘（FAQ）

记录开发和实机验证中踩过的坑：现象、根因、修复、以后如何避免。排查同类问题时先看这里。

排查通用入口：

- `.dev-data/runtime.log`：页面 `console.error`、页面加载（`did-finish-load`）、`game-health` 健康快照（`panel` 是否挂载、`startup` 启动状态、卡牌字典大小）。
- `.dev-data/mingpai-trace.log`：协议事件（`move`、`opt-target`、`spell-opt-rep`、`yanjiao`）和座位快照（`seats`、`seat-probe`）。
- `.dev-data/webview-live.png`：游戏页面实时截图。
- 注意：`console.warn` 不会进 `runtime.log`，需要被监控的失败必须用 `console.error`。

---

## 1. 刷新后所有功能都没了（严教、弃牌堆、明牌同时失效）

**现象**：改了一行样式（给严教加上边框）后，严教、弃牌堆、明牌全部不工作。面板正常显示，只是没有任何数据。

**排查**：`mingpai-trace.log` 里页面刷新之后只有 `seats`（座位快照，来自场景轮询），没有任何 `move` / `opt-target` 等协议事件。说明协议消息没有流进来，和改动的样式无关。

**根因**：

- 小抄通过劫持游戏的 `console.log` 拿到协议消息（游戏会把每条协议对象打印出来）。
- 当前 legacy 不再创建 `VIiR0YfvE4s` 监听数组，`micro-client-message-source.ts` 等待 2 秒找不到它，就启用备用方案：自己包装 `console.log`。
- 旧的包装用的是 `writable: true` 的普通属性值。游戏加载过程中会给 `console.log` 重新赋值，如果我们的包装先装上、游戏后赋值，包装就被直接覆盖，整局收不到协议消息。
- 先后顺序取决于加载速度。开发模式下保存代码会让游戏页面在对局中途自动刷新，资源有缓存、加载更快，更容易撞上。之前"功能时有时无"很可能也是这个原因。

**修复**（`src/adapters/micro-client-message-source.ts`）：

- 参照 legacy 的做法改为 getter/setter：`get` 始终返回我们的包装，`set` 只替换包装内部的下游函数。
- 轮询时如果发现 `console.log` 已被 `defineProperty` 整体替换，重新接管。
- 回归测试：`tests/micro-client-message-source.test.mts`。

**经验**：

- 劫持全局函数时必须考虑"宿主会再次赋值"，用 getter/setter，不要用可写属性。
- "所有功能同时失效"优先查公共入口（协议消息来源），不要先怀疑刚改的功能代码。
- 对局中途刷新后，本局之前的弃牌堆、明牌记录无法恢复，属于预期行为。

---

## 2. 小抄面板偶发加载不出来

**现象**：进入游戏后右侧面板不出现，刷新几次又好了，频率越来越高。

**排查**：`runtime.log` 中有 `[小抄] 初始化失败: TypeError: Cannot set properties of null (setting 'onclick')`，`game-health` 里 `panel: false`、`startup.state: failed`。

**根因**：

- 面板挂载独立后，`bootstrap.ts` 会在游戏就绪（`SystemContext` + `#bgDiv`）时自己挂载 Vue 面板。
- legacy 的启动流程仍然会执行主面板初始化 `rx(true)`，它会先 `document.getElementById("createIframe")?.remove()` 删除已有面板。
- 如果我们先挂载，面板就被 legacy 删掉。随后 legacy 调用 `mountPanelShell`，拿到的是缓存里已经脱离文档的旧面板，按 ID 找不到按钮，绑定 `onclick` 时报错，面板彻底消失。
- 谁先挂载取决于两个轮询谁先检测到游戏就绪，所以是偶发的。

**修复**：

- `src/core/bootstrap.ts`：`mountPanelShell` 复用缓存前检查 `panelElement.isConnected`，已脱离文档就卸载重建。
- `src/ui/mount-xiaochao-app.ts`：`unmount()` 改为可重复调用。
- 面板挂载失败改用 `console.error`，保证能在 `runtime.log` 里看到。

**经验**：legacy 未删除前，新旧两套初始化会并存。凡是新代码接管了 legacy 也会操作的 DOM，都要假设 legacy 可能删除或替换它，缓存的 DOM 引用使用前要检查 `isConnected`。

---

## 3. 技能面板（严教等）不显示、座位始终"不在对局中"

**现象**：严教的协议消息收到了、结果也算出来了，但面板闪一下就消失；资援、权变等技能面板都不出现。

**排查**：`seat-probe` 显示游戏场景已找到（`isGameScene: true`，8 个座位），但 `adapterInGame: false`。

**根因**：

- 技能面板每 500ms 检查一次可见性，要求座位状态"在对局中"。
- 座位适配器 `seat-game-adapter.ts` 只从 `seatID` / `seatId` / `id` 等字段读座位号，但实机座位对象上的座位号在 `index` / `Index`。读不到座位号的座位全部被丢弃，座位列表为空，于是一直判定"不在对局中"。
- 严教亮牌时面板被强制显示，但下一次可见性检查又把它隐藏了。

**修复**：`seat-game-adapter.ts` 和 `skill-visibility.ts` 的座位号字段加入 `index`、`Index`。实机确认本家座位号和协议里的座位号一致。

**经验**：

- 游戏对象字段以 legacy / app.bak 的实际读法为准（legacy 用的是 `seat.index ?? seat.Index`），不要凭字段名猜。
- 接入游戏对象的适配器要先用实机诊断（`seat-probe` 一类）确认字段，再写逻辑。

---

## 4. 修好座位识别后，明牌"样式变了"

**现象**：座位识别修好后，游戏画面上出现"N号位明牌"浮层，卡牌页签出现"座位已知手牌"和一排牌背，看起来很乱。

**根因**：

- 原版座位明牌界面 `#seatUI` 早已被 CSS 永久隐藏，局内座位明牌改由 Laya 小牌条 `native-mingpai-preview-controller.ts` 绘制，面板内由 `SeatHandSection` 接替。
- 这两个组件都要求座位状态"在对局中"才显示。由于问题 3，它们此前在实机里从来没有显示过，之前看到的明牌其实是游戏客户端自己的显示。
- 问题 3 修好后它们第一次出现，而它们的位置和样式从未在实机调过。

**处理**：按用户决定，`App.vue` 中暂不渲染这两个组件（代码和座位识别保留，技能面板依赖座位识别）。设置页的"座位明牌"开关目前不起作用。

**经验**：修复底层状态（例如"是否在对局中"）时，要列出所有依赖它的界面。原本"从未生效"的界面会突然出现，需要一并确认。

---

## 5. 开发模式下改代码会打断对局

**现象**：对局中保存代码后，游戏页面自动刷新，本局记录丢失；偶尔还会触发问题 1、问题 2 这类时序问题。

**原因**：`npm run dev` 会在 `vite build --watch` 重新构建后自动刷新游戏页面。

**建议**：

- 需要实机验证时，尽量在对局开始前改好代码，对局中不保存文件。
- 如果必须在对局中改，改完后开新的一局验证，不要用刷新后的半局数据下结论。
