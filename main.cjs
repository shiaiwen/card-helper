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
const { createSharedStore, normalizeCredentials: normalizeSharedCredentials } = require('./shared-store.cjs')
const { createHtmlReportOpener } = require('./report-window.cjs')


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
    interceptor = require('./interceptor.cjs');
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
            sandbox: false, // Local preload requires Node and the IPC compatibility bridge.
            imageAnimationPolicy: 'always',
            allowRunningInsecureContent: true,
            allowDisplayingInsecureContent: true,
            preload: path.join(app.getAppPath(), './script/electron_frame.cjs')
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
    //require('./script/electron_frame.cjs');
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
    webContents.setWindowOpenHandler(({ url }) => {
        if (isGuanxingPageUrl(url)) {
            openGuanxingBrowserWindow(url);
            return { action: 'deny' };
        }
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

function resolveLocalScriptPath() {
    // 开发：Vite 产物；正式包：根目录内置脚本，其次用户目录已同步脚本。
    if (fs.existsSync(developmentScriptPath)) return { path: developmentScriptPath, development: true };
    const bundledPath = bundledScriptPath();
    if (fs.existsSync(bundledPath)) return { path: bundledPath, development: false };
    if (scriptPath && fs.existsSync(scriptPath)) return { path: scriptPath, development: false };
    return null;
}

function readLocalScriptCached() {
    try {
        const resolved = resolveLocalScriptPath();
        if (!resolved) {
            localScriptCache.sourcePath = '';
            localScriptCache.mtimeMs = -1;
            localScriptCache.size = -1;
            localScriptCache.data = '';
            return { success: false, error: 'local script not found' };
        }
        const sourcePath = resolved.path;
        const stat = fs.statSync(sourcePath);
        if (
            localScriptCache.data &&
            localScriptCache.sourcePath === sourcePath &&
            localScriptCache.mtimeMs === stat.mtimeMs &&
            localScriptCache.size === stat.size
        ) {
            return { success: true, data: localScriptCache.data, sourcePath, development: resolved.development };
        }
        localScriptCache.sourcePath = sourcePath;
        localScriptCache.mtimeMs = stat.mtimeMs;
        localScriptCache.size = stat.size;
        localScriptCache.data = fs.readFileSync(sourcePath, 'utf8');
        return { success: true, data: localScriptCache.data, sourcePath, development: resolved.development };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function startDevelopmentScriptWatcher() {
    if (developmentScriptWatcher) return;
    if (!fs.existsSync(developmentScriptPath)) return;
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
