

const electron = require('electron');
const { ipcRenderer } = electron;
const nativeRemote = electron.remote;
const runtimeGlobalFallback = {};
const appPathCache = {};
let runtimeGlobalsLoaded = false;
let localScriptResponseCache = null;
let localScriptInjectCache = null;

ipcRenderer.on('xiaochao-dev-script-changed', () => {
    localScriptResponseCache = null;
    localScriptInjectCache = null;
    const webview = document.getElementById('wb');
    if (webview && typeof webview.reload === 'function') {
        console.info('[xiaochao-dev] script changed, reloading game webview');
        webview.reload();
    }
});

function getReportWindowPageBridgeScript() {
    return `(() => {
        if (window.__XIAOCHAO_REPORT_WINDOW_BRIDGE__) return;
        window.__XIAOCHAO_REPORT_WINDOW_BRIDGE__ = true;
        // 打开窗口和后续操作必须使用同一个游戏 frame，不能只记住外层 webview。
        const reportSources = new Map();
        const syncRequests = new Map();
        window.electron?.onMessageFromMain?.('xiaochao-goods-flow-sync', payload => {
            if (!payload?.sourceId) return;
            const target = reportSources.get(payload.sourceId);
            if (!target || target.source.closed) {
                window.electron.invoke('xiaochao-goods-flow-sync-result', {
                    rid: payload.rid, ok: false, error: 'goods_flow_sync_unavailable'
                });
                return;
            }
            syncRequests.set(payload.rid, target);
            target.source.postMessage({ type: 'xiaochao-goods-flow-sync-request', payload }, target.origin);
        });
        // 小抄输入框聚焦时同步 webview 键盘焦点；详见 electron_renderer.js 的
        // focusWebview 说明。小抄可能运行在嵌套 frame 里，故统一走 top postMessage。
        window.addEventListener('message', (event) => {
            const request = event && event.data;
            if (!request || request.type !== 'xiaochao-focus-webview') return;
            try {
                if (window.electron && typeof window.electron.focusWebview === 'function') {
                    window.electron.focusWebview();
                }
            } catch (error) {}
        });
        window.addEventListener('message', async (event) => {
            const request = event && event.data;
            if (request?.type === 'xiaochao-goods-flow-sync-response') {
                const pending = syncRequests.get(request.payload?.rid);
                if (!pending || event.source !== pending.source ||
                    (pending.origin !== '*' && event.origin !== pending.origin)) return;
                syncRequests.delete(request.payload.rid);
                await window.electron.invoke('xiaochao-goods-flow-sync-result', request.payload);
                return;
            }
            if (!request || request.type !== 'xiaochao-open-report-window' || typeof request.requestId !== 'string') return;
            const url = String(request.url || '');
            const commaIndex = url.indexOf(',');
            const isHtml = commaIndex > 0 && /^data:text\\/html(?:[;,]|$)/i.test(url.slice(0, commaIndex));
            let success = false;
            if (isHtml && window.electron && typeof window.electron.openWindow === 'function') {
                try {
                    const sourceId = typeof request.sourceId === 'string' ? request.sourceId : '';
                    if (sourceId && event.source) {
                        for (const [id, target] of reportSources) {
                            if (target.source.closed) reportSources.delete(id);
                        }
                        reportSources.set(sourceId, { source: event.source,
                            origin: event.origin && event.origin !== 'null' ? event.origin : '*' });
                    }
                    success = !!(await window.electron.openWindow(url, sourceId || undefined));
                } catch (error) {
                    console.error('打开小抄原生报告窗口失败：', error);
                }
            }
            try {
                if (event.source && typeof event.source.postMessage === 'function') {
                    event.source.postMessage({
                        type: 'xiaochao-open-report-window-result',
                        requestId: request.requestId,
                        success
                    }, event.origin && event.origin !== 'null' ? event.origin : '*');
                }
            } catch (error) {
                console.error('返回小抄原生报告窗口结果失败：', error);
            }
        });
    })();`;
}

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function rememberRuntimeGlobal(name, value) {
    if (typeof value !== 'undefined' && value !== null && value !== '') {
        runtimeGlobalFallback[name] = value;
    }
    return value;
}

function fetchRuntimeGlobal(name) {
    if (hasOwn(runtimeGlobalFallback, name)) return runtimeGlobalFallback[name];
    try {
        if (nativeRemote && typeof nativeRemote.getGlobal === 'function') {
            return rememberRuntimeGlobal(name, nativeRemote.getGlobal(name));
        }
        if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
            return rememberRuntimeGlobal(name, ipcRenderer.sendSync('get-global-sync', name));
        }
    } catch (error) {
        console.warn('get-global-sync unavailable:', name, error);
    }
    return runtimeGlobalFallback[name];
}

function fetchAppPath(name) {
    if (hasOwn(appPathCache, name)) return appPathCache[name];
    try {
        if (nativeRemote && nativeRemote.app && typeof nativeRemote.app.getPath === 'function') {
            appPathCache[name] = nativeRemote.app.getPath(name);
            return appPathCache[name];
        }
        if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
            appPathCache[name] = ipcRenderer.sendSync('get-app-path-sync', name);
            return appPathCache[name];
        }
    } catch (error) {
        console.warn('get app path failed:', name, error);
    }
    appPathCache[name] = '';
    return '';
}

const remote = {
    getGlobal: fetchRuntimeGlobal,
    app: {
        getPath: fetchAppPath
    }
};
//const shell = remote.require('shell');
//loadElectronFrame();
window.ChannelId = '';
window.PackageId = '';
//const fs = require('fs');
//const path = require('path');

//const scriptPath = remote.app.getPath('userData')
const { contextBridge } = require('electron');

// 使用 contextBridge 暴露 API 到渲染进程
// contextBridge.exposeInMainWorld('api', {
//     loadImage: (imgElementId, imagePath) => {
//         // 向主进程请求读取文件
//         ipcRenderer.invoke('load-image', imagePath).then(base64Image => {
//             const imageElement = document.getElementById(imgElementId);
//             imageElement.src = base64Image;
//         }).catch(err => {
//             console.error('Failed to load image:', err);
//         });
//     }
// });

function applyPackageSnapshotCompat(packageObj) {
    if (!packageObj || typeof packageObj !== 'object') return;
    runtimeGlobalFallback.Version = packageObj.version;
    runtimeGlobalFallback.IsTest = packageObj.IsTest;
    runtimeGlobalFallback.PackageId = packageObj.packageId;
    runtimeGlobalFallback.URLOffTest = packageObj.URLOffTest;
    runtimeGlobalFallback.URLLYTest = packageObj.URLLYTest;
    runtimeGlobalFallback.platform = packageObj.platform;
    runtimeGlobalFallback.AutoUpdaterURL = packageObj.AutoUpdaterURL;
    runtimeGlobalFallback.JumpURL = packageObj.JumpURL;
    runtimeGlobalFallback.FeedURL = packageObj.FeedURL;
    runtimeGlobalFallback.LoginURL = packageObj.LoginURL;
    runtimeGlobalFallback.IsDebug = packageObj.IsDebug;
    runtimeGlobalFallback.ChannelId = packageObj.ChannelId;
}

async function ensureRuntimeGlobalsCompat() {
    if (runtimeGlobalsLoaded) return;
    runtimeGlobalsLoaded = true;
    try {
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
            applyPackageSnapshotCompat(await ipcRenderer.invoke('get-package'));
        }
    } catch (error) {
        console.warn('get-package unavailable:', error);
    }
    window.ChannelId = getRemoteGlobalCompat('ChannelId', runtimeGlobalFallback.ChannelId);
    window.PackageId = getRemoteGlobalCompat('PackageId', runtimeGlobalFallback.PackageId);
}

async function loadElectronFrame() {
    await ensureRuntimeGlobalsCompat();
    initElectronFrame();
    ipcRenderer.send("checkForUpdate");
    // var h = document.documentElement.clientHeight;//获取页面可见高度  
    // let wb = document.getElementById('wb');
    // let botView = document.getElementById('fixDiv2');
    // if (wb && botView) {
    //     wb.style.height = h - 80 + 'px'
    //     botView.style.top = h - 50 + 'px';
    // }
}

window.loadElectronFrame = loadElectronFrame;

ipcRenderer.on('payment-authorized', (event, message) => {
    const webview = document.getElementById('wb');
    if (webview) webview.send('payment-authorized', message);
});

ipcRenderer.on('downloadProgress', (event, progressObj) => {
    const updateDiv = document.getElementById('updateDiv');
    if (!updateDiv) return;
    updateDiv.style.visibility = 'visible';
    const percent = progressObj.percent || 1;
    const updateTxt = document.getElementById('updateTxt');
    if (updateTxt) updateTxt.innerHTML = '文件下载中：' + percent.toFixed(2) + '%';
    const updateTxt2 = document.getElementById('updateTxt2');
    if (updateTxt2) updateTxt2.innerHTML = (progressObj.transferred / 1024 / 1024).toFixed(2) + 'M/' + (progressObj.total / 1024 / 1024).toFixed(2) + 'M';
});






ipcRenderer.on('enter-full-screen', (e, msg) => {
    const top = document.getElementById('topDiv');
    const bottom = document.getElementById('topBottmDiv');
    const wd = document.getElementById('wb');
    const wbContainer = document.getElementById('wbContainer');
    const full = msg == 1;
    if (top) top.style.visibility = full ? 'hidden' : 'visible';
    if (bottom) bottom.style.visibility = full ? 'hidden' : 'visible';
    if (wbContainer) {
        wbContainer.style.top = full ? '0px' : '30px';
        wbContainer.style.bottom = full ? '0px' : '0px';
    }
    if (wd && !wbContainer) {
        wd.style.top = full ? '0px' : '30px';
        wd.style.bottom = full ? '0px' : (bottom ? '50px' : '0px');
    }
});

ipcRenderer.on('resize', (e, msg) => {
});


function getRemoteGlobalCompat(name, fallbackValue) {
    try {
        if (remote && typeof remote.getGlobal === 'function') {
            const value = remote.getGlobal(name);
            return typeof value === 'undefined' ? fallbackValue : value;
        }
    } catch (error) {
        console.warn('get remote global failed:', name, error);
    }
    return fallbackValue;
}

function getAppPathCompat(name) {
    try {
        if (remote && remote.app && typeof remote.app.getPath === 'function') {
            const value = remote.app.getPath(name);
            if (value) return value;
        }
    } catch (error) {
        console.warn('get app path failed:', name, error);
    }
    if (name === 'userData') {
        try {
            const path = require('path');
            const appData = process.env.APPDATA || '';
            if (appData) return path.join(appData, 'SGSOL');
        } catch (error) {
            console.warn('fallback userData path failed:', error);
        }
    }
    return '';
}

async function invokeCompat(channel, ...args) {
    try {
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
            return await ipcRenderer.invoke(channel, ...args);
        }
    } catch (error) {
        console.warn('ipc invoke failed:', channel, error);
    }
    return null;
}

function readLocalScriptFromDisk() {
    try {
        const fs = require('fs');
        const path = require('path');
        const userData = getAppPathCompat('userData');
        const candidates = [
            getRemoteGlobalCompat('scriptPath', ''),
            userData ? path.join(userData, '三国杀打小抄.js') : ''
        ].filter(Boolean);

        for (const filePath of candidates) {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf8');
            }
        }
    } catch (error) {
        console.warn('read local script from disk failed:', error);
    }
    return '';
}

async function readLocalScriptCompat() {
    if (localScriptResponseCache && localScriptResponseCache.success && localScriptResponseCache.data) {
        return localScriptResponseCache;
    }

    const asyncResponse = await invokeCompat('read-local-script');
    if (asyncResponse && asyncResponse.success && asyncResponse.data) {
        localScriptResponseCache = asyncResponse;
        return asyncResponse;
    }

    try {
        const syncResponse = ipcRenderer.sendSync && ipcRenderer.sendSync('read-local-script-sync');
        if (syncResponse && syncResponse.success && syncResponse.data) {
            localScriptResponseCache = syncResponse;
            return syncResponse;
        }
    } catch (error) {
        console.warn('sync read local script failed:', error);
    }

    const data = readLocalScriptFromDisk();
    if (data) {
        localScriptResponseCache = { success: true, data };
        return localScriptResponseCache;
    }
    return {
        success: false,
        error: asyncResponse && asyncResponse.error ? asyncResponse.error : 'local script not found'
    };
}

function getLocalScriptInjection(data) {
    if (localScriptInjectCache && localScriptInjectCache.data === data) {
        return localScriptInjectCache.code;
    }
    const escapedData = data.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    localScriptInjectCache = {
        data,
        code: `
            if (!window.__XIAOCHAO_MICROCLIENT_INJECTED__) {
                window.__XIAOCHAO_MICROCLIENT_INJECTED__ = true;
                let script = document.createElement('script');
                script.type = 'text/javascript';
                let src = document.createTextNode(\`${escapedData}\`);
                script.appendChild(src);
                (document.body || document.documentElement).appendChild(script);
            }
        `
    };
    return localScriptInjectCache.code;
}


async function loadScript(webview) {
    const response = await readLocalScriptCompat();
    // const videoPath = remote.getGlobal('videoPath'); // 你的视频文件路径

    if (response.success) {
        // const videoFilePath = 'myprotocol:/3.mp4'; // 替换为你实际的3.mp4路径


        const result = webview.executeJavaScript(getLocalScriptInjection(response.data));
        if (result && typeof result.catch === 'function') {
            result.catch((error) => console.error('local script injection failed:', error));
        }
    } else {
        console.error(response.error);
        // 本地脚本文件不存在或读取失败，由主进程下载后注入，不在游戏页里 fetch。
        invokeCompat('download-remote-script', 'https://xiaochao.org/download/%E5%B0%8F%E6%8A%84.user.js')
            .then(remoteResponse => {
                if (!remoteResponse || !remoteResponse.success || !remoteResponse.data) {
                    console.error(remoteResponse && remoteResponse.error || '下载远程脚本失败');
                    return;
                }
                const result = webview.executeJavaScript(getLocalScriptInjection(remoteResponse.data));
                if (result && typeof result.catch === 'function') {
                    result.catch((error) => console.error('remote script injection failed:', error));
                }
            })
            .catch(error => console.error('下载远程脚本失败:', error));
    }
}

function installReportWindowPageBridge(webview) {
    const result = webview.executeJavaScript(getReportWindowPageBridgeScript());
    if (result && typeof result.catch === 'function') {
        result.catch((error) => console.error('安装小抄原生报告窗口桥接失败：', error));
    }
}

function initElectronFrame() {


    var max = document.getElementById('max');
    if (max) {
        max.addEventListener('click', () => {
            //发送最大化命令
            ipcRenderer.send('window-max');
            //最大化图形切换
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('name', 'min');
            } else {
                max.setAttribute('name', 'max');
            }
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('src', 'res/button_05.png');
            } else {
                max.setAttribute('src', 'res/button_01.png');
            }

        })

        max.addEventListener('mousemove', () => {
            //最大化图形切换
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('src', 'res/button_06.png');
            } else {
                max.setAttribute('src', 'res/button_02.png');
            }
        })
        max.addEventListener('mouseout', () => {
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('src', 'res/button_05.png');
            } else {
                max.setAttribute('src', 'res/button_01.png');
            }
        })
    }

    var min = document.getElementById('min');
    if (min) {
        min.addEventListener('click', () => {
            //发送最小化命令
            ipcRenderer.send('window-min');
        })
    }

    var close = document.getElementById('close');
    if (close) {
        close.addEventListener('click', () => {
            ipcRenderer.send('window-close');
        })
    }
    const feed = document.getElementById('eFeed');
    if (feed) feed.addEventListener('click', () => ipcRenderer.send('e-feed'));
    const office = document.getElementById('eOffice');
    if (office) office.addEventListener('click', () => ipcRenderer.send('e-office'));
    const chagre = document.getElementById('eChagre');
    if (chagre) {
        chagre.addEventListener('click', () => {
            const webview = document.getElementById('wb');
            if (!webview) return;
            webview.executeJavaScript("if(window.OpenPay){ window.OpenPay(); }");
        });
    }
    const clear = document.getElementById('eClear');
    if (clear) clear.addEventListener('click', () => ipcRenderer.send('e-clear'));
    const searchBtn = document.getElementById('eBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const input = document.getElementById('eInput');
            ipcRenderer.send('e-search', input ? input.value : '三国杀OL');
        });
    }
    let setting = document.getElementById('icon') || document.getElementById('setting') || document.getElementById('WDVerSion') || document.querySelector('#topDiv img');
    if (setting) {
        setting.style.webkitAppRegion = 'no-drag';
        setting.addEventListener('click', () => {
            ipcRenderer.send('show-context-menu');
        });
        setting.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            ipcRenderer.send('show-context-menu');
        });
    }
    // let  menu = document.getElementById('cmenu');
    // if (menu) {
    //     setting.addEventListener('mouseover', () => {
    //         ipcRenderer.send('show-context-menu');
    //     })
    // }

    let webview = document.getElementById('wb');
    // let sidebar = document.getElementById('sidebar');
    // sidebar.addEventListener("dom-ready", function () {
    //     //alert(sidebar.src)
    //
    //     // ipcRenderer.on('onF6', (e, msg) => {
    //         sidebar.openDevTools({ mode: 'detach' })
    //     // })
    //     ipcRenderer.on('console-message-sidebar', (e, msg) => {
    //         console.warn(msg);
    //     });
    // })
    var loginURL = getRemoteGlobalCompat('LoginURL', []);
    var loginForm = Number(getRemoteGlobalCompat('PackageId', 1)) || 1;

    if (getRemoteGlobalCompat('IsTest', false)) {
        if (loginForm == 1 || loginForm == 2) {
            webview.src = getRemoteGlobalCompat('URLOffTest', '');
        } else {
            webview.src = getRemoteGlobalCompat('URLLYTest', '');
        }
    } else {
        let src = Array.isArray(loginURL) ? loginURL[loginForm - 1] : loginURL;
        if (src) {
            src += src.indexOf('?') !== -1 ? '&t=' + Math.floor(Date.now()) : '?t=' + Math.floor(Date.now());
            webview.src = src;
        }
    }
    //webview.src = 'http://10.225.11.80:8080'
    const msgList = {
        channel(packageId) {
            const url = Array.isArray(loginURL) ? loginURL[packageId - 1] : loginURL;
            if (url) webview.loadURL(url)
        },
        executeJS(str) {
            webview.executeJavaScript(str)
        },
        changeSize(wh) {

            let dimensions = wh.split('*');
            let width = dimensions[0];
            let height = dimensions[1];
            webview
              .executeJavaScript(
                `console.warn(wh);if(window.SystemContext){
                    window.SystemContext.GAME_MIN_WIDTH = '${width}'
                    window.SystemContext.GAME_MIN_HEIGHT = '${height}'
                  }`
              )
              .then(() => {
                  ipcRenderer.send('setBounds')
              })
        },
    }

    window.msgList = msgList
    ipcRenderer.on('rendererMsg', (e, msg, param) => {
        if (msgList[msg]) msgList[msg](param)
    })
    let isDeBug = getRemoteGlobalCompat('IsDebug', false);
    webview.setAttribute("IsDebug", isDeBug)
    if (!webview.__sgsolF6Bound) {
        webview.__sgsolF6Bound = true;
        ipcRenderer.on('onF6', (e, msg) => {
            webview.openDevTools({ mode: 'detach' })
        })
    }
    if (!webview.__xcFocusWebviewBound) {
        webview.__xcFocusWebviewBound = true;
        // 小抄输入框聚焦时（经 electron_renderer.js 的 focusWebview 转发）把原生
        // 键盘焦点/输入法状态委派回 webview，修复旧版 Chromium guest 焦点脱钩
        // 导致的按键丢失与中文输入法失效。
        webview.addEventListener('ipc-message', (event) => {
            if (event.channel === 'xiaochao-focus-webview') webview.focus();
        });
    }
    webview.addEventListener("dom-ready", function () {
        installReportWindowPageBridge(webview);
        loadScript(webview);
        execute(webview);
    })
}

ipcRenderer.on('set-video-path', (event, url) => {
    const index = url.indexOf('?');
    if (index !== -1) {
        url = url.substring(0, index);
    }
    // 创建视频元素
    let webview = document.getElementById('wb');
        webview.executeJavaScript(`
        document.getElementById('sgsBgVideo').src = '${url}';
    `)
});

// ipcRenderer.on('set-title', (event, title) => {
//     document.title = title;
//     const WDVerTxt = document.getElementById('WDVerSion');
//     if (WDVerTxt) {
//         WDVerTxt.innerHTML = title;
//
//         WDVerTxt.addEventListener('contextmenu', (e) => {
//             e.preventDefault();
//             WDVerTxt.innerHTML = 'title';
//             //ipcRenderer.send('show-context-menu');
//         }, false);
//     }
// });



// ipcRenderer.on('context-menu-command', (event, command) => {
//     let element = document.getElementById('WDVerSion');
//     element.innerHTML = 'o444';
//
//     if (command === 'option1') {
//         // 执行 Option 1 的操作
//         element.innerHTML = 'o1';
//
//     } else if (command === 'option2') {
//         // 执行 Option 2 的操作
//         element.innerHTML = 'o2';
//     }
// });



function execute(webview) {
    console.log('dom-ready');
    const helperSource = String.raw`
(function () {
  window.WDVerSion = '1.0.0';
  console.info('--wd-- ', window.location);

  function query(selectors, root) {
    const scope = root || document;
    for (const selector of selectors) {
      const node = scope.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function getAccessibleDocuments() {
    const documents = [];
    const visit = (currentDocument) => {
      if (!currentDocument || documents.includes(currentDocument)) return;
      documents.push(currentDocument);
      currentDocument.querySelectorAll('iframe').forEach((iframe) => {
        try {
          visit(iframe.contentDocument);
        } catch (error) {
          // The 4399 login frame becomes accessible after its document.domain setup runs.
        }
      });
    };
    visit(document);
    return documents;
  }

  function setNativeValue(input, value) {
    if (!input) return;
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    const InputEvent = input.ownerDocument.defaultView.Event;
    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new InputEvent('change', { bubbles: true }));
  }

  let is4399Login = /(^|\.)4399\.com$/i.test(window.location.hostname);

  function getCredentialScope() {
    return is4399Login ? '4399' : 'official';
  }

  function getCredentialStoreKey() {
    return 'sgsol.rememberedCredentials.v2' + (is4399Login ? '.4399' : '');
  }

  function normalizeCredentials(list) {
    const merged = [];
    const add = (account, password, updatedAt) => {
      account = String(account || '').trim();
      password = String(password || '');
      if (!account || !password) return;
      const old = merged.find((item) => item.account === account);
      if (old) {
        old.password = password;
        old.updatedAt = Math.max(old.updatedAt || 0, updatedAt || 0);
      } else {
        merged.push({ account, password, updatedAt: updatedAt || 0 });
      }
    };

    if (Array.isArray(list)) {
      list.forEach((item) => add(item && item.account, item && item.password, item && item.updatedAt));
    } else if (list && typeof list === 'object') {
      Object.keys(list).forEach((account) => add(account, list[account], 0));
    }
    return merged;
  }

  function readJsonStore(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(key + ' parse failed', error);
      return fallback;
    }
  }

  function getList() {
    const localList = normalizeCredentials(readJsonStore(getCredentialStoreKey(), []));
    const sharedList = window.xiaochaoStorage && typeof window.xiaochaoStorage.getCredentials === 'function'
      ? window.xiaochaoStorage.getCredentials(getCredentialScope(), localList)
      : localList;
    return normalizeCredentials(sharedList)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function saveList(list) {
    const normalized = normalizeCredentials(list).slice(0, 30);
    const modernList = normalized.map((item) => ({
      account: item.account,
      password: item.password,
      updatedAt: item.updatedAt || Date.now()
    }));
    window.localStorage.setItem(getCredentialStoreKey(), JSON.stringify(modernList));
    if (window.xiaochaoStorage && typeof window.xiaochaoStorage.saveCredentials === 'function') {
      window.xiaochaoStorage.saveCredentials(getCredentialScope(), modernList);
    }
  }

  function maskPassword(password) {
    if (!password) return '未保存密码';
    return '••••••••';
  }

  function bindRememberCheckbox() {
    const remember = query(['#SGS_login-remember', 'input[type="checkbox"][name*="remember"]']);
    if (!remember || remember.__sgsolBound) return;
    remember.__sgsolBound = true;
    remember.addEventListener('change', () => {
      if (remember.checked) window.localStorage.setItem('SGS_login-remember_checked', 'true');
      else window.localStorage.removeItem('SGS_login-remember_checked');
    });
    if (window.localStorage.getItem('SGS_login-remember_checked') === 'true') {
      if (!remember.checked) remember.click ? remember.click() : (remember.checked = true);
    } else {
      fetch('https://cas.dobest.cn/cas/logout?url=https%3A%2F%2Fweb.sanguosha.com%2Findex.html', {
        referrer: 'https://web.sanguosha.com/',
        referrerPolicy: 'strict-origin-when-cross-origin',
        method: 'GET',
        mode: 'no-cors',
        credentials: 'include'
      }).catch(() => console.log('logout skipped'));
    }
  }

  function enableLogin(proto, loginButton) {
    if (proto) {
      if (!proto.checked) proto.click ? proto.click() : (proto.checked = true);
      if (proto.parentNode && proto.parentNode.classList) proto.parentNode.classList.add('on');
    }
    if (loginButton) {
      loginButton.removeAttribute('disabled');
      loginButton.classList.remove('SGS_loginbtn-disable');
    }
  }

  function findLoginParts() {
    for (const loginDocument of getAccessibleDocuments()) {
      const account = query(['#SGS_login-account', '#username', 'input[name="account"]', 'input[name="username"]'], loginDocument);
      const password = query(['#SGS_login-password', '#j-password', 'input[type="password"]'], loginDocument);
      if (!account || !password) continue;
      const is4399 = account.id === 'username' && password.id === 'j-password';
      if (is4399) is4399Login = true;
      const proto = query(['#SGS_userProto', 'input[type="checkbox"][name*="proto"]', 'input[type="checkbox"][id*="Proto"]'], loginDocument);
      const nativeRemember = query(['#SGS_login-remember', '#login_autoLogin', 'input[type="checkbox"][name*="remember"]'], loginDocument);
      const loginButton = query(['#SGS_login-btn', '#j-login-submit-btn', 'button[type="submit"]', 'input[type="submit"]', '.SGS_loginbtn', '.SGS_login-btn', '.ptlogin_btn'], loginDocument);
      const form = query(['#SGS_login-form', '#login_form'], loginDocument) || account.closest('form') || password.closest('form') || loginDocument.body;
      return { account, password, proto, nativeRemember, loginButton, form, loginDocument, is4399 };
    }
    return {};
  }

  function ensureStyle(loginDocument) {
    if (loginDocument.getElementById('sgsol-password-style')) return;
    const style = loginDocument.createElement('style');
    style.id = 'sgsol-password-style';
    style.textContent = [
      '#sgsol-credential-panel{position:fixed;z-index:2147483600;box-sizing:border-box;min-width:260px;max-height:248px;overflow:auto;background:rgba(20,16,13,.98);border:1px solid rgba(226,199,137,.72);box-shadow:0 10px 28px rgba(0,0,0,.45);font-family:Arial,"Microsoft YaHei",sans-serif;color:#e9dcc0}',
      '#sgsol-credential-panel.sgsol-hidden{display:none}',
      '.sgsol-credential-header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(226,199,137,.22);font-size:13px;color:#cdbb93}',
      '.sgsol-credential-empty{padding:12px 10px;color:#9f9381;font-size:13px}',
      '.sgsol-credential-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05)}',
      '.sgsol-credential-row:hover,.sgsol-credential-row.sgsol-active{background:rgba(145,96,40,.36)}',
      '.sgsol-account-name{font-size:15px;line-height:20px;color:#f3ead5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sgsol-account-pass{font-size:12px;line-height:16px;color:#a99d89;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sgsol-delete{width:22px;height:22px;border:0;background:transparent;color:#b6aa96;font-size:18px;line-height:20px;cursor:pointer}',
      '.sgsol-delete:hover{color:#ffcf8a}',
      '.sgsol-save-line{position:fixed;z-index:2147483599;display:inline-flex;align-items:center;gap:6px;margin-left:0;color:#cfc4b2;font-size:15px;line-height:20px;cursor:pointer;vertical-align:middle;user-select:none;white-space:nowrap}',
      '.login_vertical .login_hor .sgsol-save-line.sgsol-save-line--4399{position:absolute;float:none;width:auto;margin-left:0;padding:0}',
      '.login_vertical .login_hor .sgsol-save-line.sgsol-save-line--4399>span{float:none;width:auto;overflow:visible;line-height:20px}',
      '.sgsol-save-line input{width:14px;height:14px;margin:0;accent-color:#c9984d;cursor:pointer}',
      '.sgsol-save-line:hover{color:#ead8b8}',
      '.sgsol-save-hint{margin-left:6px;color:#9f9381;font-size:12px}'
    ].join('');
    (loginDocument.head || loginDocument.documentElement).appendChild(style);
  }

  function mountPasswordManager() {
    bindRememberCheckbox();
    const parts = findLoginParts();
    if (!parts.account || !parts.password || !parts.form) return false;
    if (parts.account.__sgsolPasswordMounted) return true;
    parts.account.__sgsolPasswordMounted = true;

    const loginDocument = parts.loginDocument || document;
    const loginWindow = loginDocument.defaultView || window;

    ensureStyle(loginDocument);
    enableLogin(parts.proto, parts.loginButton);
    parts.account.spellcheck = false;
    parts.account.setAttribute('autocomplete', 'off');
    parts.password.setAttribute('autocomplete', 'off');

    let userlist = getList();
    let activeIndex = -1;
    let userWantsSave = false;
    let accountFilterKeyword = '';
    let panelAnchor = parts.account;

    const panel = loginDocument.createElement('div');
    panel.id = 'sgsol-credential-panel';
    panel.className = 'sgsol-hidden';
    loginDocument.body.appendChild(panel);

    const saveLine = loginDocument.createElement('label');
    saveLine.className = 'sgsol-save-line';
    saveLine.innerHTML = '<input id="sgsol-save-current" type="checkbox"><span>记住账号密码</span><span class="sgsol-save-hint"></span>';
    const saveCheckbox = saveLine.querySelector('input');
    const saveHint = saveLine.querySelector('.sgsol-save-hint');

    const rememberAnchor = parts.nativeRemember && (parts.nativeRemember.closest('label') || parts.nativeRemember.parentElement || parts.nativeRemember);
    if (parts.is4399 && parts.loginButton && parts.loginButton.parentElement) {
      saveLine.classList.add('sgsol-save-line--4399');
      parts.loginButton.parentElement.insertBefore(saveLine, parts.loginButton.nextSibling);
    } else {
      loginDocument.body.appendChild(saveLine);
    }

    function setSaveHint(text) {
      saveHint.textContent = text || '';
      if (text) window.setTimeout(() => { if (saveHint.textContent === text) saveHint.textContent = ''; }, 1800);
    }

    function refreshRememberState() {
      const account = parts.account.value;
      const found = userlist.find((item) => item.account === account && item.password === parts.password.value);
      if (found) {
        saveCheckbox.checked = true;
        userWantsSave = false;
      } else if (!userWantsSave) {
        saveCheckbox.checked = false;
      }
    }

    function saveCredential() {
      const account = parts.account.value.trim();
      const password = parts.password.value;
      if (!account || !password) return false;
      const item = { account, password, updatedAt: Date.now() };
      const existing = userlist.findIndex((item) => item.account === account);
      if (existing >= 0) userlist[existing] = item;
      else userlist.unshift(item);
      saveList(userlist);
      renderPanel();
      saveCheckbox.checked = true;
      setSaveHint('已保存');
      return true;
    }

    function removeCredential(index) {
      const item = userlist[index];
      userlist.splice(index, 1);
      saveList(userlist);
      if (item && item.account === parts.account.value) {
        saveCheckbox.checked = false;
        userWantsSave = false;
      }
      renderPanel();
    }

    function fill(item) {
      if (!item) return;
      setNativeValue(parts.account, item.account || '');
      setNativeValue(parts.password, item.password || '');
      saveCheckbox.checked = true;
      userWantsSave = false;
      enableLogin(parts.proto, parts.loginButton);
      hidePanel();
    }

    function getFilteredList() {
      const keyword = accountFilterKeyword;
      if (!keyword) return userlist;
      return userlist.filter((item) => String(item.account || '').toLowerCase().includes(keyword));
    }

    let positionFrame = 0;
    function schedulePosition() {
      if (positionFrame) return;
      const raf = loginWindow.requestAnimationFrame || ((callback) => loginWindow.setTimeout(callback, 16));
      positionFrame = raf(() => {
        positionFrame = 0;
        positionPanel();
      });
    }

    function positionPanel() {
      const rect = panelAnchor.getBoundingClientRect();
      panel.style.left = Math.round(rect.left) + 'px';
      panel.style.top = Math.round(rect.bottom + 4) + 'px';
      panel.style.width = Math.round(rect.width) + 'px';
      positionSaveLine();
    }

    function positionSaveLine() {
      const lineWidth = saveLine.offsetWidth || 120;
      const lineHeight = saveLine.offsetHeight || 20;
      const gap = 18;
      let left;
      let top;

      if (parts.is4399 && parts.loginButton) {
        const buttonRect = parts.loginButton.getBoundingClientRect();
        const offsetParent = saveLine.offsetParent || parts.loginButton.parentElement;
        const parentRect = offsetParent.getBoundingClientRect();
        left = buttonRect.right - parentRect.left + 10;
        top = buttonRect.top - parentRect.top + Math.max(0, (buttonRect.height - lineHeight) / 2);
        saveLine.style.left = Math.round(left) + 'px';
        saveLine.style.top = Math.round(top) + 'px';
        return;
      } else if (parts.nativeRemember) {
        const nativeRect = parts.nativeRemember.getBoundingClientRect();
        const anchorRect = rememberAnchor ? rememberAnchor.getBoundingClientRect() : nativeRect;
        const accountRect = parts.account.getBoundingClientRect();
        const anchorLooksTooWide = anchorRect.width > Math.max(220, accountRect.width * 0.7);
        const anchorRight = anchorLooksTooWide ? nativeRect.right + 96 : anchorRect.right;
        left = anchorRight + gap;
        top = anchorRect.top + Math.max(0, (anchorRect.height - lineHeight) / 2);
      } else {
        const passRect = parts.password.getBoundingClientRect();
        left = passRect.left;
        top = passRect.bottom + 10;
      }

      left = Math.max(8, Math.min(left, loginWindow.innerWidth - lineWidth - 8));
      top = Math.max(8, Math.min(top, loginWindow.innerHeight - lineHeight - 8));
      saveLine.style.left = Math.round(left) + 'px';
      saveLine.style.top = Math.round(top) + 'px';
    }

    function renderPanel() {
      const list = getFilteredList();
      panel.innerHTML = '';
      const header = loginDocument.createElement('div');
      header.className = 'sgsol-credential-header';
      header.innerHTML = '<span>已保存账号</span><span>' + list.length + '</span>';
      panel.appendChild(header);
      if (!list.length) {
        const empty = loginDocument.createElement('div');
        empty.className = 'sgsol-credential-empty';
        empty.textContent = '暂无匹配账号';
        panel.appendChild(empty);
        return;
      }
      list.forEach((item, filteredIndex) => {
        const realIndex = userlist.indexOf(item);
        const row = loginDocument.createElement('div');
        row.className = 'sgsol-credential-row' + (filteredIndex === activeIndex ? ' sgsol-active' : '');
        row.dataset.index = String(realIndex);
        row.innerHTML = '<div><div class="sgsol-account-name"></div><div class="sgsol-account-pass"></div></div><button class="sgsol-delete" title="删除" type="button">×</button>';
        row.querySelector('.sgsol-account-name').textContent = item.account || '';
        row.querySelector('.sgsol-account-pass').textContent = maskPassword(item.password);
        panel.appendChild(row);
      });
    }

    function showPanel(filterByInput = false, anchor = parts.account) {
      userlist = getList();
      panelAnchor = anchor;
      accountFilterKeyword = filterByInput ? parts.account.value.trim().toLowerCase() : '';
      activeIndex = -1;
      positionPanel();
      renderPanel();
      panel.classList.remove('sgsol-hidden');
    }

    function hidePanel() {
      panel.classList.add('sgsol-hidden');
      activeIndex = -1;
    }

    function selectActive() {
      const rows = Array.from(panel.querySelectorAll('.sgsol-credential-row'));
      if (activeIndex < 0 || activeIndex >= rows.length) return false;
      fill(userlist[Number(rows[activeIndex].dataset.index)]);
      return true;
    }

    function setActiveIndex(nextIndex) {
      const rows = Array.from(panel.querySelectorAll('.sgsol-credential-row'));
      if (!rows.length) return;
      if (activeIndex >= 0 && rows[activeIndex]) rows[activeIndex].classList.remove('sgsol-active');
      activeIndex = Math.max(0, Math.min(rows.length - 1, nextIndex));
      if (rows[activeIndex]) rows[activeIndex].classList.add('sgsol-active');
    }

    function handlePanelKeydown(event) {
      const rows = Array.from(panel.querySelectorAll('.sgsol-credential-row'));
      if (panel.classList.contains('sgsol-hidden') || !rows.length) return false;
      if (event.key === 'ArrowDown') {
        setActiveIndex(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        setActiveIndex(activeIndex - 1);
      } else if (event.key === 'Enter' && selectActive()) {
        // selectActive handles the chosen credential.
      } else if (event.key === 'Escape') {
        hidePanel();
      } else {
        return false;
      }
      event.preventDefault();
      return true;
    }

    panel.addEventListener('mousedown', (event) => event.preventDefault());
    panel.addEventListener('click', (event) => {
      const deleteButton = event.target.closest('.sgsol-delete');
      const row = event.target.closest('.sgsol-credential-row');
      if (!row) return;
      const index = Number(row.dataset.index);
      if (deleteButton) {
        removeCredential(index);
        event.stopPropagation();
        return;
      }
      fill(userlist[index]);
    });

    parts.account.addEventListener('focus', () => showPanel(false, parts.account));
    parts.account.addEventListener('click', () => showPanel(false, parts.account));
    parts.account.addEventListener('input', () => {
      refreshRememberState();
      showPanel(true, parts.account);
    });
    parts.account.addEventListener('keydown', handlePanelKeydown);

    parts.password.addEventListener('focus', () => showPanel(false, parts.password));
    parts.password.addEventListener('click', () => showPanel(false, parts.password));
    parts.password.addEventListener('input', refreshRememberState);
    parts.password.addEventListener('keydown', (event) => {
      if (handlePanelKeydown(event)) return;
      if (event.key === 'Enter' && saveCheckbox.checked) saveCredential();
    });

    saveCheckbox.addEventListener('change', () => {
      userWantsSave = saveCheckbox.checked;
      if (saveCheckbox.checked) setSaveHint('登录时保存');
    });

    if (parts.loginButton) {
      parts.loginButton.addEventListener('click', () => {
        if (saveCheckbox.checked) saveCredential();
      }, true);
    }

    loginDocument.addEventListener('mousedown', (event) => {
      if (event.target === parts.account || event.target === parts.password || panel.contains(event.target)) return;
      hidePanel();
    });
    loginWindow.addEventListener('resize', schedulePosition);
    loginWindow.addEventListener('scroll', schedulePosition, true);

    refreshRememberState();
    positionPanel();
    console.log('网页式密码管理已加载');
    return true;
  }

  if (window.__sgsolPasswordManagerTimer) clearInterval(window.__sgsolPasswordManagerTimer);
  let tries = 0;
  window.__sgsolPasswordManagerTimer = setInterval(() => {
    tries += 1;
    const mounted = mountPasswordManager();
    if (!is4399Login && (mounted || tries > 80)) clearInterval(window.__sgsolPasswordManagerTimer);
  }, 250);
  mountPasswordManager();
})();
`;
    webview.executeJavaScript(helperSource).catch((error) => {
        console.error('password manager injection failed:', error);
    });
}
