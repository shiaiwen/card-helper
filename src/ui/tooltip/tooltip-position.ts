export interface TooltipPoint {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

/**
 * 计算提示层在视口中的位置。默认显示在目标上方；空间不足时自动翻转到下方，
 * 水平方向始终限制在可视区域内。
 */
export function calculateTooltipPosition(
  target: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
  safeMargin = 8
): TooltipPoint {
  const centeredLeft = (target.left + target.right - tooltip.width) / 2;
  const maximumLeft = Math.max(safeMargin, viewport.width - tooltip.width - safeMargin);
  const left = Math.min(Math.max(safeMargin, centeredLeft), maximumLeft);
  const topPosition = target.top - tooltip.height - gap;
  const canShowAbove = topPosition >= safeMargin;
  const maximumTop = Math.max(safeMargin, viewport.height - tooltip.height - safeMargin);
  const top = canShowAbove
    ? topPosition
    : Math.min(Math.max(safeMargin, target.bottom + gap), maximumTop);

  return { left, top, placement: canShowAbove ? 'top' : 'bottom' };
}
