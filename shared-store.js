const fs = require('fs');
const path = require('path');

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

function createSharedStore(filePath) {
    const lockPath = filePath + '.lock';

    function read() {
        try {
            if (!fs.existsSync(filePath)) return {};
            const raw = fs.readFileSync(filePath, 'utf8');
            return raw.trim() ? JSON.parse(raw) : {};
        } catch (error) {
            console.error('shared config read failed:', error);
            return {};
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

    return {
        registerSettings(keys, localValues) {
            return update((store) => {
                if (!store.xiaochaoSettings || typeof store.xiaochaoSettings !== 'object') store.xiaochaoSettings = {};
                for (const key of keys) {
                    if (!Object.prototype.hasOwnProperty.call(store.xiaochaoSettings, key) && typeof localValues[key] === 'string') {
                        store.xiaochaoSettings[key] = localValues[key];
                    }
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

module.exports = { createSharedStore, normalizeCredentials };
