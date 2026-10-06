import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';

type Node = Record<string, any>;

const PATCHED_CLICK_KEY = '__xcTiesuoRecastClick';
const TIESUO_NAME = /铁索连环|^铁索$/;

function asRecord(value: unknown): Node | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as Node
    : null;
}

export function isTiesuoCardName(name: unknown): boolean {
  const text = String(name ?? '').replace(/[♠♥♣♦\s0-9AJQK10]+/g, '');
  return TIESUO_NAME.test(text);
}

export function shouldRecastTiesuo(input: {
  tiesuoSelected: boolean;
  selectedTargetCount: number;
}): boolean {
  return input.tiesuoSelected && input.selectedTargetCount <= 0;
}

/** 选中铁索连环且未点目标时，让确定可点，点击后走重铸。 */
export function installTiesuoRecastController(
  runtime: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const locator = createLayaObjectLocator(runtime);
  const patcher = createMethodPatcher();
  let stopped = false;
  let recasting = false;
  let lastRecastAt = 0;

  function sceneSelf(): { scene: Node; self: Node } | null {
    const scene = asRecord(locator.gameScene())
      ?? asRecord(locateGameScene(runtime))
      ?? asRecord((runtime as Node).gamescene);
    const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
    if (!scene || !self || self.destroyed) return null;
    return { scene, self };
  }

  function readButtons(self: Node): Node[] {
    const bar = asRecord(self.buttonBar) ?? asRecord(self.ButtonBar) ?? self;
    const list = bar?.btnList ?? bar?.buttons ?? bar?.btns;
    const buttons = Array.isArray(list) ? list.map(asRecord).filter(Boolean) as Node[] : [];
    for (const extra of [self.btnOK, bar?.btnOK]) {
      const button = asRecord(extra);
      if (button && !buttons.includes(button)) buttons.push(button);
    }
    return buttons;
  }

  function buttonLabel(button: Node): string {
    return [
      button.name,
      button.label,
      button.text,
      asRecord(button.label)?.text,
      asRecord(button.txt)?.text
    ].map((value) => String(value ?? '')).join(' ');
  }

  function isConfirmButton(button: Node): boolean {
    const name = String(button.name || '');
    if (name === 'btnOK' || name === 'btnSure') return true;
    return /确定|确认|出牌/.test(buttonLabel(button)) && !isRecastButton(button);
  }

  function isRecastButton(button: Node): boolean {
    const name = String(button.name || '');
    if (/recast|chongzhu/i.test(name) || name === 'btnRecast') return true;
    return /重铸/.test(buttonLabel(button));
  }

  function cardName(ui: unknown): string {
    const record = asRecord(ui);
    const card = asRecord(record?.Card) ?? asRecord(record?.theCard) ?? record;
    const spell = asRecord(card?.Spell) ?? asRecord(card?.spell);
    return String(card?.CardName ?? card?.cardName ?? card?.name ?? spell?.Name ?? spell?.name ?? '');
  }

  function isSelected(ui: unknown): boolean {
    const record = asRecord(ui);
    const card = asRecord(record?.Card);
    const seat = asRecord(record?.seat);
    return !!(
      record?.selected
      || record?.Selected
      || record?.isSelected
      || card?.Selected
      || card?.selected
      || seat?.Selected
      || seat?.selected
    );
  }

  function handCards(self: Node): Node[] {
    const container = asRecord(self.cardContainer);
    return [
      ...(Array.isArray(container?.activatedCardtems) ? container.activatedCardtems : []),
      ...(Array.isArray(container?.cardUis) ? container.cardUis : []),
      ...(Array.isArray(container?.handCardUis) ? container.handCardUis : [])
    ].map(asRecord).filter(Boolean) as Node[];
  }

  function tiesuoSelected(self: Node): boolean {
    const selected = handCards(self).filter(isSelected);
    if (!selected.length) return false;
    return selected.every((card) => isTiesuoCardName(cardName(card)));
  }

  function selectedTargetCount(scene: Node, self: Node): number {
    const container = asRecord(self.cardContainer);
    const context = asRecord(container?.SelectContext)
      ?? asRecord(container?.selectCardContext)
      ?? asRecord(self.SelectContext);
    const fromContext = [
      context?.SelectedSeatIds,
      context?.selectedSeatIds,
      context?.DestSeatIDs,
      context?.destSeatIDs
    ].flatMap((value) => (Array.isArray(value) ? value : []));
    const contextCount = fromContext.filter((id) => Number(id) > 0).length;
    const seatUis = (asRecord(scene.seatContainer)?.seatUIs as unknown[]) || [];
    const uiCount = seatUis.filter(isSelected).length;
    return Math.max(contextCount, uiCount);
  }

  function canRecast(): boolean {
    const located = sceneSelf();
    if (!located) return false;
    return shouldRecastTiesuo({
      tiesuoSelected: tiesuoSelected(located.self),
      selectedTargetCount: selectedTargetCount(located.scene, located.self)
    });
  }

  function allowZeroTargets(self: Node): void {
    const container = asRecord(self.cardContainer);
    const contexts = [
      asRecord(container?.SelectContext),
      asRecord(container?.selectCardContext),
      asRecord(self.SelectContext)
    ].filter(Boolean) as Node[];
    for (const context of contexts) {
      for (const key of ['SelectCountMin', 'selectCountMin', 'TargetCountMin', 'targetCountMin']) {
        if (key in context) context[key] = 0;
      }
      if ('NeedTarget' in context) context.NeedTarget = false;
      if ('needTarget' in context) context.needTarget = false;
    }
  }

  function clickNode(node: Node): boolean {
    try {
      if (typeof node.onClick === 'function') {
        node.onClick();
        return true;
      }
      const clickType = String((runtime.Laya as Node | undefined)?.Event?.CLICK ?? 'click');
      if (typeof node.onMouse === 'function') {
        node.onMouse({ type: clickType });
        return true;
      }
      if (typeof node.event === 'function') {
        node.event(clickType, node.name ?? node);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function performRecast(confirm: Node, original?: (...args: unknown[]) => unknown, args: unknown[] = []): unknown {
    const now = Date.now();
    if (recasting || now - lastRecastAt < 400) return undefined;
    recasting = true;
    lastRecastAt = now;
    try {
      const located = sceneSelf();
      if (!located) return original?.apply(confirm, args);
      const recast = readButtons(located.self).find((button) => button !== confirm && isRecastButton(button));
      if (recast && clickNode(recast)) return undefined;
      allowZeroTargets(located.self);
      if (original) return original.apply(confirm, args);
      return clickNode(confirm);
    } finally {
      recasting = false;
    }
  }

  function enableConfirm(button: Node): void {
    try {
      if (typeof button.setEnabled === 'function') button.setEnabled(true);
      else if (typeof button.setEnable === 'function') button.setEnable(true);
    } catch {
      // 部分按钮在未入舞台时改状态会抛错。
    }
    button.enabled = true;
    button._enabled = true;
    button.disabled = false;
    button.gray = false;
    button.mouseEnabled = true;
    if (typeof button.alpha === 'number' && button.alpha < 1) button.alpha = 1;
    if ('filters' in button && button.gray !== true) button.filters = null;
  }

  function patchConfirm(button: Node): void {
    if (button[PATCHED_CLICK_KEY]) return;
    button[PATCHED_CLICK_KEY] = true;
    const intercept = (original?: (...args: unknown[]) => unknown) => function (this: Node, ...args: unknown[]) {
      if (canRecast()) return performRecast(this, original?.bind(this), args);
      return original?.apply(this, args);
    };
    patcher.wrap(button, 'onClick', intercept);
    patcher.wrap(button, 'onMouse', (original) => function (this: Node, event?: Node, ...rest: unknown[]) {
      const type = String(event?.type ?? '');
      if ((type === 'click' || type === 'CLICK') && canRecast()) {
        return performRecast(this, original.bind(this), [event, ...rest]);
      }
      return original.call(this, event, ...rest);
    });
    for (const name of ['setEnabled', 'setEnable']) {
      patcher.wrap(button, name, (original) => function (this: Node, value?: unknown, ...rest: unknown[]) {
        return original.call(this, canRecast() ? true : value, ...rest);
      });
    }
  }

  function sync(): void {
    if (stopped) return;
    const located = sceneSelf();
    if (!located) return;
    const recastable = canRecast();
    for (const button of readButtons(located.self).filter(isConfirmButton)) {
      patchConfirm(button);
      if (recastable) enableConfirm(button);
    }
  }

  const timer = runtime.setInterval(sync, 120);
  sync();
  return () => {
    stopped = true;
    runtime.clearInterval(timer);
    patcher.restoreAll();
  };
}
