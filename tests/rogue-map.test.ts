import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { createConfigStore } from '../src/config/config-store.ts';
import { buildRogueMapConfigData } from '../src/features/rogue/rogue-map-config-data.ts';
import {
  adventureChoiceIds,
  buildEventBodyLines,
  buildEventLines,
  resolveEventTitle,
  shouldSkipCityEvent
} from '../src/features/rogue/rogue-map-event-text.ts';
import { dashSegments, needsRaidGate, readCityHasEvent } from '../src/features/rogue/rogue-map-geometry.ts';
import { estimatePanelHeight, layoutMapPanels } from '../src/features/rogue/rogue-map-layout.ts';
import { installRogueMapController } from '../src/features/rogue/rogue-map-controller.ts';
import { ROGUE_MAP_KEY } from '../src/features/rogue/rogue-settings.ts';
import type { RogueMapConfigData } from '../src/features/rogue/rogue-map-types.ts';

function createStore(mapEnabled = true) {
  const values = { ...getDefaultConfig(), [ROGUE_MAP_KEY]: mapEnabled };
  return createConfigStore({
    read: () => ({ ...values }),
    write: (next) => {
      Object.assign(values, next);
    }
  }, undefined);
}

const sampleRoot = {
  root: {
    abbreviation: [
      { Short: 'a', Long: 'generalgroup' },
      { Short: 'b', Long: 'generalID' },
      { Short: 'c', Long: 'generalname' },
      { Short: 'k', Long: 'hp' },
      { Short: 'l', Long: 'maxhp' },
      { Short: 'm', Long: 'armor' },
      { Short: 'n', Long: 'getarmor' },
      { Short: 'p', Long: 'draw' },
      { Short: 'q', Long: 'cardnum' },
      { Short: 'r', Long: 'exshatimes' }
    ]
  },
  Root: {
    Text: [
      { ID: 'fight_name', text: '乱战' },
      { ID: 'adv_name', text: '奇遇·桃源' }
    ],
    Chapter: [
      { seasonID: 1, chapter: 2, cityName: '许昌', bosslocation: '99', location: '1;2' }
    ],
    Level: [
      { cityID: 1, cityname: '许昌', citycoordinate: '100,200', citypic: 'city_1_xuchang.png' },
      { cityID: 2, cityname: '洛阳', citycoordinate: '300,400', citypic: 'city_2_luoyang.png' }
    ],
    General: [
      {
        a: 'g1',
        b: 604,
        c: '高顺',
        startChapter: 1,
        k: 4,
        l: 4,
        m: 0,
        n: 0,
        p: 2,
        q: 4,
        r: 0
      }
    ],
    Fight: [
      {
        fightID: 10,
        name: 'fight_name',
        text: 'fight_name',
        Ggroup: 'g1',
        itemgroup: 30,
        reward: '114;104',
        rewarditem: ''
      }
    ],
    Adventure: [
      { ID: 20, chapname: 'adv_name', effect1: 201, effect2: 202, effect3: null },
      { ID: 21, chapname: '营地事件', effect1: 301, effect2: null, effect3: null }
    ],
    Choose: [
      { effectID: 201, type: 1, getitem: '2,4', getnum: 1, showitem: 1, lostitem: '', lostnum: '' },
      { effectID: 202, type: 1, getitem: '201', getnum: 1, showitem: 1, lostitem: '', lostnum: '' },
      { effectID: 301, type: 3, event1: '2' }
    ],
    Tactics: [
      { plot: 201, plotname: '集市·霸王', plotdesc: 'desc', school: '1', money: 100, level: 3 }
    ],
    Spell: [],
    Card: [],
    Other: [
      { reward: 99, rewardname: '备用奖励' }
    ],
    RewardGroup: [
      { reward: 114, rewarddesc: '自选战法', allreward: '1,x;2,y', abandonmoney: '' },
      { reward: 104, rewarddesc: '多选一宝物', allreward: '', abandonmoney: 50 }
    ],
    EnemyGrowth: [
      { moon: 0, diffnum: 0, hp: 6, draw: 4, cardnum: 6, exshatimes: 2, armor: 1, getarmor: 0 }
    ],
    EnemyNumGrowth: [
      { type: '3', num: 1, hp: 100, draw: 100, cardnum: 100, exshatimes: 100, armor: 100, getarmor: 100 }
    ],
    EnemyDiffGrowth: [
      { diffnum: 1, chap: 1, hp: 0, draw: 0, cardnum: 0, exshatimes: 0 }
    ],
    DifficultySelection: [
      { seasonID: '1', difID: 0, bdif: 1 }
    ],
    EXDifficultySelection: []
  }
};

describe('山河地图配置与文案', () => {
  it('从 Root 构建 Rcity / 奇遇 / 营地跳过', () => {
    const config = buildRogueMapConfigData(sampleRoot);
    assert.equal(config.Rcity['1']?.name, '许昌');
    assert.equal(config.Rcity['1']?.y, -200);
    assert.equal(config.Rcity['1']?.cp, '1-2许昌');
    assert.equal(resolveEventTitle(config, 10), '乱战');
    assert.equal(resolveEventTitle(config, 20), '奇遇·桃源');
    assert.equal(shouldSkipCityEvent(config, 21), true);
    assert.equal(shouldSkipCityEvent(config, 20), false);
    assert.deepEqual(buildEventBodyLines(config, 20), ['传说战法', '集市霸王']);
  });

  it('奇遇 id 与武将组撞车时仍走奇遇正文（问号关）', () => {
    const config = buildRogueMapConfigData({
      ...sampleRoot,
      Root: {
        ...sampleRoot.Root,
        General: [
          {
            a: '20',
            b: 1,
            c: '误伤武将',
            startChapter: 1,
            k: 4,
            l: 4,
            m: 0,
            n: 0,
            p: 2,
            q: 4,
            r: 0
          }
        ]
      }
    });
    // Rfight 会有 generalgroup=20 的空壳，但不能抢走奇遇 20 的选项文案
    assert.equal(resolveEventTitle(config, 20), '奇遇·桃源');
    assert.deepEqual(buildEventBodyLines(config, 20), ['传说战法', '集市霸王']);
  });

  it('effect 表空时用 event+01 拼接回退查 Rchoose', () => {
    const config = buildRogueMapConfigData({
      root: sampleRoot.root,
      Root: {
        ...sampleRoot.Root,
        Adventure: [
          { ID: 30, chapname: 'adv_name', effect1: null, effect2: null, effect3: null }
        ],
        Choose: [
          {
            effectID: '301',
            type: 1,
            getitem: '2,4',
            getnum: 1,
            showitem: 1,
            lostitem: '',
            lostnum: ''
          },
          {
            effectID: '302',
            type: 1,
            getitem: '201',
            getnum: 1,
            showitem: 1,
            lostitem: '',
            lostnum: ''
          }
        ]
      }
    });
    assert.equal(resolveEventTitle(config, 30), '奇遇·桃源');
    assert.deepEqual(adventureChoiceIds(config, 30).map(String), ['301', '302']);
    assert.deepEqual(buildEventBodyLines(config, 30), ['传说战法', '集市霸王']);
  });

  it('无 Adventure 行、仅有 Choose 拼接时仍解析问号奇遇（撞 Rfight 空壳）', () => {
    const config = buildRogueMapConfigData({
      root: sampleRoot.root,
      Root: {
        ...sampleRoot.Root,
        Adventure: [],
        General: [
          {
            a: '40',
            b: 1,
            c: '误伤武将',
            startChapter: 1,
            k: 4,
            l: 4,
            m: 0,
            n: 0,
            p: 2,
            q: 4,
            r: 0
          }
        ],
        Choose: [
          {
            effectID: '401',
            type: 1,
            getitem: '2,4',
            getnum: 1,
            showitem: 1,
            lostitem: '',
            lostnum: ''
          },
          {
            effectID: '402',
            type: 1,
            getitem: '201',
            getnum: 1,
            showitem: 1,
            lostitem: '',
            lostnum: ''
          }
        ]
      }
    });
    assert.ok(config.Rfight['40']);
    assert.equal((config.Rfight['40'].generals?.length ?? 0) > 0, true);
    // generalgroup=40 的「误伤武将」是真武将；不应把 40 误判成奇遇
    assert.deepEqual(adventureChoiceIds(config, 40), []);

    const adventureOnly = buildRogueMapConfigData({
      root: sampleRoot.root,
      Root: {
        ...sampleRoot.Root,
        Adventure: [],
        Fight: [],
        General: [],
        Choose: [
          {
            effectID: '501',
            type: 1,
            getitem: '2,4',
            getnum: 1,
            showitem: 1,
            lostitem: '',
            lostnum: ''
          },
          {
            effectID: '502',
            type: 1,
            getitem: '201',
            getnum: 1,
            showitem: 1,
            lostitem: '',
            lostnum: ''
          }
        ]
      }
    });
    assert.deepEqual(adventureChoiceIds(adventureOnly, 50).map(String), ['501', '502']);
    assert.deepEqual(buildEventBodyLines(adventureOnly, 50), ['传说战法', '集市霸王']);

    // Rfight 空壳（无武将名）不应挡住问号关拼接
    const emptyShell = buildRogueMapConfigData({
      root: sampleRoot.root,
      Root: {
        ...sampleRoot.Root,
        Adventure: [],
        Fight: [{ fightID: 60, name: '', text: '', Ggroup: 'missing', reward: '', rewarditem: '' }],
        Choose: [
          {
            effectID: '601',
            type: 1,
            getitem: '2,4',
            getnum: 1,
            showitem: 1,
            lostitem: '',
            lostnum: ''
          }
        ]
      }
    });
    assert.ok(emptyShell.Rfight['60']);
    assert.deepEqual(adventureChoiceIds(emptyShell, 60).map(String), ['601']);
    assert.deepEqual(buildEventBodyLines(emptyShell, 60), ['传说战法']);
  });

  it('展开武将缩写并拼出属性行', () => {
    const config = buildRogueMapConfigData(sampleRoot);
    const lines = buildEventLines(config, 10, {
      difficulty: 0,
      seasonId: 1,
      accday: 0,
      passChapter: 0,
      chapterId: 2,
      seedItem: []
    }, 1);
    assert.deepEqual(lines.map((line) => line.kind), [
      'general',
      'stats',
      'reward',
      'reward',
      'reward'
    ]);
    assert.equal(lines[0].text, '高顺');
    assert.equal(lines[1].text, '10血 10牌 摸6 杀3 甲1');
    assert.equal(lines[2].text, '30铜币');
    assert.equal(lines[3].text, '普通/稀有自选战法');
    assert.equal(lines[4].text, '自选宝物/50铜币');
  });

  it('难度≤100 才要求 raid 可见；虚线分段正确', () => {
    assert.equal(needsRaidGate(100), true);
    assert.equal(needsRaidGate(101), false);
    const segments = dashSegments(0, 0, 20, 0, 7, 5);
    assert.ok(segments.length >= 2);
    assert.equal(segments[0].fromX, 0);
    assert.equal(segments[segments.length - 1].toX, 20);
  });

  it('布局会写出面板坐标', () => {
    const lines = [{ kind: 'reward' as const, text: '一行' }];
    const height = estimatePanelHeight('标题', lines);
    const panels = layoutMapPanels([
      {
        id: 1,
        title: '标题',
        lines,
        x0: 0,
        y0: 0,
        w: 190,
        h: height,
        centerX: 50,
        centerY: 80
      }
    ]);
    assert.equal(panels.length, 1);
    assert.equal(typeof panels[0].x, 'number');
    assert.equal(typeof panels[0].y, 'number');
  });

  it('可视区比面板窄时不强夹，避免多城面板叠死', () => {
    const lines = [{ kind: 'reward' as const, text: '一行' }];
    const height = estimatePanelHeight('标题', lines);
    const panels = layoutMapPanels(
      [
        {
          id: 1,
          title: '朝歌',
          lines,
          x0: 40,
          y0: 100,
          w: 190,
          h: height,
          centerX: 100,
          centerY: 150
        },
        {
          id: 2,
          title: '燕县',
          lines,
          x0: 400,
          y0: 120,
          w: 190,
          h: height,
          centerX: 460,
          centerY: 170
        }
      ],
      [],
      8,
      { left: 0, top: 0, right: 100, bottom: 80 }
    );
    assert.equal(panels.length, 2);
    assert.notEqual(panels[0].x, panels[1].x);
    assert.ok(Math.abs(panels[0].x - 40) < 1);
    assert.ok(Math.abs(panels[1].x - 400) < 1);
  });
});

describe('山河地图控制器', () => {
  it('从同步包抽出 cities 后在开关开启时保持可绘制状态', () => {
    const store = createStore(true);
    const config: RogueMapConfigData = buildRogueMapConfigData(sampleRoot);
    const children: Array<{ name?: string }> = [];
    const cityView = {
      numChildren: 0,
      directionX: 1,
      directionY: 1,
      GetCityItemById() {
        return {
          x: 10,
          y: 20,
          scaleX: 1,
          scaleY: 1,
          HasEvent: true,
          cityImg: { width: 10, height: 10, textureWidth: 10, textureHeight: 10 }
        };
      },
      getChildAt(index: number) {
        return children[index];
      },
      removeChild(child: { name?: string }) {
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
        this.numChildren = children.length;
      },
      addChild(child: { name?: string }) {
        children.push(child);
        this.numChildren = children.length;
      }
    };

    class FakeVBox {
      name = '';
      width = 0;
      height = 0;
      zOrder = 0;
      mouseEnabled = true;
      layoutEnabled = false;
      vScrollBarSkin = '';
      addChild() {}
      pos() {}
    }
    class FakeSprite {
      name = '';
      width = 0;
      height = 0;
      alpha = 1;
      zOrder = 0;
      mouseEnabled = true;
      graphics = {
        clear() {},
        drawPath() {},
        drawRect() {},
        drawLine() {}
      };
      pos() {}
    }
    class FakeLabel {
      width = 0;
      height = 20;
      text = '';
      color = '';
      fontSize = 14;
      bold = false;
      wordWrap = false;
      align = '';
      valign = '';
      leading = 0;
      padding = '';
      mouseEnabled = true;
    }

    const previousLaya = (globalThis as any).Laya;
    (globalThis as any).Laya = {
      VBox: FakeVBox,
      Sprite: FakeSprite,
      Label: FakeLabel
    };

    const globalObject = {
      Laya: (globalThis as any).Laya,
      document: {
        getElementById() {
          return null;
        }
      },
      setInterval() {
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval() {}
    } as unknown as Window & typeof globalThis;

    const locator = {
      findInLayer: () => [{ cityView, visible: true, destroyed: false }],
      scene: () => ({ cityView }),
      manager: () => null
    };

    const controller = installRogueMapController(store, {
      globalObject: globalObject as never,
      locator: locator as never,
      configSource: {
        get: () => config,
        ready: () => true,
        dispose() {}
      },
      intervalMs: 60_000
    });

    try {
      controller.filterMessage({
        allData: {
          seasonData: { difficulty: 150, seasonId: 1 },
          chapterData: {
            accday: 0,
            chapterId: 2,
            locations: [
              { location: 1, event: 10 },
              { location: 2, event: 20 }
            ]
          },
          gameData: { passChapter: [], seedData: { seedItem: [] } }
        }
      }, 'decodeRogueLikeDataSync');

      assert.ok(children.some((child) => child.name === 'city'));

      // 打完关：locations 清空后面板必须消失
      controller.filterMessage({
        allData: {
          seasonData: { difficulty: 150, seasonId: 1 },
          chapterData: { accday: 0, chapterId: 2, locations: [] },
          gameData: { passChapter: [1], seedData: { seedItem: [] } }
        }
      }, 'decodeRogueLikeDataSync');
      assert.equal(children.some((child) => child.name === 'city'), false);

      // 再画一次，然后地图场景消失也要清掉
      controller.filterMessage({
        allData: {
          seasonData: { difficulty: 150, seasonId: 1 },
          chapterData: {
            accday: 0,
            chapterId: 2,
            locations: [{ location: 1, event: 10 }]
          },
          gameData: { passChapter: [1], seedData: { seedItem: [] } }
        }
      }, 'decodeRogueLikeDataSync');
      assert.ok(children.some((child) => child.name === 'city'));
      locator.findInLayer = () => [];
      // 触发轮询路径：直接再同步一次 force redraw
      controller.filterMessage({
        allData: {
          seasonData: { difficulty: 150, seasonId: 1 },
          chapterData: {
            accday: 0,
            chapterId: 2,
            locations: [{ location: 1, event: 10 }]
          },
          gameData: { passChapter: [1], seedData: { seedItem: [] } }
        }
      }, 'decodeRogueLikeDataSync');
      assert.equal(children.some((child) => child.name === 'city'), false);
    } finally {
      controller.dispose();
      (globalThis as any).Laya = previousLaya;
    }
  });

  it('打完关后 HasEvent=false 会清面板；回图时能从 manager 回填', () => {
    const store = createStore(true);
    const config: RogueMapConfigData = buildRogueMapConfigData(sampleRoot);
    const children: Array<{ name?: string }> = [];
    let hasEvent = true;
    const cityView = {
      numChildren: 0,
      directionX: 1,
      directionY: 1,
      GetCityItemById() {
        return {
          x: 10,
          y: 20,
          scaleX: 1,
          scaleY: 1,
          HasEvent: hasEvent,
          cityImg: { width: 10, height: 10, textureWidth: 10, textureHeight: 10 }
        };
      },
      getChildAt(index: number) {
        return children[index];
      },
      removeChild(child: { name?: string }) {
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
        this.numChildren = children.length;
      },
      addChild(child: { name?: string }) {
        children.push(child);
        this.numChildren = children.length;
      }
    };

    class FakeVBox {
      name = '';
      width = 0;
      height = 0;
      zOrder = 0;
      mouseEnabled = true;
      layoutEnabled = false;
      vScrollBarSkin = '';
      addChild() {}
      pos() {}
    }
    class FakeLabel {
      text = '';
      width = 0;
      color = '';
      fontSize = 0;
      bold = false;
      wordWrap = false;
      leading = 0;
      align = '';
      valign = '';
      padding = '';
      height = 14;
    }
    const previousLaya = (globalThis as any).Laya;
    (globalThis as any).Laya = {
      VBox: FakeVBox,
      Label: FakeLabel,
      Sprite: class {
        graphics = {
          clear() {},
          drawRect() {},
          drawLine() {}
        };
        addChild() {}
        pos() {}
        size() {}
      }
    };

    let sceneVisible = true;
    const managerData = {
      allData: {
        seasonData: { difficulty: 150, seasonId: 1 },
        chapterData: {
          accday: 0,
          chapterId: 2,
          locations: [{ location: 1, event: 10 }]
        },
        gameData: { passChapter: [], seedData: { seedItem: [] } }
      }
    };

    const locator = {
      findInLayer: () => (sceneVisible
        ? [{ cityView, visible: true, destroyed: false }]
        : []),
      scene: () => (sceneVisible ? { cityView } : null),
      manager: () => managerData
    };

    const globalObject = {
      setInterval: () => 1,
      clearInterval() {},
      document: { getElementById: () => null }
    };

    const controller = installRogueMapController(store, {
      globalObject: globalObject as never,
      locator: locator as never,
      configSource: {
        get: () => config,
        ready: () => true,
        dispose() {}
      },
      intervalMs: 60_000
    });

    try {
      controller.filterMessage(managerData.allData, 'decodeRogueLikeDataSync');
      assert.ok(children.some((child) => child.name === 'city'));

      // HasEvent=false：奇遇已领取，面板必须消失
      hasEvent = false;
      controller.filterMessage(managerData.allData, 'decodeRogueLikeDataSync');
      assert.equal(children.some((child) => child.name === 'city'), false);
      const debug = (globalObject as any).__XIAOCHAO_ROGUE_MAP_DEBUG__;
      assert.equal(debug?.reason, 'no-active-cities');
      assert.match(String(debug?.fingerprint ?? ''), /:false/);

      // 离开地图后再回来：同步包不带 locations，靠 manager 回填
      hasEvent = true;
      sceneVisible = false;
      controller.filterMessage({
        allData: {
          seasonData: { difficulty: 150, seasonId: 1 },
          chapterData: { accday: 0, chapterId: 2, locations: [] },
          gameData: { passChapter: [1], seedData: { seedItem: [] } }
        }
      }, 'decodeRogueLikeDataSync');
      assert.equal(children.some((child) => child.name === 'city'), false);

      managerData.allData.chapterData.locations = [{ location: 2, event: 20 }];
      sceneVisible = true;
      controller.filterMessage({
        allData: {
          seasonData: { difficulty: 150, seasonId: 1 },
          chapterData: { accday: 0, chapterId: 2 },
          gameData: { passChapter: [1], seedData: { seedItem: [] } }
        }
      }, 'decodeRogueLikeDataSync');
      assert.ok(children.some((child) => child.name === 'city'));
    } finally {
      controller.dispose();
      (globalThis as any).Laya = previousLaya;
    }
  });

  it('HasEvent 用 0/1 时也能识别；领取后即使另城贴图未就绪也先清旧面板', () => {
    assert.equal(readCityHasEvent({ GetCityItemById: () => ({ HasEvent: 1 }) }, 1), 'true');
    assert.equal(readCityHasEvent({ GetCityItemById: () => ({ HasEvent: 0 }) }, 1), 'false');
    assert.equal(readCityHasEvent({ GetCityItemById: () => ({}) }, 1), 'unknown');

    const store = createStore(true);
    const config: RogueMapConfigData = buildRogueMapConfigData(sampleRoot);
    const children: Array<{ name?: string }> = [];
    let hasEventById: Record<number, boolean | number> = { 1: true, 2: true };
    let textureReady = true;
    const cityView = {
      numChildren: 0,
      directionX: 1,
      directionY: 1,
      GetCityItemById(id: number) {
        return {
          x: Number(id) * 10,
          y: 20,
          scaleX: 1,
          scaleY: 1,
          HasEvent: hasEventById[Number(id)],
          cityImg: textureReady
            ? { width: 10, height: 10, textureWidth: 10, textureHeight: 10 }
            : { width: 0, height: 0, textureWidth: 0, textureHeight: 0 }
        };
      },
      getChildAt(index: number) {
        return children[index];
      },
      removeChild(child: { name?: string }) {
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
        this.numChildren = children.length;
      },
      addChild(child: { name?: string }) {
        children.push(child);
        this.numChildren = children.length;
      }
    };

    class FakeVBox {
      name = '';
      width = 0;
      height = 0;
      zOrder = 0;
      mouseEnabled = true;
      layoutEnabled = false;
      vScrollBarSkin = '';
      addChild() {}
      pos() {}
    }
    class FakeLabel {
      text = '';
      width = 0;
      color = '';
      fontSize = 0;
      bold = false;
      wordWrap = false;
      leading = 0;
      align = '';
      valign = '';
      padding = '';
      height = 14;
    }
    const previousLaya = (globalThis as any).Laya;
    (globalThis as any).Laya = {
      VBox: FakeVBox,
      Label: FakeLabel,
      Sprite: class {
        graphics = { clear() {}, drawRect() {}, drawLine() {} };
        addChild() {}
        pos() {}
        size() {}
      }
    };

    const managerData = {
      allData: {
        seasonData: { difficulty: 150, seasonId: 1 },
        chapterData: {
          accday: 0,
          chapterId: 2,
          locations: [
            { location: 1, event: 10 },
            { location: 2, event: 20 }
          ]
        },
        gameData: { passChapter: [], seedData: { seedItem: [] } }
      }
    };

    const globalObject = {
      setInterval: () => 1,
      clearInterval() {},
      document: { getElementById: () => null }
    };

    const controller = installRogueMapController(store, {
      globalObject: globalObject as never,
      locator: {
        findInLayer: () => [{ cityView, visible: true, destroyed: false }],
        scene: () => ({ cityView }),
        manager: () => managerData
      } as never,
      configSource: {
        get: () => config,
        ready: () => true,
        dispose() {}
      },
      intervalMs: 60_000
    });

    try {
      controller.filterMessage(managerData.allData, 'decodeRogueLikeDataSync');
      assert.ok(children.some((child) => child.name === 'city'));

      // 城 1 领取（HasEvent=0），城 2 贴图未就绪：必须清掉旧面板，不能卡在 pending
      hasEventById = { 1: 0, 2: true };
      textureReady = false;
      controller.filterMessage(managerData.allData, 'decodeRogueLikeDataSync');
      assert.equal(children.some((child) => child.name === 'city'), false);
      assert.equal((globalObject as any).__XIAOCHAO_ROGUE_MAP_DEBUG__?.reason, 'pending-images');
    } finally {
      controller.dispose();
      (globalThis as any).Laya = previousLaya;
    }
  });
});
