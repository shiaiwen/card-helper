/**
 * 右停靠时压缩游戏画布区域；解除停靠后恢复全宽。
 */

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

/** 缩小游戏视口，并让 Laya 使用扣除侧栏后的宽度重新排版。 */
export function reserveGameAreaForDockedPanel(panelWidth: number): void {
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
