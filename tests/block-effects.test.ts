import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConfigStore } from '../src/config/config-store.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { createMethodPatcher } from '../src/runtime/method-patch.ts';
import { replaceBlockedEffectUrl } from '../src/features/block-effects/effect-resource-filter.ts';
import { applyBlockMessageFilters } from '../src/features/block-effects/block-message-filters.ts';
import {
  collectMarqueeUis,
  createMarqueeVisibilityBlocker
} from '../src/features/block-effects/marquee-visibility.ts';
import { installBlockEffectsController } from '../src/features/block-effects/block-effects-controller.ts';
import type { LayaObjectLocator } from '../src/adapters/laya-object-locator.ts';

const BASE = 'https://web.sanguosha.com/220/h5_2/';
const SHA_URL = 'res/assets/animate/game/neweffect/EF_Basic_Sha_1/EF_Basic_Sha_1.sk';
const OFF = { sha: false, heal: false, interact: false };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryConfigStore() {
  return createConfigStore({ read: () => getDefaultConfig(), write: () => undefined }, undefined);
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

describe('屏蔽设置：特效资源替换', () => {
  it('开启杀特效后把杀的骨骼换成空动画，关闭时保持原地址', () => {
    assert.match(replaceBlockedEffectUrl(SHA_URL, { ...OFF, sha: true }, BASE), /^data:basic;base64,/);
    assert.equal(replaceBlockedEffectUrl(SHA_URL, OFF, BASE), SHA_URL);
  });

  it('铁索与酒的骨骼始终保留，非 .sk 资源不替换', () => {
    const tiesuo = 'res/assets/animate/game/effect/FX_x/EF_Plot_tiesuo.sk';
    assert.equal(replaceBlockedEffectUrl(tiesuo, { sha: true, heal: true, interact: true }, BASE), tiesuo);
    const png = 'res/assets/animate/game/neweffect/EF_Basic_Sha_1/EF_Basic_Sha_1.png';
    assert.equal(replaceBlockedEffectUrl(png, { ...OFF, sha: true }, BASE), png);
  });

  it('空动画引用的 placeholder.png 换成透明图', () => {
    assert.match(replaceBlockedEffectUrl('placeholder.png', OFF, BASE), /^data:image\/png;base64,/);
  });

  it('回血与互动道具按各自开关替换', () => {
    const heal = 'res/assets/animate/game/effect/xinglinchunman/a.sk';
    const egg = 'res/assets/animate/interactProp/Ol_DaoJu_jidan/a.sk';
    assert.match(replaceBlockedEffectUrl(heal, { ...OFF, heal: true }, BASE), /^data:basic/);
    assert.equal(replaceBlockedEffectUrl(heal, { ...OFF, interact: true }, BASE), heal);
    assert.match(replaceBlockedEffectUrl(egg, { ...OFF, interact: true }, BASE), /^data:basic/);
  });

  it('牌局互动只替换草鞋与鸡蛋，回血不含吃桃动画', () => {
    const flower = 'res/assets/animate/interactProp/fx_uihd_huashu.sk';
    assert.equal(replaceBlockedEffectUrl(flower, { ...OFF, interact: true }, BASE), flower);
    const shoe = 'res/assets/animate/interactProp/fx_uihd_caoxie.sk';
    assert.match(replaceBlockedEffectUrl(shoe, { ...OFF, interact: true }, BASE), /^data:basic/);
    const peach = `${BASE}res/assets/animate/game/neweffect/EFF_tao.sk?v=-6323274737`;
    assert.equal(replaceBlockedEffectUrl(peach, { ...OFF, heal: true }, BASE), peach);
  });
});

describe('屏蔽设置：协议改写', () => {
  const own = (id: number) => id === 100;
  const options = { killEffect: false, otherSkinState: false, factionSlogan: false, isOwnGeneral: own };

  it('击杀特效开启时把 CClientGameRewardPointNTF.Type 置 0', () => {
    const payload: Record<string, unknown> = { ClassName: 'CClientGameRewardPointNTF', Type: 3 };
    applyBlockMessageFilters(payload, 'CClientGameRewardPointNTF', options);
    assert.equal(payload.Type, 3);
    applyBlockMessageFilters(payload, 'CClientGameRewardPointNTF', { ...options, killEffect: true });
    assert.equal(payload.Type, 0);
  });

  it('他人动态只关闭非本家武将的皮肤状态', () => {
    const payload = {
      GeneralSkinList: [{ GeneralID: 100, state: 1 }, { GeneralID: 200, state: 1 }]
    };
    applyBlockMessageFilters(payload, 'ClientGeneralSkinRep', { ...options, otherSkinState: true });
    assert.deepEqual(payload.GeneralSkinList.map((skin) => skin.state), [1, 0]);
  });

  it('口号开启时丢弃频道 2 的势力口号，其他聊天保留', () => {
    const chat = (text: string, Channel = 2) => ({
      ProtoObj: { Channel, chatMsg: text },
      data: { protoObj: {} } as Record<string, unknown>
    });
    const slogan = chat('魏武藏奇略，霸业定乾坤！');
    applyBlockMessageFilters(slogan, 'decodeSSCChatmsgNtf', options);
    assert.ok('protoObj' in slogan.data);
    applyBlockMessageFilters(slogan, 'decodeSSCChatmsgNtf', { ...options, factionSlogan: true });
    assert.equal('protoObj' in slogan.data, false);

    const normal = chat('大家好');
    const otherChannel = chat('魏武藏奇略，霸业定乾坤！', 7);
    applyBlockMessageFilters(normal, 'decodeSSCChatmsgNtf', { ...options, factionSlogan: true });
    applyBlockMessageFilters(otherChannel, 'decodeSSCChatmsgNtf', { ...options, factionSlogan: true });
    assert.ok('protoObj' in normal.data);
    assert.ok('protoObj' in otherChannel.data);
  });
});

describe('屏蔽设置：狗托跑马灯', () => {
  class Sprite {
    _visible = true;
    repaints = 0;
    get visible() { return this._visible; }
    set visible(value: boolean) { this._visible = value; }
    repaint() { this.repaints += 1; }
  }

  it('屏蔽期间始终不可见，记住游戏设置的可见值并在关闭时还原', () => {
    const ui = new Sprite() as Sprite & Record<string, unknown>;
    const blocker = createMarqueeVisibilityBlocker();
    blocker.sync(collectMarqueeUis({ marqueeUI: ui, marqueeUIList: { datum: [ui] } }), true);
    assert.equal(ui.visible, false);
    assert.equal(ui._visible, false);
    ui.visible = false;
    ui.visible = true;
    assert.equal(ui.visible, false);
    blocker.sync([], false);
    assert.equal(ui.visible, true);
    assert.equal(ui._visible, true);
    assert.equal(Object.prototype.hasOwnProperty.call(ui, 'visible'), false);
  });
});

describe('屏蔽设置：方法补丁', () => {
  it('包装当前方法、同名只包装一次，恢复后还原描述符', () => {
    const target = { greet(name: string) { return `hi ${name}`; } };
    const original = target.greet;
    const patcher = createMethodPatcher();
    assert.equal(patcher.wrap(target, 'greet', (base) => function (this: unknown, name: string) {
      return `${base.call(this, name)}!`;
    }), true);
    assert.equal(patcher.wrap(target, 'greet', (base) => base), false);
    assert.equal(target.greet('a'), 'hi a!');
    patcher.restoreAll();
    assert.equal(target.greet, original);
  });

  it('外层被他人再次包装时，恢复后我们的包装改为透传', () => {
    const target = { value() { return 1; } };
    const patcher = createMethodPatcher();
    patcher.wrap(target, 'value', () => () => 2);
    const ours = target.value;
    target.value = function () { return ours.call(this) * 10; };
    assert.equal(target.value(), 20);
    patcher.restoreAll();
    assert.equal(target.value(), 10);
  });

  it('包装并恢复静态 getter', () => {
    class Context { static get Show() { return true; } }
    const patcher = createMethodPatcher();
    patcher.wrapGetter(Context, 'Show', (get) => () => !get());
    assert.equal(Context.Show, false);
    patcher.restoreAll();
    assert.equal(Context.Show, true);
  });
});

describe('屏蔽设置：控制器', () => {
  it('按开关拦截广告弹窗，其他窗口照常显示', async () => {
    const shown: string[] = [];
    class Dispatcher {
      a1(name: string) { shown.push(name); return '弹窗被功能关闭拦截'.length; }
    }
    const dispatcher = new Dispatcher() as unknown as Record<string, unknown>;
    const configStore = memoryConfigStore();
    const controller = installBlockEffectsController(configStore, {
      globalObject: {} as never,
      locator: fakeLocator({
        dispatcher: () => dispatcher,
        manager: (name) => (name === 'WindowManager' ? {} : null),
        obfuscatedMethodName: () => 'a1'
      })
    });
    await flush();
    await flush();
    const show = dispatcher.a1 as (name: string) => void;
    show.call(dispatcher, 'AdPushWindow');
    configStore.set('block.adWindow', true);
    show.call(dispatcher, 'AdPushWindow');
    show.call(dispatcher, 'BagWindow');
    assert.deepEqual(shown, ['AdPushWindow', 'BagWindow']);
    controller.dispose();
    assert.equal(Object.prototype.hasOwnProperty.call(dispatcher, 'a1'), false);
  });

  it('击杀特效开关控制 ShowGameDetonationEffects，红点开关把状态置 0', async () => {
    class GameContext {
      static get ShowGameDetonationEffects() { return true; }
      static GetModeVO() { return null; }
    }
    const calls: Array<[unknown, unknown]> = [];
    const redDot = {
      tree: { root: { state: 1, children: [{ state: 1 }, { state: 0 }] } },
      setNodeState(node: unknown, state: unknown) { calls.push([node, state]); }
    };
    const configStore = memoryConfigStore();
    const controller = installBlockEffectsController(configStore, {
      globalObject: {} as never,
      locator: fakeLocator({
        dispatcher: () => ({}),
        manager: (name) => (name === 'WindowManager' ? {} : name === 'TaskRedDotManager' ? redDot : null),
        gameContext: () => GameContext as unknown as Record<string, unknown>
      })
    });
    await flush();
    await flush();
    assert.equal(GameContext.ShowGameDetonationEffects, true);
    configStore.set('block.killEffect', true);
    assert.equal(GameContext.ShowGameDetonationEffects, false);

    redDot.setNodeState({}, 1);
    configStore.set('block.taskRedDot', true);
    redDot.setNodeState({}, 1);
    const leaf = (redDot.tree.root.children as unknown[])[0];
    // 开启时清掉仍亮着的叶子；按钮再清一次，直接对叶子调用 setNodeState。
    assert.deepEqual(calls, [[{}, 1], [leaf, 0], [{}, 0]]);
    assert.deepEqual(controller.clearRedDots(), { found: true, count: 1 });
    assert.deepEqual(calls.at(-1), [leaf, 0]);
    controller.dispose();
    assert.equal(GameContext.ShowGameDetonationEffects, true);
  });

  it('filterMessage 按开关改写协议', () => {
    const configStore = memoryConfigStore();
    const controller = installBlockEffectsController(configStore, {
      globalObject: {} as never,
      locator: fakeLocator({})
    });
    const payload: Record<string, unknown> = { Type: 2 };
    configStore.set('block.killEffect', true);
    controller.filterMessage(payload, 'CClientGameRewardPointNTF');
    assert.equal(payload.Type, 0);
    assert.deepEqual(controller.clearRedDots(), { found: false, count: 0 });
    controller.dispose();
  });
});
