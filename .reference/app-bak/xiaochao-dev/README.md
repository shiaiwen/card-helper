# 小抄开发模式

客户端优先加载本目录下的 `xiaochao.js`。文件不存在时，自动回退到正式版小抄。

## 直接编辑单文件

将解混淆后的完整用户脚本保存为 `xiaochao.js`。保存后客户端会自动刷新游戏 webview。

## 使用模块化源码

将浏览器入口放在 `src/index.js`，然后运行：

```powershell
.\build-watch.ps1
```

构建程序会持续监听 `src`，并把代码打包为当前目录下的 `xiaochao.js`。入口必须真正启动小抄，而不能只导出函数。

删除或重命名 `xiaochao.js` 即可恢复加载正式版。
