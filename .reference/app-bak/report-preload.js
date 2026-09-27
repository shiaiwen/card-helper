'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 独立报告窗口只暴露操作消息，不暴露 Electron 或任意 IPC 通道。
// 消息不会触发页面导航，初始化时的有效期请求和会员探测可同时发送。
contextBridge.exposeInMainWorld('xiaochaoReportActions', {
    send(url) {
        // 旧版 Chromium 对自定义协议使用 opaque URL，hostname 会为空。
        // 原始 URL 交给主进程的 Node URL 解析，与导航入口保持一致。
        return ipcRenderer.invoke('xiaochao-report-action', String(url));
    }
});
