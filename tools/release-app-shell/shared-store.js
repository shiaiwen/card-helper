/** 主进程侧的本地存储，转给战绩和原生游戏数据。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { applyGameRecordStorageOperation } = require('./game-record-store');
const { applyNativeGameStorageOperation } = require('./native-game-store');

function sleepSync(milliseconds) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function normalizeCredentials(list) {
    if (!Array.isArray(list)) return [];
    const result = [];
    for (const item of list) {
        const account = String(item && item.account || '').trim();
        const password = String(item && item.password || '');
        if (!account || !password) continue;
        const normalized = {
            account,
            password,
            updatedAt: Number(item && item.updatedAt) || Date.now()
        };
        const index = result.findIndex((entry) => entry.account === account);
        if (index >= 0) result[index] = normalized;
        else result.push(normalized);
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
}

function normalizeCredentialScope(scope) {
    const normalized = String(scope || 'official').trim();
    return normalized && normalized.length <= 64 ? normalized : 'official';
}

function parseCredentialArguments(scopeOrCredentials, credentials) {
    if (Array.isArray(scopeOrCredentials)) {
        return { scope: 'official', credentials: scopeOrCredentials };
    }
    return {
        scope: normalizeCredentialScope(scopeOrCredentials),
        credentials: Array.isArray(credentials) ? credentials : []
    };
}

function ensureCredentialScopes(store) {
    if (!store.credentialsByScope || typeof store.credentialsByScope !== 'object') {
        store.credentialsByScope = {};
    }
    if (!store.credentialScopesInitialized || typeof store.credentialScopesInitialized !== 'object') {
        store.credentialScopesInitialized = {};
    }
    if (store.credentialsInitialized === true && store.credentialScopesInitialized.official !== true) {
        store.credentialsByScope.official = normalizeCredentials(store.credentials);
        store.credentialScopesInitialized.official = true;
    }
}

function createJsonStore(filePath) {
    const lockPath = filePath + '.lock';

    function read() {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const store = JSON.parse(raw);
            if (!store || typeof store !== 'object' || Array.isArray(store)) throw new Error('invalid config object');
            return store;
        } catch (error) {
            if (error.code === 'ENOENT') return {};
            // 读取失败时不能把空对象写回，否则会把仍可恢复的配置彻底覆盖。
            throw error;
        }
    }

    function acquireLock() {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const deadline = Date.now() + 3000;
        while (true) {
            try {
                fs.mkdirSync(lockPath);
                return;
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
                try {
                    const stat = fs.statSync(lockPath);
                    if (Date.now() - stat.mtimeMs > 15000) {
                        fs.rmdirSync(lockPath);
                        continue;
                    }
                } catch (statError) {
                    if (statError.code === 'ENOENT') continue;
                }
                if (Date.now() >= deadline) throw new Error('shared config lock timeout');
                sleepSync(20);
            }
        }
    }

    function update(callback) {
        acquireLock();
        let tempPath = '';
        try {
            const store = read();
            const result = callback(store);
            tempPath = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
            fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
            fs.renameSync(tempPath, filePath);
            tempPath = '';
            return result;
        } finally {
            if (tempPath) {
                try {
                    fs.unlinkSync(tempPath);
                } catch (error) {
                    if (error.code !== 'ENOENT') console.error('shared config temp cleanup failed:', error);
                }
            }
            try {
                fs.rmdirSync(lockPath);
            } catch (error) {
                if (error.code !== 'ENOENT') console.error('shared config unlock failed:', error);
            }
        }
    }

    return { read, update };
}

function createJsonConfig(filePath) {
    const { read, update } = createJsonStore(filePath);
    return {
        get(key, fallback) {
            const store = read();
            return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
        },
        set(key, value) { update(store => { store[key] = value; }); },
        has(key) { return Object.prototype.hasOwnProperty.call(read(), key); },
        ensureDefaults(defaults) {
            update(store => {
                for (const key of Object.keys(defaults)) {
                    if (!Object.prototype.hasOwnProperty.call(store, key)) store[key] = defaults[key];
                }
            });
        }
    };
}

function createSharedStore(filePath) {
    const { read, update } = createJsonStore(filePath);
    // 战绩可能远大于设置，独立落盘，避免每次读开关都解析整份历史。
    const gameRecordsStore = createJsonStore(path.join(path.dirname(filePath), 'game-records.json'));
    const nativeDirectory = path.join(path.dirname(filePath), 'native-settings');
    const nativeStores = new Map();
    function nativeSnapshot(store) {
        return { revision: store.revision || 0, values: store.values || {}, generations: store.generations || {} };
    }
    return {
        nativeGameStorage(origin, operation, source) {
            const name = crypto.createHash('sha256').update(origin).digest('hex') + '.json';
            if (!nativeStores.has(name)) nativeStores.set(name, { origin, settings: createJsonStore(path.join(nativeDirectory, name)) });
            const { settings } = nativeStores.get(name);
            if (operation.action === 'get') return applyNativeGameStorageOperation(settings.read(), operation, source);
            return settings.update(store => {
                const result = applyNativeGameStorageOperation(store, operation, source);
                store.revision = (store.revision || 0) + 1;
                return { ...(typeof result === 'object' ? result : {}), snapshot: nativeSnapshot(store) };
            });
        },
        watchNativeSettings(callback) {
            fs.mkdirSync(nativeDirectory, { recursive: true });
            const changedNames = new Set();
            let pending = null;
            const watcher = fs.watch(nativeDirectory, (_event, name) => {
                if (name && !nativeStores.has(String(name))) return;
                for (const key of name ? [String(name)] : nativeStores.keys()) changedNames.add(key);
                if (pending) return;
                pending = setImmediate(() => {
                    pending = null;
                    for (const key of changedNames) {
                        const entry = nativeStores.get(key);
                        if (!entry) continue;
                        try { callback(entry.origin, nativeSnapshot(entry.settings.read())); }
                        catch (error) { console.error('native settings change failed:', error); }
                    }
                    changedNames.clear();
                });
            });
            watcher.on('error', error => console.error('native settings watch failed:', error));
            return () => { watcher.close(); if (pending) clearImmediate(pending); };
        },
        gameRecords(operation) {
            const source = operation.source || 'local';
            if (operation.action === 'read') {
                const state = gameRecordsStore.read().gameRecords;
                // 原子替换保证读到完整文件。迁移完成后的读取不获取写锁，
                // 也不能仅为打开战绩窗口就重写所有账号的历史。
                if (state && (state.migrationClosed || state.migrated[source])) {
                    return { revision: state.revision, records: state.accounts[operation.accountId] || {} };
                }
            }
            return gameRecordsStore.update(store => {
                store.gameRecords = applyGameRecordStorageOperation(store.gameRecords, operation);
                return {
                    revision: store.gameRecords.revision,
                    records: store.gameRecords.accounts[operation.accountId] || {}
                };
            });
        },
        watchSettings(callback) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            let previous = read().xiaochaoSettings || {};
            let pending = null;
            const watcher = fs.watch(path.dirname(filePath), (_event, name) => {
                if (name && String(name) !== path.basename(filePath)) return;
                if (pending) return;
                pending = setImmediate(() => {
                    pending = null;
                    try {
                        const next = read().xiaochaoSettings || {};
                        const changes = [];
                        for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
                            if (previous[key] !== next[key]) changes.push({ key, newValue: next[key] ?? null });
                        }
                        previous = next;
                        if (changes.length) callback(changes);
                    } catch (error) { console.error('shared settings change failed:', error); }
                });
            });
            watcher.on('error', error => console.error('shared settings watch failed:', error));
            return () => { watcher.close(); if (pending) clearImmediate(pending); };
        },
        registerSettings(keys, localValues) {
            return update((store) => {
                if (!store.xiaochaoSettings || typeof store.xiaochaoSettings !== 'object') store.xiaochaoSettings = {};
                if (!store.settingsInitialized) store.settingsInitialized = {};
                for (const key of keys) {
                    if (!store.settingsInitialized[key] && !Object.prototype.hasOwnProperty.call(store.xiaochaoSettings, key) && typeof localValues[key] === 'string') {
                        store.xiaochaoSettings[key] = localValues[key];
                    }
                    store.settingsInitialized[key] = true;
                }
                return Object.fromEntries(keys
                    .filter((key) => Object.prototype.hasOwnProperty.call(store.xiaochaoSettings, key))
                    .map((key) => [key, store.xiaochaoSettings[key]]));
            });
        },
        getSetting(key) {
            const settings = read().xiaochaoSettings;
            return settings && Object.prototype.hasOwnProperty.call(settings, key)
                ? { found: true, value: settings[key] }
                : { found: false };
        },
        setSetting(key, value) {
            update((store) => {
                if (!store.xiaochaoSettings || typeof store.xiaochaoSettings !== 'object') store.xiaochaoSettings = {};
                store.xiaochaoSettings[key] = value;
            });
        },
        deleteSetting(key) {
            update((store) => {
                if (store.xiaochaoSettings && typeof store.xiaochaoSettings === 'object') delete store.xiaochaoSettings[key];
                if (!store.settingsInitialized) store.settingsInitialized = {};
                store.settingsInitialized[key] = true;
            });
        },
        getCredentials(scopeOrCredentials, localCredentials) {
            const parsed = parseCredentialArguments(scopeOrCredentials, localCredentials);
            return update((store) => {
                ensureCredentialScopes(store);
                if (store.credentialScopesInitialized[parsed.scope] !== true) {
                    const stored = normalizeCredentials(store.credentialsByScope[parsed.scope]);
                    store.credentialsByScope[parsed.scope] = stored.length
                        ? stored
                        : normalizeCredentials(parsed.credentials);
                    store.credentialScopesInitialized[parsed.scope] = true;
                }
                return normalizeCredentials(store.credentialsByScope[parsed.scope]);
            });
        },
        setCredentials(scopeOrCredentials, credentials) {
            const parsed = parseCredentialArguments(scopeOrCredentials, credentials);
            update((store) => {
                ensureCredentialScopes(store);
                store.credentialsByScope[parsed.scope] = normalizeCredentials(parsed.credentials);
                store.credentialScopesInitialized[parsed.scope] = true;
                if (parsed.scope === 'official') {
                    store.credentials = store.credentialsByScope.official;
                    store.credentialsInitialized = true;
                }
            });
        }
    };
}

module.exports = { createSharedStore, createJsonConfig, createJsonStore, normalizeCredentials };
