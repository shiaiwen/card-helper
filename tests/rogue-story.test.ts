import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { createConfigStore } from '../src/config/config-store.ts';
import type { LayaObjectLocator } from '../src/adapters/laya-object-locator.ts';
import { installRogueStoryController } from '../src/features/rogue/rogue-story-controller.ts';
import { ROGUE_HIDE_STORY_KEY } from '../src/features/rogue/rogue-settings.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createStore(hideStory = true) {
  const values = { ...getDefaultConfig(), [ROGUE_HIDE_STORY_KEY]: hideStory };
  return createConfigStore({
    read: () => ({ ...values }),
    write: (next) => {
      Object.assign(values, next);
    }
  }, undefined);
}

function fakeLocator(overrides: Partial<LayaObjectLocator> = {}): LayaObjectLocator {
  return {
    manager: () => null,
    dispatcher: () => null,
    scene: () => null,
    gameScene: () => null,
    gameContext: () => null,
    baseEffectPrototype: () => null,
    classPrototype: () => null,
    window: () => null,
    findWindows: () => [],
    findInLayer: () => [],
    managerFromList: () => null,
    obfuscatedMethodName: () => 'ShowWindow',
    createInstance: () => null,
    layer: () => null,
    ...overrides
  };
}

describe('隐藏对白', () => {
  it('开关开启时 ShowWindow(RogueChapterStoryWindow) 会立刻 Close 返回实例', async () => {
    const store = createStore(true);
    let closed = 0;
    const storyWin = {
      Close() {
        closed += 1;
      }
    };
    const dispatcher: Record<string, unknown> = {
      ShowWindow(name: string) {
        return name === 'RogueChapterStoryWindow' ? storyWin : null;
      }
    };
    const controller = installRogueStoryController(store, {
      globalObject: {
        setTimeout,
        clearTimeout
      } as never,
      locator: fakeLocator({
        dispatcher: () => dispatcher
      })
    });

    try {
      const result = (dispatcher.ShowWindow as Function)('RogueChapterStoryWindow');
      assert.equal(result, storyWin);
      assert.equal(closed, 1);
      await flush();
      assert.ok(closed >= 1);
    } finally {
      controller.dispose();
    }
  });

  it('开关关闭时不关闭对白窗', () => {
    const store = createStore(false);
    let closed = 0;
    const storyWin = {
      Close() {
        closed += 1;
      }
    };
    const dispatcher: Record<string, unknown> = {
      ShowWindow() {
        return storyWin;
      }
    };
    const controller = installRogueStoryController(store, {
      globalObject: {
        setTimeout,
        clearTimeout
      } as never,
      locator: fakeLocator({
        dispatcher: () => dispatcher
      })
    });

    try {
      (dispatcher.ShowWindow as Function)('RogueChapterStoryWindow');
      assert.equal(closed, 0);
    } finally {
      controller.dispose();
    }
  });

  it('中途打开开关会关掉已存在的对白窗', async () => {
    const store = createStore(false);
    let closed = 0;
    const storyWin = {
      Close() {
        closed += 1;
      }
    };
    const controller = installRogueStoryController(store, {
      globalObject: {
        setTimeout,
        clearTimeout
      } as never,
      locator: fakeLocator({
        dispatcher: () => ({
          ShowWindow() {
            return storyWin;
          }
        }),
        window: () => storyWin,
        findWindows: () => [storyWin]
      })
    });

    try {
      assert.equal(closed, 0);
      store.set(ROGUE_HIDE_STORY_KEY, true);
      await flush();
      assert.equal(closed, 1);
    } finally {
      controller.dispose();
    }
  });

  it('自检窗名在开关开启时也会被 Close', () => {
    const store = createStore(true);
    const dispatcher: Record<string, unknown> = {
      ShowWindow() {
        throw new Error('不应走到原 ShowWindow');
      }
    };
    const controller = installRogueStoryController(store, {
      globalObject: {
        setTimeout,
        clearTimeout
      } as never,
      locator: fakeLocator({
        dispatcher: () => dispatcher
      })
    });

    try {
      const result = (dispatcher.ShowWindow as Function)('__XIAOCHAO_STORY_PROBE__') as {
        destroyed?: boolean;
        __probeClosed?: boolean;
      };
      assert.equal(result.destroyed, true);
      assert.equal(result.__probeClosed, true);
    } finally {
      controller.dispose();
    }
  });
});
