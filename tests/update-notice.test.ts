import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConfigStore } from '../src/config/config-store.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import {
  compareVersions,
  createUpdateNoticeController,
  isNewerVersion,
  parseUpdateManifest,
  shouldPromptUpdateDialog
} from '../src/features/update-notice/index.ts';

function createMemoryStore() {
  let values = getDefaultConfig();
  return createConfigStore({
    read: () => values,
    write: (next) => {
      values = next;
    }
  }, undefined);
}

describe('小抄版本比较与清单', () => {
  it('按点分段比较，缺段当 0', () => {
    assert.equal(compareVersions('1.1.48', '1.1.47'), 1);
    assert.equal(compareVersions('1.1.47', '1.1.47'), 0);
    assert.equal(compareVersions('1.1', '1.1.0'), 0);
    assert.equal(isNewerVersion('1.2.0', '1.1.47'), true);
    assert.equal(isNewerVersion('1.1.46', '1.1.47'), false);
  });

  it('解析 version / scriptVersion，拒绝空号和非法说明页', () => {
    assert.equal(parseUpdateManifest(null), null);
    assert.equal(parseUpdateManifest({ notes: 'x' }), null);
    assert.deepEqual(parseUpdateManifest({
      scriptVersion: '1.1.48',
      changelog: '修了商店',
      url: 'https://95chong.cn/download'
    }), {
      version: '1.1.48',
      notes: '修了商店',
      pageUrl: 'https://95chong.cn/download'
    });
    assert.equal(
      parseUpdateManifest({ version: '1.0.0', pageUrl: 'javascript:alert(1)' })?.pageUrl,
      'https://xc.95chong.cn/downloads'
    );
  });

  it('同一远程号关闭弹窗后不再弹，换更大号再弹', () => {
    assert.equal(shouldPromptUpdateDialog('1.1.48', ''), true);
    assert.equal(shouldPromptUpdateDialog('1.1.48', '1.1.48'), false);
    assert.equal(shouldPromptUpdateDialog('1.1.49', '1.1.48'), true);
  });
});

describe('小抄更新检查', () => {
  it('手动检查到更新后打开下载页', async () => {
    const store = createMemoryStore();
    const opened: string[] = [];
    const controller = createUpdateNoticeController(
      store,
      async (url) => {
        opened.push(url);
      },
      {
        currentVersion: '1.1.47',
        manifestUrl: 'https://example.test/manifest.json',
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            version: '1.1.48',
            notes: '清单说明',
            pageUrl: 'https://95chong.cn/xiaochao'
          })
        }) as Response
      }
    );

    controller.start();
    assert.equal(controller.getSnapshot().hasUpdate, false);

    const snapshot = await controller.checkNow();
    assert.equal(snapshot.hasUpdate, true);
    assert.equal(snapshot.dialogOpen, false);
    assert.equal(snapshot.latestVersion, '1.1.48');
    assert.equal(snapshot.notes, '清单说明');

    await controller.openUpdatePage();
    assert.deepEqual(opened, ['https://95chong.cn/xiaochao']);
    controller.dispose();
  });

  it('当前已是最新或请求失败时没有更新', async () => {
    const store = createMemoryStore();
    const quiet = createUpdateNoticeController(store, async () => {}, {
      currentVersion: '1.1.47',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ version: '1.1.47' })
      }) as Response
    });
    const quietSnapshot = await quiet.checkNow();
    assert.equal(quietSnapshot.hasUpdate, false);
    assert.equal(quiet.getSnapshot().dialogOpen, false);
    quiet.dispose();

    const failed = createUpdateNoticeController(store, async () => {}, {
      currentVersion: '1.1.47',
      fetchImpl: async () => {
        throw new Error('network');
      }
    });
    const failedSnapshot = await failed.checkNow();
    assert.equal(failedSnapshot.hasUpdate, false);
    failed.dispose();
  });

  it('开发态跳过远程检查', async () => {
    const store = createMemoryStore();
    let fetched = 0;
    const controller = createUpdateNoticeController(store, async () => {}, {
      skipRemoteCheck: true,
      currentVersion: '1.1.47',
      fetchImpl: async () => {
        fetched += 1;
        return { ok: true, json: async () => ({ version: '9.9.9' }) } as Response;
      }
    });
    await controller.checkNow();
    assert.equal(fetched, 0);
    assert.equal(controller.getSnapshot().hasUpdate, false);
    controller.dispose();
  });
});
