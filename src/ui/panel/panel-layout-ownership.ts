/**
 * 面板布局样式所有权：通过 data 属性标记小抄自身写入的 left/top/width/height。
 */

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
 * Vue 只写带命名空间的 CSS 变量，由外壳样式映射为最终布局。
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

/** 读取 Vue 保存的布局值。 */
export function getOwnedPanelLayoutValue(
  panelElement: HTMLElement,
  property: keyof PanelLayoutStyle
): string {
  return panelElement.style.getPropertyValue(PANEL_LAYOUT_VARIABLES[property]).trim();
}
