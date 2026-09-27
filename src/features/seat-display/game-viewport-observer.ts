export interface GameViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 观察游戏实际可见区域。停靠面板只会改变 #bgDiv 尺寸，不一定触发 window.resize；
 * 重连时游戏还可能替换整个节点，因此尺寸观察和 DOM 观察都需要保留。
 */
export function observeGameViewport(
  onChange: (bounds: GameViewportBounds) => void,
  globalObject: Window = window,
  documentObject: Document = document
): () => void {
  let stopped = false;
  let observedGameRoot: HTMLElement | null = null;
  let animationFrameId = 0;
  const resizeObserver = typeof globalObject.ResizeObserver === 'function'
    ? new globalObject.ResizeObserver(scheduleMeasurement)
    : null;

  const measure = () => {
    animationFrameId = 0;
    if (stopped) return;
    attachCurrentGameRoot();
    const bounds = observedGameRoot?.getBoundingClientRect();
    if (bounds?.width && bounds.height) {
      onChange({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height });
      return;
    }
    onChange({ left: 0, top: 0, width: globalObject.innerWidth, height: globalObject.innerHeight });
  };
  function scheduleMeasurement(): void {
    if (stopped || animationFrameId) return;
    animationFrameId = globalObject.requestAnimationFrame(measure);
  }
  function attachCurrentGameRoot(): void {
    const currentGameRoot = documentObject.getElementById('bgDiv');
    if (currentGameRoot === observedGameRoot) return;
    if (observedGameRoot) resizeObserver?.unobserve(observedGameRoot);
    observedGameRoot = currentGameRoot;
    if (observedGameRoot) resizeObserver?.observe(observedGameRoot);
  }

  const mutationObserver = typeof globalObject.MutationObserver === 'function'
    ? new globalObject.MutationObserver(scheduleMeasurement)
    : null;
  if (documentObject.body) {
    mutationObserver?.observe(documentObject.body, { childList: true, subtree: true });
  }
  globalObject.addEventListener('resize', scheduleMeasurement);
  attachCurrentGameRoot();
  measure();

  return () => {
    if (stopped) return;
    stopped = true;
    if (animationFrameId) globalObject.cancelAnimationFrame(animationFrameId);
    globalObject.removeEventListener('resize', scheduleMeasurement);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    observedGameRoot = null;
  };
}
