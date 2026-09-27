export interface DialogPosition {
  left: number;
  top: number;
}

/**
 * 将弹窗中心对齐到面板或触发区域，同时限制在当前游戏窗口内。
 * 锚点不存在时，调用方可传入整个视口作为锚点，实现窗口居中。
 */
export function calculateDialogPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  dialog: { width: number; height: number },
  viewport: { width: number; height: number },
  safeMargin = 12
): DialogPosition {
  const preferredLeft = (anchor.left + anchor.right - dialog.width) / 2;
  const preferredTop = (anchor.top + anchor.bottom - dialog.height) / 2;
  const maximumLeft = Math.max(safeMargin, viewport.width - dialog.width - safeMargin);
  const maximumTop = Math.max(safeMargin, viewport.height - dialog.height - safeMargin);

  return {
    left: Math.min(Math.max(safeMargin, preferredLeft), maximumLeft),
    top: Math.min(Math.max(safeMargin, preferredTop), maximumTop)
  };
}
