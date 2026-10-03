import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findHuangGaiGeneral,
  firstEnabledIndex,
  isIdleKickWhy,
  nextKurouAction,
  shouldClickFallbackCancel,
  shouldClickFallbackConfirm,
  skillItemId,
  KUROU_SKILL_ID,
  LEAVE_TABLE_IDLE_WHY
} from '../src/features/auto-hg/auto-hg-actions.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { createLayaObjectLocator } from '../src/adapters/laya-object-locator.ts';
import { clickLayaNode, runKurouTick, runTableRestart } from '../src/features/auto-hg/auto-hg-runtime.ts';

describe('盖主速刷：决策', () => {
  it('按 Laya 的 event(type, data) 约定点击技能', () => {
    const calls: unknown[][] = [];
    assert.equal(clickLayaNode({ name: 'kurou', event(...args: unknown[]) { calls.push(args); } }, {
      Laya: { Event: { CLICK: 'click' } }
    } as never), true);
    assert.deepEqual(calls, [['click', 'kurou']]);
  });

  it('偶数拍点苦肉，奇数拍点确认', () => {
    assert.equal(nextKurouAction(0), 'skill');
    assert.equal(nextKurouAction(1), 'confirm');
    assert.equal(nextKurouAction(2), 'skill');
  });

  it('从选将列表里认出黄盖', () => {
    const found = findHuangGaiGeneral([
      { general: { name: '曹操' } },
      { general: { name: '黄盖' } }
    ]);
    assert.equal((found as { general: { name: string } }).general.name, '黄盖');
    assert.equal(findHuangGaiGeneral([{ general: { name: '孙权' } }]), null);
  });

  it('按 3/1/0 顺序点第一个可用按钮', () => {
    const buttons = [
      { enabled: true },
      { enabled: false },
      { enabled: false },
      { enabled: true }
    ];
    assert.equal(firstEnabledIndex(buttons, [3, 1, 0]), 3);
    assert.equal(firstEnabledIndex([{ enabled: false }], [3, 1, 0]), -1);
  });

  it('识别苦肉技能号与请出原因码', () => {
    assert.equal(skillItemId({ Skill: { SkillId: 62 } }), KUROU_SKILL_ID);
    assert.equal(isIdleKickWhy(LEAVE_TABLE_IDLE_WHY), true);
    assert.equal(isIdleKickWhy(1), false);
  });

  it('兜底按钮按名字区分确定和取消', () => {
    assert.equal(shouldClickFallbackConfirm('btnOK'), true);
    assert.equal(shouldClickFallbackCancel('btnCancel'), true);
    assert.equal(shouldClickFallbackCancel('btnOK'), false);
  });
});

describe('盖主速刷：苦肉', () => {
  it('兼容新版小写 selfSeatUi，并点击苦肉与确认', () => {
    const calls: string[] = [];
    const skill = { Skill: { SkillId: 62 }, name: 'kurou', event(type: string) { calls.push(`skill:${type}`); } };
    const buttons = [
      { enabled: false },
      { enabled: true, onClick() { calls.push('confirm'); } }
    ];
    const globalObject = {
      __XIAOCHAO_GAME_SCENE__: {
        seatContainer: { seatUIs: [] },
        selfSeatUi: {
          seat: { hasSkill(id: number) { return id === 62; } },
          SkillItems: [skill],
          ButtonBar: { buttons }
        }
      },
      Laya: { Event: { CLICK: 'click' } }
    } as never;
    assert.equal(runKurouTick(globalObject, 0), 'skill');
    assert.equal(runKurouTick(globalObject, 1), 'confirm');
    assert.deepEqual(calls, ['skill:click', 'confirm']);
  });
});

describe('盖主速刷：配置', () => {
  it('默认关闭', () => {
    assert.equal(getDefaultConfig()['assist.autoHGEnabled'], false);
  });
});

describe('盖主速刷：小号房主补人', () => {
  it('空位补普通小杀，满员后才点开始', async () => {
    const calls: string[] = [];
    const seats = [
      { WaitInfo: { isMaster: true, isReady: true }, seatId: 0 },
      { seatId: 1 },
      { seatId: 2 }
    ];
    const scene = {
      seatListView: {
        seatList: seats,
        showBtns(seat: { seatId: number }) { calls.push(`show:${seat.seatId}`); },
        addAiHandler(level: number, seat: { seatId: number }) { calls.push(`ai:${level}:${seat.seatId}`); }
      },
      startUI: {
        startBtn: { onClick() { calls.push('start'); } },
        readyBtn: { event() { calls.push('ready'); } }
      },
      addAiBtn: { onMouse() { calls.push('addBtn'); } }
    };
    const dispatcher = { _events: { SWITCH_SCENE: { caller: { IsTableScene: true, CurrentScene: scene } } } };
    const proto = {};
    Object.defineProperty(proto, 'ged', { get: () => dispatcher });
    const globalObject = {
      Laya: {
        ClassUtils: { getClass: (name: string) => name === 'PopUpWindow' ? { prototype: proto } : null },
        stage: { _childs: [] },
        Event: { CLICK: 'click' }
      },
      setTimeout
    };
    const locator = createLayaObjectLocator(globalObject as never);
    assert.equal(runTableRestart(locator, globalObject as never), 'waiting');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(calls.filter((item) => item.startsWith('ai:')), ['ai:1:1', 'ai:1:2']);
    assert.ok(calls.includes('addBtn'));
    assert.equal(calls.includes('start'), false);
    seats[1]!.WaitInfo = { isMaster: false };
    seats[2]!.WaitInfo = { isMaster: false };
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal(runTableRestart(locator, globalObject as never), 'started');
    assert.ok(calls.includes('start'));
  });
});
