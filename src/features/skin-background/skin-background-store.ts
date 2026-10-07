/**
 * 皮肤背景收藏与选项持久化存储。
 */

import { accountStorageKey, readJson, writeJson } from './skin-runtime.ts';

/** type：0 静态图，1 视频（不支持做背景），2 骨骼 .sk，3 新版 Spine，4 旧版 Spine。 */
export interface BackgroundResource {
  url: string;
  type: number;
  width: number;
  height: number;
}

/** 「小抄背景」收藏项。 */
export interface BackgroundFavorite {
  id: string;
  skinId: string;
  generalId: number;
  state: number;
  name: string;
  generalName: string;
  previewUrl: string;
  resource: BackgroundResource;
  savedAt: number;
}

type BackgroundStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RESOURCE_SUFFIX = '::paperRes';
const FAVORITES_SUFFIX = '::XC_SKIN_BACKGROUND_FAVORITES';

/** 当前皮肤背景与收藏按账号持久化，键为 `<userID>::paperRes` 与 `::XC_SKIN_BACKGROUND_FAVORITES`。 */
export interface SkinBackgroundStore {
  loadResource(): Partial<BackgroundResource>;
  saveResource(resource: BackgroundResource): void;
  clearResource(): void;
  favorites(): BackgroundFavorite[];
  isFavorite(id: string): boolean;
  /** 已存在的同 id 收藏会被移到最前。 */
  addFavorite(favorite: BackgroundFavorite): boolean;
  removeFavorite(id: string): boolean;
  /** 收藏列表变化时回调，返回取消订阅函数。 */
  onFavoritesChange(listener: () => void): () => void;
}

/** 把收藏记录收成统一字段。 */
export function normalizeFavorite(value: unknown): BackgroundFavorite | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const resource = record?.resource && typeof record.resource === 'object' ? record.resource as Record<string, unknown> : null;
  if (!record?.id || !resource?.url) return null;
  const type = Number(resource.type);
  const width = Number(resource.width);
  const height = Number(resource.height);
  if (!Number.isFinite(type) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    id: String(record.id),
    skinId: String(record.skinId || ''),
    generalId: Number(record.generalId) || 0,
    state: Number(record.state) || 0,
    name: String(record.name || '三国杀皮肤'),
    generalName: String(record.generalName || ''),
    previewUrl: String(record.previewUrl || ''),
    resource: { url: String(resource.url), type, width, height },
    savedAt: Number(record.savedAt) || 0
  };
}

/** 创建皮肤背景收藏仓库。 */
export function createSkinBackgroundStore(storage: BackgroundStorage | undefined): SkinBackgroundStore {
  const resourceKey = () => `${accountStorageKey(storage)}${RESOURCE_SUFFIX}`;
  const favoritesKey = () => `${accountStorageKey(storage)}${FAVORITES_SUFFIX}`;
  const listeners = new Set<() => void>();

  function favorites(): BackgroundFavorite[] {
    const raw = readJson<unknown>(storage, favoritesKey(), []);
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: unknown[] }).items : [];
    const seen = new Set<string>();
    return list.map(normalizeFavorite).filter((item): item is BackgroundFavorite => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  function saveFavorites(list: BackgroundFavorite[]): void {
    writeJson(storage, favoritesKey(), list);
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.warn('[皮肤做背景] 收藏刷新失败:', error);
      }
    });
  }

  return {
    loadResource() {
      const value = readJson<Partial<BackgroundResource>>(storage, resourceKey(), {});
      return value && typeof value === 'object' ? value : {};
    },
    saveResource(resource) {
      writeJson(storage, resourceKey(), resource);
    },
    clearResource() {
      try {
        storage?.removeItem(resourceKey());
      } catch {
        // 忽略存储异常。
      }
    },
    favorites,
    isFavorite: (id) => Boolean(id) && favorites().some((item) => item.id === id),
    addFavorite(favorite) {
      const normalized = normalizeFavorite(favorite);
      if (!normalized) return false;
      saveFavorites([normalized, ...favorites().filter((item) => item.id !== normalized.id)]);
      return true;
    },
    removeFavorite(id) {
      const list = favorites();
      const next = list.filter((item) => item.id !== id);
      if (next.length === list.length) return false;
      saveFavorites(next);
      return true;
    },
    onFavoritesChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
