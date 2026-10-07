# 注释补充摘要（COMMENT_SUMMARY）

> 本次仅添加/修正中文注释，不改运行时行为；未创建 git commit。
> 注释遵守 `.cursor/rules/no-appbak-comments.mdc`：只描述当前代码行为，不出现 `app.bak` /「对照原版」/ 旧混淆符号出处。

**累计修改源码文件数：约 95（第一轮）+ 78（第二轮，有重叠）**；另含本摘要文件。

第二轮专补先前跳过的次要功能与遗漏文件头/方法注释。

## 架构概览

```
Electron 主进程 (main.cjs)
  ├─ shared-store.cjs     跨实例设置/凭证
  ├─ interceptor.cjs      壁纸/贴图/统计拦截
  └─ preload → 注入 dist/electron/xiaochao.js
         │
entries/electron(-bootstrap) 或 entries/userscript
         │
core/bootstrap.ts
  ├─ config/              配置 Schema + Store + 平台存储
  ├─ runtime/             生命周期、事件总线、方法补丁、等待游戏就绪
  ├─ adapters/            平台、协议翻译、console 消息源、Laya 定位、卡牌配置
  ├─ features/*           明牌/技能辅助/座位/牌局/自动任务/托管/山河/皮肤…
  └─ ui/                  Vue 面板（App.vue + 设置/卡牌区块）
```

### 数据流（简）

1. **注入**：微端 preload 读取本地 `xiaochao.js`（开发产物优先）注入游戏 webview；油猴直接跑 userscript 入口。
2. **启动**：`bootstrapXiaochao(platform)` 组装 ConfigStore、GameEventBus、明牌引擎、各功能 `install*`，再挂 Vue 面板。
3. **协议**：`micro-client-message-source` 包装 `console.log` → `game-message-adapter` 译为业务事件 → 总线分发给明牌/牌局/技能辅助/自动托管等。
4. **改写**：屏蔽特效、皮肤、山河、托管等通过 `filterMessage` 在游戏处理前改写 payload。
5. **UI**：`mountXiaochaoApp` 创建 `#xiaochao-app`，常规/山河图/工具三 Tab；配置经 `configStore` 持久化到 localStorage（Electron 另有 shared.json IPC）。

## 修改文件清单

### Electron 胶水（4）

- `dev-main.cjs`
- `interceptor.cjs`
- `main.cjs`
- `shared-store.cjs`

### 入口 / 核心 / 运行时 / 适配器 / 配置（14）

- `src/adapters/card-config-source.ts`
- `src/adapters/game-message-adapter.ts`
- `src/adapters/laya-object-locator.ts`
- `src/adapters/platform.ts`
- `src/config/config-schema.ts`
- `src/config/config-storage.ts`
- `src/config/config-store.ts`
- `src/core/bootstrap.ts`
- `src/entries/electron-bootstrap.ts`
- `src/entries/electron.ts`
- `src/entries/userscript.ts`
- `src/runtime/game-event-bus.ts`
- `src/runtime/method-patch.ts`
- `src/runtime/mingpai-trace.ts`

### UI（19）

- `src/ui/App.vue`
- `src/ui/cards/DeckRecordSection.vue`
- `src/ui/cards/SkillAssistSection.vue`
- `src/ui/cards/TurnStatusBar.vue`
- `src/ui/deck-record/DeckRecordOverlay.vue`
- `src/ui/dialog/BaseDialog.vue`
- `src/ui/mount-xiaochao-app.ts`
- `src/ui/panel/PanelHeader.vue`
- `src/ui/panel/PanelTabs.vue`
- `src/ui/panel/panel-layout-ownership.ts`
- `src/ui/settings/AutoTaskSettingsSection.vue`
- `src/ui/settings/BlockSettingsSection.vue`
- `src/ui/settings/ClearRedDotSection.vue`
- `src/ui/settings/DisplaySettingsSection.vue`
- `src/ui/settings/GameAssistSettingsSection.vue`
- `src/ui/settings/GuanxingEntry.vue`
- `src/ui/settings/RogueSettingsSection.vue`
- `src/ui/settings/SkinBackgroundSettingsSection.vue`
- `src/ui/settings/VersionNoticeSection.vue`

### 功能：auto-bot / auto-task / auto-hg（15）

- `src/features/auto-bot/auto-bot-actions.ts`
- `src/features/auto-bot/auto-bot-baisheng.ts`
- `src/features/auto-bot/auto-bot-controller.ts`
- `src/features/auto-bot/auto-bot-leave.ts`
- `src/features/auto-bot/auto-bot-mode.ts`
- `src/features/auto-bot/auto-bot-play.ts`
- `src/features/auto-bot/auto-bot-rooms.ts`
- `src/features/auto-bot/auto-bot-tavern.ts`
- `src/features/auto-bot/auto-bot-windows.ts`
- `src/features/auto-bot/index.ts`
- `src/features/auto-hg/auto-hg-controller.ts`
- `src/features/auto-hg/index.ts`
- `src/features/auto-task/auto-task-controller.ts`
- `src/features/auto-task/auto-task-runner.ts`
- `src/features/auto-task/index.ts`

### 功能：mingpai / skill-assist / seat-display / deck-record / cards（21）

- `src/features/cards/hand-sort-controller.ts`
- `src/features/deck-record/deck-record-store.ts`
- `src/features/deck-record/native-deck-record-controller.ts`
- `src/features/mingpai/draw-pile-order.ts`
- `src/features/mingpai/index.ts`
- `src/features/mingpai/mingpai-controller.ts`
- `src/features/mingpai/mingpai-engine.ts`
- `src/features/mingpai/mingpai-queries.ts`
- `src/features/mingpai/mingpai-store.ts`
- `src/features/mingpai/mingpai-zones.ts`
- `src/features/mingpai/native-mingpai-preview-controller.ts`
- `src/features/mingpai/rules/move-card-rules.ts`
- `src/features/mingpai/rules/opt-target-rules.ts`
- `src/features/mingpai/rules/reveal-types.ts`
- `src/features/recent-cards/native-recent-card-controller.ts`
- `src/features/seat-display/seat-state-store.ts`
- `src/features/skill-assist/point-calculators.ts`
- `src/features/skill-assist/quanbian.ts`
- `src/features/skill-assist/skill-assist-store.ts`
- `src/features/skill-assist/skill-visibility.ts`
- `src/features/turn-status/turn-status-store.ts`

### 功能：rogue / extra-assist / skin-background / room-filter / 其它（22）

- `src/features/block-effects/block-effects-controller.ts`
- `src/features/block-effects/block-message-filters.ts`
- `src/features/block-effects/effect-resource-filter.ts`
- `src/features/extra-assist/extra-assist-controller.ts`
- `src/features/extra-assist/index.ts`
- `src/features/extra-assist/peixiu-assist.ts`
- `src/features/extra-assist/peixiu-map-view.ts`
- `src/features/extra-assist/peixiu-route-planner.ts`
- `src/features/extra-assist/peixiu-route-store.ts`
- `src/features/extra-assist/seat-general-tips.ts`
- `src/features/extra-assist/xushao-assist.ts`
- `src/features/rogue/index.ts`
- `src/features/rogue/rogue-controller.ts`
- `src/features/rogue/rogue-map-config-data.ts`
- `src/features/rogue/rogue-map-controller.ts`
- `src/features/rogue/rogue-map-general-stats.ts`
- `src/features/rogue/rogue-map-view.ts`
- `src/features/room-filter/classic-room-filter-controller.ts`
- `src/features/skin-background/official-background-controller.ts`
- `src/features/skin-background/skin-change-controller.ts`
- `src/features/skin-background/skin-paper-controller.ts`
- `src/features/skin-background/skin-runtime.ts`

## 顺带修正的违规注释

多处旧注释含「对照原版 / 对应原版」或仅指向旧混淆符号（如 `kD`、`nD`、`nb.show`、`nC.turn` 等），已改写为描述**当前实现**的中文说明，涉及例如：

- `src/runtime/method-patch.ts`、`game-event-bus.ts`
- `src/features/mingpai/*`、`skill-assist/*`、`block-effects/*`、`rogue/*`、`turn-status/*` 等

## 第二轮补充（剩余模块）

本轮覆盖先前跳过的功能与遗漏文件头，**修改源码 78 个**：

### 本轮重点模块

| 模块 | 内容 |
|------|------|
| `gift-code` | 登录后拉远程礼包码、按 ClientID 去重自动兑换 |
| `runtime-search` | 背包 / 将池注入搜索框与列表过滤 |
| `update-notice` | 远程 manifest、版本比较、工具 Tab 角标 |
| `countdown` | 进度条旁剩余秒数 Label |
| `turn-status` | 阶段 / 出杀剩余状态仓 |
| `recent-cards` | 最近用牌 store + 原生 Laya HUD（去掉「原版小抄」表述） |
| `block-effects` | 设置声明、协议过滤、资源替换、跑马灯接管 |
| `auto-hg` | 盖主速刷动作常量与运行时点击 |
| `legacy` | 目录为空，无文件可注 |

### 本轮亦补文件头的遗漏文件（节选）

- 座位：`seat-state-*`、`game-scene-locator`、`known-card-registry`、`seat-overlay-layout` 等
- 明牌：`mingpai-engine`、`reveal-sink`、rules、`special-spell-recovery` 等
- 山河：`rogue-shop-controller`、`rogue-story-controller`、`rogue-map-*` 等
- 皮肤：`skin-background-store/renderer/settings/favorites-tab`
- 其它：`selection-tools`、`peixiu-resources`、`panel-shell-styles`、toast/tooltip 等

### 本轮完整文件列表（78）

- `src/adapters/game-message-adapter.ts`
- `src/adapters/micro-client-message-source.ts`
- `src/features/auto-hg/auto-hg-actions.ts`
- `src/features/auto-hg/auto-hg-runtime.ts`
- `src/features/auto-task/auto-task-claims.ts`
- `src/features/auto-task/auto-task-config-data.ts`
- `src/features/auto-task/auto-task-rules.ts`
- `src/features/auto-task/auto-task-settings.ts`
- `src/features/auto-task/auto-task-windows.ts`
- `src/features/block-effects/block-effect-settings.ts`
- `src/features/block-effects/block-message-filters.ts`
- `src/features/block-effects/effect-resource-filter.ts`
- `src/features/block-effects/marquee-visibility.ts`
- `src/features/cards/card-label-controller.ts`
- `src/features/cards/game-card-catalog.ts`
- `src/features/cards/official-card-renderer.ts`
- `src/features/cards/selection-tools-controller.ts`
- `src/features/cards/tiesuo-recast-controller.ts`
- `src/features/countdown/countdown-seconds-controller.ts`
- `src/features/deck-record/deck-record-interaction.ts`
- `src/features/extra-assist/extra-assist-config-data.ts`
- `src/features/extra-assist/extra-assist-settings.ts`
- `src/features/extra-assist/nanhua-assist.ts`
- `src/features/extra-assist/peixiu-map-model.ts`
- `src/features/extra-assist/peixiu-resources.ts`
- `src/features/gift-code/gift-code-controller.ts`
- `src/features/gift-code/index.ts`
- `src/features/mingpai/draw-pile-order.ts`
- `src/features/mingpai/mingpai-engine.ts`
- `src/features/mingpai/mingpai-queries.ts`
- `src/features/mingpai/mingpai-store.ts`
- `src/features/mingpai/reveal-sink.ts`
- `src/features/mingpai/rules/move-card-rules.ts`
- `src/features/mingpai/rules/opt-target-rules.ts`
- `src/features/mingpai/rules/spell-opt-rep-rules.ts`
- `src/features/mingpai/special-spell-recovery.ts`
- `src/features/recent-cards/native-recent-card-controller.ts`
- `src/features/recent-cards/recent-card-store.ts`
- `src/features/rogue/rogue-map-config-data.ts`
- `src/features/rogue/rogue-map-config-source.ts`
- `src/features/rogue/rogue-map-event-text.ts`
- `src/features/rogue/rogue-map-geometry.ts`
- `src/features/rogue/rogue-map-layout.ts`
- `src/features/rogue/rogue-settings.ts`
- `src/features/rogue/rogue-shop-controller.ts`
- `src/features/rogue/rogue-story-controller.ts`
- `src/features/runtime-search/index.ts`
- `src/features/runtime-search/runtime-search-controller.ts`
- `src/features/seat-display/game-scene-locator.ts`
- `src/features/seat-display/game-viewport-observer.ts`
- `src/features/seat-display/known-card-registry.ts`
- `src/features/seat-display/seat-display-visibility.ts`
- `src/features/seat-display/seat-game-adapter.ts`
- `src/features/seat-display/seat-overlay-layout.ts`
- `src/features/seat-display/seat-state-controller.ts`
- `src/features/seat-display/seat-state-store.ts`
- `src/features/skill-assist/quanbian.ts`
- `src/features/skill-assist/skill-assist-controller.ts`
- `src/features/skill-assist/skill-visibility.ts`
- `src/features/skill-assist/yanxi.ts`
- `src/features/skin-background/skin-background-favorites-tab.ts`
- `src/features/skin-background/skin-background-renderer.ts`
- `src/features/skin-background/skin-background-settings.ts`
- `src/features/skin-background/skin-background-store.ts`
- `src/features/turn-status/turn-status-store.ts`
- `src/features/update-notice/index.ts`
- `src/features/update-notice/update-manifest.ts`
- `src/features/update-notice/update-notice-controller.ts`
- `src/runtime/game-lifecycle-events.ts`
- `src/runtime/method-patch.ts`
- `src/ui/dialog/dialog-position.ts`
- `src/ui/panel/game-layout-docking.ts`
- `src/ui/panel/panel-drag.ts`
- `src/ui/panel/panel-model.ts`
- `src/ui/panel/panel-shell-styles.ts`
- `src/ui/toast/show-toast.ts`
- `src/ui/tooltip/TooltipLayer.vue`
- `src/ui/tooltip/tooltip-position.ts`

## 仍跳过的部分

| 范围 | 原因 |
|------|------|
| `src/env.d.ts` | 纯类型声明，无业务逻辑 |
| `features/legacy` | 空目录 |
| 已有充分中文 JSDoc 且文件头已存在的文件（如 `lifecycle.js`、`wait-for-game-runtime.js`） | 避免噪音 |
| `node_modules` / `dist` | 不存在或禁止触碰 |
| 运行时代码本身 | 硬约束：只加注释 |

## 注释风格约定（本次遵循）

- 文件头说明职责与在链路中的位置
- 导出函数用简短 JSDoc 说明意图与副作用
- Vue 组件在 `<script>` 顶部说明职责
- 禁止「对照原版」式出处注释；混淆符号仅当它是**当前代码中的真实标识符**时才可出现在注释中

