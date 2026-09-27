// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, Menu, systemPreferences, Notification, screen } = require('electron')
const { crashReporter, session  } = require('electron')
let autoUpdater = null;
let autoUpdaterLoadError = null;
let updateHandleInitialized = false;

const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const path = require('path')
const { spawn } = require('child_process');
const os = require('os')
const { createSharedStore, normalizeCredentials: normalizeSharedCredentials } = require('./shared-store')
const { buildWindowsMicroClientUpdater } = require('./micro-client-updater')
const { createHtmlReportOpener } = require('./report-window')


const steamAppID = 4209770;
let mainWindow;
let updateProgressWindow = null;

// Runtime writes go to userData; the install directory may be read-only (e.g. C:\Program Files).
const defaultScriptUrl = 'https://xiaochao.org/download/%E5%B0%8F%E6%8A%84.user.js';
const microClientManifestUrl = 'https://xiaochao.org/download/weiduan/manifest.json';
const configApiUrl = 'https://xiaochao.org/api/config';
let dataDirectory = '';
let configPath = '';
let sharedConfigPath = '';
let sharedConfig = null;
let scriptPath = '';
let tempScriptPath = '';
let logFilePath = '';
let config = null;
const developmentScriptPath = path.join(__dirname, 'dist', 'electron', 'xiaochao.js');
let developmentScriptWatcher = null;
let developmentReloadTimer = null;
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
const openXcWindow = createHtmlReportOpener({
    BrowserWindow,
    getUserDataPath: () => app.getPath('userData'),
    getWorkAreaSize: () => screen.getPrimaryDisplay().workAreaSize
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
            sandbox: false, // Local preload requires Node and the IPC compatibility bridge.
            imageAnimationPolicy: 'always',
            allowRunningInsecureContent: true,
            allowDisplayingInsecureContent: true,
            preload: path.join(app.getAppPath(), './script/electron_frame.js')
            //allowRunningInsecureContent: true,
            // allowDisplayingInsecureContent :true
        }
    })
    startDevelopmentScriptWatcher();
    if (interceptor) {
        try {
            await interceptor(mainWindow);
        } catch (error) {
            console.error('interceptor init failed:', error);
        }
    }
    mainWindow.loadFile('./index_wd.html');
    if (config.get('firstTime', true) === true || config.get('firstTimeAnnouncementSeen', false) !== true) {
        firstTimeAnnouncement(mainWindow);
    }
    scheduleMicroClientUpdate();
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

ipcMain.handle('open-window', (event, url) => {
    return openXcWindow(url);
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

app.on('web-contents-created', (e, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
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
    if (!app.isPackaged) return;
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


// Codex migration helpers from app_old, adapted for the newer official app.
function createJsonConfig(filePath) {
    let storeCache = null;

    function ensureDir() {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    function readStore() {
        if (storeCache) return storeCache;
        try {
            if (!fs.existsSync(filePath)) {
                storeCache = {};
                return storeCache;
            }
            const raw = fs.readFileSync(filePath, 'utf8');
            storeCache = raw.trim() ? JSON.parse(raw) : {};
            return storeCache;
        } catch (error) {
            console.error('config read failed:', error);
            storeCache = {};
            return storeCache;
        }
    }
    function writeStore(store) {
        storeCache = store;
        try {
            ensureDir();
            fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
        } catch (error) {
            console.error('config write failed:', error);
        }
    }
    return {
        get(key, fallback) {
            const store = readStore();
            return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
        },
        set(key, value) {
            const store = readStore();
            store[key] = value;
            writeStore(store);
        },
        has(key) {
            const store = readStore();
            return Object.prototype.hasOwnProperty.call(store, key);
        },
        ensureDefaults(defaults) {
            const store = readStore();
            let changed = false;
            Object.keys(defaults).forEach((key) => {
                if (!Object.prototype.hasOwnProperty.call(store, key)) {
                    store[key] = defaults[key];
                    changed = true;
                }
            });
            if (changed) writeStore(store);
        }
    };
}

function getSharedConfig() {
    if (!sharedConfig) {
        const filePath = sharedConfigPath || path.join(app.getPath('userData'), 'xiaochao', 'shared.json');
        sharedConfig = createSharedStore(filePath);
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
    event.returnValue = getSharedConfig().getSetting(String(key));
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
        const sourcePath = developmentScriptPath;
        if (!fs.existsSync(sourcePath)) {
            localScriptCache.sourcePath = '';
            localScriptCache.mtimeMs = -1;
            localScriptCache.size = -1;
            localScriptCache.data = '';
            return { success: false, error: 'local script not found' };
        }
        const stat = fs.statSync(sourcePath);
        if (
            localScriptCache.data &&
            localScriptCache.sourcePath === sourcePath &&
            localScriptCache.mtimeMs === stat.mtimeMs &&
            localScriptCache.size === stat.size
        ) {
            return { success: true, data: localScriptCache.data };
        }
        localScriptCache.sourcePath = sourcePath;
        localScriptCache.mtimeMs = stat.mtimeMs;
        localScriptCache.size = stat.size;
        localScriptCache.data = fs.readFileSync(sourcePath, 'utf8');
        return { success: true, data: localScriptCache.data, sourcePath, development: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function startDevelopmentScriptWatcher() {
    if (developmentScriptWatcher) return;
    try {
        developmentScriptWatcher = fs.watch(path.dirname(developmentScriptPath), (eventType, filename) => {
            if (!filename || String(filename).toLowerCase() !== 'xiaochao.js') return;
            clearTimeout(developmentReloadTimer);
            developmentReloadTimer = setTimeout(() => {
                clearLocalScriptCache();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('xiaochao-dev-script-changed');
                }
                logMessage(`development script changed (${eventType})`);
            }, 300);
        });
        logMessage(`development script watcher enabled: ${developmentScriptPath}`);
    } catch (error) {
        logMessage(`development script watcher failed: ${error.message}`);
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
            '1. 三国杀打小抄脚本注入与自动更新\n' +
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
    const autoUpdateEnabled = config.get('autoUpdateEnabled', true);
    return Menu.buildFromTemplate([
        { label: '切换游戏大区', click: () => changeChannel(mainWindow, false) },
        { label: '选择默认游戏大区', click: () => changePackage(mainWindow, true) },
        { label: '修改分辨率', click: () => resize(mainWindow) },
        { label: '查看微端说明', click: () => firstTimeAnnouncement(mainWindow, true) },
        { type: 'separator' },
        { label: `微端版本 ${package.version}`, enabled: false },
        { label: `微端自动更新：${autoUpdateEnabled ? '开' : '关'}`, click: () => config.set('autoUpdateEnabled', !autoUpdateEnabled) }
    ]);
}

function clearCache() {
    try {
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
        clearLocalScriptCache();
    } catch (error) {
        console.error('clear local script failed:', error);
    }
    dialog.showMessageBox(mainWindow, { type: 'warning', title: '本地脚本已删除', message: '请重启微端，脚本将重新下载。', buttons: ['ok'] }).then(() => mainWindow && mainWindow.close());
}

function downloadFile(url, localFilePath, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (!url) {
            reject(new Error('scriptUrl is empty'));
            return;
        }
        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        const file = fs.createWriteStream(localFilePath);
        const lib = url.startsWith('http://') ? http : https;
        const request = lib.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirectCount < 5) {
                file.close(() => fs.unlink(localFilePath, () => {}));
                const nextUrl = new URL(response.headers.location, url).toString();
                downloadFile(nextUrl, localFilePath, redirectCount + 1).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                file.close(() => fs.unlink(localFilePath, () => {}));
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        });
        request.on('error', (error) => {
            file.close(() => fs.unlink(localFilePath, () => {}));
            reject(error);
        });
    });
}

function fetchJson(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('http://') ? http : https;
        const request = lib.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirectCount < 5) {
                response.resume();
                const nextUrl = new URL(response.headers.location, url).toString();
                fetchJson(nextUrl, redirectCount + 1).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
                return;
            }
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > 1024 * 1024) {
                    request.destroy(new Error('manifest is too large'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('error', reject);
    });
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isValidMicroClientManifest(manifest) {
    return manifest &&
        /^\d+\.\d+\.\d+$/.test(String(manifest.version || '')) &&
        /^https:\/\/xiaochao\.org\/download\/weiduan\/app\.zip(?:\?|$)/.test(String(manifest.appUrl || '')) &&
        /^[a-f0-9]{64}$/.test(String(manifest.appSha256 || ''));
}

function supportsMicroClientAutoUpdate() {
    return process.platform === 'win32' || process.platform === 'darwin';
}

function writeMicroClientUpdater(updateDirectory, archivePath) {
    if (process.platform === 'darwin') {
        return writeDarwinMicroClientUpdater(updateDirectory, archivePath);
    }
    return writeWindowsMicroClientUpdater(updateDirectory, archivePath);
}

function writeWindowsMicroClientUpdater(updateDirectory, archivePath) {
    const updaterPath = path.join(updateDirectory, 'apply-update.ps1');
    const launcherPath = path.join(updateDirectory, 'launch-update.ps1');
    const statusPath = path.join(updateDirectory, 'update-status.txt');
    const { updaterSource, launcherSource } = buildWindowsMicroClientUpdater({
        parentPid: process.pid,
        archivePath,
        resourcesPath: process.resourcesPath,
        executablePath: app.getPath('exe'),
        updaterPath,
        launcherPath,
        statusPath
    });
    fs.writeFileSync(updaterPath, updaterSource, 'utf8');
    fs.writeFileSync(launcherPath, launcherSource, 'utf8');
    return launcherPath;
}

function writeDarwinMicroClientUpdater(updateDirectory, archivePath) {
    const updaterPath = path.join(updateDirectory, 'apply-update.sh');
    const launcherPath = path.join(updateDirectory, 'launch-update.sh');
    const statusPath = path.join(updateDirectory, 'update-status.txt');
    const updaterSource = `#!/bin/bash
set -euo pipefail
PARENT_PID="$1"
ARCHIVE="$2"
RESOURCES="$3"
EXECUTABLE="$4"
LAUNCHER="$5"
STATUS_FILE="$6"

UPDATE_ROOT="$(dirname "$ARCHIVE")"
STAGE_ROOT="$UPDATE_ROOT/stage"
NEW_APP="$STAGE_ROOT/app"
CURRENT_APP="$RESOURCES/app"
BACKUP_APP="$RESOURCES/app.xiaochao-backup"
LOG_FILE="$UPDATE_ROOT/update-error.log"
APP_READY=0

restore_backup() {
  if [ -d "$BACKUP_APP" ]; then
    rm -rf "$CURRENT_APP"
    mv "$BACKUP_APP" "$CURRENT_APP"
  fi
}

set_update_status() {
  if [ -n "$STATUS_FILE" ]; then
    printf '%s' "$1" > "$STATUS_FILE"
  fi
}

log_error() {
  echo "$1" >> "$LOG_FILE"
}

set_update_status started
rm -rf "$STAGE_ROOT"
mkdir -p "$STAGE_ROOT"
if ! unzip -q -o "$ARCHIVE" -d "$STAGE_ROOT"; then
  log_error "failed to unzip archive"
  set_update_status failed
  restore_backup
  open "$EXECUTABLE" 2>/dev/null || "$EXECUTABLE" &
  exit 1
fi
if [ ! -f "$NEW_APP/package.json" ]; then
  log_error "更新包缺少 app/package.json"
  set_update_status failed
  rm -rf "$STAGE_ROOT"
  restore_backup
  open "$EXECUTABLE" 2>/dev/null || "$EXECUTABLE" &
  exit 1
fi

while kill -0 "$PARENT_PID" 2>/dev/null; do
  sleep 1
done
sleep 2

rm -rf "$BACKUP_APP"
if [ -d "$CURRENT_APP" ]; then
  mv "$CURRENT_APP" "$BACKUP_APP"
fi

if ! mv "$NEW_APP" "$CURRENT_APP"; then
  log_error "failed to replace app directory"
  set_update_status failed
  restore_backup
  rm -rf "$STAGE_ROOT"
  open "$EXECUTABLE" 2>/dev/null || "$EXECUTABLE" &
  exit 1
fi
APP_READY=1

open "$EXECUTABLE" 2>/dev/null || "$EXECUTABLE" &
sleep 2

set_update_status success
rm -rf "$BACKUP_APP" "$STAGE_ROOT" "$ARCHIVE"
rm -f "$0" "$LAUNCHER"
`;
    const quote = (value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
    const launcherSource = `#!/bin/bash
set -euo pipefail
UPDATER=${quote(updaterPath)}
ARCHIVE=${quote(archivePath)}
RESOURCES=${quote(process.resourcesPath)}
EXECUTABLE=${quote(app.getPath('exe'))}
LAUNCHER=${quote(launcherPath)}
STATUS_FILE=${quote(statusPath)}
PARENT_PID=${process.pid}
CMD=$(printf '%q ' "$UPDATER" "$PARENT_PID" "$ARCHIVE" "$RESOURCES" "$EXECUTABLE" "$LAUNCHER" "$STATUS_FILE")
rm -f "$STATUS_FILE"
if ! osascript -e "do shell script \\"nohup $CMD >/dev/null 2>&1 &\\" with administrator privileges" >/dev/null 2>&1; then
  exit 1
fi
deadline=$((SECONDS + 120))
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ -f "$STATUS_FILE" ] && [ "$(tr -d '\\r\\n' < "$STATUS_FILE")" = "started" ]; then
    exit 0
  fi
  sleep 0.5
done
exit 1
`;
    fs.writeFileSync(updaterPath, updaterSource, 'utf8');
    fs.writeFileSync(launcherPath, launcherSource, 'utf8');
    fs.chmodSync(updaterPath, 0o755);
    fs.chmodSync(launcherPath, 0o755);
    return launcherPath;
}

function microClientUpdatePermissionHint() {
    if (process.platform === 'darwin') {
        return '需要输入系统密码才能完成更新。若取消授权，微端将继续使用当前版本。';
    }
    return '管理员授权被取消，或更新器准备失败。微端将继续使用当前版本。';
}

function microClientUpdateStatePaths() {
    const updateDirectory = path.join(app.getPath('userData'), 'xiaochao-update');
    return {
        statusPath: path.join(updateDirectory, 'update-status.txt'),
        logPath: path.join(updateDirectory, 'update-error.log')
    };
}

function readMicroClientUpdateErrorDetail() {
    const { logPath } = microClientUpdateStatePaths();
    try {
        if (!fs.existsSync(logPath)) return '';
        const content = fs.readFileSync(logPath, 'utf8').trim();
        return content.length > 1800 ? content.slice(-1800) : content;
    } catch (error) {
        return '';
    }
}

function markMicroClientUpdateFailureReported() {
    const { statusPath } = microClientUpdateStatePaths();
    try {
        fs.writeFileSync(statusPath, 'failed-reported', 'utf8');
    } catch (error) {
        logMessage(`mark micro-client update failure reported failed: ${error.message}`);
    }
}

async function handlePreviousMicroClientUpdateFailure() {
    const { statusPath } = microClientUpdateStatePaths();
    let status = '';
    try {
        if (!fs.existsSync(statusPath)) return false;
        status = fs.readFileSync(statusPath, 'utf8').trim();
    } catch (error) {
        return false;
    }

    if (status === 'success') {
        try {
            fs.unlinkSync(statusPath);
        } catch (error) {}
        return false;
    }
    if (status === 'failed-reported') {
        try {
            fs.writeFileSync(statusPath, 'failed-acknowledged', 'utf8');
        } catch (error) {}
        return true;
    }
    if (status !== 'failed') return false;

    const detail = readMicroClientUpdateErrorDetail();
    try {
        fs.writeFileSync(statusPath, 'failed-acknowledged', 'utf8');
    } catch (error) {}
    if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '上次微端更新失败',
            message: '更新器已尝试恢复旧版本。本次启动将不再重复更新，请稍后重试或手动安装新版。',
            detail: detail || '未记录到详细错误。',
            buttons: ['确定']
        }).catch(() => {});
    }
    return true;
}

async function promptMicroClientElevationHint() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const options = process.platform === 'darwin'
        ? {
            type: 'info',
            title: '需要系统密码',
            message: '即将请求管理员权限以安装微端更新。',
            detail: '请在弹出的系统对话框中输入密码并确认。取消后更新不会生效。',
            buttons: ['继续']
        }
        : {
            type: 'info',
            title: '需要管理员权限',
            message: '即将弹出 Windows 用户账户控制（UAC）窗口。',
            detail: '请点击「是」以完成微端更新。若点击「否」或关闭弹窗，更新将不会生效。',
            buttons: ['继续']
        };
    await presentUpdateDialog(options);
}

function launchMicroClientUpdate(launcherPath) {
    closeUpdateProgress();
    const spawnOptions = { stdio: 'ignore', windowsHide: true };
    const child = process.platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherPath], spawnOptions)
        : spawn('/bin/bash', [launcherPath], spawnOptions);

    return new Promise((resolve) => {
        child.once('exit', (code) => {
            logMessage(`micro-client updater exited with code ${code}`);
            if (code === 0) {
                logMessage('micro-client updater prepared successfully, quitting for install');
                app.quit();
                resolve(true);
                return;
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '更新未应用',
                    message: microClientUpdatePermissionHint(),
                    detail: readMicroClientUpdateErrorDetail(),
                    buttons: ['确定']
                });
            }
            markMicroClientUpdateFailureReported();
            resolve(false);
        });
        child.once('error', (error) => {
            logMessage(`micro-client updater spawn failed: ${error.message}`);
            markMicroClientUpdateFailureReported();
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '更新未应用',
                    message: '无法启动系统更新器，微端将继续使用当前版本。',
                    detail: error.message,
                    buttons: ['确定']
                }).catch(() => {});
            }
            resolve(false);
        });
    });
}

const activeUpdateNotifications = new Set();

function showUpdateNotification(title, body) {
    if (!Notification.isSupported()) return;
    try {
        const notification = new Notification({ title, body });
        const cleanup = () => {
            activeUpdateNotifications.delete(notification);
        };
        notification.on('show', () => {
            setTimeout(() => {
                notification.close();
                cleanup();
            }, 6000);
        });
        notification.on('close', cleanup);
        notification.on('click', cleanup);
        notification.on('failed', cleanup);
        activeUpdateNotifications.add(notification);
        notification.show();
    } catch (error) {
        console.error('show update notification failed:', error);
    }
}

async function presentUpdateDialog(options) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { response: options.cancelId != null ? options.cancelId : 1 };
    }
    try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return await dialog.showMessageBox(mainWindow, options);
    } catch (error) {
        console.error('show update dialog failed:', error);
        logMessage(`show update dialog failed: ${error.message}`);
        return { response: options.cancelId != null ? options.cancelId : 1 };
    }
}

const updateProgressWindowSize = { width: 420, height: 140 };

function placeUpdateProgressWindow(win) {
    if (!win || win.isDestroyed()) return;
    const { width, height } = updateProgressWindowSize;
    let display = screen.getPrimaryDisplay();
    if (mainWindow && !mainWindow.isDestroyed()) {
        display = screen.getDisplayMatching(mainWindow.getBounds());
    }
    const area = display.workArea;
    const x = Math.round(area.x + (area.width - width) / 2);
    const y = Math.round(area.y + area.height - height - 48);
    win.setBounds({ x, y, width, height });
}

function showUpdateProgress(text) {
    if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
        placeUpdateProgressWindow(updateProgressWindow);
        updateProgressWindow.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(String(text).replace(/\n/g, '<br>'))};`).catch(() => {});
        return updateProgressWindow;
    }
    try {
        const win = new BrowserWindow({
            ...updateProgressWindowSize,
            parent: mainWindow,
            modal: false,
            frame: false,
            closable: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            show: false,
            skipTaskbar: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;font-size:16px;background:#f5f5f5;color:#333;}
        </style></head><body><div>${String(text).replace(/\n/g, '<br>')}</div></body></html>`;
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        win.once('ready-to-show', () => {
            placeUpdateProgressWindow(win);
            win.show();
        });
        updateProgressWindow = win;
        return win;
    } catch (error) {
        console.error('show update progress window failed:', error);
        logMessage(`show update progress window failed: ${error.message}`);
        return null;
    }
}

function closeUpdateProgress() {
    if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
        updateProgressWindow.close();
    }
    updateProgressWindow = null;
}

async function checkAndUpdateMicroClient() {
    if (!supportsMicroClientAutoUpdate()) return false;
    const currentVersion = String(package.version || '0.0.0');
    logMessage(`micro-client update check started, current=${currentVersion}`);

    const manifest = await fetchJson(microClientManifestUrl + '?t=' + Date.now());
    logMessage(`micro-client manifest fetched: ${JSON.stringify(manifest)}`);
    if (!isValidMicroClientManifest(manifest) || compareVersions(manifest.version, currentVersion) <= 0) {
        logMessage('micro-client is up to date or manifest invalid');
        return false;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
        logMessage('mainWindow gone, skip update dialog');
        return false;
    }
    const scriptVersion = await readCurrentXiaochaoVersion();
    const targetScriptVersion = await resolveTargetScriptVersion(manifest);
    const report = [
        buildVersionReportLine('微端', currentVersion, manifest.version),
        buildVersionReportLine('小抄', scriptVersion, targetScriptVersion)
    ].join('\n');
    logMessage('showing micro-client confirm dialog');
    const confirm = await presentUpdateDialog({
        type: 'info',
        title: '微端更新',
        message: `检测到微端新版本 ${manifest.version}，将同时更新微端与小抄脚本，是否立即更新？`,
        detail: report,
        buttons: ['立即更新', '暂不更新'],
        defaultId: 0,
        cancelId: 1
    });
    logMessage(`micro-client confirm dialog result: ${confirm.response}`);
    if (confirm.response !== 0) return false;

    const updateDirectory = path.join(app.getPath('userData'), 'xiaochao-update');
    const archivePath = path.join(updateDirectory, `app-${manifest.version}.zip`);
    fs.mkdirSync(updateDirectory, { recursive: true });
    showUpdateProgress('正在下载更新，请保持微端运行…\n稍后将自动重启微端');
    showUpdateNotification('小抄微端更新', `正在下载 ${manifest.version}`);
    const downloadUrl = new URL(manifest.appUrl);
    downloadUrl.searchParams.set('t', String(Date.now()));
    logMessage(`downloading micro-client update from ${downloadUrl.toString()} to ${archivePath}`);
    try {
        await downloadFile(downloadUrl.toString(), archivePath);
    } catch (error) {
        closeUpdateProgress();
        throw error;
    }
    logMessage('micro-client update downloaded, checking sha256');
    if (sha256File(archivePath) !== manifest.appSha256) {
        fs.unlinkSync(archivePath);
        closeUpdateProgress();
        throw new Error('微端更新包校验失败');
    }
    logMessage('micro-client update sha256 ok');

    closeUpdateProgress();
    const launcherPath = writeMicroClientUpdater(updateDirectory, archivePath);
    logMessage(`micro-client update launcher written: ${launcherPath}`);
    await promptMicroClientElevationHint();
    return launchMicroClientUpdate(launcherPath);
}

async function checkAndUpdateScript() {
    const currentVersion = await readCurrentXiaochaoVersion();
    if (currentVersion === '未安装' || currentVersion === '未知') {
        console.log('local script version unknown, skip script update check');
        return false;
    }

    let config;
    try {
        config = await fetchJson(configApiUrl + '?t=' + Date.now());
    } catch (error) {
        console.error('fetch config api failed:', error);
        return false;
    }
    const latestVersion = String(config?.scriptVersion || '').trim();
    const scriptUrl = String(config?.scriptUrl || '').trim();
    if (!latestVersion || !scriptUrl) {
        console.log('config api did not return script version or url');
        return false;
    }
    if (compareVersions(latestVersion, currentVersion) <= 0) {
        console.log('local script is up to date:', currentVersion);
        return false;
    }

    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const result = await presentUpdateDialog({
        type: 'info',
        title: '小抄脚本更新',
        message: `检测到小抄脚本新版本 ${latestVersion}，是否更新？`,
        detail: `当前版本：${currentVersion}`,
        buttons: ['更新', '暂不更新'],
        defaultId: 0,
        cancelId: 1
    });
    if (result.response !== 0) return false;

    showUpdateProgress('正在下载小抄脚本更新…\n稍后将自动重启微端');
    logMessage(`downloading script update from ${scriptUrl}`);
    try {
        await downloadFile(scriptUrl, tempScriptPath);
    } catch (error) {
        closeUpdateProgress();
        throw error;
    }

    const downloadedVersion = await readVersionFromScript(tempScriptPath);
    if (compareVersions(downloadedVersion, currentVersion) <= 0) {
        fs.unlinkSync(tempScriptPath);
        closeUpdateProgress();
        console.log('downloaded script is not newer:', downloadedVersion);
        return false;
    }

    showUpdateProgress('正在安装更新并重启，请稍候…\n稍后将自动重启微端');
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    fs.renameSync(tempScriptPath, scriptPath);
    clearLocalScriptCache();
    sendUpdateMessage(`小抄脚本已从 v${currentVersion} 更新至 v${downloadedVersion}`);
    logMessage('relaunching after script update');
    app.relaunch();
    app.quit();
    return true;
}

function scheduleMicroClientUpdate() {
    if (!app.isPackaged) return; // Development sources must not be replaced by the installer.
    handlePreviousMicroClientUpdateFailure().then((skipThisLaunch) => {
        if (skipThisLaunch) return;
        if (config.get('autoUpdateEnabled', true) === false) {
            console.log('micro-client auto update is disabled, skip update check');
            return;
        }
        checkAndUpdateMicroClient().then((updated) => {
            if (!updated) {
                checkAndUpdateScript().catch((error) => console.error('script update failed:', error));
            }
        }).catch((error) => {
            console.error('micro-client update failed:', error);
            logMessage(`micro-client update failed: ${error.message}`);
            closeUpdateProgress();
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'error',
                    title: '微端更新失败',
                    message: error.message || '更新下载失败，请稍后再试。',
                    buttons: ['确定']
                }).catch(() => {});
            }
        });
    }).catch((error) => {
        console.error('read previous micro-client update result failed:', error);
    });
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

function buildVersionReportLine(name, before, after) {
    if (before === after) {
        return `${name}版本保持 ${before} 不变`;
    }
    return `${name}版本从 ${before} 更新至 ${after}`;
}

async function readCurrentXiaochaoVersion() {
    try {
        if (!fs.existsSync(scriptPath)) return '未安装';
        return await readVersionFromScript(scriptPath);
    } catch (error) {
        return '未知';
    }
}

function bundledScriptPath() {
    return path.join(__dirname, 'xiaochao.js');
}

async function resolveTargetScriptVersion(manifest) {
    const manifestVersion = String(manifest?.scriptVersion || '').trim();
    if (manifestVersion) return manifestVersion;
    try {
        if (fs.existsSync(bundledScriptPath())) {
            return await readVersionFromScript(bundledScriptPath());
        }
    } catch (error) {
        console.error('read bundled script version failed:', error);
    }
    return await readCurrentXiaochaoVersion();
}

async function syncBundledScriptIfNewer() {
    const bundledPath = bundledScriptPath();
    if (!fs.existsSync(bundledPath)) {
        logMessage('bundled script not found, skip sync');
        return false;
    }

    let bundledVersion;
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
    }

    const versionComparison = compareVersions(bundledVersion, currentVersion);
    let sameVersionContentChanged = false;
    if (versionComparison === 0 && fs.existsSync(scriptPath)) {
        try {
            sameVersionContentChanged = sha256File(bundledPath) !== sha256File(scriptPath);
        } catch (error) {
            logMessage(`same-version bundled script comparison failed: ${error.message}`);
        }
    }
    if (versionComparison < 0 || (versionComparison === 0 && !sameVersionContentChanged)) {
        return false;
    }

    try {
        fs.copyFileSync(bundledPath, tempScriptPath);
        const copiedVersion = await readVersionFromScript(tempScriptPath);
        const copiedVersionComparison = compareVersions(copiedVersion, currentVersion);
        const copiedContentUnchanged = copiedVersionComparison === 0 &&
            fs.existsSync(scriptPath) &&
            sha256File(tempScriptPath) === sha256File(scriptPath);
        if (copiedVersionComparison < 0 || copiedContentUnchanged) {
            fs.unlinkSync(tempScriptPath);
            return false;
        }
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
        fs.renameSync(tempScriptPath, scriptPath);
        clearLocalScriptCache();
        logMessage(
            copiedVersionComparison === 0
                ? `synced bundled script content for v${copiedVersion}`
                : `synced bundled script from v${currentVersion} to v${copiedVersion}`
        );
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
    dataDirectory = path.join(app.getPath('userData'), 'xiaochao');
    fs.mkdirSync(dataDirectory, { recursive: true });
    configPath = path.join(dataDirectory, 'config.json');
    sharedConfigPath = path.join(dataDirectory, 'shared.json');
    sharedConfig = createSharedStore(sharedConfigPath);
    scriptPath = path.join(dataDirectory, 'xiaochao.js');
    tempScriptPath = path.join(dataDirectory, 'xiaochao.js.tmp');
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
        firstTimeAnnouncementSeen: false,
        scriptUrl: defaultScriptUrl,
        autoUpdateEnabled: true
    });
    config.set('autoUpdateEnabled', false);
    const configuredScriptUrl = config.get('scriptUrl', defaultScriptUrl);
    if (!/^https:\/\/xiaochao\.org\/download\//i.test(configuredScriptUrl)) {
        config.set('scriptUrl', defaultScriptUrl);
    }
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
