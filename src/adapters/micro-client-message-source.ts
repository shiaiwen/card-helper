/**
 * 微端消息源：包装 console.log，改写协议并发布到游戏事件总线。
 */

import { findGameMessage, translateGameMessages } from './game-message-adapter.ts';
import type { GameEventBus } from '../runtime/game-event-bus.ts';

type MessageListener = (...rawArguments: unknown[]) => void;

type MicroClientMessageWindow = Window;

export interface MicroClientMessageSourceOptions {
  /** 游戏处理协议前改写原始对象，例如屏蔽设置。 */
  mutateMessage?: (payload: Record<string, unknown>, className: string) => void;
}

/** 从微端控制台协议日志接入游戏消息。 */
export function installMicroClientMessageSource(
  gameEvents: GameEventBus,
  globalObject: MicroClientMessageWindow = window,
  options: MicroClientMessageSourceOptions = {}
): () => void {
  const listener: MessageListener = (...rawArguments) => {
    if (options.mutateMessage) {
      const message = findGameMessage(rawArguments);
      if (message) {
        try {
          options.mutateMessage(message.payload, message.className);
        } catch (error) {
          console.warn('[xiaochao] 协议改写失败', error);
        }
      }
    }
    translateGameMessages(rawArguments).forEach((event) => gameEvents.publish(event));
  };

  const consoleLogSource = installConsoleLogSource(listener);

  return () => {
    consoleLogSource.restore();
  };
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
