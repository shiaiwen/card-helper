import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';

type Node = Record<string, any>;

/**
 * 对照 app.bak：
 * 1) 包 SelfSeatUi.ButtonBar_UpdateCallback：点确定时若 btnOK 走不通，改走 btnReset（重铸）。
 * 2) 铁索未选目标时游戏会把确定置灰，需额外点亮，否则点不到、回调进不来。
 * 绝不包装 onClick / setEnabled —— 之前那样会吞掉所有牌的确定。
 */

function asRecord(value: unknown): Node | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as Node
    : null;
}

export function isTiesuoCardName(name: unknown): boolean {
  const text = String(name ?? '').replace(/[♠♥♣♦\s0-9AJQK10]+/g, '');
  return /铁索连环|^铁索$/.test(text);
}

export function shouldRecastTiesuo(input: {
  selectedCardCount: number;
  tiesuoOnly: boolean;
  selectedTargetCount: number;
}): boolean {
  return input.selectedCardCount === 1
    && input.tiesuoOnly
    && input.selectedTargetCount <= 0;
}

function buttonList(bar: Node | null): Node[] {
  if (!bar) return [];
  const list = Array.isArray(bar.btns) ? bar.btns : Array.isArray(bar.btnList) ? bar.btnList : [];
  return list.map(asRecord).filter(Boolean) as Node[];
}

function looksOn(button: Node | null): boolean {
  if (!button || button.destroyed) return false;
  return button.visible !== false
    && button._visible !== false
    && button.enabled !== false
    && button._enabled !== false
    && button.disabled !== true
    && button.gray !== true;
}

export function installTiesuoRecastController(
  runtime: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const locator = createLayaObjectLocator(runtime);
  const patcher = createMethodPatcher();
  let stopped = false;
  let patchedTarget: Node | null = null;
  let patchedBarTarget: Node | null = null;

  function sceneSelf(): Node | null {
    const scene = asRecord(locator.gameScene())
      ?? asRecord(locateGameScene(runtime))
      ?? asRecord((runtime as Node).gamescene);
    const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
    if (!self || self.destroyed) return null;
    return self;
  }

  function buttonBar(self: Node): Node | null {
    return asRecord(self.buttonBar) ?? asRecord(self.ButtonBar);
  }

  function findButton(self: Node, name: string): Node | null {
    const bar = buttonBar(self);
    return asRecord(bar?.[name])
      ?? buttonList(bar).find((button) => String(button.name || '') === name)
      ?? null;
  }

  function resolvePatchTarget(self: Node): Node | null {
    const proto = asRecord(Object.getPrototypeOf(self));
    if (proto && typeof proto.ButtonBar_UpdateCallback === 'function') return proto;
    if (typeof self.ButtonBar_UpdateCallback === 'function') return self;
    return null;
  }

  function ensureCallbackPatch(): boolean {
    const self = sceneSelf();
    if (!self) return false;
    const target = resolvePatchTarget(self);
    if (!target) return false;
    if (patchedTarget === target && patcher.isWrapped(target, 'ButtonBar_UpdateCallback')) {
      return true;
    }
    const wrapped = patcher.wrap(target, 'ButtonBar_UpdateCallback', (original) => {
      return function (this: Node, buttonName?: unknown, ...rest: unknown[]) {
        const result = original.call(this, buttonName, ...rest);
        if (String(buttonName ?? '') !== 'btnOK') return result;
        if (result) return result;
        return original.call(this, 'btnReset', ...rest);
      };
    });
    if (wrapped) patchedTarget = target;
    return wrapped;
  }

  /** 仅点亮：重铸亮着说明当前是可重铸态（铁索零目标），让确定也能点到。 */
  function lightOkIfRecastReady(self: Node): void {
    const recast = findButton(self, 'btnReset');
    const ok = findButton(self, 'btnOK');
    if (!ok || !looksOn(recast)) return;
    if (looksOn(ok)) return;
    try {
      if (typeof ok.setEnabled === 'function') ok.setEnabled(true);
      else if (typeof ok.setEnable === 'function') ok.setEnable(true);
    } catch {
      // ignore
    }
    try {
      if (typeof ok.setGray === 'function') ok.setGray(false);
    } catch {
      // ignore
    }
    ok.enabled = true;
    ok._enabled = true;
    ok.disabled = false;
    ok.gray = false;
    ok.mouseEnabled = true;
  }

  /** 游戏 Update 刚把确定关掉后立刻再打开，避免和轮询抢时机。 */
  function ensureBarUpdatePatch(self: Node): void {
    const bar = buttonBar(self);
    if (!bar || typeof bar.Update !== 'function') return;
    const proto = asRecord(Object.getPrototypeOf(bar));
    const target = proto && typeof proto.Update === 'function' ? proto : bar;
    if (patchedBarTarget === target && patcher.isWrapped(target, 'Update')) return;
    const wrapped = patcher.wrap(target, 'Update', (original) => {
      return function (this: Node, ...args: unknown[]) {
        const result = original.apply(this, args);
        const owner = sceneSelf();
        if (owner && buttonBar(owner) === this) lightOkIfRecastReady(owner);
        return result;
      };
    });
    if (wrapped) patchedBarTarget = target;
  }

  function sync(): void {
    if (stopped) return;
    ensureCallbackPatch();
    const self = sceneSelf();
    if (!self) return;
    ensureBarUpdatePatch(self);
    lightOkIfRecastReady(self);
  }

  const timer = runtime.setInterval(sync, 100);
  sync();
  return () => {
    stopped = true;
    runtime.clearInterval(timer);
    patcher.restoreAll();
    patchedTarget = null;
    patchedBarTarget = null;
  };
}
