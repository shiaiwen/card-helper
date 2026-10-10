/**
 * 游戏消息源：微端从 console.log 取协议，浏览器从 ServerProxy.event 取。
 * 同一条消息两边都会出现时只处理一次。
 */

import { createLayaObjectLocator } from './laya-object-locator.ts';
import { findGameMessage, translateGameMessages } from './game-message-adapter.ts';
import type { GameEventBus } from '../runtime/game-event-bus.ts';

type MessageListener = (...rawArguments: unknown[]) => void;
type UnknownRecord = Record<string, unknown>;

type MicroClientMessageWindow = Window;

export interface MicroClientMessageSourceOptions {
  /** 游戏处理协议前改写原始对象，例如屏蔽设置。 */
  mutateMessage?: (payload: Record<string, unknown>, className: string) => void;
}

/** 接入游戏协议：控制台日志与 ServerProxy 分发互为补充。 */
export function installMicroClientMessageSource(
  gameEvents: GameEventBus,
  globalObject: MicroClientMessageWindow = window,
  options: MicroClientMessageSourceOptions = {}
): () => void {
  const recentPayloads = new Set<object>();

  const listener: MessageListener = (...rawArguments) => {
    deliver(rawArguments);
  };

  function deliver(rawArguments: unknown[], fallbackClassName = ''): void {
    const message = findGameMessage(rawArguments);
    const payload = message?.payload ?? payloadFor(rawArguments, fallbackClassName);
    if (payload) {
      if (recentPayloads.has(payload)) return;
      recentPayloads.add(payload);
      setTimeout(() => recentPayloads.delete(payload), 0);
      const className = message?.className || fallbackClassName || readClassName(payload);
      if (!message && className && !readClassName(payload)) payload.ClassName = className;
      if (options.mutateMessage && className) {
        try {
          options.mutateMessage(payload, className);
        } catch (error) {
          console.warn('[xiaochao] 协议改写失败', error);
        }
      }
    }
    translateGameMessages(rawArguments).forEach((event) => gameEvents.publish(event));
  }

  const consoleLogSource = installConsoleLogSource(listener);
  const dispatcherSource = installServerProxySource(globalObject, deliver);

  return () => {
    consoleLogSource.restore();
    dispatcherSource.restore();
  };
}

/** 浏览器客户端不把协议打到控制台，分发时的事件名就是协议类名。 */
function installServerProxySource(
  globalObject: MicroClientMessageWindow,
  deliver: (rawArguments: unknown[], fallbackClassName?: string) => void
): { restore(): void } {
  const locator = createLayaObjectLocator(globalObject as never);
  let wrapped: ((this: unknown, type: unknown, data: unknown, ...rest: unknown[]) => unknown) | null = null;
  let original: UnknownRecord['event'] | null = null;
  let proxy: UnknownRecord | null = null;
  const timer = setInterval(() => {
    const found = locator.manager('ServerProxy');
    if (!found || typeof found.event !== 'function' || found.event === wrapped) return;
    proxy = found;
    original = found.event;
    wrapped = function (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) {
      const className = typeof type === 'string' ? type : '';
      if (data && typeof data === 'object' && isProtocolEvent(className, data as UnknownRecord)) {
        deliver([data], className);
      }
      return typeof original === 'function' ? original.call(this, type, data, ...rest) : undefined;
    };
    found.event = wrapped;
    clearInterval(timer);
  }, 1000);
  return {
    restore() {
      clearInterval(timer);
      if (proxy && wrapped && proxy.event === wrapped && original) proxy.event = original;
    }
  };
}

function isProtocolEvent(className: string, payload: UnknownRecord): boolean {
  if (readClassName(payload)) return true;
  return /^(decode|Msg|Client|GsC|PubGs|Smsg|CClient|CGs)/.test(className);
}

function payloadFor(rawArguments: unknown[], fallbackClassName: string): UnknownRecord | null {
  if (!fallbackClassName) return null;
  for (let index = rawArguments.length - 1; index >= 0; index -= 1) {
    const candidate = rawArguments[index];
    if (candidate !== null && typeof candidate === 'object') return candidate as UnknownRecord;
  }
  return null;
}

function readClassName(payload: UnknownRecord): string {
  return typeof payload.ClassName === 'string'
    ? payload.ClassName
    : typeof payload.className === 'string' ? payload.className : '';
}

interface ConsoleLogSource {
  restore(): void;
}

function installConsoleLogSource(listener: MessageListener): ConsoleLogSource {
  const descriptor = Object.getOwnPropertyDescriptor(console, 'log');
  let downstreamLog: unknown = console.log;
  const wrappedLog = (...rawArguments: unknown[]) => {
    listener(...rawArguments);
    return typeof downstreamLog === 'function' ? downstreamLog.apply(console, rawArguments) : undefined;
  };
  try {
    // 游戏加载过程中会给 console.log 重新赋值；用 setter 接住赋值，只替换下游函数，
    // 否则包装被覆盖后协议消息会整局丢失。
    Object.defineProperty(console, 'log', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => wrappedLog,
      set: (value: unknown) => {
        downstreamLog = value;
      }
    });
  } catch {
    return { restore: () => undefined };
  }
  return {
    restore() {
      if (console.log !== wrappedLog) return;
      try {
        if (descriptor) Object.defineProperty(console, 'log', descriptor);
        else delete (console as Partial<Console>).log;
      } catch {
        // 页面销毁时无需继续恢复不可写属性。
      }
    }
  };
}
