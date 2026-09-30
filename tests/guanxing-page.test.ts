import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUANXING_PAGE_URL, openGuanxingPage } from '../src/ui/legacy/prepare-legacy-tab-panes.ts';

describe('自助观星', () => {
  it('在新窗口打开观星页面', () => {
    const opened: Array<{ url: string; target?: string; features?: string }> = [];
    const previous = globalThis.window;
    globalThis.window = {
      open(url: string, target?: string, features?: string) {
        opened.push({ url, target, features });
        return null;
      }
    } as unknown as Window & typeof globalThis;
    try {
      openGuanxingPage();
    } finally {
      globalThis.window = previous;
    }
    assert.equal(GUANXING_PAGE_URL, 'https://gx.95chong.cn/');
    assert.deepEqual(opened, [{ url: GUANXING_PAGE_URL, target: '_blank', features: 'noopener' }]);
  });
});
