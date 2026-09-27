import type { PlatformAdapter } from '../adapters/platform';
import {
  CONFIG_DOCUMENT_VERSION,
  CONFIG_SCHEMA,
  CONFIG_STORAGE_KEY,
  getDefaultConfig,
  type XiaochaoConfig,
  type XiaochaoConfigKey
} from './config-schema.ts';

interface StoredConfigDocument {
  version: number;
  values: Partial<XiaochaoConfig>;
}

export interface ConfigStorage {
  read(): XiaochaoConfig;
  write(config: XiaochaoConfig): void;
}

/** 使用平台设置 API 持久化，并负责损坏数据回退和旧版独立键迁移。 */
export function createPlatformConfigStorage(platform: PlatformAdapter): ConfigStorage {
  return {
    read() {
      const defaults = getDefaultConfig();
      const document = parseStoredDocument(platform.getSetting(CONFIG_STORAGE_KEY));
      const source = document?.values || {};
      let shouldPersist = !document || document.version !== CONFIG_DOCUMENT_VERSION;

      for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
        const definition = CONFIG_SCHEMA[key];
        let candidate: unknown = source[key];
        if (candidate === undefined && definition.legacyStorageKey) {
          candidate = parseLegacyValue(platform.getSetting(definition.legacyStorageKey));
          if (candidate !== undefined) shouldPersist = true;
        }
        const parsed = definition.parse(candidate);
        if (parsed !== undefined) (defaults as any)[key] = parsed;
        else if (candidate !== undefined) shouldPersist = true;
      }

      if (shouldPersist) this.write(defaults);
      return defaults;
    },
    write(config) {
      const document: StoredConfigDocument = {
        version: CONFIG_DOCUMENT_VERSION,
        values: config
      };
      platform.setSetting(CONFIG_STORAGE_KEY, JSON.stringify(document));
    }
  };
}

function parseStoredDocument(rawValue: string | null): StoredConfigDocument | undefined {
  if (!rawValue) return undefined;
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || !parsed.values || typeof parsed.values !== 'object') {
      return undefined;
    }
    return {
      version: Number(parsed.version) || 0,
      values: parsed.values
    };
  } catch {
    return undefined;
  }
}

function parseLegacyValue(rawValue: string | null): unknown {
  if (rawValue === null) return undefined;
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}
