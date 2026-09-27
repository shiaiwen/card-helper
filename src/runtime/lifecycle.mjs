/**
 * 创建一次小抄注入周期对应的资源管理器。
 *
 * 所有事件监听、计时器和临时 DOM 的清理动作都应在这里注册。销毁时采用
 * 后进先出顺序，保证后创建且更依赖外部状态的资源先释放。
 *
 * @param {{logger?: Pick<Console, 'error'>}} [options]
 */
export function createLifecycle({ logger = console } = {}) {
  const cleanupCallbacks = new Set();
  let disposed = false;

  function runCleanup(callback, message) {
    try {
      callback();
    } catch (error) {
      logger.error(message, error);
    }
  }

  /** 注册清理函数；生命周期结束后注册的函数会被立即执行。 */
  function register(callback) {
    if (typeof callback !== 'function') return callback;
    if (disposed) {
      runCleanup(callback, '[lifecycle] 延迟清理失败:');
      return callback;
    }
    cleanupCallbacks.add(callback);
    return callback;
  }

  /**
   * 添加 DOM 风格的事件监听，并自动登记参数完全一致的解绑操作。
   * @returns {Function} 原监听函数，方便调用方继续保存或比较引用。
   */
  function listen(target, eventName, listener, options) {
    if (!target?.addEventListener || typeof listener !== 'function') return listener;
    target.addEventListener(eventName, listener, options);
    register(() => target.removeEventListener(eventName, listener, options));
    return listener;
  }

  /** 销毁当前生命周期。重复调用无副作用，单个清理异常不会中断其余任务。 */
  function dispose() {
    if (disposed) return;
    disposed = true;
    [...cleanupCallbacks].reverse().forEach((callback) => {
      runCleanup(callback, '[lifecycle] 清理失败:');
    });
    cleanupCallbacks.clear();
  }

  return {
    register,
    listen,
    dispose,
    /** 是否已经销毁。 */
    get disposed() { return disposed; },
    /** 尚未执行的清理任务数量，主要用于诊断和测试。 */
    get size() { return cleanupCallbacks.size; }
  };
}
