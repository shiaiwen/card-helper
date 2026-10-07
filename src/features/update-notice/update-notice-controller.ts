/**
 * 更新提示控制器：拉取远程 manifest，维护 hasUpdate / 弹窗状态，
 * 支持「稍后」记下已忽略版本，以及打开下载页。
 */

import type { XiaochaoConfigStore } from '../../config/config-store';
import {
  getXiaochaoVersion,
  isNewerVersion,
  parseUpdateManifest,
  XIAOCHAO_UPDATE_MANIFEST_URL,
  XIAOCHAO_UPDATE_PAGE_URL,
  type XiaochaoUpdateManifest
} from './update-manifest.ts';

export interface UpdateNoticeSnapshot {
  currentVersion: string;
  latestVersion: string | null;
  notes: string;
  pageUrl: string;
  hasUpdate: boolean;
  dialogOpen: boolean;
  failureMessage: string;
}

export interface UpdateNoticeController {
  getSnapshot(): UpdateNoticeSnapshot;
  subscribe(listener: (snapshot: UpdateNoticeSnapshot) => void): () => void;
  start(): void;
  checkNow(): Promise<UpdateNoticeSnapshot>;
  dismissDialog(): void;
  openUpdatePage(): Promise<void>;
  dispose(): void;
}

export interface UpdateNoticeControllerOptions {
  fetchImpl?: typeof fetch;
  currentVersion?: string;
  manifestUrl?: string;
  skipRemoteCheck?: boolean;
}

const DISMISSED_VERSION_KEY = 'update.dismissedVersion' as const;

function createEmptySnapshot(currentVersion: string): UpdateNoticeSnapshot {
  return {
    currentVersion,
    latestVersion: null,
    notes: '',
    pageUrl: XIAOCHAO_UPDATE_PAGE_URL,
    hasUpdate: false,
    dialogOpen: false,
    failureMessage: ''
  };
}

/** 创建更新提示控制器（不自动请求；由 install / checkNow 触发）。 */
export function createUpdateNoticeController(
  configStore: XiaochaoConfigStore,
  openExternal: (url: string) => Promise<void>,
  options: UpdateNoticeControllerOptions = {}
): UpdateNoticeController {
  const currentVersion = options.currentVersion || getXiaochaoVersion();
  const manifestUrl = options.manifestUrl || XIAOCHAO_UPDATE_MANIFEST_URL;
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  let snapshot = createEmptySnapshot(currentVersion);
  const listeners = new Set<(next: UpdateNoticeSnapshot) => void>();
  let disposed = false;

  function emit(next: UpdateNoticeSnapshot): void {
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  /** 「稍后」：记下 latestVersion 并关闭弹窗；角标仍由 hasUpdate 决定。 */
  function dismissDialog(): void {
    const latest = snapshot.latestVersion;
    if (latest) configStore.set(DISMISSED_VERSION_KEY, latest);
    if (snapshot.dialogOpen) emit({ ...snapshot, dialogOpen: false });
  }

  /** 用远程清单刷新快照（本轮不自动弹窗，dialogOpen=false）。 */
  function applyManifest(manifest: XiaochaoUpdateManifest): void {
    const hasUpdate = isNewerVersion(manifest.version, currentVersion);
    emit({
      currentVersion,
      latestVersion: manifest.version,
      notes: manifest.notes,
      pageUrl: manifest.pageUrl,
      hasUpdate,
      dialogOpen: false,
      failureMessage: ''
    });
  }

  /** 正式微端自己请求会被重置，优先让外壳用本机浏览器去取。 */
  async function checkRemote(): Promise<void> {
    const invoke = window.electron && window.electron.invoke;
    if (invoke) {
      try {
        const raw = await invoke('xiaochao-fetch-update-manifest');
        if (disposed) return;
        const manifest = parseUpdateManifest(raw);
        if (manifest) applyManifest(manifest);
        else emit({ ...snapshot, failureMessage: '检查失败' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '检查失败';
        emit({ ...snapshot, failureMessage: message || '检查失败' });
      }
      return;
    }
    if (!fetchImpl) return;
    try {
      const response = await fetchImpl(manifestUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
      if (disposed || !response.ok) return;
      const raw = await response.json();
      if (disposed) return;
      const manifest = parseUpdateManifest(raw);
      if (manifest) applyManifest(manifest);
    } catch (error) {
      console.warn('[检查更新] 拉取失败:', error);
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {},
    async checkNow() {
      if (disposed || options.skipRemoteCheck) return snapshot;
      await checkRemote();
      return snapshot;
    },
    dismissDialog() {
      dismissDialog();
    },
    async openUpdatePage() {
      const url = snapshot.pageUrl || XIAOCHAO_UPDATE_PAGE_URL;
      try {
        await openExternal(url);
      } catch {
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      }
      dismissDialog();
    },
    dispose() {
      disposed = true;
      listeners.clear();
    }
  };
}

/** 安装并 start 更新提示控制器，供工具 Tab 角标与弹窗使用。 */
export function installUpdateNoticeController(
  configStore: XiaochaoConfigStore,
  openExternal: (url: string) => Promise<void>,
  options: UpdateNoticeControllerOptions = {}
): UpdateNoticeController {
  const controller = createUpdateNoticeController(configStore, openExternal, options);
  controller.start();
  return controller;
}
