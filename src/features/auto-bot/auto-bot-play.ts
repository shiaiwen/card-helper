import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { isEnabledFlag, skillItemId } from '../auto-hg/auto-hg-actions.ts';
import {
  SKIP_SELECT_SKILL_ID,
  advanceFallback,
  buttonOrderForCard,
  canRequestTrustee,
  collectNumberList,
  helpFingerprint,
  officialAiAllowed,
  refreshDecisionState,
  type AutoBotDecisionState,
  type AutoBotHelpRequest,
  type AutoBotMode
} from './auto-bot-actions.ts';

type UnknownRecord = Record<string, unknown>;

export interface AutoBotPlayContext {
  decision: AutoBotDecisionState | null;
  mode: AutoBotMode;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function sameId(left: unknown, right: unknown): boolean {
  return String(left) === String(right);
}

function cardIdOf(ui: unknown): number {
  const record = asRecord(ui);
  const card = asRecord(record?.Card) ?? asRecord(record?.theCard) ?? record;
  return Number(card?.CardId ?? card?.cardId ?? card?.ID ?? card?.id ?? 0) || 0;
}

function seatIdOf(ui: unknown): number {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
  return Number(seat?.SeatID ?? seat?.seatID ?? seat?.index ?? record?.seatID ?? 0);
}

function cardNameOf(ui: unknown): string {
  const record = asRecord(ui);
  const card = asRecord(record?.Card) ?? record;
  return String(card?.CardName ?? card?.cardName ?? card?.name ?? '').replace(/[♠♥♣♦0-9AJQK]+$/g, '');
}

function isSelected(ui: unknown): boolean {
  const record = asRecord(ui);
  return !!(record?.selected || asRecord(record?.Card)?.Selected || asRecord(record?.seat)?.Selected);
}

function isActivated(ui: unknown): boolean {
  const record = asRecord(ui);
  const card = asRecord(record?.Card);
  const value = record?.activated ?? record?.Activated ?? card?.activated ?? card?.Activated;
  return value === true || value === 1;
}

function mouseClick(record: UnknownRecord, type: string): boolean {
  try {
    if (typeof record.onMouse === 'function') {
      record.onMouse({ type });
      return true;
    }
    if (typeof record.event === 'function') {
      record.event(type, type === 'click' ? record.name : record);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function clickCard(ui: unknown): boolean {
  const record = asRecord(ui);
  if (!record) return false;
  try {
    if (typeof record.setSelected === 'function') {
      record.setSelected(true);
      return true;
    }
    if (typeof record.CardUI_Click === 'function') {
      record.CardUI_Click(null);
      return true;
    }
  } catch {
    return false;
  }
  return mouseClick(record, 'click');
}

function clickSeat(ui: unknown): boolean {
  const record = asRecord(ui);
  if (!record) return false;
  if (typeof record.seatClickHandler === 'function') {
    try { record.seatClickHandler(); return true; } catch { return false; }
  }
  return mouseClick(record, 'SELECTE');
}

function clickButton(ui: unknown): boolean {
  const record = asRecord(ui);
  if (!record) return false;
  if (typeof record.onClick === 'function') {
    try { record.onClick(); return true; } catch { return false; }
  }
  return mouseClick(record, 'click');
}

function clickButtonByName(buttons: unknown[], name: string, globalObject?: LayaRuntimeWindow): boolean {
  const found = buttons.map(asRecord).find((item) => item && (item.name === name || String(item.name) === name));
  if (!found || !isEnabledFlag(found, '_enabled')) return false;
  return clickButton(found);
}

function clickButtonByIndex(buttons: unknown[], order: number[], globalObject?: LayaRuntimeWindow): boolean {
  for (const index of order) {
    const button = asRecord(buttons[index]);
    if (button && isEnabledFlag(button, '_enabled')) return clickButton(button);
  }
  return false;
}

function readHelp(self: UnknownRecord, seatUis: unknown[], buttons: unknown[], skills: unknown[], select: UnknownRecord | null): AutoBotHelpRequest {
  const data = asRecord(self.CurStepHelpData) ?? asRecord(self.curStepHelpData);
  const protocol = asRecord(data?.protocol);
  const cardIds = collectNumberList(data?.cardIds, data?.CardIDs, protocol?.CardIDs, protocol?.CardID);
  const seatIds = collectNumberList(data?.completeSeatIds, data?.seatIds, protocol?.DestSeatIDs, protocol?.SeatIDs);
  const protocolName = String(protocol?._className_ ?? protocol?.className ?? '');
  const skillId = /UseCard/i.test(protocolName)
    ? undefined
    : Number(data?.skillId ?? data?.SkillId ?? 0) || undefined;
  const buttonName = String(data?.buttonName || '') || undefined;
  const optionRaw = data?.optionIndex ?? data?.OptionIndex;
  const optionIndex = optionRaw === undefined || optionRaw === null || optionRaw === ''
    ? undefined
    : Number(optionRaw);
  const cardUis = Array.isArray(data?.cardUis) ? data!.cardUis as unknown[] : [];
  const target = data?.target;
  const selectVisible = select?.visible === true;
  const actionable = !!(
    skillId
    || cardIds.length
    || cardUis.length
    || seatIds.length
    || buttonName
    || target
    || (selectVisible && optionIndex !== undefined)
  );
  return { skillId, cardIds, seatIds, buttonName, optionIndex, actionable };
}

function executeOfficial(help: AutoBotHelpRequest, self: UnknownRecord, seatUis: unknown[], buttons: unknown[], skills: unknown[], select: UnknownRecord | null, globalObject?: LayaRuntimeWindow): 'acted' | 'waiting' | 'invalid' | 'absent' {
  if (!help.actionable) return 'absent';
  const data = asRecord(self.CurStepHelpData) ?? asRecord(self.curStepHelpData);
  const target = data?.target;
  if (target && typeof target === 'object') {
    const asButton = asRecord(target);
    if (select?.visible && Array.isArray(select.btnList) && (select.btnList as unknown[]).includes(target)) {
      if (!isEnabledFlag(asButton, '_enabled') || typeof select.btnClick !== 'function') return 'invalid';
      (select.btnClick as (item: unknown) => void)(target);
      return 'acted';
    }
    if (buttons.includes(target)) {
      if (!isEnabledFlag(asButton, '_enabled')) return 'invalid';
      clickButton(asButton);
      return 'acted';
    }
    if (typeof asButton?.CardUI_Click === 'function') {
      asButton.CardUI_Click(null);
      return 'acted';
    }
    if (typeof asButton?.seatClickHandler === 'function') {
      asButton.seatClickHandler();
      return 'acted';
    }
    if (asButton) mouseClick(asButton, 'click');
    return 'acted';
  }
  if (help.skillId) {
    const skill = skills.find((item) => sameId(skillItemId(item), help.skillId));
    if (skill && !isSelected(skill)) {
      if (!isActivated(skill)) return 'waiting';
      mouseClick(asRecord(skill)!, 'click');
      return 'acted';
    }
  }
  if (help.cardIds.length) {
    const container = asRecord(self.cardContainer);
    const pool = [
      ...((container?.activatedCardtems as unknown[]) || []),
      ...((container?.cardUis as unknown[]) || []),
      ...((container?.handCardUis as unknown[]) || [])
    ];
    const missing = help.cardIds.some((id) => !pool.some((item) => sameId(cardIdOf(item), id)));
    if (missing) return 'waiting';
    const unselected = pool.find((item) => help.cardIds.some((id) => sameId(cardIdOf(item), id)) && !isSelected(item));
    if (unselected) {
      if (!isActivated(unselected)) return 'invalid';
      clickCard(unselected);
      if (!help.seatIds.length && !help.buttonName && help.optionIndex === undefined && !select?.visible) {
        clickButtonByName(buttons, 'btnOK', globalObject);
      }
      return 'acted';
    }
  }
  if (help.seatIds.length) {
    const mapped = help.seatIds.map((id) => seatUis.find((item) => sameId(seatIdOf(item), id)));
    if (mapped.some((item) => !item)) return 'invalid';
    const unselected = mapped.find((item) => item && !isSelected(item));
    if (unselected && isActivated(unselected)) {
      clickSeat(unselected);
      return 'acted';
    }
  }
  if (help.buttonName) {
    if (clickButtonByName(buttons, help.buttonName, globalObject)) return 'acted';
    return 'waiting';
  }
  if (select?.visible && help.optionIndex !== undefined) {
    const option = asRecord((select.btnList as unknown[])?.[help.optionIndex]);
    if (!option || !isEnabledFlag(option, '_enabled') || typeof select.btnClick !== 'function') return 'invalid';
    (select.btnClick as (item: unknown) => void)(option);
    return 'acted';
  }
  return 'absent';
}

function executeLocal(self: UnknownRecord, seatUis: unknown[], buttons: unknown[], skills: unknown[], globalObject?: LayaRuntimeWindow): boolean {
  const container = asRecord(self.cardContainer);
  const context = asRecord(container?.SelectContext) ?? asRecord(container?.selectCardContext);
  const skillId = Number(asRecord(context?.Skill)?.SkillId ?? asRecord(context?.Skill)?.ID ?? 0);
  if (skillId === SKIP_SELECT_SKILL_ID && Number(context?.SelectCountMin) === 0 && Number(context?.SelectCountMax) === 0) {
    return clickButtonByName(buttons, 'btnCancel', globalObject) || clickButtonByName(buttons, 'btnOK', globalObject);
  }
  const selectedCards = [
    ...((container?.activatedCardtems as unknown[]) || []),
    ...((container?.cardUis as unknown[]) || [])
  ].filter((item) => isSelected(item));
  if (selectedCards.length) {
    return clickButtonByName(buttons, 'btnOK', globalObject);
  }
  const activatedItems = (container?.activatedCardtems as unknown[]) || [];
  const playableCard = [
    ...activatedItems,
    ...((container?.cardUis as unknown[]) || []),
    ...((container?.handCardUis as unknown[]) || [])
  ].find((item) => !isSelected(item) && (activatedItems.includes(item) || isActivated(item)));
  if (playableCard) {
    clickCard(playableCard);
    const targetSeat = seatUis.find((item) => isActivated(item) && !isSelected(item));
    if (targetSeat) clickSeat(targetSeat);
    const name = cardNameOf(playableCard);
    const dying = seatUis.some((item) => {
      const seat = asRecord(asRecord(item)?.seat);
      return seat && !seat.isDead && Number(seat.currentHp ?? seat.Hp) <= 0;
    });
    clickButtonByIndex(buttons, buttonOrderForCard(name, dying, false), globalObject);
    return true;
  }
  const cancel = buttons.find((item) => {
    const name = String(asRecord(item)?.name || '');
    return /btnCancel|取消|不出/.test(name) && isEnabledFlag(item, '_enabled');
  });
  if (cancel) return clickButton(cancel);
  const playableSkill = skills.find((item) => isActivated(item) && !isSelected(item));
  if (playableSkill) return mouseClick(asRecord(playableSkill)!, 'click');
  return clickButtonByName(buttons, 'btnOK', globalObject) || clickButtonByIndex(buttons, [0, 1, 2, 3], globalObject);
}

function requestOfficialHelp(scene: UnknownRecord): void {
  if (typeof scene.RequestAiHelp === 'function') {
    try { scene.RequestAiHelp(); } catch { /* ignore */ }
  } else if (typeof scene.requestAiHelp === 'function') {
    try { scene.requestAiHelp(); } catch { /* ignore */ }
  }
}

function tryTrustee(self: UnknownRecord): boolean {
  if (typeof self.onTrusteeshipClick === 'function') {
    try { self.onTrusteeshipClick(); return true; } catch { return false; }
  }
  return false;
}

function isSelfTurn(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow, self: UnknownRecord): boolean {
  const context = locator.gameContext() ?? asRecord((globalObject as UnknownRecord).GameContext);
  const current = context?.currentID ?? context?.CurrentID ?? context?.currentId;
  const seat = asRecord(self.seat);
  const mine = seat?.SeatID ?? seat?.seatID ?? seat?.index;
  return current != null && mine != null && String(current) === String(mine);
}

function canUseOfficial(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  const context = locator.gameContext() ?? asRecord((globalObject as UnknownRecord).GameContext);
  let modeType = 0;
  let trusteeAiManual: boolean | null = null;
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    modeType = Number(vo?.ModeType ?? vo?.modeType ?? context?.GetModeType?.() ?? 0) || 0;
    if (vo && 'TrusteeAiManual' in vo) trusteeAiManual = !!vo.TrusteeAiManual;
  } catch {
    // ignore
  }
  let canOpen: boolean | null = null;
  try {
    if (typeof context?.CanOpenAiHelp === 'function') canOpen = !!context.CanOpenAiHelp();
  } catch {
    canOpen = null;
  }
  const label = String(asRecord(asRecord(locateGameScene(globalObject))?.topMenu)?.areaServerLabel?.text || '');
  return officialAiAllowed({
    enabled: true,
    modeType,
    modeLabel: label,
    trusteeAiManual,
    canOpenAiHelp: canOpen
  });
}

/**
 * 对照 app.bak `deal`：一拍内尽量执行一次操作。
 */
export function runAutoBotDeal(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  previous: AutoBotPlayContext
): AutoBotPlayContext {
  const legacy = asRecord((globalObject as UnknownRecord).XC);
  const scene = asRecord(locator.gameScene())
    ?? locateGameScene(globalObject)
    ?? asRecord(legacy?.gamescene)
    ?? asRecord((globalObject as UnknownRecord).gamescene);
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  if (!scene || !self) return { decision: previous.decision, mode: 'off' };
  const seat = asRecord(self.seat);
  if (Number(seat?.OnlineState) >= 3 && typeof self.stageMoveHandler === 'function') {
    try { self.stageMoveHandler(); } catch { /* ignore */ }
  }
  const bar = asRecord(self.buttonBar) ?? asRecord(self.ButtonBar);
  const buttons = (bar?.btnList as unknown[]) || (bar?.buttons as unknown[]) || [];
  const skills = (self.skillItems as unknown[]) || [];
  const seatUis = (asRecord(scene.seatContainer)?.seatUIs as unknown[]) || [];
  const select = asRecord(self.selectView) ?? asRecord(self.SelectView);
  const help = readHelp(self, seatUis, buttons, skills, select);
  const now = Date.now();
  const key = helpFingerprint(help, String(asRecord(self.cardContainer)?.SelectContext ?? ''));
  let decision = refreshDecisionState(previous.decision, key, now);
  const selfTurn = isSelfTurn(locator, globalObject, self);
  const officialOn = canUseOfficial(locator, globalObject);

  if (officialOn && selfTurn) requestOfficialHelp(scene);
  if (officialOn && help.actionable && decision.fallbackLevel === 0) {
    const result = executeOfficial(help, self, seatUis, buttons, skills, select, globalObject);
    if (result === 'acted' && (help.cardIds.length || help.seatIds.length || help.skillId || help.buttonName)) {
      decision = advanceFallback(decision, now, { officialActed: true, officialAvailable: true });
      return { decision, mode: 'ai' };
    }
    decision = advanceFallback(decision, now, { officialAvailable: result === 'waiting' });
  } else {
    decision = advanceFallback(decision, now, { officialAvailable: officialOn && help.actionable });
  }

  if (decision.fallbackLevel >= 2 && canRequestTrustee(decision, now, selfTurn)) {
    if (tryTrustee(self)) {
      return {
        decision: { ...decision, trusteeAttempts: decision.trusteeAttempts + 1, trusteeRequestedAt: now },
        mode: 'trustee'
      };
    }
  }

  const acted = executeLocal(self, seatUis, buttons, skills, globalObject);
  return { decision, mode: acted || decision.fallbackLevel > 0 ? 'local' : previous.mode };
}
