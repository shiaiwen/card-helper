/** 微端更新：下载、校验并替换客户端文件。 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildWindowsMicroClientUpdater } = require('./micro-client-updater');

const MANIFEST_URL = 'https://95chong.cn/api/xiaochao-version';
const APP_URL = 'https://xc.95chong.cn/downloads/app.zip';

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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

const NO_BROWSER_MESSAGE = '未安装 Chrome 或 Edge';

function browserExecutable() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (let index = 0; index < candidates.length; index += 1) {
        if (fs.existsSync(candidates[index])) return candidates[index];
    }
    return '';
}

/** 正式微端自己的加密握手会被重置，改由本机 Chrome 或 Edge 打开页面取回正文。 */
function requestBuffer(url, maxBytes) {
    const executable = browserExecutable();
    if (!executable) return Promise.reject(new Error(NO_BROWSER_MESSAGE));
    return new Promise((resolve, reject) => {
        const child = spawn(executable, [
            '--headless=new',
            '--disable-gpu',
            '--no-first-run',
            '--disable-extensions',
            '--virtual-time-budget=15000',
            '--dump-dom',
            url
        ], { windowsHide: true });
        const chunks = [];
        let settled = false;
        const finish = (error, body) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ statusCode: 200, body: body });
        };
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.on('error', (error) => finish(error));
        child.on('close', () => {
            const html = Buffer.concat(chunks).toString('utf8');
            const matched = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
            const text = matched ? matched[1] : html;
            const body = Buffer.from(text.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), 'utf8');
            if (!body.length) {
                finish(new Error('浏览器没有返回内容'));
                return;
            }
            if (maxBytes && body.length > maxBytes) {
                finish(new Error('response is too large'));
                return;
            }
            finish(null, body);
        });
    });
}

function fetchJson(url) {
    return requestBuffer(url, 1024 * 1024).then(({ statusCode, body }) => {
        if (statusCode !== 200) throw new Error(`Failed to get '${url}' (${statusCode})`);
        return JSON.parse(body.toString('utf8'));
    });
}

function downloadFile(url, localFilePath) {
    return requestBuffer(url).then(({ statusCode, body }) => {
        if (statusCode !== 200) throw new Error(`Failed to get '${url}' (${statusCode})`);
        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        fs.writeFileSync(localFilePath, body);
    });
}

function isValidManifest(manifest) {
    return Boolean(manifest)
        && /^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))
        && String(manifest.appUrl || '').split('?')[0] === APP_URL
        && /^[a-f0-9]{64}$/.test(String(manifest.appSha256 || ''));
}

function readScriptVersion(scriptPath) {
    try {
        if (!scriptPath || !fs.existsSync(scriptPath)) return '0.0.0';
        const match = fs.readFileSync(scriptPath, 'utf8').match(/@version\s+([\d.]+)/);
        return match ? match[1] : '0.0.0';
    } catch (error) {
        return '0.0.0';
    }
}

/**
 * 正式包启动后检查门户清单。脚本版本更高时下载 app.zip，校验后弹 UAC，
 * 等本进程退出再替换 resources/app 并重新打开微端。
 */
function scheduleMicroClientUpdate(deps) {
    const {
        app,
        dialog,
        BrowserWindow,
        screen,
        getMainWindow,
        logMessage,
        getScriptPath
    } = deps;
    if (!app.isPackaged || process.platform !== 'win32') return;

    let updateProgressWindow = null;

    function showProgress(text) {
        const mainWindow = getMainWindow();
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
            updateProgressWindow.webContents.executeJavaScript(
                `document.body.innerHTML = ${JSON.stringify(String(text).replace(/\n/g, '<br>'))};`
            ).catch(() => {});
            return;
        }
        const win = new BrowserWindow({
            width: 420,
            height: 140,
            parent: mainWindow || undefined,
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
            const display = mainWindow && !mainWindow.isDestroyed()
                ? screen.getDisplayMatching(mainWindow.getBounds())
                : screen.getPrimaryDisplay();
            const area = display.workArea;
            win.setBounds({
                x: Math.round(area.x + (area.width - 420) / 2),
                y: Math.round(area.y + area.height - 140 - 48),
                width: 420,
                height: 140
            });
            win.show();
        });
        updateProgressWindow = win;
    }

    function closeProgress() {
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) updateProgressWindow.close();
        updateProgressWindow = null;
    }

    async function present(options) {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { response: options.cancelId != null ? options.cancelId : 1 };
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return dialog.showMessageBox(mainWindow, options);
    }

    setTimeout(() => {
        run().catch((error) => {
            logMessage(`micro-client update failed: ${error.message}`);
            closeProgress();
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'error',
                    title: '微端更新失败',
                    message: error.message || '更新下载失败，请稍后再试。',
                    buttons: ['确定']
                }).catch(() => {});
            }
        });
    }, 500);

    async function run() {
        const currentVersion = readScriptVersion(getScriptPath());
        logMessage(`micro-client update check started, script=${currentVersion}`);
        let manifest;
        try {
            manifest = await fetchJson(`${MANIFEST_URL}?t=${Date.now()}`);
        } catch (error) {
            logMessage(`micro-client manifest fetch failed, skip update check: ${error.message}`);
            return;
        }
        if (!isValidManifest(manifest) || compareVersions(manifest.version, currentVersion) <= 0) {
            logMessage('micro-client is up to date or manifest invalid');
            return;
        }
        const confirm = await present({
            type: 'info',
            title: '微端更新',
            message: `检测到新版本 ${manifest.version}，将更新微端与小抄，是否立即更新？`,
            detail: `当前小抄 ${currentVersion}`,
            buttons: ['立即更新', '暂不更新'],
            defaultId: 0,
            cancelId: 1
        });
        if (confirm.response !== 0) return;

        const updateDirectory = path.join(app.getPath('userData'), 'xiaochao-update');
        const archivePath = path.join(updateDirectory, `app-${manifest.version}.zip`);
        fs.mkdirSync(updateDirectory, { recursive: true });
        showProgress('正在下载更新，请保持微端运行…\n稍后将自动重启微端');
        const downloadUrl = new URL(manifest.appUrl);
        downloadUrl.searchParams.set('t', String(Date.now()));
        try {
            await downloadFile(downloadUrl.toString(), archivePath);
        } catch (error) {
            closeProgress();
            throw error;
        }
        if (sha256File(archivePath) !== manifest.appSha256) {
            fs.unlinkSync(archivePath);
            closeProgress();
            throw new Error('微端更新包校验失败');
        }

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
        closeProgress();
        await present({
            type: 'info',
            title: '需要管理员权限',
            message: '即将弹出 Windows 用户账户控制（UAC）窗口。',
            detail: '请点击「是」以完成微端更新。若点击「否」或关闭弹窗，更新将不会生效。',
            buttons: ['继续']
        });

        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherPath], {
            stdio: 'ignore',
            windowsHide: true
        });
        child.once('exit', (code) => {
            logMessage(`micro-client updater exited with code ${code}`);
            if (code === 0) {
                app.quit();
                return;
            }
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '更新未应用',
                    message: '管理员授权被取消，或更新器准备失败。微端将继续使用当前版本。',
                    buttons: ['确定']
                }).catch(() => {});
            }
        });
    }
}

module.exports = {
    scheduleMicroClientUpdate,
    fetchJson,
    compareVersions,
    isValidManifest,
    readScriptVersion
};
