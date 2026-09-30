// 游戏 WCt 将账号配置保存为 LoginUserName + "::" + key。
// Chromium 数据库继续隔离，只把这个配置命名空间放进共享文件。
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const objectValue = value => value && typeof value === 'object' && !Array.isArray(value);
const safeKey = key => !['__proto__', 'constructor', 'prototype'].includes(key);

function isNativeGameSettingKey(key) {
    return typeof key === 'string' && key.length <= 1024 && key.indexOf('::') > 0 && !key.startsWith('SGS_NATIVE_RED_MARK:');
}

function parse(value) {
    try { return JSON.parse(value); } catch (_) { return null; }
}

function mergeChangedFields(current, previous, next) {
    if (JSON.stringify(previous) === JSON.stringify(next)) return current;
    if (!objectValue(next) || !objectValue(current)) return next;
    const result = { ...current };
    for (const key of Object.keys(next).filter(safeKey)) {
        result[key] = mergeChangedFields(current[key], previous && previous[key], next[key]);
        if (result[key] === undefined) delete result[key];
    }
    if (objectValue(previous)) {
        for (const key of Object.keys(previous).filter(safeKey)) {
            if (!own(next, key)) delete result[key];
        }
    }
    return result;
}

function mergeNativeGameSetting(key, current, previous, next) {
    const incoming = parse(next), stored = parse(current);
    // 本地红点时间只会向前推进；旧快照里的较早时间不能让已读状态倒退。
    if (key.endsWith('::RED_TIME') && objectValue(incoming?.RED_TIME) && objectValue(stored?.RED_TIME)) {
        const times = { ...stored.RED_TIME };
        for (const [node, time] of Object.entries(incoming.RED_TIME)) {
            if (safeKey(node) && Number.isFinite(time)) times[node] = Math.max(Number(times[node]) || 0, time);
        }
        return JSON.stringify({ ...stored, RED_TIME: times });
    }
    if (previous === next) return current;
    if (objectValue(stored) && objectValue(incoming)) {
        return JSON.stringify(mergeChangedFields(stored, parse(previous), incoming));
    }
    return next;
}

function applyNativeGameStorageOperation(store, operation, source) {
    store.values = store.values || {};
    store.generations = store.generations || {};
    store.sources = store.sources || {};
    if (operation.action === 'clear') {
        for (const key of Object.keys(store.values)) {
            store.values[key] = null;
            store.generations[key] = (store.generations[key] || 0) + 1;
        }
        store.migrationClosed = true;
        return true;
    }
    if (operation.action === 'register') {
        if (!store.migrationClosed && !own(store.sources, source)) {
            for (const [key, value] of Object.entries(operation.values || {})) {
                if (!isNativeGameSettingKey(key) || typeof value !== 'string') continue;
                if (!own(store.values, key)) store.values[key] = value;
                else if (store.values[key] !== null && key.endsWith('::RED_TIME')) {
                    store.values[key] = mergeNativeGameSetting(key, store.values[key], null, value);
                }
            }
            store.sources[source] = true;
        }
        return true;
    }
    const key = operation.key;
    if (!isNativeGameSettingKey(key)) throw new Error('invalid native setting key');
    const generation = store.generations[key] || 0;
    if (operation.action === 'set') {
        if (typeof operation.value !== 'string') throw new Error('invalid native setting value');
        if (operation.generation == null || operation.generation === generation) {
            store.values[key] = mergeNativeGameSetting(key, store.values[key] ?? null, operation.base, operation.value);
        }
    } else if (operation.action === 'remove') {
        store.values[key] = null;
        store.generations[key] = generation + 1;
    } else if (operation.action !== 'get') throw new Error('invalid native setting operation');
    return { value: store.values[key] ?? null, generation: store.generations[key] || 0 };
}

module.exports = { applyNativeGameStorageOperation, isNativeGameSettingKey };
