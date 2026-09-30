'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const reportWindowInteractionScript = `(() => {
    if (window.__XIAOCHAO_REPORT_INTERACTION__) return;
    window.__XIAOCHAO_REPORT_INTERACTION__ = true;
    const getTextSearchInput = (event) => {
        const target = event && event.target;
        return target && typeof target.matches === 'function'
            && target.matches('input[type="search"],input[type="text"]') ? target : null;
    };
    document.addEventListener('keydown', (event) => {
        const input = getTextSearchInput(event);
        if (!input || event.defaultPrevented || event.isComposing || event.key !== 'Enter') return;
        const scope = input.closest('form,.nav,.filters-bottom') || input.parentElement;
        const button = scope && scope.querySelector('button.primary,button[type="submit"],button:not(.secondary)');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        button.click();
    }, true);
})();`;

function decodeHtmlDataUrl(url) {
    const value = String(url || '');
    const commaIndex = value.indexOf(',');
    if (commaIndex < 0 || !/^data:text\/html(?:[;,]|$)/i.test(value.slice(0, commaIndex))) return '';

    const metadata = value.slice(0, commaIndex);
    const payload = value.slice(commaIndex + 1);
    return /;base64(?:;|$)/i.test(metadata)
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload);
}

function getReportKey(html) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
    return crypto.createHash('sha256').update(title || html).digest('hex').slice(0, 16);
}

function getReportWindowSize(workAreaSize) {
    const availableWidth = Number(workAreaSize?.width);
    const availableHeight = Number(workAreaSize?.height);
    return {
        width: Number.isFinite(availableWidth) && availableWidth > 0
            ? Math.max(640, Math.min(1400, availableWidth - 40))
            : 1200,
        height: Number.isFinite(availableHeight) && availableHeight > 0
            ? Math.max(480, Math.min(900, availableHeight - 40))
            : 800
    };
}

function parseReportActionUrl(url) {
    try {
        const parsed = new URL(String(url || ''));
        if (parsed.protocol !== 'xiaochao-report-action:') return null;
        return {
            action: parsed.hostname,
            params: Object.fromEntries(parsed.searchParams.entries())
        };
    } catch (error) {
        return null;
    }
}

function createHtmlReportOpener({ BrowserWindow, ipcMain, getUserDataPath, getWorkAreaSize, onAction, logger = console }) {
    const reportWindows = new Map();
    const reportActionContexts = new WeakMap();
    const reportWindowsByContents = new Map();
    const dispatchAction = (reportWindow, action) => {
        if (!action || typeof action.action !== 'string' || !action.params || typeof action.params !== 'object') return;
        try {
            const result = onAction?.(action, { ...reportActionContexts.get(reportWindow), reportWindow });
            if (result && typeof result.catch === 'function') {
                result.catch(error => logger.error('handle xc report action failed:', error));
            }
        } catch (error) {
            logger.error('handle xc report action failed:', error);
        }
    };
    const dispatchIpcAction = (event, url) => {
        const reportWindow = reportWindowsByContents.get(event.sender);
        if (!reportWindow || reportWindow.isDestroyed()) return false;
        const action = parseReportActionUrl(url);
        if (!action) return false;
        dispatchAction(reportWindow, action);
        return true;
    };
    if (typeof ipcMain?.handle === 'function') {
        ipcMain.handle('xiaochao-report-action', dispatchIpcAction);
    } else {
        ipcMain?.on('xiaochao-report-action', (event, action) => {
            event.returnValue = dispatchIpcAction(event, action);
        });
    }

    return async function openHtmlReport(url, actionContext = {}) {
        let reportWindow = null;
        let reportKey = '';
        try {
            const html = decodeHtmlDataUrl(url);
            if (!html) return false;

            reportKey = getReportKey(html);
            const reportDirectory = path.join(getUserDataPath(), 'xiaochao-reports');
            const reportPath = path.join(reportDirectory, `report-${reportKey}.html`);
            fs.mkdirSync(reportDirectory, { recursive: true });
            fs.writeFileSync(reportPath, html, 'utf8');

            reportWindow = reportWindows.get(reportKey);
            if (reportWindow?.isDestroyed()) {
                reportWindows.delete(reportKey);
                reportWindow = null;
            }

            if (!reportWindow) {
                reportWindow = new BrowserWindow({
                    ...getReportWindowSize(getWorkAreaSize?.()),
                    minWidth: 640,
                    minHeight: 480,
                    frame: true,
                    resizable: true,
                    minimizable: true,
                    maximizable: true,
                    show: false,
                    autoHideMenuBar: true,
                    webPreferences: {
                        preload: path.join(__dirname, 'report-preload.js'),
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true
                    }
                });
                reportWindows.set(reportKey, reportWindow);
                const reportContents = reportWindow.webContents;
                reportWindowsByContents.set(reportContents, reportWindow);
                reportWindow.on('closed', () => {
                    reportWindowsByContents.delete(reportContents);
                    if (reportWindows.get(reportKey) === reportWindow) reportWindows.delete(reportKey);
                });
                reportWindow.webContents?.on?.('will-navigate', (event, targetUrl) => {
                    const action = parseReportActionUrl(targetUrl);
                    if (!action) return;
                    event.preventDefault();
                    dispatchAction(reportWindow, action);
                });
            }
            reportActionContexts.set(reportWindow, actionContext);

            await reportWindow.loadFile(reportPath);
            if (reportWindow.isDestroyed()) return false;
            if (typeof reportWindow.webContents?.executeJavaScript === 'function') {
                await reportWindow.webContents.executeJavaScript(reportWindowInteractionScript);
            }
            reportWindow.show();
            reportWindow.focus();
            reportWindow.webContents?.focus?.();
            return true;
        } catch (error) {
            logger.error('open xc report window failed:', error);
            if (reportWindow && !reportWindow.isDestroyed()) reportWindow.destroy();
            if (reportKey && reportWindows.get(reportKey) === reportWindow) reportWindows.delete(reportKey);
            return false;
        }
    };
}

module.exports = {
    createHtmlReportOpener,
    decodeHtmlDataUrl,
    getReportWindowSize,
    parseReportActionUrl,
    reportWindowInteractionScript
};
