import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlatformAdapter } from '../src/adapters/platform.ts';
import { CONFIG_STORAGE_KEY } from '../src/config/config-schema.ts';
import { createPlatformConfigStorage } from '../src/config/config-storage.ts';
import { createConfigStore } from '../src/config/config-store.ts';

function createMemoryPlatform(initialValues: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialValues));
  const platform: PlatformAdapter = {
    platform: 'electron',
    openExternal: async () => {},
    getSetting: (key) => values.get(key) ?? null,
    setSetting: (key, value) => values.set(key, value)
  };
  return { platform, values };
}

test('migrates legacy panel settings into the versioned config document', () => {
  const { platform, values } = createMemoryPlatform({
    'XC::mainPanelActiveTab': '工具',
    'XC::mainPanelCollapsed': 'true',
    'XC::mainPanelDockedRight': 'false',
    'XC::mainPanelPosition': JSON.stringify({ left: 120, top: 48 }),
    'CARD_LABEL_SWITCH': 'false'
  });
  const store = createConfigStore(createPlatformConfigStorage(platform), undefined);

  assert.equal(store.get('panel.activeTab'), 'tools');
  assert.equal(store.get('panel.collapsed'), true);
  assert.deepEqual(store.get('panel.position'), { left: 120, top: 48 });
  assert.equal(store.get('display.cardLabelsEnabled'), false);
  const persisted = JSON.parse(values.get(CONFIG_STORAGE_KEY) || '{}');
  assert.equal(persisted.version, 1);
  assert.equal(persisted.values['panel.activeTab'], 'tools');
});

test('recovers from damaged storage and rejects invalid config values', () => {
  const { platform, values } = createMemoryPlatform({ [CONFIG_STORAGE_KEY]: '{broken' });
  const store = createConfigStore(createPlatformConfigStorage(platform), undefined);

  assert.equal(store.get('panel.activeTab'), 'settings');
  assert.equal(store.get('display.cardLabelsEnabled'), true);
  assert.doesNotThrow(() => JSON.parse(values.get(CONFIG_STORAGE_KEY) || ''));
  assert.throws(
    () => store.set('panel.activeTab', 'unknown' as any),
    /无效的小抄配置/
  );
});

test('persists changes and notifies only subscribers of the changed key', () => {
  const { platform } = createMemoryPlatform();
  const store = createConfigStore(createPlatformConfigStorage(platform), undefined);
  const received: unknown[] = [];
  const unsubscribe = store.subscribe('panel.collapsed', (detail) => received.push(detail));

  store.set('panel.collapsed', true);
  store.set('panel.collapsed', true);
  unsubscribe();
  store.set('panel.collapsed', false);

  assert.deepEqual(received, [{
    key: 'panel.collapsed',
    value: true,
    previousValue: false
  }]);
});
