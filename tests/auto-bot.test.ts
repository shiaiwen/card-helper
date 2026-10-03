import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceFallback,
  canRequestTrustee,
  emptyDecisionState,
  firstSelectableGeneral,
  helpFingerprint,
  officialAiAllowed,
  buttonOrderForCard
} from '../src/features/auto-bot/auto-bot-actions.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import {
  applyCreateTableDefaults,
  CREATE_TABLE_PASSWORD,
  detectAutoBotKind,
  hallCreatePlan,
  emptySeatsForHostAi,
  pickBaiShengGeneralId,
  shouldHostFillAndStart
} from '../src/features/auto-bot/auto-bot-mode.ts';
import { formatTavernSeconds, parseTavernTarget } from '../src/features/auto-bot/auto-bot-tavern.ts';
import { shouldLeaveAfterDeath } from '../src/features/auto-bot/auto-bot-leave.ts';
import { isGeneralSelectWindowName } from '../src/features/auto-bot/auto-bot-windows.ts';
import { findOwnTableSeat, hallModeFromRoomNames, planRobotSeats } from '../src/features/auto-bot/auto-bot-rooms.ts';

describe('自动挂机：自己的座位', () => {
  it('登录 id 对不上时，用房主座位开局', () => {
    const guest = { WaitInfo: { userID: 9, isMaster: false } };
    const host = { WaitInfo: { userID: 3, isMaster: true } };
    assert.equal(findOwnTableSeat([guest, host], 0), host);
    assert.equal(findOwnTableSeat([guest, host], 9), guest);
  });
});

describe('自动挂机：降级', () => {
  it('官方一直没结果则降到本地再托管', () => {
    const start = emptyDecisionState('a', 1000);
    const local = advanceFallback(start, 2100, { officialAvailable: true });
    assert.equal(local.fallbackLevel, 1);
    const trustee = advanceFallback({ ...local, localStartedAt: 2100 }, 5200, { officialAvailable: true });
    assert.equal(trustee.fallbackLevel, 2);
    assert.equal(canRequestTrustee(trustee, 5200, true), true);
    assert.equal(canRequestTrustee(trustee, 5200, false), false);
  });

  it('官方已行动则不降级', () => {
    const start = emptyDecisionState('a', 1000);
    const next = advanceFallback(start, 4000, { officialActed: true, officialAvailable: true });
    assert.equal(next.fallbackLevel, 0);
    assert.equal(next.lastOfficialActionAt, 4000);
  });
});

describe('自动挂机：官方 AI 开关', () => {
  it('演武模式允许', () => {
    assert.equal(officialAiAllowed({ enabled: true, modeType: 74 }), true);
    assert.equal(officialAiAllowed({ enabled: true, modeLabel: '身份军争演武' }), true);
  });

  it('明确不能开小杀时关掉', () => {
    assert.equal(officialAiAllowed({
      enabled: true,
      trusteeAiManual: false,
      canOpenAiHelp: false
    }), false);
  });
});

describe('自动挂机：选将与按钮序', () => {
  it('跳过不可选武将', () => {
    const picked = firstSelectableGeneral([
      { name: '隐藏', CanSelect: false },
      { name: '可选', CanSelect: true }
    ]);
    assert.equal((picked as { name: string }).name, '可选');
  });

  it('濒死队友时桃优先点第二个按钮', () => {
    assert.deepEqual(buttonOrderForCard('桃', true, false), [1, 2, 3, 0]);
    assert.deepEqual(buttonOrderForCard('杀', false, false), [0, 1, 2, 3]);
  });

  it('帮助指纹随卡和座位变化', () => {
    const left = helpFingerprint({ cardIds: [1], seatIds: [2], actionable: true });
    const right = helpFingerprint({ cardIds: [1], seatIds: [3], actionable: true });
    assert.notEqual(left, right);
  });
});

describe('自动挂机：配置', () => {
  it('默认关闭', () => {
    assert.equal(getDefaultConfig()['assist.autoBotEnabled'], false);
    assert.equal(getDefaultConfig()['assist.baiShengEnabled'], false);
    assert.equal(getDefaultConfig()['assist.autoBotTavernTarget'], 'none');
  });
});

describe('自动挂机：模式与房间', () => {
  it('按场景和模式名识别种类', () => {
    assert.equal(detectAutoBotKind({ sceneName: 'RogueLike1v1Scene' }), 11);
    assert.equal(detectAutoBotKind({ modeLabel: '国战老友' }), 28);
    assert.equal(detectAutoBotKind({ modeLabel: '八人身份老友' }), 29);
    assert.equal(detectAutoBotKind({ modeLabel: '身份老友房' }), 29);
    const seats = [
      { seatId: 0, WaitInfo: { isMaster: true } },
      { seatId: 1 },
      { seatId: 5 }
    ];
    assert.deepEqual(emptySeatsForHostAi(seats, 29, false).map((seat) => seat.seatId), [1, 5]);
    assert.equal(detectAutoBotKind({ modeId: 74 }), 1);
    assert.equal(hallCreatePlan('军争'), 'none');
    assert.equal(hallCreatePlan('军争演武'), 'none');
    assert.equal(hallCreatePlan('身份演武'), 'identity-drill');
    assert.equal(hallCreatePlan('国战演武'), 'identity-drill');
    assert.equal(hallCreatePlan('欢乐'), 'identity-drill');
    assert.deepEqual(planRobotSeats(8), { sit: 8, king: [4, 5, 6, 7], normal: [1, 2, 3] });
    assert.equal(hallModeFromRoomNames(['身份演武军争 72345', '哦 72748']), '身份演武');
    assert.equal(hallModeFromRoomNames(['欢乐成双']), '欢乐');
    assert.equal(hallModeFromRoomNames(['八人军争']), '');
  });

  it('非托管房主不补人机也不代开', () => {
    assert.equal(shouldHostFillAndStart({ managedRoom: false, baiSheng: false, kind: 1 }), false);
    assert.equal(shouldHostFillAndStart({ managedRoom: true, baiSheng: false, kind: 1 }), true);
    assert.equal(shouldHostFillAndStart({ managedRoom: false, baiSheng: true, kind: 1 }), true);
    assert.equal(shouldHostFillAndStart({ managedRoom: false, baiSheng: false, kind: 28 }), true);
  });

  it('建房窗口填密码和时间', () => {
    const win = {
      showMoreHandler() { this.opened = true; },
      modeBox: { labels: ['军争', '自选身份'], selectedIndex: 0 },
      timeBox: { selectedIndex: 0 },
      banItemBox: { selected: false },
      passwordInput: { text: '' }
    };
    applyCreateTableDefaults(win);
    assert.equal(win.modeBox.selectedIndex, 1);
    assert.equal(win.timeBox.selectedIndex, 1);
    assert.equal(win.banItemBox.selected, true);
    assert.equal(win.passwordInput.text, CREATE_TABLE_PASSWORD);
  });
});

describe('自动挂机：酒馆与百胜离场', () => {
  it('解析酒馆目标并格式化进度', () => {
    assert.equal(parseTavernTarget('dailyWin'), 'dailyWin');
    assert.equal(parseTavernTarget('bad'), 'none');
    assert.equal(formatTavernSeconds(1800), '30分');
  });

  it('百胜跳过隐匿将并优先当前未完成将', () => {
    assert.equal(pickBaiShengGeneralId([0x166, 12, 34], 0), 12);
    assert.equal(pickBaiShengGeneralId([12, 34], 34), 34);
  });

  it('自己阵亡且其余座位全是 AI 才离场', () => {
    assert.equal(shouldLeaveAfterDeath({
      deadSeatId: 0,
      selfSeatId: 0,
      seats: [{ ai: false }, { ai: true }, { ai: true }]
    }), true);
    assert.equal(shouldLeaveAfterDeath({
      deadSeatId: 0,
      selfSeatId: 0,
      seats: [{ ai: false }, { ai: false }, { ai: true }]
    }), false);
  });

  it('选将窗口名覆盖快乐模式', () => {
    assert.equal(isGeneralSelectWindowName('SelectGeneralHappyWindow'), true);
    assert.equal(isGeneralSelectWindowName('SelectCountryWarGeneralWindow'), true);
    assert.equal(isGeneralSelectWindowName('GameMvpWindow'), false);
  });
});
