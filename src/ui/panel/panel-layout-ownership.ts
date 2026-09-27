export interface PanelLayoutStyle {
  left?: string;
  top?: string;
  right?: string;
  width?: string;
  height?: string;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
}

const PANEL_LAYOUT_VARIABLES = {
  left: '--xc-panel-left',
  top: '--xc-panel-top',
  right: '--xc-panel-right',
  width: '--xc-panel-width',
  height: '--xc-panel-height',
  minWidth: '--xc-panel-min-width',
  maxWidth: '--xc-panel-max-width',
  minHeight: '--xc-panel-min-height',
  maxHeight: '--xc-panel-max-height'
} as const;

/**
 * Vue 只写带命名空间的 CSS 变量，不与 legacy 争用普通内联布局属性。
 * 外壳样式使用 !important 将变量映射为最终计算样式，因此 legacy 后续对
 * left/top/right/width/height 的异步写入不会产生视觉变化。
 */
export function setOwnedPanelLayout(
  panelElement: HTMLElement,
  layout: PanelLayoutStyle
): void {
  for (const [property, value] of Object.entries(layout)) {
    const variableName = PANEL_LAYOUT_VARIABLES[property as keyof PanelLayoutStyle];
    if (value === undefined) panelElement.style.removeProperty(variableName);
    else panelElement.style.setProperty(variableName, value);
  }
}

/** 读取 Vue 保存的布局值，不读取可能已经被 legacy 污染的普通 style 属性。 */
export function getOwnedPanelLayoutValue(
  panelElement: HTMLElement,
  property: keyof PanelLayoutStyle
): string {
  return panelElement.style.getPropertyValue(PANEL_LAYOUT_VARIABLES[property]).trim();
}

