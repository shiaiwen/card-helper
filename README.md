# 小抄

注入三国杀微端的脚本。功能代码在本仓库，运行时挂进游戏页面。

小抄版本只看根目录 `package.json` 的 `version`。打包后写进 `xiaochao.js` 的 `@version`，并出现在线上版本接口里。

## 框架

| 目录 | 作用 |
| --- | --- |
| `src/entries` | 入口。微端走 `electron.ts`，油猴走 `userscript.ts` |
| `src/core/bootstrap.ts` | 启动器。组装配置、事件、各功能控制器和 Vue 面板 |
| `src/features` | 功能。明牌、身份、礼包码、检查更新等都在这里 |
| `src/ui` | Vue 面板 |
| `src/adapters` | 平台和游戏对象定位。功能代码不直接依赖微端壳 |
| `tools/release-app-shell` | 打进安装包的微端壳。业务改动不要写在这里 |
| `tests` | 用 `node --experimental-strip-types` 跑的测试 |

开发时 `npm run dev` 用仓库里的 Electron 44 加载本目录。已安装的 `SGSOL.exe` 不会加载这个仓库，不能拿来当开发进程。

## 快速上手

```bash
npm install
npm run dev
```

改 `src` 后，开发进程会按 Vite 的 watch 重新构建脚本。确认某个功能时，在对应的 `tests/*.test.ts` 里补断言：

```bash
node --experimental-strip-types tests/某个测试.test.ts
```

新功能放在 `src/features` 下自己的目录，由 `src/core/bootstrap.ts` 安装。面板放在 `src/ui`。不要把正确性建在 `src/legacy` 上。

## 发布

1. 把根目录 `package.json` 的 `version` 改成比线上更高的三段版本，例如 `1.0.12`。小于或等于已安装版本时，客户端不会提示更新。

2. 在本仓库执行：

```bash
npm run pack
npm run copy:portal
```

`npm run pack` 会生成：

| 文件 | 用途 |
| --- | --- |
| `release/wd-xc-<版本>.zip` | 手动安装包。解压后运行里面的 `install.bat` |
| `release/app.zip` | 自动更新包，文件名不带版本 |
| `release/xiaochao-manifest.json` | 版本清单 |
| `dist/userscript/xiaochao.user.js` | 油猴脚本。拷到门户后文件名是 `sgs-xc.user.js` |

打包还会把清单拷到旁边的 `sgs-xc-server/data/xiaochao-manifest.json`。线上接口 `https://95chong.cn/api/xiaochao-version` 读的是服务器上的这份文件。接口进程要在这份文件更新后重新加载，游戏里的「检查更新」才会看到新版本。

3. 发布下载页。`copy:portal` 把安装包、`app.zip`、清单和油猴脚本拷到 `sgs-xc-portal/public/downloads`。油猴脚本在网站上是 `/downloads/sgs-xc.user.js`。然后：

```bash
cd ../sgs-xc-portal
npm run deploy
```

终端出现「已同步到 admin@123.56.3.130:/opt/xc/dist」后，下载页才是新包。

| 地址 | 内容 |
| --- | --- |
| `https://xc.95chong.cn/downloads` | 下载页，链接到 `wd-xc-<版本>.zip` |
| `https://xc.95chong.cn/downloads/app.zip` | 自动更新用的包 |
| `https://xc.95chong.cn/downloads/sgs-xc.user.js` | 油猴脚本。浏览器打开后由篡改猴安装，版本号升高后会提示更新 |
| `https://95chong.cn/api/xiaochao-version` | 游戏内检查更新读的版本 |
