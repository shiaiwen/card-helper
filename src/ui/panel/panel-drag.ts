/**
 * 面板拖拽几何：阈值、视口约束、右缘停靠判定。
 */

export const RIGHT_DOCK_THRESHOLD_PX = 25;
export const FLOATING_PANEL_SAFE_MARGIN_PX = 8;
export const DRAG_START_THRESHOLD_PX = 5;

export interface PanelPosition {
  left: number;
  top: number;
}

/** 把悬浮框限制在游戏窗口可视区域内，标题栏不会被拖出屏幕。 */
export function constrainPanelPosition(
  position: PanelPosition,
  panelSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  safeMargin = FLOATING_PANEL_SAFE_MARGIN_PX
): PanelPosition {
  const maximumLeft = Math.max(safeMargin, viewportSize.width - panelSize.width - safeMargin);
  const maximumTop = Math.max(safeMargin, viewportSize.height - panelSize.height - safeMargin);
  return {
    left: Math.min(Math.max(safeMargin, position.left), maximumLeft),
    top: Math.min(Math.max(safeMargin, position.top), maximumTop)
  };
}

/** 超过原版的 5px 阈值后才算拖拽，防止轻微手抖触发移动。 */
export function hasExceededDragThreshold(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) > DRAG_START_THRESHOLD_PX;
}

/** 指针或面板进入右侧吸附范围时，切换为与游戏窗口等高的停靠模式。 */
export function shouldDockToRight(
  pointerX: number,
  panelRight: number,
  viewportWidth: number,
  threshold = RIGHT_DOCK_THRESHOLD_PX
): boolean {
  return viewportWidth - pointerX <= threshold || viewportWidth - panelRight <= threshold;
}
