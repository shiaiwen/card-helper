interface DockingSnapshot {
  padding: unknown;
  backgroundWidth: string;
  backgroundWidthPriority: string;
  layaBrowser: object | undefined;
  layaClientWidthDescriptor: PropertyDescriptor | undefined;
}

let dockingSnapshot: DockingSnapshot | undefined;
let reservedPanelWidth = 0;
let lastNotifiedPanelWidth = -1;

/**
 * 使用旧版小抄的微端适配方式缩小游戏视口：除了调整背景宽度，还要让
 * Laya.Browser.clientWidth 返回扣除侧栏后的宽度，游戏引擎才会真正重排。
 */
export function reserveGameAreaForDockedPanel(panelWidth: number): void {
  const legacyLayoutBridge = (window.__XIAOCHAO_ENGINEERING__ as any)
    ?.applyLegacyGameDockLayout;
  if (typeof legacyLayoutBridge === 'function') {
    const nextPanelWidth = Math.max(0, Math.round(panelWidth));
    if (lastNotifiedPanelWidth === nextPanelWidth) return;
    reservedPanelWidth = nextPanelWidth;
    lastNotifiedPanelWidth = nextPanelWidth;
    legacyLayoutBridge(reservedPanelWidth);
    return;
  }
  const gameBackground = document.getElementById('bgDiv');
  reservedPanelWidth = Math.max(0, Math.round(panelWidth));

  if (!dockingSnapshot) {
    const layaBrowser = (window as any).Laya?.Browser as object | undefined;
    dockingSnapshot = {
      padding: (window as any).padding,
      backgroundWidth: gameBackground?.style.getPropertyValue('width') || '',
      backgroundWidthPriority: gameBackground?.style.getPropertyPriority('width') || '',
      layaBrowser,
      layaClientWidthDescriptor: layaBrowser
        ? Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth')
        : undefined
    };
    installLayaClientWidthOverride(layaBrowser);
  }

  (window as any).padding = reservedPanelWidth;
  const gameWidth = getAvailableGameWidth();
  gameBackground?.style.setProperty('width', `${gameWidth}px`, 'important');
  document.documentElement.style.setProperty('--sgs-center-x', `${gameWidth / 2}px`);
  document.documentElement.classList.add('xiaochao-game-viewport--docked');
  if (lastNotifiedPanelWidth !== reservedPanelWidth) {
    lastNotifiedPanelWidth = reservedPanelWidth;
    requestGameResize();
  }
}

/** 脱离、折叠或卸载小抄时恢复 Laya 原始视口 getter 与背景宽度。 */
export function restoreFullGameArea(): void {
  const legacyLayoutBridge = (window.__XIAOCHAO_ENGINEERING__ as any)
    ?.applyLegacyGameDockLayout;
  if (typeof legacyLayoutBridge === 'function') {
    if (lastNotifiedPanelWidth === 0) return;
    reservedPanelWidth = 0;
    lastNotifiedPanelWidth = 0;
    legacyLayoutBridge(0);
    return;
  }
  if (!dockingSnapshot) return;
  const snapshot = dockingSnapshot;
  dockingSnapshot = undefined;
  reservedPanelWidth = 0;
  lastNotifiedPanelWidth = -1;

  if (snapshot.layaBrowser && snapshot.layaClientWidthDescriptor) {
    Object.defineProperty(
      snapshot.layaBrowser,
      'clientWidth',
      snapshot.layaClientWidthDescriptor
    );
  }
  (window as any).padding = snapshot.padding;
  const gameBackground = document.getElementById('bgDiv');
  if (snapshot.backgroundWidth) {
    gameBackground?.style.setProperty(
      'width',
      snapshot.backgroundWidth,
      snapshot.backgroundWidthPriority
    );
  } else {
    gameBackground?.style.removeProperty('width');
  }
  document.documentElement.classList.remove('xiaochao-game-viewport--docked');
  document.documentElement.style.removeProperty('--sgs-center-x');
  requestGameResize();
}

function getAvailableGameWidth(): number {
  return Math.max(320, document.documentElement.clientWidth - reservedPanelWidth);
}

function installLayaClientWidthOverride(layaBrowser: object | undefined): void {
  if (!layaBrowser) return;
  const descriptor = Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth');
  if (!descriptor?.configurable || typeof descriptor.get !== 'function') return;
  Object.defineProperty(layaBrowser, 'clientWidth', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: getAvailableGameWidth
  });
}

function requestGameResize(): void {
  // 原版同时监听 resize 和 SGSresize；两者都发送才能覆盖大厅与对局场景。
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('SGSresize'));
}
