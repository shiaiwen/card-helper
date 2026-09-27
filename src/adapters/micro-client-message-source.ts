import { translateGameMessages } from './game-message-adapter.ts';
import type { GameEventBus } from '../runtime/game-event-bus.ts';

type MessageListener = (...rawArguments: unknown[]) => void;

interface MicroClientMessageWindow extends Window {
  VIiR0YfvE4s?: MessageListener[];
}

/**
 * 迁移期接入微端现有协议回调队列。随机名称只允许存在于本适配器；业务模块
 * 不得引用它。待独立协议钩子完成后可整体删除本文件。
 */
export function installMicroClientMessageSource(
  gameEvents: GameEventBus,
  globalObject: MicroClientMessageWindow = window
): () => void {
  let stopped = false;
  let attachedListeners: MessageListener[] | null = null;
  let restoreConsoleLog: (() => void) | null = null;
  let missingQueueChecks = 0;
  const listener: MessageListener = (...rawArguments) => {
    translateGameMessages(rawArguments).forEach((event) => gameEvents.publish(event));
  };

  const attachToCurrentQueue = () => {
    if (stopped) return;
    const currentListeners = globalObject.VIiR0YfvE4s;
    if (!Array.isArray(currentListeners)) {
      missingQueueChecks += 1;
      // 给 legacy 足够时间建立正常监听队列；只有队列持续不可见时才启用
      // Electron 跨执行环境兼容桥，避免初始化阶段抢先包装 console.log。
      if (missingQueueChecks >= 8 && !restoreConsoleLog) {
        restoreConsoleLog = installConsoleLogFallback(listener);
      }
      return;
    }
    missingQueueChecks = 0;
    restoreConsoleLog?.();
    restoreConsoleLog = null;
    if (currentListeners === attachedListeners) return;
    detachListener(attachedListeners, listener);
    attachedListeners = currentListeners;
    if (!attachedListeners.includes(listener)) attachedListeners.push(listener);
  };

  // 工程入口先于 legacy 执行；协议队列此时通常尚未创建。旧脚本热重载还会
  // 替换整个数组，因此必须等待并跟随当前队列，不能只在安装时检查一次。
  attachToCurrentQueue();
  const timer = globalObject.setInterval(attachToCurrentQueue, 250);

  return () => {
    stopped = true;
    globalObject.clearInterval(timer);
    restoreConsoleLog?.();
    restoreConsoleLog = null;
    detachListener(attachedListeners, listener);
    attachedListeners = null;
  };
}

/**
 * 部分 Electron 版本会把页面脚本和注入脚本放在不同执行环境，导致无法读取
 * legacy 暴露的监听数组。协议对象仍会经过 console.log，因此在这种环境下
 * 包装现有分发函数作为兼容桥；调用原函数以保证旧小抄行为完全不变。
 */
function installConsoleLogFallback(listener: MessageListener): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(console, 'log');
  const originalLog = console.log;
  const wrappedLog = (...rawArguments: unknown[]) => {
    listener(...rawArguments);
    return originalLog(...rawArguments);
  };
  try {
    Object.defineProperty(console, 'log', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      writable: true,
      value: wrappedLog
    });
  } catch {
    return () => undefined;
  }
  return () => {
    if (console.log !== wrappedLog) return;
    try {
      if (descriptor) Object.defineProperty(console, 'log', descriptor);
      else delete (console as Partial<Console>).log;
    } catch {
      // 页面销毁时无需继续恢复不可写属性。
    }
  };
}

function detachListener(
  listeners: MessageListener[] | null,
  listener: MessageListener
): void {
  if (!listeners) return;
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
}
