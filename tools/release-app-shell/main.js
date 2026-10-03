// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, Menu, systemPreferences, screen } = require('electron')
const { crashReporter, session  } = require('electron')
let autoUpdater = null;
let autoUpdaterLoadError = null;
let updateHandleInitialized = false;

const fs = require('fs');
const crypto = require('crypto');
const path = require('path')
const os = require('os')
const { createSharedStore, createJsonConfig, normalizeCredentials: normalizeSharedCredentials } = require('./shared-store')
const { selectInstanceProfile } = require('./instance-profile')
const instanceProfile = selectInstanceProfile(app)
const { createHtmlReportOpener } = require('./report-window')
const { scheduleMicroClientUpdate } = require('./micro-client-update')


const steamAppID = 4209770;
let mainWindow;

// Runtime writes go to userData; the install directory may be read-only (e.g. C:\Program Files).
let dataDirectory = '';
let configPath = '';
let sharedConfigPath = '';
let sharedConfig = null;
let scriptPath = '';
let tempScriptPath = '';
let logFilePath = '';
let config = null;
global.config = config;
global.scriptPath = '';
global.configPath = '';
const localScriptCache = {
    sourcePath: '',
    mtimeMs: -1,
    size: -1,
    data: ''
};
let interceptor = null;
try {
    interceptor = require('./interceptor');
} catch (error) {
    console.error('interceptor load failed:', error);
}
// 杀批账本云同步中继：报告窗口(data: URL, 无 opener) → 主进程 → 游戏 webview 里的
// 小抄脚本执行上传/下载 → 结果按 rid 回送给发起的报告窗口。probe 用于会员状态探测。
const GOODS_FLOW_SYNC_CHANNEL = 'xiaochao-goods-flow-sync';
const GOODS_FLOW_SYNC_RESULT_CHANNEL = 'xiaochao-goods-flow-sync-result';
const GOODS_FLOW_SYNC_ACTIONS = ['probe', 'upload', 'download'];
const GOODS_FLOW_SYNC_PROBE_TIMEOUT_MS = 12000;
const GOODS_FLOW_SYNC_TIMEOUT_MS = 90000;
const goodsFlowSyncPendingByRid = new Map();

function jsonLiteralForScript(value) {
    // U+2028/U+2029 在 JSON 里合法但在 JS 字符串字面量里是行终止符，executeJavaScript 前转义。
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function deliverGoodsFlowSyncResponse(reportWindow, payload) {
    if (!reportWindow || reportWindow.isDestroyed()) return;
    try {
        const script = 'window.__xcGoodsFlowCloudSyncResult && window.__xcGoodsFlowCloudSyncResult('
            + jsonLiteralForScript(String(payload && payload.rid || ''))
            + ', ' + jsonLiteralForScript(payload) + ');';
        reportWindow.webContents.executeJavaScript(script).catch(error => {
            console.error('deliver xc goods flow sync response failed:', error);
        });
    } catch (error) {
        console.error('deliver xc goods flow sync response failed:', error);
    }
}

function handleGoodsFlowCloudSyncAction(params, reportWindow, sourceWebContents, sourceId = '') {
    const rid = String(params && params.rid || '');
    const action = String(params && params.action || '');
    if (!/^[A-Za-z0-9-]{6,64}$/.test(rid) || !GOODS_FLOW_SYNC_ACTIONS.includes(action)) {
        deliverGoodsFlowSyncResponse(reportWindow, { rid, ok: false, error: 'invalid_goods_flow_sync_request' });
        return true;
    }
    if (!sourceWebContents || sourceWebContents.isDestroyed()) {
        deliverGoodsFlowSyncResponse(reportWindow, { rid, ok: false, error: 'goods_flow_sync_unavailable' });
        return true;
    }
    const previous = goodsFlowSyncPendingByRid.get(rid);
    if (previous) clearTimeout(previous.timer);
    const pending = { reportWindow, sourceWebContents };
    goodsFlowSyncPendingByRid.set(rid, pending);
    pending.timer = setTimeout(() => {
        if (goodsFlowSyncPendingByRid.get(rid) === pending) goodsFlowSyncPendingByRid.delete(rid);
        deliverGoodsFlowSyncResponse(reportWindow, { rid, ok: false, error: 'goods_flow_sync_timeout' });
    }, action === 'probe' ? GOODS_FLOW_SYNC_PROBE_TIMEOUT_MS : GOODS_FLOW_SYNC_TIMEOUT_MS);
    sourceWebContents.send(GOODS_FLOW_SYNC_CHANNEL, { rid, action, ...(sourceId ? { sourceId } : {}) });
    return true;
}

function normalizeGoodsFlowSyncResponse(payload) {
    const response = { rid: String(payload && payload.rid || ''), ok: payload?.ok === true };
    if (payload?.error) response.error = String(payload.error).slice(0, 200);
    if (payload?.action) response.action = String(payload.action).slice(0, 16);
    if (payload?.probe === true) response.probe = true;
    if (payload?.available !== undefined) response.available = payload?.available === true;
    for (const key of ['total', 'added', 'updated']) {
        const value = Number(payload?.[key]);
        if (Number.isSafeInteger(value) && value >= 0) response[key] = value;
    }
    // 上传完成后服务端返回 repair.completed；报告窗口用它把修复中图标切换为对勾。
    // 微端结果必须经过这里的白名单后再注入独立报告窗口，因此显式保留并约束字段。
    if (payload?.repair?.completed === true) {
        response.repair = { completed: true };
        const changed = Number(payload.repair.changed);
        if (Number.isSafeInteger(changed) && changed >= 0) response.repair.changed = changed;
    }
    if (Array.isArray(payload?.records)) response.records = payload.records.slice(-30000);
    return response;
}

function initGoodsFlowSyncRelay() {
    ipcMain.handle(GOODS_FLOW_SYNC_RESULT_CHANNEL, (event, payload) => {
        const rid = String(payload && payload.rid || '');
        const pending = goodsFlowSyncPendingByRid.get(rid);
        if (!pending || event.sender !== pending.sourceWebContents) return false;
        goodsFlowSyncPendingByRid.delete(rid);
        clearTimeout(pending.timer);
        deliverGoodsFlowSyncResponse(pending.reportWindow, normalizeGoodsFlowSyncResponse(payload));
        return true;
    });
}

const openXcWindow = createHtmlReportOpener({
    BrowserWindow,
    ipcMain,
    getUserDataPath: () => app.getPath('userData'),
    getWorkAreaSize: () => screen.getPrimaryDisplay().workAreaSize,
    onAction: ({ action, params }, { reportWindow, sourceWebContents, sourceId }) => {
        if (action === 'goods-flow-cloud-sync') {
            return handleGoodsFlowCloudSyncAction(params, reportWindow, sourceWebContents, sourceId);
        }
        return false;
    }
});
const isWin7 = os.release().startsWith('6.1');
// win7 下关闭硬件加速
if (isWin7) {
    //app.disableHardwareAcceleration();    // 关闭硬件加速
    //app.getGPUFeatureStatus()
    //app.commandLine.appendSwitch('disable-gpu')
}

//app.commandLine.appendSwitch("--disable-http-cache");
app.commandLine.appendSwitch("--no-sandbox");
app.commandLine.appendSwitch("--enable-webgl");
app.commandLine.appendSwitch('ignore-gpu-blacklist');
// 禁止 Chromium 在 cwd / 可执行目录自动写 debug.log
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-file', process.platform === 'win32' ? 'NUL' : '/dev/null');

var package = require("./package.json");
global.Version = package.version;
global.IsTest = package.IsTest;
global.PackageId = package.packageId;
global.URLOffTest = package.URLOffTest;
global.URLLYTest = package.URLLYTest;
global.platform = package.platform;

global.AutoUpdaterURL = package.AutoUpdaterURL;
global.JumpURL = package.JumpURL;
global.FeedURL = package.FeedURL;
global.LoginURL = package.LoginURL;
global.IsDebug = package.IsDebug;
global.ChannelId = package.ChannelId;

let steamworks = null;
if (global.platform == 1) {
    try {
        steamworks = require('steamworks.js');
        let relaunch = steamworks.restartAppIfNecessary(steamAppID);
        if (relaunch) {
            app.quit();
        } else {
            client = steamworks.init(steamAppID);
            if (client) {
                console.log('Steam init success');
            } else {
                console.error('Steam init failed');
                app.quit();
            }
        }
    } catch (error) {
        console.error('Steamworks init failed:', error);
        app.quit();
    }
}

if (process.platform == 'darwin') {
    console.log('mac');
    app.dock.hide();
}

if (process.platform == 'win32') {
    console.log('win');
    if (global.platform == 1) {
        //const greenworks = require('./greenworks/greenworks');
    }
}

function loadWindow() {
    if (global.platform == 0) {
        createWindow();
    } else if (global.platform == 1) {
        createWindow();
        setupPaymentCallback();
    }
}


async function createWindow() {
    await initConfig();
    global.PackageId = config.get('packageId', package.packageId);

    // Create the browser window.
    console.log("createWindow");
    mainWindow = new BrowserWindow({
        width: config.get('width', 1400),
        height: config.get('height', 820),
        frame: false,
        resizable: true,
        titleBarStyle: 'customButtonOnHover',
        webPreferences: {
            webviewTag: true,
            nodeIntegration: true,
            webSecurity: false,
            contextIsolation: false,  //12之后需要设置
            enableRemoteModule: true,
            nativeWindowOpen: true, //是否使用原生的window.open()
            plugins: true, //是否支持插件
            sandbox: true, //沙盒选项,这个很重要
            imageAnimationPolicy: 'always',
            allowRunningInsecureContent: true,
            allowDisplayingInsecureContent: true,
            preload: path.join(app.getAppPath(), './script/electron_frame.js')
            //allowRunningInsecureContent: true,
            // allowDisplayingInsecureContent :true
        }
    })
    if (interceptor) {
        try {
            await interceptor(mainWindow);
        } catch (error) {
            console.error('interceptor init failed:', error);
        }
    }
    mainWindow.loadFile('./index_wd.html');
    scheduleMicroClientUpdate({
        app,
        dialog,
        BrowserWindow,
        screen,
        getMainWindow: () => mainWindow,
        logMessage,
        getScriptPath: () => scriptPath
    });
    if (config.get('firstTime', true) === true || config.get('firstTimeAnnouncementSeen', false) !== true) {
        firstTimeAnnouncement(mainWindow);
    }
    //mainWindow.loadURL('https://web.sanguosha.com/test_h5.html');

    mainWindow.setMenu(null);
    // let devtools = new BrowserWindow();
    // mainWindow.webContents.setDevToolsWebContents(devtools.webContents)
    // mainWindow.webContents.openDevTools({ mode: 'detach' })

    // Emitted when the window is closed.
    mainWindow.on('closed', function () {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        console.log("closed1")
        mainWindow = null
    })

    mainWindow.webContents.on('crashed', function () {
        console.log("crashed");
        //crashReporter.addExtraParameter("whlie", "main");
    })

    mainWindow.webContents.on('resize', function () {
        console.log("win resize");

        mainWindow.webContents.send('resize', 1);
        //crashReporter.addExtraParameter("whlie", "main");
    })

    mainWindow.on('enter-full-screen', function () {
        console.log("enter");
        mainWindow.webContents.send('enter-full-screen', 1);
    });

    mainWindow.on('leave-full-screen', function () {
        console.log("leave");
        mainWindow.webContents.send('enter-full-screen', 0);
    });


    const ret = globalShortcut.register('F11', () => {
        if (mainWindow.isFullScreen()) {
            mainWindow.setFullScreen(false);
        } else {
            mainWindow.setFullScreen(true);
        }
    })

    globalShortcut.register('F6', () => {
        let devtools = new BrowserWindow();
        mainWindow.webContents.setDevToolsWebContents(devtools.webContents)
        mainWindow.webContents.openDevTools({ mode: 'detach' })

        mainWindow.webContents.send('onF6', 1);
    })
    if (global.platform == 0) {
        updateHandle();
    }
}

function initEvent() {
    //require('./script/ipc_main');
    //require('./script/electron_frame.js');
    initGoodsFlowSyncRelay();
    ipcMain.handle('get-steam-id', (event) => {
        const steamId = client.localplayer.getSteamId();
        console.log(`steamid "${steamId.steamId64}" `);
        return steamId.steamId64; // 返回 64 位 Steam ID
    });

    // 示例：处理解锁成就的请求
    ipcMain.handle('activate-achievement', (event, achievementName) => {
        if (client.achievement.activate(achievementName)) {
            console.log(`成就 "${achievementName}" 已解锁！`);
            return true;
        }
        return false;
    });

    ipcMain.handle('get-user-language', (event) => {
        const lan = client.apps.currentGameLanguage();
        let sxLan = 'en';
        switch (lan) {
            case "schinese":
                sxLan = "zh-CN"
                break;
            case "tchinese":
                sxLan = "zh-TW"
                break;
            case "japanese":
                sxLan = "ja"
                break;
            default:
                sxLan = "en"
                break;
        }
        return sxLan;
    });

    ipcMain.handle('get-package', () => getPackageSnapshot());
}
initEvent();

// Codex migration IPC shims used by the app_old preload script.
ipcMain.on('get-global-sync', (event, name) => {
    event.returnValue = getRuntimeGlobal(name);
});

ipcMain.on('get-app-path-sync', (event, name) => {
    try {
        event.returnValue = app.getPath(name);
    } catch (error) {
        event.returnValue = '';
    }
});

ipcMain.handle('read-local-script', async () => readLocalScriptCached());


ipcMain.on('read-local-script-sync', (event) => {
    event.returnValue = readLocalScriptCached();
});

ipcMain.on('show-context-menu', (event) => {
    createContextMenu().popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.handle('has-open-handler', () => true);

ipcMain.handle('open-window', (event, request) => {
    const url = typeof request === 'string' ? request : request?.url;
    const sourceId = typeof request?.sourceId === 'string' ? request.sourceId : '';
    return openXcWindow(url, { sourceWebContents: event.sender, sourceId });
});

ipcMain.handle('open-external', (event, url) => {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) return false;
    shell.openExternal(value);
    return true;
});

ipcMain.on('setBounds', () => {
    if (!mainWindow) return;
    mainWindow.setBounds({
        width: config.get('width', 1400),
        height: config.get('height', 820)
    });
});

ipcMain.handle('get-userlist', () => config.get('userlist', []));
ipcMain.handle('save-userlist', (event, userlist) => {
    config.set('userlist', Array.isArray(userlist) ? userlist : []);
});

//initCrash();

function initCrash() {
    console.log("crashReporter.start");
    console.log(app.getPath('crashDumps'))
    crashReporter.start({
        productName: 'Lyf',
        companyName: 'Yoka',
        submitURL: 'http://127.0.0.1:1127/post',
        uploadToServer: false,
        compress: false
    })
    global.globle_name = "1";
    //crashReporter.addExtraParameter("whlie","global");
    crashReporter.addExtraParameter("whlie", global.globle_name);
}

function setupPaymentCallback() {
    // 注册微交易授权响应回调
    console.log('Steam init setupPaymentCallback');
    const microTxnHandler = client.callback.register(
        client.callback.SteamCallback.MicroTxnAuthorizationResponse,
        (response) => {
            console.log(`MicroTxn Response - OrderID: ${response.orderId}, Authorized: ${response.authorized}`);

            if (response.authorized) {
                // 支付成功！通知渲染进程或直接通知游戏服务器
                mainWindow.webContents.send('payment-authorized', { orderId: response.orderId });
            } else {
                // 支付失败或取消
                mainWindow.webContents.send('payment-failed');
            }
        }
    );
}

ipcMain.on('main-render', (event) => {
    mainWindow.webContents.send('list', 'Main进程主动发送的消息');
})

ipcMain.on('PERMISSION_REQUEST', async (event, arg) => {

    console.log('#######:' + JSON.stringify(arg));

    const type = arg.type;

    const res = await systemPreferences.getMediaAccessStatus(type);

    event.returnValue = res;
    console.log('#######111:' + JSON.stringify(res));
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.setAppUserModelId('org.xiaochao.sgsol');
app.on('ready', loadWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') app.quit()
    console.log("quit");
})

app.on('resize', function () {
    console.log("win resize");

    mainWindow.webContents.send('resize', 1);
})

app.on('activate', function () {
    console.log("activate")
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) loadWindow()
})

let guanxingWindow = null;

function isGuanxingPageUrl(url) {
    try {
        return new URL(url).hostname === 'gx.95chong.cn';
    } catch (error) {
        return false;
    }
}

function openGuanxingBrowserWindow(url) {
    if (guanxingWindow && !guanxingWindow.isDestroyed()) {
        if (guanxingWindow.webContents.getURL() !== url) guanxingWindow.loadURL(url);
        guanxingWindow.show();
        guanxingWindow.focus();
        return;
    }
    const area = screen.getPrimaryDisplay().workAreaSize;
    guanxingWindow = new BrowserWindow({
        width: Math.max(640, Math.min(1200, area.width - 80)),
        height: Math.max(480, Math.min(860, area.height - 80)),
        title: '自助观星',
        autoHideMenuBar: true,
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
    guanxingWindow.on('closed', () => {
        guanxingWindow = null;
    });
    guanxingWindow.loadURL(url);
}

app.on('web-contents-created', (e, webContents) => {
    webContents.on('new-window', (event, url) => {
        event.preventDefault();
        if (isGuanxingPageUrl(url)) {
            openGuanxingBrowserWindow(url);
            return;
        }
        shell.openExternal(url);
    });
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

function loadAutoUpdaterCompat() {
    if (autoUpdater) return autoUpdater;
    if (autoUpdaterLoadError) return null;

    const nodeMajor = Number(String(process.versions && process.versions.node || '0').split('.')[0]);
    if (nodeMajor && nodeMajor < 14) {
        autoUpdaterLoadError = new Error('electron-updater requires fs/promises, current Node is ' + process.versions.node);
        console.warn('electron-updater disabled for this runtime:', autoUpdaterLoadError.message);
        return null;
    }

    try {
        require('fs/promises');
        autoUpdater = require("electron-updater").autoUpdater;
        return autoUpdater;
    } catch (error) {
        autoUpdaterLoadError = error;
        console.warn('electron-updater disabled for this runtime:', error.message);
        return null;
    }
}

// 检测更新，在你想要检查更新的时候执行，renderer事件触发后的操作自行编写
function updateHandle() {
    if (updateHandleInitialized) return;
    updateHandleInitialized = true;

    const updater = loadAutoUpdaterCompat();
    if (!updater) {
        ipcMain.on("checkForUpdate", () => {
            const reason = autoUpdaterLoadError ? autoUpdaterLoadError.message : 'unknown reason';
            console.log('autoUpdater unavailable, skip update check:', reason);
        });
        mainWindow.once('focus', () => mainWindow.flashFrame(false));
        return;
    }

    let message = {
        error: '检查更新出错',
        checking: '正在检查更新……',
        updateAva: '检测到新版本，正在下载……',
        updateNotAva: '现在使用的就是最新版本，不用更新',
    };

    let uploadUrl = global.AutoUpdaterURL[global.PackageId - 1];

    updater.setFeedURL(uploadUrl);
    updater.on('error', function (error) {
        sendUpdateMessage(message.error)
    });
    updater.on('checking-for-update', function () {
        sendUpdateMessage(message.checking)
    });
    updater.on('update-available', function (info) {
        //sendUpdateMessage(message.updateAva)
    });
    updater.on('update-not-available', function (info) {
        sendUpdateMessage(message.updateNotAva)
    });

    // 更新下载进度事件
    updater.on('download-progress', function (progressObj) {
        mainWindow.webContents.send('downloadProgress', progressObj)
    })
    updater.on('update-downloaded', function (event, releaseNotes, releaseName, releaseDate, updateUrl, quitAndUpdate) {
        updater.quitAndInstall();
        // ipcMain.on('isUpdateNow', (e, arg) => {
        //     console.log(arguments);
        //     console.log("开始更新");
        //     //some code here to handle event
        //     autoUpdater.quitAndInstall();
        // });
        //mainWindow.webContents.send('isUpdateNow')
    })
    ipcMain.on("checkForUpdate", () => {
        //执行自动更新检查
        updater.checkForUpdates();
        // mainWindow.webContents.send('downloadProgress', { "bytesPerSecoend": 111, "delta": 11, "percent": 2, "total": 30, "transferred": 32 })
    })

    mainWindow.once('focus', () => mainWindow.flashFrame(false))
}

// 通过main进程发送事件给renderer进程，提示更新信息
function sendUpdateMessage(text) {
    mainWindow.webContents.send('message', text)
}

//接收最小化命令
ipcMain.on('window-min', function () {
    mainWindow.minimize();
})
//接收最大化命令
ipcMain.on('window-max', function () {
    if (mainWindow.isMaximized()) {
        mainWindow.restore();
    } else {
        mainWindow.maximize();
    }
})
//接收关闭命令
ipcMain.on('window-close', function () {
    dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '提示',
        message: '是否确定退出游戏',
        buttons: ['ok', 'cancel']
    }).then((index) => {
        if (index.response == 0) {
            mainWindow.close();
        }
    })
})

ipcMain.on('e-feed', (event) => {
    console.log("e-feed");
    let url = global.FeedURL[global.PackageId - 1];
    shell.openExternal(url);
    // process.crash();
})

ipcMain.on('e-clear', (event) => {
    console.log("e-clear");
    session.defaultSession.clearCache();
    // process.crash();
})

ipcMain.on('e-office', (event) => {
    let url = global.JumpURL[global.PackageId - 1];
    shell.openExternal(url);
})

ipcMain.on('e-search', (event, msg) => {
    console.log("e-search" + msg);
    shell.openExternal("https://www.baidu.com/s?wd=" + msg);
})

ipcMain.handle('pc_2_flashWindow', (event, str) => {
    console.log('pc_2_flashWindow', str);
    mainWindow.flashFrame(true)
});


function getSharedConfig() {
    if (!sharedConfig) {
        const filePath = sharedConfigPath || path.join(instanceProfile.sharedUserData, 'xiaochao', 'shared.json');
        sharedConfig = createSharedStore(filePath);
        const stopWatching = sharedConfig.watchSettings(changes => {
            for (const contents of require('electron').webContents.getAllWebContents()) {
                if (!contents.isDestroyed()) contents.send('xiaochao-settings-changed', changes);
            }
        });
        const stopNativeWatching = sharedConfig.watchNativeSettings((origin, snapshot) => {
            for (const contents of require('electron').webContents.getAllWebContents()) {
                if (contents.isDestroyed()) continue;
                try {
                    if (new URL(contents.getURL()).origin === origin) {
                        contents.send('xiaochao-native-settings-changed', { origin, snapshot });
                    }
                } catch (_) {}
            }
        });
        app.once('will-quit', () => { stopWatching(); stopNativeWatching(); });
    }
    return sharedConfig;
}

ipcMain.on('xiaochao-settings-register-sync', (event, payload) => {
    try {
        const keys = Array.isArray(payload && payload.keys)
            ? payload.keys.map(String).filter((key) => key && key.length <= 128)
            : [];
        const localValues = payload && typeof payload.localValues === 'object' ? payload.localValues : {};
        event.returnValue = getSharedConfig().registerSettings(keys, localValues);
    } catch (error) {
        console.error('shared settings register failed:', error);
        event.returnValue = null;
    }
});

ipcMain.on('xiaochao-setting-get-sync', (event, key) => {
    try {
        event.returnValue = getSharedConfig().getSetting(String(key));
    } catch (error) {
        console.error('shared setting read failed:', error);
        event.returnValue = null;
    }
});

ipcMain.on('xiaochao-setting-set-sync', (event, payload) => {
    try {
        const key = String(payload && payload.key || '');
        if (!key || key.length > 128) throw new Error('invalid shared setting key');
        const value = String(payload && payload.value);
        getSharedConfig().setSetting(key, value);
        event.returnValue = true;
    } catch (error) {
        console.error('shared setting write failed:', error);
        event.returnValue = false;
    }
});

ipcMain.on('xiaochao-setting-delete-sync', (event, key) => {
    try {
        getSharedConfig().deleteSetting(String(key));
        event.returnValue = true;
    } catch (error) {
        console.error('shared setting delete failed:', error);
        event.returnValue = false;
    }
});

ipcMain.on('xiaochao-native-storage-sync', (event, operation) => {
    try {
        const origin = new URL(event.senderFrame?.url || event.sender.getURL()).origin;
        if (origin === 'null') throw new Error('native settings require a page origin');
        const result = getSharedConfig().nativeGameStorage(origin, operation, String(instanceProfile.slot));
        event.returnValue = { success: true, result };
    } catch (error) {
        console.error('native game settings failed:', error);
        event.returnValue = { success: false, error: error.message };
    }
});

ipcMain.handle('xiaochao-game-records', (event, operation) => {
    if (!operation || !['read', 'merge', 'reset'].includes(operation.action)) throw new Error('invalid game record operation');
    return getSharedConfig().gameRecords({
        ...operation,
        source: instanceProfile.slot + ':' + new URL(event.sender.getURL()).origin
    });
});

ipcMain.on('xiaochao-credentials-get-sync', (event, payload) => {
    const scope = payload && !Array.isArray(payload) ? payload.scope : 'official';
    const localCredentials = payload && !Array.isArray(payload) ? payload.localCredentials : payload;
    try {
        event.returnValue = getSharedConfig().getCredentials(scope, localCredentials);
    } catch (error) {
        console.error('shared credentials read failed:', error);
        event.returnValue = normalizeSharedCredentials(localCredentials);
    }
});

ipcMain.on('xiaochao-credentials-set-sync', (event, payload) => {
    const scope = payload && !Array.isArray(payload) ? payload.scope : 'official';
    const credentials = payload && !Array.isArray(payload) ? payload.credentials : payload;
    try {
        getSharedConfig().setCredentials(scope, credentials);
        event.returnValue = true;
    } catch (error) {
        console.error('shared credentials write failed:', error);
        event.returnValue = false;
    }
});

function readLocalScriptCached() {
    try {
        if (!fs.existsSync(scriptPath)) {
            localScriptCache.sourcePath = '';
            localScriptCache.mtimeMs = -1;
            localScriptCache.size = -1;
            localScriptCache.data = '';
            return { success: false, error: 'local script not found' };
        }
        const stat = fs.statSync(scriptPath);
        if (
            localScriptCache.data &&
            localScriptCache.sourcePath === scriptPath &&
            localScriptCache.mtimeMs === stat.mtimeMs &&
            localScriptCache.size === stat.size
        ) {
            return { success: true, data: localScriptCache.data };
        }
        localScriptCache.sourcePath = scriptPath;
        localScriptCache.mtimeMs = stat.mtimeMs;
        localScriptCache.size = stat.size;
        localScriptCache.data = fs.readFileSync(scriptPath, 'utf8');
        return { success: true, data: localScriptCache.data };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function clearLocalScriptCache() {
    localScriptCache.sourcePath = '';
    localScriptCache.mtimeMs = -1;
    localScriptCache.size = -1;
    localScriptCache.data = '';
}

function getPackageSnapshot() {
    return {
        ...package,
        packageId: config.get('packageId', package.packageId),
        IsDebug: package.IsDebug,
        IsTest: package.IsTest,
        LoginURL: package.LoginURL,
        ADLoginURL: package.ADLoginURL,
        AutoUpdaterURL: package.AutoUpdaterURL,
        JumpURL: package.JumpURL,
        FeedURL: package.FeedURL,
        ChannelId: package.ChannelId,
        URLLYTest: package.URLLYTest,
        URLOffTest: package.URLOffTest,
        platform: package.platform
    };
}

function getRuntimeGlobal(name) {
    switch (name) {
        case 'PackageId': return config.get('packageId', package.packageId);
        case 'Version': return package.version;
        case 'IsTest': return package.IsTest;
        case 'IsDebug': return package.IsDebug;
        case 'LoginURL': return package.LoginURL;
        case 'AutoUpdaterURL': return package.AutoUpdaterURL;
        case 'JumpURL': return package.JumpURL;
        case 'FeedURL': return package.FeedURL;
        case 'ChannelId': return package.ChannelId;
        case 'URLLYTest': return package.URLLYTest;
        case 'URLOffTest': return package.URLOffTest;
        case 'platform': return package.platform;
        case 'scriptPath': return scriptPath;
        case 'configPath': return configPath;
        default: return global[name];
    }
}

function logMessage(message) {
    try {
        fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
        fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
    } catch (error) {
        console.error('log write failed:', error);
    }
}

function changePackage(window, isSave = false) {
    dialog.showMessageBox(window, {
        type: 'warning',
        title: '提示',
        message: '修改默认游戏大区，页面将刷新',
        buttons: ['OL', '4399', '快玩', '百度', 'cancel']
    }).then((data) => {
        const map = [1, 3, 5, 9];
        const packageId = map[data.response];
        if (!packageId) return;
        if (isSave) config.set('packageId', packageId);
        global.PackageId = packageId;
        window.webContents.send('rendererMsg', 'channel', packageId);
    });
}

function changeChannel(window, isSave = false) {
    changePackage(window, isSave);
}

function resize(window) {
    dialog.showMessageBox(window, {
        type: 'warning',
        title: '提示',
        message: '修改分辨率，并默认下次打开微端时使用该分辨率',
        buttons: ['1500*820', '1340*700', '1400*820', 'cancel']
    }).then((data) => {
        const sizes = [
            { width: 1500, height: 820 },
            { width: 1340, height: 700 },
            { width: 1400, height: 820 }
        ];
        const size = sizes[data.response];
        if (!size) return;
        config.set('width', size.width);
        config.set('height', size.height);
        window.setBounds(size);
    });
}

function firstTimeAnnouncement(window, manual = false) {
    if (!window) return;
    dialog.showMessageBox(window, {
        type: 'warning',
        title: '三国杀打小抄微端说明',
        message: '本微端在官方微端基础上恢复以下功能：\n' +
            '1. 三国杀打小抄脚本注入（使用本机内置脚本）\n' +
            '2. 多大区切换和默认大区保存\n' +
            '3. 账号密码本地记住与快速填充\n' +
            '4. 自定义背景/动态背景\n' +
            '5. 分辨率保存、全屏适配、右键/左上角功能菜单\n\n' +
            '账号密码只保存在本机微端用户数据目录中，请勿在公共电脑使用“记住账号密码”。',
        buttons: manual ? ['ok'] : ['我知道了', '退出']
    }).then((index) => {
        if (manual || index.response === 0) {
            config.set('firstTime', false);
            config.set('firstTimeAnnouncementSeen', true);
        } else if (index.response === 1) {
            window.close();
        }
    });
}

function createContextMenu() {
    return Menu.buildFromTemplate([
        { label: '切换游戏大区', click: () => changeChannel(mainWindow, false) },
        { label: '选择默认游戏大区', click: () => changePackage(mainWindow, true) },
        { label: '修改分辨率', click: () => resize(mainWindow) },
        { label: '查看微端说明', click: () => firstTimeAnnouncement(mainWindow, true) },
        { type: 'separator' },
        { label: `微端版本 ${package.version}`, enabled: false }
    ]);
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readVersionFromScript(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (error, data) => {
            if (error) {
                reject(error);
                return;
            }
            const versionMatch = data.match(/@version\s+([\d.]+)/);
            resolve(versionMatch ? versionMatch[1] : '0');
        });
    });
}

function compareVersions(left, right) {
    const leftParts = String(left || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const rightParts = String(right || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        if ((leftParts[index] || 0) > (rightParts[index] || 0)) return 1;
        if ((leftParts[index] || 0) < (rightParts[index] || 0)) return -1;
    }
    return 0;
}

function bundledScriptPath() {
    return path.join(__dirname, 'xiaochao.js');
}

async function syncBundledScriptIfNewer() {
    // 正式微端注入的是 userData 下的脚本，不是 app/xiaochao.js。
    // 本地打包版本号常低于官网缓存（如 1.1.47 < 1.5.91），若仍按“仅更新更高版本”
    // 同步，开发产物永远进不了运行时。这里以 app 内置脚本内容为准：哈希不同就覆盖。
    const bundledPath = bundledScriptPath();
    if (!fs.existsSync(bundledPath)) {
        logMessage('bundled script not found, skip sync');
        return false;
    }

    let bundledVersion = '0';
    try {
        bundledVersion = await readVersionFromScript(bundledPath);
    } catch (error) {
        logMessage(`bundled script version read failed: ${error.message}`);
        return false;
    }

    let currentVersion = '0';
    if (fs.existsSync(scriptPath)) {
        try {
            currentVersion = await readVersionFromScript(scriptPath);
        } catch (error) {
            currentVersion = '0';
        }
        try {
            if (sha256File(bundledPath) === sha256File(scriptPath)) {
                return false;
            }
        } catch (error) {
            logMessage(`bundled script comparison failed: ${error.message}`);
        }
    }

    try {
        fs.copyFileSync(bundledPath, tempScriptPath);
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
        fs.renameSync(tempScriptPath, scriptPath);
        clearLocalScriptCache();
        logMessage(`synced bundled script into userData (bundled v${bundledVersion}, was v${currentVersion})`);
        return true;
    } catch (error) {
        if (fs.existsSync(tempScriptPath)) {
            try {
                fs.unlinkSync(tempScriptPath);
            } catch (cleanupError) {
                console.error('cleanup temp script failed:', cleanupError);
            }
        }
        logMessage(`sync bundled script failed: ${error.message}`);
        return false;
    }
}

function initializeWritablePaths() {
    dataDirectory = path.join(instanceProfile.sharedUserData, 'xiaochao');
    fs.mkdirSync(dataDirectory, { recursive: true });
    configPath = path.join(dataDirectory, 'config.json');
    sharedConfigPath = path.join(dataDirectory, 'shared.json');
    getSharedConfig();
    scriptPath = path.join(dataDirectory, 'xiaochao.js');
    tempScriptPath = path.join(dataDirectory, 'xiaochao.js.' + process.pid + '.tmp');
    logFilePath = path.join(dataDirectory, 'app-log.txt');
    config = createJsonConfig(configPath);
    global.config = config;
    global.configPath = configPath;
    global.scriptPath = scriptPath;
}

async function initConfig() {
    initializeWritablePaths();
    await syncBundledScriptIfNewer();
    config.ensureDefaults({
        packageId: package.packageId || 1,
        width: 1400,
        height: 820,
        firstTime: true,
        firstTimeAnnouncementSeen: false
    });
    global.config = config;
    global.PackageId = config.get('packageId', package.packageId);
    logMessage('Application started');
}
if (steamworks && typeof steamworks.electronEnableSteamOverlay === 'function') {
    try {
        steamworks.electronEnableSteamOverlay();
    } catch (error) {
        console.error('Steam overlay setup failed:', error);
    }
}
