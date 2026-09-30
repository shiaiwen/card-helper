const { ipcRenderer, contextBridge } = require('electron');
async function GetSteamId(){
    const steamId =  await ipcRenderer.invoke('get-steam-id');
    console.log('你的 Steam ID 是:', steamId);
    return steamId;
}

var isSteam = false;

const sharedSettingKeys = new Set();
const nativeLocalStorage = window.localStorage;
const sharedSettingListeners = new Set();
const nativeSettingListeners = new Set();
// 原生设置会在布局、红点检查中高频读取。启动时取快照，此后只由文件变更
// 通知更新；get 不能再阻塞渲染线程等待主进程同步读盘。
let nativeSettingsSnapshot = null;
function acceptNativeSettingsSnapshot(snapshot) {
    if (!snapshot || !snapshot.values || !snapshot.generations) return;
    if (nativeSettingsSnapshot && snapshot.revision <= nativeSettingsSnapshot.revision) return;
    const previous = nativeSettingsSnapshot;
    nativeSettingsSnapshot = snapshot;
    if (!previous) return;
    const changed = [...new Set([...Object.keys(previous.values), ...Object.keys(snapshot.values)])]
        .filter(key => previous.values[key] !== snapshot.values[key] || previous.generations[key] !== snapshot.generations[key]);
    if (changed.length) for (const callback of nativeSettingListeners) callback(changed);
}
ipcRenderer.on('xiaochao-native-settings-changed', (_event, payload) => {
    if (payload?.origin !== window.location.origin) return;
    acceptNativeSettingsSnapshot(payload.snapshot);
});

ipcRenderer.on('xiaochao-settings-changed', (_event, changes) => {
    for (const change of changes) {
        if (!sharedSettingKeys.has(change.key)) continue;
        if (change.newValue === null) nativeLocalStorage.removeItem(change.key);
        else nativeLocalStorage.setItem(change.key, String(change.newValue));
        for (const callback of sharedSettingListeners) callback(change);
    }
});

function sendSharedSync(channel, data) {
    try {
        return ipcRenderer.sendSync(channel, data);
    } catch (error) {
        console.warn('shared micro-client storage unavailable:', channel, error);
        return null;
    }
}

const xiaochaoStorage = {
    onNativeChange: callback => {
        nativeSettingListeners.add(callback);
        return () => nativeSettingListeners.delete(callback);
    },
    nativeGameStorage: operation => {
        if (operation.action === 'get' && nativeSettingsSnapshot) {
            return {
                value: nativeSettingsSnapshot.values[operation.key] ?? null,
                generation: nativeSettingsSnapshot.generations[operation.key] || 0
            };
        }
        // 原生 UI 会重复保存相同标记。只有读过且未改动的值才能省略写入；
        // 本地有修改、远端值已变化或删除代次变化时仍交给主进程合并。
        if (operation.action === 'set' && nativeSettingsSnapshot &&
            operation.value === operation.base && operation.value === nativeSettingsSnapshot.values[operation.key] &&
            operation.generation === (nativeSettingsSnapshot.generations[operation.key] || 0)) {
            return { value: operation.value, generation: operation.generation };
        }
        const response = sendSharedSync('xiaochao-native-storage-sync', operation);
        if (!response?.success) throw new Error(response?.error || '游戏原生配置保存失败');
        acceptNativeSettingsSnapshot(response.result?.snapshot);
        return response.result;
    },
    gameRecords: operation => ipcRenderer.invoke('xiaochao-game-records', operation),
    onChange: callback => {
        sharedSettingListeners.add(callback);
        return () => sharedSettingListeners.delete(callback);
    },
    registerKeys: (keys) => {
        const normalizedKeys = Array.isArray(keys) ? keys.map(String).filter(Boolean) : [];
        const localValues = {};
        normalizedKeys.forEach((key) => {
            sharedSettingKeys.add(key);
            const value = nativeLocalStorage.getItem(key);
            if (value !== null) localValues[key] = value;
        });
        const sharedValues = sendSharedSync('xiaochao-settings-register-sync', {
            keys: normalizedKeys,
            localValues
        });
        if (sharedValues && typeof sharedValues === 'object') {
            normalizedKeys.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(sharedValues, key)) nativeLocalStorage.setItem(key, String(sharedValues[key]));
                else nativeLocalStorage.removeItem(key);
            });
        }
        return sharedValues || {};
    },
    getItem: (key) => {
        key = String(key);
        if (!sharedSettingKeys.has(key)) return nativeLocalStorage.getItem(key);
        const result = sendSharedSync('xiaochao-setting-get-sync', key);
        if (result) {
            if (result.found) {
                nativeLocalStorage.setItem(key, String(result.value));
                return String(result.value);
            }
            nativeLocalStorage.removeItem(key);
            return null;
        }
        return nativeLocalStorage.getItem(key);
    },
    setItem: (key, value) => {
        key = String(key);
        value = String(value);
        if (sharedSettingKeys.has(key)) {
            if (sendSharedSync('xiaochao-setting-set-sync', { key, value }) !== true) throw new Error('小抄设置保存失败');
        }
        nativeLocalStorage.setItem(key, value);
    },
    removeItem: (key) => {
        key = String(key);
        if (sharedSettingKeys.has(key) && sendSharedSync('xiaochao-setting-delete-sync', key) !== true) throw new Error('小抄设置删除失败');
        nativeLocalStorage.removeItem(key);
    },
    getCredentials: (scope, localCredentials) => {
        return sendSharedSync('xiaochao-credentials-get-sync', { scope, localCredentials }) || localCredentials || [];
    },
    saveCredentials: (scope, credentials) => {
        return sendSharedSync('xiaochao-credentials-set-sync', { scope, credentials });
    }
};

const api = {
    WDVerSion: "1.0.0",
    isSteam: isSteam,
    GetSteamId: GetSteamId,
    hasOpenHandler: () => {
        return ipcRenderer.invoke('has-open-handler').catch(() => false);
    },
    openWindow: (url, sourceId) => {
        return ipcRenderer.invoke('open-window', typeof sourceId === 'string' ? { url, sourceId } : url).catch(() => false);
    },
    openExternal: (url) => {
        return ipcRenderer.invoke('open-external', url).catch(() => false);
    },
    invoke: (channel, data) => {
        return ipcRenderer.invoke(channel, data);
    },
    // 小抄输入框聚焦时调用：请求外层把原生键盘焦点/输入法状态委派回 webview。
    // 旧版 Chromium guest 的键盘焦点可能与外层脱钩，这是恢复输入（尤其中文
    // 输入法）的同步通道；仅对 webview 内页面可见，不改变既有 ipc 行为。
    focusWebview: () => {
        try {
            ipcRenderer.sendToHost('xiaochao-focus-webview');
        } catch (error) {
            console.warn('focus webview unavailable:', error);
        }
    },
    onMessageFromMain: (channel ,callback) => {
        ipcRenderer.on(channel,(event, ...args) => {
            // 只透传数据实参，不把 ipc 事件对象暴露过 contextBridge。
            callback(...args);
        });
    },
};

function exposeApi() {
    if (process.contextIsolated && contextBridge) {
        contextBridge.exposeInMainWorld('WEIDUAN', true);
        contextBridge.exposeInMainWorld('electron', api);
        contextBridge.exposeInMainWorld('xiaochaoStorage', xiaochaoStorage);
        return;
    }
    window.WEIDUAN = true;
    window.electron = api;
    window.xiaochaoStorage = xiaochaoStorage;
}

exposeApi();
