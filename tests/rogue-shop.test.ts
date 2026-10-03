import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRogueShopPreviewItems,
  hasRogueShopSyncFlag,
  installRogueShopController,
  readShopData,
  resolveRogueLikeSyncBody,
  ROGUE_SHOP_DATA_REQ_MARK,
  ROGUE_SHOP_WINDOW
} from '../src/features/rogue/rogue-shop-controller.ts';
import type { LayaObjectLocator } from '../src/adapters/laya-object-locator.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

test('集市透视：无商品或无法解析时返回空列表', () => {
  assert.deepEqual(buildRogueShopPreviewItems([], {}), []);
  assert.deepEqual(buildRogueShopPreviewItems([101, 202], {}), []);
  assert.deepEqual(buildRogueShopPreviewItems(null, null), []);
});

test('集市透视：按 Rplot 解析名称、铜价、类型标题与等级', () => {
  const items = buildRogueShopPreviewItems(
    [11, 22, 33],
    {
      11: { name: '铁索连环', money: 120, type: 4, level: 2, desc: '横置目标' },
      22: { name: '奸雄', money: '', type: 3, level: 1, desc: '受到伤害摸牌' },
      33: { name: '未知商品', type: 9, level: 0 }
    }
  );
  assert.equal(items.length, 3);
  assert.equal(items[0]?.label, '铁索连环 120铜');
  assert.equal(items[0]?.title, '手牌横置目标');
  assert.equal(items[0]?.level, 2);
  assert.equal(items[1]?.label, '奸雄');
  assert.equal(items[1]?.title, '技能受到伤害摸牌');
  assert.equal(items[2]?.label, '未知商品');
  assert.equal(items[2]?.title, '');
});

test('集市透视：等级限制在 1~4，供四档配色区分', () => {
  const items = buildRogueShopPreviewItems(
    [1, 2, 3, 4, 5],
    {
      1: { name: '普通', level: 1 },
      2: { name: '稀有', level: 2 },
      3: { name: '史诗', level: 3 },
      4: { name: '传说', level: 4 },
      5: { name: '异常', level: 9 }
    }
  );
  assert.deepEqual(items.map((item) => item.level), [1, 2, 3, 4, 0]);
});

test('集市透视：部分 id 能解析时只展示能解析的商品', () => {
  const items = buildRogueShopPreviewItems(
    [1, 999],
    { 1: { name: '桃', money: 50, type: 4, level: 1, desc: '回复体力' } }
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.label, '桃 50铜');
  assert.equal(items[0]?.title, '手牌回复体力');
  assert.equal(items[0]?.level, 1);
});

test('集市同步标志：dataMark bit4 对照 app.bak 翻转', () => {
  assert.equal(hasRogueShopSyncFlag({ dataMark: 0 }), false);
  assert.equal(hasRogueShopSyncFlag({ dataMark: 1 << 4 }), true);
  assert.equal(hasRogueShopSyncFlag({ dataMark: (1 << 4) | 1 }), true);
  assert.equal(hasRogueShopSyncFlag({ DataMark: 16 }), true);
  assert.equal(hasRogueShopSyncFlag({}), false);
});

test('现网包络：ProtoObj 内 allData/dataMark/shopData 可解出', () => {
  const shopData = { bShow: false, itemId: [9] };
  const envelope = {
    ClassName: 'decodeRogueLikeDataSync',
    ProtoObj: {
      dataMark: 1 << 4,
      allData: { shopData, chapterData: { locations: [] } }
    }
  };
  assert.equal(resolveRogueLikeSyncBody(envelope), envelope.ProtoObj);
  assert.equal(hasRogueShopSyncFlag(envelope), true);
  assert.equal(readShopData(envelope), shopData);
});

test('同步包 bit4 + shopData：强制 bShow 并刷新透视列表', () => {
  const shopData = { bShow: false, itemId: [7] };
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator(),
    cardConfigSource: {
      getRogueMapData: () => ({
        Rplot: { 7: { name: '无中', money: 80, type: 4, level: 2, desc: '杀或闪' } }
      }) as never
    }
  });

  try {
    controller.filterMessage({
      dataMark: 1 << 4,
      allData: { shopData }
    }, 'decodeRogueLikeDataSync');
    assert.equal(shopData.bShow, true);
    const preview = controller.getPreview();
    assert.equal(preview.length, 1);
    assert.equal(preview[0]?.label, '无中 80铜');
  } finally {
    controller.dispose();
  }
});

test('现网 ProtoObj 包络：filterMessage 仍强制 bShow 并刷新透视', () => {
  const shopData = { bShow: false, itemId: [7] };
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator(),
    cardConfigSource: {
      getRogueMapData: () => ({
        Rplot: { 7: { name: '无中', money: 80, type: 4, level: 2, desc: '杀或闪' } }
      }) as never
    }
  });

  try {
    controller.filterMessage({
      ClassName: 'decodeRogueLikeDataSync',
      ProtoObj: {
        dataMark: 1 << 4,
        allData: { shopData }
      }
    }, 'decodeRogueLikeDataSync');
    assert.equal(shopData.bShow, true);
    assert.equal(controller.getPreview()[0]?.label, '无中 80铜');
  } finally {
    controller.dispose();
  }
});

test('同步包 bit4 但无 shopData：请求 RogueLikeDataReq，不误伤其他字段', () => {
  const reqMarks: number[] = [];
  const manager = {
    RogueLikeDataReq(mark: number) {
      reqMarks.push(mark);
    }
  };
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator({
      manager: (name) => (name === 'RogueLikePveManager' ? manager : null)
    })
  });

  try {
    const payload = { dataMark: 1 << 4, allData: { chapterData: { locations: [] } } };
    controller.filterMessage(payload, 'decodeRogueLikeDataSync');
    assert.deepEqual(reqMarks, [ROGUE_SHOP_DATA_REQ_MARK]);
    // 重复同步不会重复请求
    controller.filterMessage(payload, 'decodeRogueLikeDataSync');
    assert.deepEqual(reqMarks, [ROGUE_SHOP_DATA_REQ_MARK]);
  } finally {
    controller.dispose();
  }
});

test('ProtoObj bit4 无 shopData：同样会 RogueLikeDataReq', () => {
  const reqMarks: number[] = [];
  const manager = {
    RogueLikeDataReq(mark: number) {
      reqMarks.push(mark);
    }
  };
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator({
      manager: (name) => (name === 'RogueLikePveManager' ? manager : null)
    })
  });

  try {
    controller.filterMessage({
      ClassName: 'decodeRogueLikeDataSync',
      ProtoObj: { dataMark: 1 << 4, allData: { chapterData: {} } }
    }, 'decodeRogueLikeDataSync');
    assert.deepEqual(reqMarks, [ROGUE_SHOP_DATA_REQ_MARK]);
  } finally {
    controller.dispose();
  }
});

test('无 bit4 的 shopData：只刷新透视，不强制改 bShow', () => {
  const shopData = { bShow: false, itemId: [3] };
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator(),
    cardConfigSource: {
      getRogueMapData: () => ({
        Rplot: { 3: { name: '杀', money: 30, type: 4, level: 1, desc: '' } }
      }) as never
    }
  });

  try {
    controller.filterMessage({
      dataMark: 0,
      allData: { shopData }
    }, 'decodeRogueLikeDataSync');
    assert.equal(shopData.bShow, false);
    assert.equal(controller.getPreview()[0]?.label, '杀 30铜');
  } finally {
    controller.dispose();
  }
});

test('Rplot 晚于同步包：先空列表，配置就绪后补刷透视', async () => {
  let rplot: Record<string, { name: string; money: number; type: number; level: number; desc: string }> | null = null;
  const shopData = { bShow: true, itemId: [5] };
  const updates: number[] = [];
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator(),
    cardConfigSource: {
      getRogueMapData: () => (rplot ? { Rplot: rplot } : null) as never
    }
  });

  try {
    controller.subscribePreview((items) => updates.push(items.length));
    controller.filterMessage({
      ClassName: 'decodeRogueLikeDataSync',
      ProtoObj: { dataMark: 1 << 4, allData: { shopData } }
    }, 'decodeRogueLikeDataSync');
    assert.equal(controller.getPreview().length, 0);

    rplot = { 5: { name: '闪', money: 40, type: 4, level: 1, desc: '' } };
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(controller.getPreview().length, 1);
    assert.equal(controller.getPreview()[0]?.label, '闪 40铜');
    assert.ok(updates.includes(0));
    assert.ok(updates.includes(1));
  } finally {
    controller.dispose();
  }
});

test('打开集市时管理器没有商品 id，已有透视列表保留', () => {
  const shopData = { bShow: false, itemId: [] as number[] };
  const dispatcher = { ShowWindow() {} };
  const rplot = { 9: { name: '杀', money: 10, type: 4, level: 1, desc: '' } };
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator({
      manager: (name) => (name === 'RogueLikePveManager' ? { allData: { shopData } } : null),
      dispatcher: () => dispatcher
    }),
    cardConfigSource: { getRogueMapData: () => ({ Rplot: rplot }) as never }
  });

  try {
    controller.filterMessage({
      ClassName: 'decodeRogueLikeDataSync',
      ProtoObj: { shopData: { bShow: true, itemId: [9] } }
    }, 'decodeRogueLikeDataSync');
    assert.equal(controller.getPreview().length, 1);
    assert.equal(controller.openShop(), true);
    assert.equal(controller.getPreview().length, 1);
    assert.equal(controller.getPreview()[0]?.label, '杀 10铜');
  } finally {
    controller.dispose();
  }
});

test('打开集市：对管理器缓存启用透视并 ShowWindow', () => {
  const shown: string[] = [];
  const shopData = { bShow: false, itemId: [] as number[] };
  const manager = { allData: { shopData } };
  const dispatcher = {
    ShowWindow(name: string) {
      shown.push(name);
    }
  };
  const controller = installRogueShopController({
    globalObject: { setTimeout, clearTimeout } as never,
    locator: fakeLocator({
      manager: (name) => (name === 'RogueLikePveManager' ? manager : null),
      dispatcher: () => dispatcher
    })
  });

  try {
    assert.equal(controller.openShop(), true);
    assert.equal(shopData.bShow, true);
    assert.deepEqual(shown, [ROGUE_SHOP_WINDOW]);
  } finally {
    controller.dispose();
  }
});

test('提前显示集市且原 bShow=false：购买成功提示改写', async () => {
  const prompts: string[] = [];
  const shopData = { bShow: false, itemId: [] as number[] };
  const context = {
    ShowTextPrompt(message: string) {
      prompts.push(String(message));
    }
  };
  const controller = installRogueShopController({
    globalObject: {
      setTimeout,
      clearTimeout,
      GameContext: context
    } as never,
    locator: fakeLocator({
      gameContext: () => context,
      window: (name) => (name === ROGUE_SHOP_WINDOW ? { name } : null)
    })
  });

  try {
    controller.filterMessage({
      dataMark: 1 << 4,
      allData: { shopData }
    }, 'decodeRogueLikeDataSync');
    await flush();
    context.ShowTextPrompt('购买成功');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /还没到购买东西的月份/);
  } finally {
    controller.dispose();
  }
});
