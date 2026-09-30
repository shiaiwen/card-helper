# 发布用微端壳

这里是已经能启动的官方微端 `app/` 底板（不含 `xiaochao.js`）。

`npm run pack` 会整份复制本目录，再写入当前工程构建的 `xiaochao.js`，打成 `release/wd-xc.zip`。

开发中的仓库根目录 `main.js` 等仍供 `npm run dev` 使用，**不要**把开发改动直接打进发布包；升级微端壳时，用已验证可运行的正式 `app.zip` 覆盖本目录（去掉其中的 `xiaochao.js`）。
