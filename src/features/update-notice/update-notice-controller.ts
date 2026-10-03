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
const FETCH_TIMEOUT_MS = 8000;

function createEmptySnapshot(currentVersion: string): UpdateNoticeSnapshot {
  return {
    currentVersion,
    latestVersion: null,
    notes: '',
    pageUrl: XIAOCHAO_UPDATE_PAGE_URL,
    hasUpdate: false,
    dialogOpen: false
  };
}

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
  let abortController: AbortController | null = null;

  function emit(next: UpdateNoticeSnapshot): void {
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  function dismissDialog(): void {
    const latest = snapshot.latestVersion;
    if (latest) configStore.set(DISMISSED_VERSION_KEY, latest);
    if (snapshot.dialogOpen) emit({ ...snapshot, dialogOpen: false });
  }

  function applyManifest(manifest: XiaochaoUpdateManifest): void {
    const hasUpdate = isNewerVersion(manifest.version, currentVersion);
    emit({
      currentVersion,
      latestVersion: manifest.version,
      notes: manifest.notes,
      pageUrl: manifest.pageUrl,
      hasUpdate,
      dialogOpen: false
    });
  }

  async function checkRemote(): Promise<void> {
    if (!fetchImpl) return;
    abortController?.abort();
    abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => abortController?.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(manifestUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: abortController?.signal
      });
      if (disposed || !response.ok) return;
      const raw = await response.json();
      if (disposed) return;
      const manifest = parseUpdateManifest(raw);
      if (manifest) applyManifest(manifest);
    } catch {
      // 网络失败、超时、跨域被拒都不打扰对局。
    } finally {
      clearTimeout(timer);
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
      abortController?.abort();
      listeners.clear();
    }
  };
}

export function installUpdateNoticeController(
  configStore: XiaochaoConfigStore,
  openExternal: (url: string) => Promise<void>,
  options: UpdateNoticeControllerOptions = {}
): UpdateNoticeController {
  const controller = createUpdateNoticeController(configStore, openExternal, options);
  controller.start();
  return controller;
}
