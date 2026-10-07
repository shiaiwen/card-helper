/**
 * 配置仓库：Schema 校验后读写平台存储，并通知键级订阅者与 DOM 自定义事件。
 */

import {
  CONFIG_SCHEMA,
  getDefaultConfig,
  type XiaochaoConfig,
  type XiaochaoConfigKey
} from './config-schema.ts';
import type { ConfigStorage } from './config-storage.ts';

export const CONFIG_CHANGE_EVENT = 'xc:config-change';

export interface ConfigChangeDetail<Key extends XiaochaoConfigKey = XiaochaoConfigKey> {
  key: Key;
  value: XiaochaoConfig[Key];
  previousValue: XiaochaoConfig[Key];
}

type ConfigSubscriber<Key extends XiaochaoConfigKey> = (
  detail: ConfigChangeDetail<Key>
) => void;

export interface XiaochaoConfigStore {
  get<Key extends XiaochaoConfigKey>(key: Key): XiaochaoConfig[Key];
  set<Key extends XiaochaoConfigKey>(key: Key, value: XiaochaoConfig[Key]): void;
  reset<Key extends XiaochaoConfigKey>(key: Key): void;
  subscribe<Key extends XiaochaoConfigKey>(
    key: Key,
    subscriber: ConfigSubscriber<Key>
  ): () => void;
  snapshot(): XiaochaoConfig;
  resetAll(): void;
}

/** 配置仓库是业务层唯一读写入口，同时通知模块订阅者和 DOM 事件消费者。 */
export function createConfigStore(
  storage: ConfigStorage,
  eventTarget: EventTarget | undefined = typeof window === 'undefined' ? undefined : window
): XiaochaoConfigStore {
  let values = storage.read();
  const subscribers = new Map<XiaochaoConfigKey, Set<ConfigSubscriber<any>>>();

  function get<Key extends XiaochaoConfigKey>(key: Key): XiaochaoConfig[Key] {
    return values[key];
  }

  function set<Key extends XiaochaoConfigKey>(key: Key, value: XiaochaoConfig[Key]): void {
    const parsedValue = CONFIG_SCHEMA[key].parse(value) as XiaochaoConfig[Key] | undefined;
    if (parsedValue === undefined) throw new TypeError(`无效的小抄配置：${key}`);
    const previousValue = values[key];
    if (isSameValue(previousValue, parsedValue)) return;
    values = { ...values, [key]: parsedValue };
    storage.write(values);
    const detail = { key, value: parsedValue, previousValue } as ConfigChangeDetail<Key>;
    subscribers.get(key)?.forEach((subscriber) => subscriber(detail));
    if (eventTarget && typeof CustomEvent !== 'undefined') {
      eventTarget.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail }));
    }
  }

  function reset<Key extends XiaochaoConfigKey>(key: Key): void {
    set(key, CONFIG_SCHEMA[key].defaultValue as XiaochaoConfig[Key]);
  }

  function resetAll(): void {
    const previousValues = values;
    values = getDefaultConfig();
    storage.clear();
    storage.write(values);
    for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
      if (isSameValue(previousValues[key], values[key])) continue;
      const detail = {
        key,
        value: values[key],
        previousValue: previousValues[key]
      } as ConfigChangeDetail;
      subscribers.get(key)?.forEach((subscriber) => subscriber(detail));
      if (eventTarget && typeof CustomEvent !== 'undefined') {
        eventTarget.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail }));
      }
    }
  }

  function subscribe<Key extends XiaochaoConfigKey>(
    key: Key,
    subscriber: ConfigSubscriber<Key>
  ): () => void {
    const keySubscribers = subscribers.get(key) || new Set();
    keySubscribers.add(subscriber);
    subscribers.set(key, keySubscribers);
    return () => {
      keySubscribers.delete(subscriber);
      if (!keySubscribers.size) subscribers.delete(key);
    };
  }

  return {
    get,
    set,
    reset,
    subscribe,
    snapshot: () => structuredClone(values),
    resetAll
  };
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
