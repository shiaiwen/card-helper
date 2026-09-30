const { ipcRenderer, contextBridge } = require('electron');
async function GetSteamId(){
    const steamId =  await ipcRenderer.invoke('get-steam-id');
    console.log('你的 Steam ID 是:', steamId);
    return steamId;
}

var isSteam = false;

const sharedSettingKeys = new Set();
const nativeLocalStorage = window.localStorage;

function sendSharedSync(channel, data) {
    try {
        return ipcRenderer.sendSync(channel, data);
    } catch (error) {
        console.warn('shared micro-client storage unavailable:', channel, error);
        return null;
    }
}

const xiaochaoStorage = {
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
            Object.entries(sharedValues).forEach(([key, value]) => {
                nativeLocalStorage.setItem(key, String(value));
            });
        }
        return sharedValues || {};
    },
    getItem: (key) => {
        key = String(key);
        if (!sharedSettingKeys.has(key)) return nativeLocalStorage.getItem(key);
        const result = sendSharedSync('xiaochao-setting-get-sync', key);
        if (result && result.found) {
            nativeLocalStorage.setItem(key, String(result.value));
            return String(result.value);
        }
        return nativeLocalStorage.getItem(key);
    },
    setItem: (key, value) => {
        key = String(key);
        value = String(value);
        nativeLocalStorage.setItem(key, value);
        if (sharedSettingKeys.has(key)) {
            sendSharedSync('xiaochao-setting-set-sync', { key, value });
        }
    },
    removeItem: (key) => {
        key = String(key);
        nativeLocalStorage.removeItem(key);
        if (sharedSettingKeys.has(key)) sendSharedSync('xiaochao-setting-delete-sync', key);
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
    openWindow: (url) => {
        return ipcRenderer.invoke('open-window', url).catch(() => false);
    },
    openExternal: (url) => {
        return ipcRenderer.invoke('open-external', url).catch(() => false);
    },
    invoke: (channel, data) => {
        return ipcRenderer.invoke(channel, data);
    },
    onMessageFromMain: (channel ,callback) => {
        ipcRenderer.on(channel,(event, ...args) => {
            callback(event, ...args);
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
