import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatQuanyuTipText,
  QUANYU_BUFF_LABELS,
  QUANYU_SKILL_ID
} from '../src/features/extra-assist/quanyu-assist.ts';
import { buildExtraAssistConfigData } from '../src/features/extra-assist/extra-assist-config-data.ts';
import { findXuShaoMatches } from '../src/features/extra-assist/xushao-assist.ts';
import { planPeixiuRoute } from '../src/features/extra-assist/peixiu-route-planner.ts';
import { parsePeixiuMapConfig, classifyCardName } from '../src/features/extra-assist/peixiu-map-model.ts';
import { isLocalPlayerTurn, readSelfSeatId } from '../src/features/extra-assist/peixiu-resources.ts';
import { installPeixiuAssist, isPeixiuBackground } from '../src/features/extra-assist/peixiu-assist.ts';
import { createPeixiuRouteStore } from '../src/features/extra-assist/peixiu-route-store.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { GAME_ASSIST_SWITCH_SETTINGS } from '../src/features/extra-assist/extra-assist-settings.ts';

describe('进阶辅助：权御文案', () => {
  it('无座位或无方法时返回空串', () => {
    assert.equal(formatQuanyuTipText(null), '');
    assert.equal(formatQuanyuTipText({}), '');
  });

  it('按 bitmask 拼出多行增益', () => {
    const seat = {
      GetSkillBuffInfo(skillId: number) {
        assert.equal(skillId, QUANYU_SKILL_ID);
        // bit1 + bit3 → 伤害+1、无视防具
        return [0b1010];
      },
      GetSeatState(skillId: number) {
        assert.equal(skillId, QUANYU_SKILL_ID);
        return true;
      }
    };
    assert.equal(
      formatQuanyuTipText(seat),
      [QUANYU_BUFF_LABELS[0], QUANYU_BUFF_LABELS[2]].join('\n')
    );
  });

  it('座位状态关闭时不显示', () => {
    const seat = {
      GetSkillBuffInfo: () => [0b111111],
      GetSeatState: () => false
    };
    assert.equal(formatQuanyuTipText(seat), '');
  });
});

describe('进阶辅助：许劭连词', () => {
  it('横竖都能匹配技能名', () => {
    const entries = [
      { id: 1, name: '火攻', spell: 10, triggerID: 1 },
      { id: 2, name: '杀', spell: 20, triggerID: 2 }
    ];
    // 6x6 网格：第一行「火攻」
    const words = Array.from({ length: 36 }, () => '');
    const skillIds = Array.from({ length: 36 }, () => 0);
    words[0] = '火';
    words[1] = '攻';
    skillIds[0] = 10;
    skillIds[1] = 10;
    words[6] = '杀';
    skillIds[6] = 20;
    const matches = findXuShaoMatches(words, skillIds, [], entries, 6);
    assert.equal(matches.some((item) => item.entry.id === 1 && item.horizontal), true);
    assert.equal(matches.some((item) => item.entry.id === 2), true);
  });
});

describe('进阶辅助：配置解析', () => {
  it('解析南华触发与许劭词条', () => {
    const data = buildExtraAssistConfigData({
      NHtrigger: [
        { triggerID: 11, triggerType: 1 },
        { triggerID: 12, triggerType: 2 }
      ],
      NHeffect: [
        { effectType: 1, desc: '你可以摸一张牌。' },
        { effectType: 2, desc: '你可以弃一张牌。' }
      ],
      XSPJ: [
        { id: 3, name: '火攻', spell: 10, triggerID: 1 },
        { id: 0, name: '', spell: 0, triggerID: 0 }
      ]
    });
    assert.ok(data);
    assert.equal(data.nanHua.trigger[11], 1);
    assert.equal(data.nanHua.trigger[12], 2);
    assert.ok(data.nanHua.effectHtml.length >= 2);
    assert.deepEqual(data.shiLun, [{ id: 3, name: '火攻', spell: 10, triggerID: 1 }]);
    assert.deepEqual(data.peiXiuRewards, {});
  });

  it('解析裴秀地图技奖励', () => {
    const data = buildExtraAssistConfigData({
      PXreward: [
        { ID: 8, name: '尽览', desc: '观看牌堆顶两张牌。' }
      ]
    });
    assert.ok(data);
    assert.equal(data.peiXiuRewards[8].name, '尽览');
    assert.match(data.peiXiuRewards[8].description, /牌堆顶/);
  });
});

describe('进阶辅助：裴秀路线', () => {
  it('按 app.bak 的真实 resName 识别地图背景', () => {
    assert.equal(isPeixiuBackground({ resName: 'peixiuSpBg' }), true);
    assert.equal(isPeixiuBackground({ _name: 'peixiuSpBg' }), true);
    assert.equal(isPeixiuBackground({ name: 'PeiXiuMapBackground' }), true);
    assert.equal(isPeixiuBackground({ peixiuSpBg: true }), false);
  });

  it('兼容新版小写 selfSeatUi，并识别自己的回合', () => {
    const globalObject = {
      __XIAOCHAO_GAME_SCENE__: {
        seatContainer: { seatUIs: [] },
        selfSeatUi: { seat: { seatId: 3 } }
      }
    } as never;
    const context = { currentID: 3 };
    assert.equal(readSelfSeatId(globalObject, context), '3');
    assert.equal(isLocalPlayerTurn(globalObject, '', context), true);
  });

  it('场景暂未暴露本家座位时从游戏上下文回退', () => {
    const globalObject = {
      __XIAOCHAO_GAME_SCENE__: { seatContainer: { seatUIs: [] } }
    } as never;
    const context = { currentID: 2, myID: 2 };
    assert.equal(readSelfSeatId(globalObject, context), '2');
    assert.equal(isLocalPlayerTurn(globalObject, '', context), true);
  });

  it('识别杀与不可用闪', () => {
    assert.equal(classifyCardName('火杀'), 'sha');
    assert.equal(classifyCardName('闪'), 'unusable');
    assert.equal(classifyCardName('诸葛连弩'), 'zhuge');
  });

  it('把大于 25 的行列编号压成 1-25', () => {
    const map = parsePeixiuMapConfig({
      Cells: [31, 32, 33, 41],
      precell: 31,
      reward: [{ cell: 33, rewardId: 1 }]
    });
    assert.ok(map);
    assert.equal(map.start, 11);
    assert.ok(map.cells.has(12));
    assert.deepEqual(map.rewardCells, [13]);
  });

  it('用黑桃向右走出最短可执行路线', () => {
    const planned = planPeixiuRoute({
      Cells: [1, 2, 3],
      precell: 1,
      reward: [{ cell: 3, rewardId: 9, isCard: true }]
    }, {
      handCards: [
        { key: 'a', id: 1, suit: 3, name: '杀', displayName: '杀♠7', kind: 'sha', playable: true, selected: false },
        { key: 'b', id: 2, suit: 3, name: '闪', displayName: '闪♠2', kind: 'unusable', playable: true, selected: false },
        { key: 'c', id: 3, suit: 3, name: '过河拆桥', displayName: '过河拆桥♠5', kind: 'other', playable: true, selected: false }
      ],
      remainingSha: 1,
      jiuLimit: 0,
      peachLimit: 0,
      shandianLimit: 1
    });
    assert.ok(planned);
    assert.equal(planned.complete, true);
    assert.ok((planned.solution.path || []).some((step) => step.dir === 3 && step.available));
    assert.match(planned.solution.path.map((step) => step.card?.name).filter(Boolean).join(''), /杀|过河拆桥/);
  });

  it('没有对应花色时路线标为不可用', () => {
    const planned = planPeixiuRoute({
      Cells: [1, 6],
      precell: 1,
      reward: [{ cell: 6, rewardId: 2 }]
    }, {
      handCards: [
        { key: 'h', id: 4, suit: 1, name: '桃', displayName: '桃♥3', kind: 'tao', playable: true, selected: false }
      ],
      remainingSha: 1,
      peachLimit: 0
    });
    assert.ok(planned);
    assert.equal(planned.solution.availableStepCount, 0);
    assert.equal(planned.solution.path[0]?.available, false);
  });

  it('把规划结果发布为 Vue 可展示的最佳路线', () => {
    const planned = planPeixiuRoute({
      name: '测试地图',
      Cells: [1, 2, 3],
      precell: 1,
      reward: [{ cell: 3, rewardId: 9, isCard: true }]
    }, {
      handCards: [
        { key: 'a', id: 1, suit: 3, name: '杀', displayName: '杀♠7', kind: 'sha', playable: true, selected: false }
      ],
      remainingSha: 1
    });
    assert.ok(planned);
    const store = createPeixiuRouteStore();
    store.publish(planned, [{ rewardId: 8, name: '尽览', description: '观看牌堆顶。' }]);
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.variants[0]?.label, '最佳');
    assert.equal(snapshot.variants[0]?.steps[0]?.cardName, '杀♠7');
    assert.equal(snapshot.skills[0]?.name, '尽览');
  });

  it('地图节点挂载后自动捕获并发布最佳路线', () => {
    class FakeDisplay {
      parent: unknown = null;
      destroyed = false;
      children: FakeDisplay[] = [];
      graphics = {
        lines: [] as unknown[][],
        circles: [] as unknown[][],
        clear() {},
        drawRect() {},
        drawLine: (...args: unknown[]) => { this.graphics.lines.push(args); },
        drawCircle: (...args: unknown[]) => { this.graphics.circles.push(args); }
      };
      style: Record<string, unknown> = {};
      addChild(child: FakeDisplay) { child.parent = this; this.children.push(child); return child; }
      addDrawChild(child: { parent?: unknown }) { return this.addChild(child); }
      sortChildren() {}
      size(width: number, height: number) { Object.assign(this, { width, height }); }
      pos(x: number, y: number) { Object.assign(this, { x, y }); }
      on() {}
      removeSelf() { this.parent = null; }
      destroy() { this.destroyed = true; }
    }
    class FakeNode {
      parent: unknown = null;
      _setParent(parent: unknown) {
        this.parent = parent;
      }
    }
    const scene = {
      seatContainer: { seatUIs: [] },
      SelfSeatUi: {
        seat: { seatId: 1 },
        cardContainer: { cardUis: [] }
      }
    };
    const globalObject = {
      __XIAOCHAO_GAME_SCENE__: scene,
      GameContext: { currentID: 1, myID: 1 },
      Laya: {
        Node: FakeNode,
        Sprite: FakeDisplay,
        Text: FakeDisplay,
        Label: FakeDisplay,
        HTMLDivElement: FakeDisplay,
        Event: { CLICK: 'click', ROLL_OVER: 'rollover', ROLL_OUT: 'rollout' },
        stage: new FakeDisplay()
      },
      requestAnimationFrame(callback: () => void) { callback(); return 1; },
      setTimeout(callback: () => void) { callback(); return 1; },
      setInterval() { return 1; },
      clearInterval() {}
    } as never;
    const store = createPeixiuRouteStore();
    const dispose = installPeixiuAssist({
      isEnabled: () => true,
      globalObject,
      routeStore: store,
      locator: {
        scene: () => scene,
        gameScene: () => scene,
        gameContext: () => ({ currentID: 1, myID: 1 }),
        classPrototype: () => null
      } as never
    });
    const boardEffectRoot = Object.assign(new FakeDisplay(), { width: 500, height: 500 });
    const map = Object.assign(new FakeNode(), {
      resName: 'peixiuSpBg',
      boardCellSlots: [],
      boardEffectRoot,
      refreshBoardEffectLayer() {},
      getMarkerPos(cell: number) {
        return { x: ((cell - 1) % 5) * 80 + 40, y: Math.floor((cell - 1) / 5) * 80 + 40 };
      },
      mapState: {
        mapConfig: {
          name: '挂载测试',
          Cells: [1, 2, 3],
          precell: 1,
          reward: [{ cell: 3, rewardId: 9 }]
        },
        currentPos: 1
      }
    });
    map._setParent({});
    assert.equal(store.getSnapshot().active, true);
    assert.equal(store.getSnapshot().mapName, '挂载测试');
    assert.equal(store.getSnapshot().variants[0]?.label, '最佳');
    const layer = boardEffectRoot.children.find((child) => child.name === 'xcPeiXiuRouteLayer') as FakeDisplay;
    assert.ok(layer);
    assert.ok(layer.graphics.lines.length > 0);
    assert.ok(layer.graphics.circles.length > 0);
    assert.ok(boardEffectRoot.children.some((child) => child.name === 'xcPeiXiuRouteControlRoot'));
    dispose();
  });
});

describe('游戏辅助配置键', () => {
  it('面板只露出辅助功能', () => {
    const labels = GAME_ASSIST_SWITCH_SETTINGS.map((setting) => setting.label);
    assert.deepEqual(labels, ['辅助功能']);
    const extra = GAME_ASSIST_SWITCH_SETTINGS.find((setting) => setting.label === '辅助功能');
    assert.equal(extra?.tooltip, [
      '开启后可使用进阶武将辅助',
      '魔孙权：显示权御增益状态',
      '南华老仙：显示天书选择提示',
      '裴秀：显示地图路线辅助',
      '许劭：显示评鉴可连词框'
    ].join('\n'));
  });

  it('默认关闭三个开关', () => {
    const defaults = getDefaultConfig();
    assert.equal(defaults['assist.extraEnabled'], false);
    assert.equal(defaults['assist.autoBotEnabled'], false);
    assert.equal(defaults['assist.autoHGEnabled'], false);
    assert.equal(defaults['assist.baiShengEnabled'], false);
  });
});
