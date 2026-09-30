# 小抄工程结构

- `src/entries/electron.ts`：Electron 微端注入入口。
- `src/entries/userscript.ts`：油猴脚本入口（当前冻结，微端完成后再继续）。
- `src/core/`：两个平台共享的启动、生命周期与业务编排。
- `src/adapters/`：Electron preload 与浏览器 API 的平台差异。
- `src/features/`：按钮、报告、预览等独立业务功能。
- `src/runtime/`：游戏对象适配、计时器和状态管理。
- `src/ui/`：Vue 页面、组件、布局和交互。
- `src/legacy/xiaochao-legacy.js`：迁移期兼容代码，不是最终源码结构。
- `dist/electron/xiaochao.js`：微端注入产物，禁止手工修改。
- `dist/userscript/xiaochao.user.js`：可安装的油猴脚本（当前不参与默认构建）。

## 开发

```powershell
npm install
npm run dev                 # Vite 监听 + Electron 微端
npm run dev:ui              # 浏览器只挂面板 UI（不连游戏，方便改样式）
npm run build               # 只构建 Electron 微端注入脚本
npm run pack                # 打出可替换官方 app.asar 的发布包
npm test
```

`npm run dev` 必须用「可加载仓库目录」的 `electron.exe`（`SGSOL_ELECTRON_PATH` → `resources\xiaochao-electron-runtime` → `tools\electron-runtime` → `npm i -D electron`）。**不要用官方 `SGSOL.exe` 跑 dev**：它是已打包微端，会忽略仓库路径、始终加载 `Program Files` 里的 app，`dist` 热更新和样式改动会看起来完全没生效。验证正式包样式用 `.\deploy.bat`。

修改 `src` 后 Vite 会生成 `dist/electron/xiaochao.js`，微端检测到产物变化后刷新游戏 webview。当前里程碑只维护 Electron 微端；`build:userscript` 和 `dev:userscript` 仅保留为后续兼容入口，不纳入日常开发与验收。

仓库约定：新增脚本用 `.ts` / `.js`，不要再用 `.mts` / `.mjs`；Electron 壳等 CommonJS 用 `.cjs`。`package.json` 已设 `"type": "module"`。

### 发布包

`npm run pack` 会先构建脚本，再以 `tools/release-app-shell/`（已验证可启动的微端壳）为底板，只替换 `xiaochao.js`，打成：

```text
release/wd-xc.zip
  ├── app.zip           # 解压后得到 app/（正式微端壳 + 当前小抄脚本）
  ├── install.bat / install.sh
  ├── restore.bat / restore.sh
  └── 安装说明.txt
```

解压 `wd-xc.zip` 后，把其中文件放进 `C:\Program Files\SGSOL\resources`，管理员运行 `install.bat`。仓库根目录的 `main.js` 仅给 `npm run dev` 用，不打进发布包。

本地一键部署（打包并覆盖安装到官方微端目录）：

```powershell
.\deploy.bat                 # 提权 → npm pack → 解压安装到 C:\Program Files\SGSOL\resources
.\deploy.bat --no-pack       # 只安装已有的 release\wd-xc.zip
```

或已有管理员终端时：`npm run deploy`。目录可用环境变量 `SGSOL_RESOURCES` 或参数 `--resources=路径` 覆盖。部署前需退出 `SGSOL.exe`。

开发能看到、打包后没有：正式微端注入的是 `%APPDATA%\SGSOL\xiaochao\xiaochao.js`，不是 `resources\app\xiaochao.js`。`npm run dev` 直接读 `dist/electron/xiaochao.js`；安装后若 userData 里仍是旧脚本，不会自动用 app 里的新版本。`deploy` 会同时覆盖 userData 脚本并清理旧的远程更新字段；壳启动时也会按内容哈希把 app 内置脚本同步进 userData。不再从 `xiaochao.org` 拉脚本或微端包。

TypeScript 类型检查当前暂时关闭：`tsconfig.json` 使用 `noCheck`，`npm run typecheck` 只输出关闭提示。Vite 仍会转译 TypeScript；无法解析的语法错误仍会阻止构建。

## 后续 TODO（暂缓）

- 统一去掉 `.cjs`：把 `dev-main.cjs`、`tools/*.cjs`、`script/runtime-startup.cjs` 等改成 `.js` 或 `.ts`，并理顺模块加载；**现在不做**（见 `docs/功能清单.md` 阶段 G）。

完整剩余事项（删 legacy 阻断、面板缺口、待实机、明确不做）见 **`docs/剩余工作.md`**。

## 迁移规则

迁移顺序固定为：入口 → 生命周期 → Vue UI → 点击事件 → 业务功能。每次从 legacy 中迁移一个完整调用链：先语义化命名并确认职责，再写成可注入依赖的模块并补测试，通过实际微端验证后在工程入口停用对应旧能力。当前每一步只要求 `npm run build` 生成可用的 Electron 产物。

`src/legacy/xiaochao-legacy.js` 作为原始行为基线保持只读，迁移期间禁止直接修改。旧代码与新外壳冲突时，必须在 Vue、适配器或运行时桥接层隔离；所有功能迁移完成后整体删除该文件，而不是持续在其中打补丁。

### 完成标准

- 新文件存在但运行时仍依赖 legacy 对应能力：只算兼容桥接，不算迁移完成。
- 一个切片只有在旧 DOM 创建、旧状态、旧事件绑定和旧入口调用都不再参与运行后，才算完成。
- 每停用一个旧切片，都要在实际微端验证它可见、可操作，并运行相关自动化测试。
- 禁止长期保留两套实现或依靠“新代码接管旧代码生成结果”的方式冒充迁移。
- 最终验收要求移除 `src/legacy/xiaochao-legacy.js` 的入口导入，工程仍能独立启动和执行。

## 当前 UI 迁移边界

- 旧面板模板来自 `window.XC.iframe`，其原始值是 legacy 中的 `S8` HTML 字符串。
- 旧 `th()` 负责创建 `#createIframe`、写入模板、调整四个主标签页并注册大量事件。
- Vue 将先独立创建窗口外壳、标题栏、折叠状态和主标签页；验证后删除 `th()` 中对应创建与事件代码。
- 尚未迁移的页面放入兼容内容区，继续使用旧 DOM 与旧事件，确保微端功能不中断。
- 某个页面的 DOM、状态和事件全部迁移完成后，才删除 legacy 中对应实现。

### 已完成切片

- 悬浮框外壳由 Vue 创建并管理，legacy 不再创建外层 DOM。
- 标题栏的展开/折叠状态、点击事件、尺寸恢复和状态持久化已迁入 Vue。
- 展开/折叠所需样式由 `panel-shell-styles.ts` 独立安装；legacy 中对应函数、事件、状态和 CSS 已删除。
- 四个主标签按钮、激活状态、点击事件和样式均由 Vue 管理；legacy 仅暂存尚未迁移的页面内容。
- legacy 页面提取必须以原模板的 `#content` 为根节点；旧 `.panel-header` 容器会被移除，只保留四个 `.xc-main-tab-pane` 供 Vue 切换。
- 面板拖拽由 Vue Pointer Events 管理，限制在游戏可视区内并持久化位置；右侧停靠沿用原版微端机制，通过 `window.padding`、`Laya.Browser.clientWidth` 和游戏 resize 事件让引擎按“微端宽度减去小抄宽度”重排；脱离、折叠或卸载时恢复原始 getter 与背景宽度。
- Vue 外壳布局只写 `--xc-panel-*` 命名空间变量；最终位置和尺寸由带 `!important` 的映射规则生成。legacy 可以保留普通内联 style 写入，但不能改变外壳计算样式。
- 从右侧拖离时先清零布局 padding 并触发游戏原生 resize，游戏立即向右恢复完整宽度；legacy 的延迟布局刷新只负责随后校正各游戏图层。
- 当前登录页不会注入面板；进入游戏页面后由开发微端自动刷新并加载最新构建。

## Electron 启动约束

- `electron-bootstrap.ts` 必须先于 legacy 执行，因为 legacy 顶层会立即读取生命周期桥接。
- 游戏网页不存在 Node.js 的 `process`；Electron Vite 配置必须在构建时替换 `process.env.NODE_ENV`。
- 面板启动只等待 `SystemContext` 和 `#bgDiv`。`JSZipUtils`、`CtrUtil` 属于资源功能依赖，缺失时不得阻止基础面板显示。
- 开发构建变化后微端会刷新游戏 webview，并重新注入 `dist/electron/xiaochao.js`。

## 命名规则

- 禁止把 `K4`、`rR`、`aH` 等混淆标识符带进新模块。
- 函数使用“动词 + 业务对象”，例如 `waitForGameRuntime`、`initializeMainPanel`。
- 布尔值使用 `is`、`has`、`can`、`should` 前缀。
- 事件处理器使用 `handle` 前缀；注册函数使用 `bind` 或 `register` 前缀。
- 参数表达业务含义，例如 `eventName`、`panelElement`，不使用 `data1`、`value2`。
- 无法确认业务含义时先保留在 legacy，不凭猜测命名。
