const fs = require('fs');
const path = require('path');

// Chromium 的磁盘数据库只能由一个主进程持有。用 Electron 原生进程锁
// 分配可复用的目录；第一个实例继续使用旧目录，后续实例各自保留缓存。
function selectInstanceProfile(app) {
    const sharedUserData = app.getPath('userData');
    for (let slot = 0; slot < 64; slot += 1) {
        const userData = slot === 0 ? sharedUserData : path.join(sharedUserData, 'xiaochao', 'profiles', String(slot));
        fs.mkdirSync(userData, { recursive: true });
        app.setPath('userData', userData);
        if (!app.requestSingleInstanceLock()) continue;
        // 旧版 Electron 没有 sessionData；其 Session 直接使用 userData。
        let hasSessionData = false;
        try { hasSessionData = !!app.getPath('sessionData'); } catch (_) {}
        if (hasSessionData) app.setPath('sessionData', userData);
        return { sharedUserData, userData, slot };
    }
    throw new Error('没有可用的微端数据目录，请关闭部分微端后重试');
}

module.exports = { selectInstanceProfile };
