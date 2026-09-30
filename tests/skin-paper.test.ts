import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConfigStore } from '../src/config/config-store.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { installSkinChangeController } from '../src/features/skin-background/skin-change-controller.ts';
import { installSkinPaperController } from '../src/features/skin-background/skin-paper-controller.ts';
import { createSkinBackgroundStore } from '../src/features/skin-background/skin-background-store.ts';
import type { LayaObjectLocator, LayaRuntimeWindow } from '../src/adapters/laya-object-locator.ts';

type UnknownRecord = Record<string, unknown>;

const flush = async (times = 5) => {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function memoryConfigStore() {
  return createConfigStore({ read: () => getDefaultConfig(), write: () => undefined }, undefined);
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); }
  };
}

function fakeLocator(overrides: Partial<LayaObjectLocator>): LayaObjectLocator {
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
    obfuscatedMethodName: () => null,
    createInstance: () => null,
    layer: () => null,
    ...overrides
  };
}

class FakeSprite {
  children: FakeSprite[] = [];
  _parent: FakeSprite | null = null;
  visible = true;
  destroyed = false;
  url = '';
  get numChildren() { return this.children.length; }
  addChild(child: FakeSprite) {
    child.removeSelf();
    child._parent = this;
    this.children.push(child);
    return child;
  }
  removeChildAt(index: number) {
    const [child] = this.children.splice(index, 1);
    if (child) child._parent = null;
    return child;
  }
  removeSelf() {
    if (!this._parent) return this;
    const siblings = this._parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this._parent = null;
    return this;
  }
  destroy() {
    this.removeSelf();
    this.destroyed = true;
  }
  pos() {}
  scale() {}
  size() {}
  on() {}
  off() {}
  once() {}
  loadImage(url: string) { this.url = url; }
}

class FakeSpineEffect extends FakeSprite {
  action = '';
  InitEffect(url: string, action: string) {
    this.url = url;
    this.action = action;
  }
  playEffect() {}
}

describe('皮肤与背景：收藏存储', () => {
  it('按账号保存，重复收藏置顶，非法记录被过滤，变化时通知', () => {
    const storage = memoryStorage({ LastUserName: 'tester' });
    const store = createSkinBackgroundStore(storage);
    let changes = 0;
    store.onFavoritesChange(() => { changes += 1; });
    const resource = { url: 'a.png', type: 0, width: 594, height: 335 };
    const base = { skinId: '1', generalId: 1, state: 0, name: '甲', generalName: '', previewUrl: '', savedAt: 1 };
    assert.equal(store.addFavorite({ ...base, id: 'a', resource }), true);
    assert.equal(store.addFavorite({ ...base, id: 'b', resource }), true);
    assert.equal(store.addFavorite({ ...base, id: 'a', resource }), true);
    assert.deepEqual(store.favorites().map((item) => item.id), ['a', 'b']);
    assert.ok(storage.data.has('tester::XC_SKIN_BACKGROUND_FAVORITES'));
    assert.equal(store.addFavorite({ ...base, id: 'bad', resource: { ...resource, width: 0 } }), false);
    assert.equal(store.removeFavorite('a'), true);
    assert.equal(store.isFavorite('a'), false);
    assert.equal(changes, 4);
  });
});

describe('皮肤与背景：本地换肤', () => {
  it('开局下发自己武将皮肤时替换为本地保存的选择', () => {
    const storage = memoryStorage({ 'XC::localSkins': JSON.stringify({ 101: { skinID: 7, isDynamic: false } }) });
    const seat = { generalIds: [101, 102], SetGeneralSkin() {} };
    const controller = installSkinChangeController(memoryConfigStore(), {
      globalObject: {} as LayaRuntimeWindow,
      storage,
      locator: fakeLocator({ gameScene: () => ({ SelfSeatUi: { seat } }) })
    });
    const payload = {
      GeneralSkinList: [
        { GeneralID: 101, SkinID: 0, state: 0 },
        { GeneralID: 102, SkinID: 3, state: 0 },
        { GeneralID: 200, SkinID: 3, state: 0 }
      ]
    };
    controller.filterMessage(payload, 'ClientGeneralSkinRep');
    controller.dispose();
    assert.deepEqual(payload.GeneralSkinList, [
      { GeneralID: 101, SkinID: 7, state: 0 },
      { GeneralID: 102, SkinID: 3, state: 1 },
      { GeneralID: 200, SkinID: 3, state: 0 }
    ]);
  });
});

describe('皮肤与背景：皮肤做背景', () => {
  function setup() {
    const storage = memoryStorage({
      LastUserName: 'tester',
      'tester::paperRes': JSON.stringify({ url: 'res/skin', type: 3, width: 594, height: 335 })
    });
    const layer = new FakeSprite();
    const stage = new FakeSprite();
    const globalObject = { Laya: { Sprite: FakeSprite, Event: { RESIZE: 'resize', STOPPED: 'stopped' }, stage } } as unknown as LayaRuntimeWindow;
    const configStore = memoryConfigStore();
    let menuSyncs = 0;
    const controller = installSkinPaperController(configStore, {
      globalObject,
      storage,
      selfSeatId: () => 2,
      syncWallpaperMenu: () => { menuSyncs += 1; },
      locator: fakeLocator({
        dispatcher: () => ({}),
        scene: () => ({ SceneName: 'GameScene' }),
        gameScene: () => ({ SelfSeatUi: { getEffectType: () => new FakeSpineEffect() } }),
        layer: (name) => (name === 'BackgroundLayer' ? layer : null)
      })
    });
    return { controller, configStore, layer, menuSyncs: () => menuSyncs };
  }

  it('牌局中恢复保存的动态背景，自己出杀时播放攻击动作', async () => {
    const { controller, layer } = setup();
    await flush();
    const container = layer.children[0] as FakeSprite;
    assert.ok(container, '背景容器已加到 BackgroundLayer');
    assert.deepEqual(container.children.map((child) => child.url), [
      'res/skin/beijing.json', 'res/skin/daiji.json', 'res/skin/qianjing.json'
    ]);

    controller.filterMessage({ SeatID: 3, useType: 1, spellID: 1 }, 'PubGsCUseCard');
    assert.equal(container.children.length, 3, '他人出杀不播放');
    controller.filterMessage({ SeatID: 2, useType: 1, spellID: 1, isSend: false }, 'PubGsCUseCard');
    const actions = container.children.slice(3) as FakeSpineEffect[];
    assert.deepEqual(actions.map((effect) => [effect.url, effect.action]), [
      ['res/skin/xingxiang.json', 'GongJi'],
      ['res/skin/qianjing.json', 'GongJi']
    ]);
    controller.dispose();
  });

  it('关闭开关后移除背景并同步背景面板', async () => {
    const { controller, configStore, layer, menuSyncs } = setup();
    await flush();
    assert.equal(layer.children.length, 1);
    configStore.set('skin.skinPaper', false);
    await flush();
    assert.equal(layer.children.length, 0);
    assert.equal(menuSyncs(), 1);
    assert.equal(controller.menuExtension.enabled(), false);
    controller.dispose();
  });
});
