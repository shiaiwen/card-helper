/**
 * 跨微端实例共享的本地持久化存储。
 *
 * 写入 userData/xiaochao/shared.json，用目录锁保证多进程互斥。
 * 负责两类数据：小抄设置项（xiaochaoSettings）与按大区隔离的账号密码。
 */

const fs = require('fs');
const path = require('path');

/** 同步短暂休眠，仅用于目录锁轮询等待。 */
function sleepSync(milliseconds) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** 清洗账号列表：去空、按账号去重、按更新时间倒序，最多保留 30 条。 */
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

/** 规范化凭证作用域（大区）名称，非法值回退为 official。 */
function normalizeCredentialScope(scope) {
    const normalized = String(scope || 'official').trim();
    return normalized && normalized.length <= 64 ? normalized : 'official';
}

/** 兼容旧调用：首参可为凭证数组，也可为 scope + credentials。 */
function parseCredentialArguments(scopeOrCredentials, credentials) {
    if (Array.isArray(scopeOrCredentials)) {
        return { scope: 'official', credentials: scopeOrCredentials };
    }
    return {
        scope: normalizeCredentialScope(scopeOrCredentials),
        credentials: Array.isArray(credentials) ? credentials : []
    };
}

/** 惰性初始化 credentialsByScope；把旧版扁平 credentials 迁入 official。 */
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

/**
 * 创建带文件锁的共享配置读写器。
 * @param {string} filePath shared.json 绝对路径
 */
function createSharedStore(filePath) {
    const lockPath = filePath + '.lock';

    /** 无锁读取当前 JSON；损坏或缺失时返回空对象。 */
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

    /** 以 mkdir 实现互斥锁；超时 3s，过期锁（>15s）可强制回收。 */
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

    /** 加锁 → 读 → 回调改写 → 写临时文件再 rename，保证原子落盘。 */
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
        /** 首次注册设置键：共享端尚无值时用本地值填充，并返回已有共享值。 */
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
        /** 读取单项设置；未找到时返回 { found: false }。 */
        getSetting(key) {
            const settings = read().xiaochaoSettings;
            return settings && Object.prototype.hasOwnProperty.call(settings, key)
                ? { found: true, value: settings[key] }
                : { found: false };
        },
        /** 写入单项设置到共享文件。 */
        setSetting(key, value) {
            update((store) => {
                if (!store.xiaochaoSettings || typeof store.xiaochaoSettings !== 'object') store.xiaochaoSettings = {};
                store.xiaochaoSettings[key] = value;
            });
        },
        /** 从共享文件删除单项设置。 */
        deleteSetting(key) {
            update((store) => {
                if (store.xiaochaoSettings && typeof store.xiaochaoSettings === 'object') delete store.xiaochaoSettings[key];
            });
        },
        /** 读取指定大区凭证；该大区首次访问时可用本地列表初始化。 */
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
        /** 覆盖写入指定大区凭证；official 同步回旧字段 credentials。 */
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
