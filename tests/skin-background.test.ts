import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConfigStore } from '../src/config/config-store.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { createMethodPatcher } from '../src/runtime/method-patch.ts';
import {
  installOfficialBackgroundController,
  isBackgroundReport
} from '../src/features/skin-background/official-background-controller.ts';
import { ALL_SKIN_BACKGROUND_SETTINGS } from '../src/features/skin-background/skin-background-settings.ts';
import type { LayaObjectLocator } from '../src/adapters/laya-object-locator.ts';

type UnknownRecord = Record<string, unknown>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryConfigStore() {
  return createConfigStore({ read: () => getDefaultConfig(), write: () => undefined }, undefined);
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }
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

class FakeDispatcher {
  listeners: Array<[string, unknown, (data: unknown) => void]> = [];
  received: unknown[] = [];
  on(type: string, caller: unknown, listener: (data: unknown) => void) { this.listeners.push([type, caller, listener]); }
  off(type: string, caller: unknown, listener: unknown) {
    this.listeners = this.listeners.filter((item) => !(item[0] === type && item[1] === caller && item[2] === listener));
  }
  event(type: string, data: unknown) {
    this.received.push(data);
    this.listeners.filter(([name]) => name === type).forEach(([, , listener]) => listener(data));
  }
}

describe('皮肤与背景：设置项', () => {
  it('共 5 项，全局背景依赖皮肤做背景', () => {
    assert.equal(ALL_SKIN_BACKGROUND_SETTINGS.length, 5);
    const allPaper = ALL_SKIN_BACKGROUND_SETTINGS.find(({ key }) => key === 'skin.allPaper');
    assert.equal(allPaper?.visibleWhen, 'skin.skinPaper');
    const defaults = getDefaultConfig();
    assert.equal(defaults['skin.localSkin'], true);
    assert.equal(defaults['skin.otherLocalSkin'], false);
    assert.equal(defaults['skin.officialBackground'], true);
  });
});

describe('皮肤与背景：原型 getter 补丁', () => {
  it('原 getter 以访问实例为 this', () => {
    class Item {
      owned: boolean;
      constructor(owned: boolean) { this.owned = owned; }
      get canUsed() { return this.owned; }
    }
    const patcher = createMethodPatcher();
    let force = false;
    patcher.wrapGetter(Item.prototype, 'canUsed', (get) => () => force || get());
    assert.equal(new Item(true).canUsed, true);
    assert.equal(new Item(false).canUsed, false);
    force = true;
    assert.equal(new Item(false).canUsed, true);
    patcher.restoreAll();
    assert.equal(new Item(false).canUsed, false);
  });
});

describe('皮肤与背景：官方背景', () => {
  it('识别背景上报请求', () => {
    assert.equal(isBackgroundReport('https://x/sgs_ccon?a=1', 'k=GAME_BG_USEID'), true);
    assert.equal(isBackgroundReport('https://x/sgs_ccon', encodeURIComponent('GAME_BG_STRUCT=1')), true);
    assert.equal(isBackgroundReport('https://x/sgs_ccon', 'OTHER=1'), false);
    assert.equal(isBackgroundReport('https://x/other', 'GAME_BG_USEID'), false);
  });

  it('开启时拦截上报、保存选择并在下发背景 ID 时替换', async () => {
    const sent: unknown[] = [];
    class FakeXhr {
      open(_method: string, _url: string) { return undefined; }
      send(body: unknown) { sent.push(body); }
      abort() { return undefined; }
    }
    const dispatcher = new FakeDispatcher();
    const storage = memoryStorage({ LastUserName: 'tester' });
    const configStore = memoryConfigStore();
    const controller = installOfficialBackgroundController(configStore, {
      globalObject: { XMLHttpRequest: FakeXhr } as never,
      storage,
      locator: fakeLocator({
        dispatcher: () => dispatcher as unknown as UnknownRecord,
        scene: () => ({ topMenu: {} })
      })
    });
    await flush();

    const request = new FakeXhr();
    request.open('POST', 'https://x/sgs_ccon');
    request.send('GAME_BG_USEID=5');
    request.send('OTHER=1');
    assert.deepEqual(sent, ['OTHER=1']);

    dispatcher.event('SELECT_WALLPAPER', 7);
    assert.equal(JSON.parse(storage.data.get('tester::XC_OFFICIAL_BACKGROUND_CHOICE') ?? '{}').id, 7);

    dispatcher.event('BACKGROUND_USEDID_GOT', [3, '']);
    assert.deepEqual(dispatcher.received.at(-1), [7, '']);

    configStore.set('skin.officialBackground', false);
    request.send('GAME_BG_USEID=5');
    dispatcher.event('BACKGROUND_USEDID_GOT', [3, '']);
    assert.deepEqual(dispatcher.received.at(-1), [3, '']);
    assert.deepEqual(sent, ['OTHER=1', 'GAME_BG_USEID=5']);
    controller.dispose();
  });

  it('打开背景面板后去锁，点击锁定项直接使用并只写本地', async () => {
    const used: number[] = [];
    class WallItem {
      maskLock = { visible: true };
      tagLock = { visible: true };
      selectedImg = { visible: false };
      bg = { Gray: true };
      ID: number;
      constructor(id: number) { this.ID = id; }
      initUI() { this.maskLock.visible = true; }
      updateUI() { return undefined; }
      onSelectedClicked() { return 'locked'; }
      useWall() { used.push(this.ID); }
    }
    class UsedData {
      get IsCanUse() { return false; }
    }
    const items = [new WallItem(1), new WallItem(2)];
    items[0].selectedImg.visible = true;
    class WallPaperUI {
      tabGroup = { BtnList: [{}], SelectedValue: 0 };
      wallPaperItems = items;
      wallPaperSkinItems: unknown[] = [];
      usedData: unknown = null;
      initData() { this.usedData = new UsedData(); }
      onShowSkinitems() { return undefined; }
      RefreList() { return undefined; }
    }
    class TopMenu {
      wallPaperUI: WallPaperUI | null = null;
      onClickSkin() { this.wallPaperUI ??= new WallPaperUI(); }
    }
    const topMenu = new TopMenu();
    // scene().topMenu 指向自身以便复用对象。
    (topMenu as unknown as UnknownRecord).topMenu = topMenu;
    const storage = memoryStorage();
    const configStore = memoryConfigStore();
    const controller = installOfficialBackgroundController(configStore, {
      globalObject: { Laya: { Event: { CLICK: 'click', MOUSE_DOWN: 'down' } } } as never,
      storage,
      locator: fakeLocator({
        dispatcher: () => new FakeDispatcher() as unknown as UnknownRecord,
        scene: () => topMenu as unknown as UnknownRecord
      })
    });
    await flush();
    await flush();

    const menu = topMenu.wallPaperUI!;
    assert.ok(menu, '静默创建了背景面板');
    assert.equal((menu.usedData as UsedData).IsCanUse, true);
    items[1].initUI();
    assert.equal(items[1].maskLock.visible, false);
    assert.equal(items[1].bg.Gray, false);
    // 初次同步把当前选中的背景作为本地选择。
    assert.deepEqual(used, [1]);
    assert.equal(JSON.parse(storage.data.get('default::XC_OFFICIAL_BACKGROUND_CHOICE') ?? '{}').id, 1);

    assert.equal(items[1].onSelectedClicked(), undefined);
    assert.deepEqual(used, [1, 2]);
    assert.equal(JSON.parse(storage.data.get('default::XC_OFFICIAL_BACKGROUND_CHOICE') ?? '{}').id, 2);

    configStore.set('skin.officialBackground', false);
    assert.equal(items[1].onSelectedClicked(), 'locked');
    controller.dispose();
  });
});
