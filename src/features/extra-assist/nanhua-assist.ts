/**
 * 南华辅助：在相关技能触发 UI 上展示效果说明。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type MethodPatcher } from '../../runtime/method-patch.ts';

type UnknownRecord = Record<string, unknown>;

export interface NanHuaAssistConfig {
  /** triggerID → triggerType（第几类）。 */
  trigger: Readonly<Record<number, number>>;
  /** 已排好序的效果 HTML 片段（按类型切片后拼接）。 */
  effectHtml: readonly string[];
}

export interface NanHuaAssistOptions {
  isEnabled: () => boolean;
  /** 天书提示文案开关，默认开启。 */
  isTipVisible?: () => boolean;
  getConfig: () => NanHuaAssistConfig | null;
  locator: LayaObjectLocator;
  patcher?: MethodPatcher;
  globalObject?: {
    Laya?: {
      Event?: { CLICK?: string };
      HTMLDivElement?: new () => UnknownRecord;
    };
  };
}

/**
 * TianShuWindow.updateWinUI 的南华分支：
 * type=1 时按 triggerType 排序选项、显示问号钮与效果 HTML。
 */
export function installNanHuaAssist(options: NanHuaAssistOptions): () => void {
  const patcher = options.patcher ?? createMethodPatcher();
  const globalObject = options.globalObject ?? (typeof window !== 'undefined' ? window : {});
  const prototype = options.locator.classPrototype('TianShuWindow');
  if (!prototype) return () => undefined;

  patcher.wrap(prototype, 'updateWinUI', (original) => function (this: UnknownRecord, ...args: unknown[]) {
    const data = asRecord(args[0]);
    const type = Number(data?.type);
    const enabled = options.isEnabled();
    const config = enabled ? options.getConfig() : null;

    if (type === 1 && enabled && config?.trigger && Array.isArray(data?.ids)) {
      const ids = data.ids as number[];
      ids.sort((left, right) => (
        Number(config.trigger[left] ?? 0) - Number(config.trigger[right] ?? 0)
      ));
    }

    const result = original.apply(this, args);

    if (type === 1 && enabled) {
      ensureWenhao(this, globalObject, options);
      if (config && (options.isTipVisible?.() ?? true)) {
        renderEffectHtml(this, data, config, globalObject);
      } else {
        hideEffectHtml(this);
      }
    } else {
      hideWenhao(this);
      if (type !== 1) hideEffectHtml(this);
    }

    return result;
  });

  return () => {
    const windowInstance = options.locator.window('TianShuWindow');
    if (windowInstance) {
      hideWenhao(windowInstance);
      hideEffectHtml(windowInstance);
    }
    if (!options.patcher) patcher.restoreAll();
  };
}

function ensureWenhao(
  win: UnknownRecord,
  globalObject: NanHuaAssistOptions['globalObject'],
  options: NanHuaAssistOptions
): void {
  let wenhao = asRecord(win.wenhao);
  if (wenhao) {
    wenhao.visible = true;
    return;
  }
  const created = options.locator.createInstance('SgsSpriteFilterBtn');
  if (!created) return;
  wenhao = created;
  win.wenhao = wenhao;
  const addChild = win.addChild;
  if (typeof addChild === 'function') addChild.call(win, wenhao);
  callMethod(wenhao, 'InitSkin',
    'hall_user_wenhao_up',
    'hall_user_wenhao_over',
    'hall_user_wenhao_down',
    'hall_user_wenhao_disabled'
  );
  wenhao.pos?.(670, 270);
  wenhao.zOrder = 100;
  wenhao.mouseEnabled = true;
  const click = globalObject?.Laya?.Event?.CLICK ?? 'click';
  callMethod(wenhao, 'on', click, win, function (this: UnknownRecord) {
    const html = asRecord(this.html);
    if (!html) return;
    html.visible = !html.visible;
  });
}

function hideWenhao(win: UnknownRecord): void {
  const wenhao = asRecord(win.wenhao);
  if (wenhao) wenhao.visible = false;
}

function hideEffectHtml(win: UnknownRecord): void {
  const html = asRecord(win.html);
  if (html) html.visible = false;
}

function renderEffectHtml(
  win: UnknownRecord,
  data: UnknownRecord | null,
  config: NanHuaAssistConfig,
  globalObject: NanHuaAssistOptions['globalObject']
): void {
  const ids = Array.isArray(data?.ids) ? data.ids as number[] : [];
  if (!ids.length || !config.effectHtml.length) {
    hideEffectHtml(win);
    return;
  }
  const selectItems = Array.isArray(win.selectItems) ? win.selectItems as UnknownRecord[] : [];
  selectItems.forEach((item, index) => {
    const id = Number(ids[index]);
    const triggerType = Number(config.trigger[id] ?? 0);
    if (triggerType) item.UseCnt = `第${triggerType}类型`;
    if (triggerType === 3) item.SelectBgVisible = true;
  });

  const minType = Math.min(...ids.map((id) => Number(config.trigger[id] ?? 99)));
  const y = minType <= 1 ? -70 : minType >= 3 ? 116 : 8;
  const HtmlDiv = globalObject?.Laya?.HTMLDivElement;
  let html = asRecord(win.html);
  if (!html && HtmlDiv) {
    html = new HtmlDiv();
    html.name = 'xcNanHuaTip';
    html.mouseEnabled = false;
    html.mouseThrough = true;
    const style = asRecord(html.style) ?? (html.style = {});
    Object.assign(style, {
      width: 507,
      color: 'white',
      fontSize: 15,
      fontFamily: 'FZLBGBK',
      stroke: 1,
      strokeColor: '#000000'
    });
    win.html = html;
    const addChild = win.addChild;
    if (typeof addChild === 'function') addChild.call(win, html);
  }
  if (!html) return;
  const pieces = config.effectHtml.slice(Math.max(0, minType - 1));
  html.innerHTML = `<div style="width:507px;">${pieces.join('')}</div> `;
  html.visible = true;
  html.pos?.(150, y);
}

function callMethod(target: UnknownRecord | null, name: string, ...args: unknown[]): unknown {
  if (!target) return undefined;
  const method = target[name];
  if (typeof method !== 'function') return undefined;
  try {
    return method.apply(target, args);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}
