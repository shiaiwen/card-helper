export const PANEL_SHELL_STYLE_ID = 'xiaochao-vue-panel-shell-style';

/** Vue 面板外壳的独立样式，不依赖 legacy HTML 模板中的 style 标签。 */
export const PANEL_SHELL_CSS = `
#createIframe.createIframe {
  --xc-font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
  position: fixed !important;
  left: var(--xc-panel-left, auto) !important;
  top: var(--xc-panel-top, auto) !important;
  right: var(--xc-panel-right, auto) !important;
  width: var(--xc-panel-width, 340px) !important;
  height: var(--xc-panel-height, 720px) !important;
  min-width: var(--xc-panel-min-width, 0px) !important;
  max-width: var(--xc-panel-max-width, none) !important;
  min-height: var(--xc-panel-min-height, 0px) !important;
  max-height: var(--xc-panel-max-height, none) !important;
  transform: none !important;
  z-index: 2147483600;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  color: #f2de9c;
  background: rgb(35, 32, 29);
  border-radius: 8px;
  clip-path: inset(0 round 8px);
  user-select: none;
  pointer-events: none;
  transition: width .18s ease, height .18s ease, box-shadow .18s ease;
}
#createIframe.xiaochao-panel--collapsed {
  border: 0;
  box-shadow: 0 0 10px 2px rgba(255, 220, 120, .28);
}
#createIframe.xiaochao-panel--docked-right {
  border-radius: 8px 0 0 8px;
  clip-path: inset(0 round 8px 0 0 8px);
  box-shadow: -4px 0 12px rgba(0, 0, 0, .32);
}
#createIframe.xiaochao-panel--dragging {
  cursor: grabbing;
  opacity: .96;
}
@property --xiaochao-border-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
#createIframe.xiaochao-panel--collapsed::before {
  content: '';
  position: absolute;
  z-index: 5;
  inset: 0;
  padding: 2px;
  border-radius: inherit;
  pointer-events: none;
  background: conic-gradient(
    from var(--xiaochao-border-angle),
    transparent 0deg 245deg,
    rgba(210, 182, 111, .22) 270deg,
    #fff4c2 305deg,
    #d2b66f 330deg,
    transparent 360deg
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: xiaochaoCollapsedBorderRun 2.2s linear infinite;
}
@keyframes xiaochaoCollapsedBorderRun {
  to { --xiaochao-border-angle: 360deg; }
}
#createIframe .xc-frame-header {
  min-height: 30px;
  margin: 1px;
  display: flex;
  align-items: center;
  cursor: grab;
  touch-action: none;
  pointer-events: auto;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-header {
  min-height: 26px;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-toggle {
  width: 24px;
  height: 24px;
  margin: 0 1px;
}
#createIframe #mini-label {
  margin: 0 auto 0 6px;
  color: #f2de9c;
  font-size: 15px;
  white-space: nowrap;
}
#createIframe .xc-frame-toggle {
  position: relative;
  width: 26px;
  height: 26px;
  margin: 1px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #f2de9c;
  cursor: pointer;
  pointer-events: auto;
}
#createIframe .xc-frame-toggle:hover {
  color: #fff1bd;
  background: rgba(242, 222, 156, .1);
  border-color: rgba(242, 222, 156, .2);
}
#createIframe .xc-frame-toggle__icon { position: absolute; inset: 0; pointer-events: none; }
#createIframe .xc-frame-toggle__arrow {
  position: absolute;
  width: 7px;
  height: 7px;
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  box-sizing: border-box;
  transition: left .18s ease, right .18s ease, top .18s ease, bottom .18s ease, transform .18s ease;
}
#createIframe .xc-frame-toggle__arrow--bottom-left { left: 4px; bottom: 4px; transform: rotate(0deg); }
#createIframe .xc-frame-toggle__arrow--top-right { right: 4px; top: 4px; transform: rotate(180deg); }
#createIframe .xc-frame-toggle[data-collapsed="1"] .xc-frame-toggle__arrow--bottom-left { left: 6px; bottom: 6px; transform: rotate(180deg); }
#createIframe .xc-frame-toggle[data-collapsed="1"] .xc-frame-toggle__arrow--top-right { right: 6px; top: 6px; transform: rotate(0deg); }
#createIframe .xiaochao-panel__tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 2px;
  padding: 3px;
  background: linear-gradient(180deg, #2a241f 0%, #1a1714 100%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, .22);
  pointer-events: auto;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab {
  flex: 1 1 0;
  min-width: 0;
  padding: 5px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #a09080;
  font-size: 12.5px;
  text-align: center;
  cursor: pointer;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab:hover {
  background: rgba(55, 40, 32, .75);
  color: #f2de9c;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab.active {
  border-color: rgba(242, 222, 156, .28);
  background: linear-gradient(180deg, #3d342c 0%, #2f2822 100%);
  box-shadow: inset 0 1px 0 rgba(242, 222, 156, .1);
  color: #f2de9c;
  font-weight: 700;
}
#createIframe #iframe-source { pointer-events: auto; }
#createIframe .xiaochao-panel__content {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin: 0;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  background: #23201d;
  pointer-events: auto;
}
#createIframe .xiaochao-panel__content::-webkit-scrollbar { width: 0; height: 0; display: none; }
#createIframe #frame-resize-handle { pointer-events: auto; }
.xiaochao-dock-preview {
  position: fixed;
  z-index: 2147483599;
  top: 0;
  right: 0;
  width: 25px;
  height: 100vh;
  pointer-events: none;
  background: rgba(55, 40, 32, .8);
  border-left: 1px solid rgba(242, 222, 156, .25);
  transition: width .12s ease, background .12s ease, box-shadow .12s ease;
}
.xiaochao-dock-preview--active {
  width: 38px;
  background: rgba(201, 161, 93, .42);
  box-shadow: -4px 0 14px rgba(242, 222, 156, .28);
}
.xiaochao-tooltip {
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  max-width: min(280px, calc(100vw - 16px));
  padding: 5px 8px;
  border: 1px solid rgba(242, 222, 156, .5);
  border-radius: 5px;
  background: rgba(29, 27, 24, .96);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .3);
  color: #eee5d2;
  font: 12px/1.45 var(--xc-font-ui, system-ui, sans-serif);
  overflow-wrap: anywhere;
  pointer-events: none;
  user-select: none;
}
.xiaochao-dialog {
  position: fixed;
  inset: auto;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(242, 222, 156, .45);
  border-radius: 8px;
  background: #23201d;
  box-shadow: 0 14px 42px rgba(0, 0, 0, .5);
  color: #f2de9c;
  font-family: var(--xc-font-ui, system-ui, sans-serif);
}
.xiaochao-dialog::backdrop {
  background: rgba(0, 0, 0, .48);
  backdrop-filter: blur(1px);
}
.xiaochao-dialog__header {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid rgba(242, 222, 156, .18);
  background: linear-gradient(180deg, #302923 0%, #211d19 100%);
}
.xiaochao-dialog__title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
.xiaochao-dialog__close {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #c4b28a;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.xiaochao-dialog__close:hover {
  border-color: rgba(242, 222, 156, .22);
  background: rgba(242, 222, 156, .08);
  color: #fff1bd;
}
.xiaochao-dialog__content {
  box-sizing: border-box;
  max-height: calc(100vh - 110px);
  padding: 12px;
  overflow: auto;
}
.xiaochao-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(242, 222, 156, .18);
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-settings-section {
  box-sizing: border-box;
  margin: 0 0 10px;
}
#createIframe [data-migrated-to-vue="true"],
#createIframe .switch-container-row[hidden],
#createIframe .nav:has(#phrase) {
  display: none !important;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-settings-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 27px;
  box-sizing: border-box;
  margin: 0 2px 6px;
  padding: 0 8px 0 9px;
  border-left: 3px solid #d7b66b;
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(117, 84, 38, .32), rgba(44, 36, 28, .08) 72%, transparent);
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-settings-section__title {
  margin: 0;
  color: #f2de9c;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: .5px;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-settings-section__summary {
  color: rgba(214, 197, 156, .56);
  font-size: 10px;
  line-height: 1;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-settings-section__body {
  overflow: hidden;
  border: 1px solid rgba(242, 222, 156, .16);
  border-radius: 7px;
  background:
    linear-gradient(135deg, rgba(242, 222, 156, .035), transparent 45%),
    rgba(25, 22, 19, .66);
  box-shadow: inset 0 1px rgba(255, 242, 198, .035), 0 2px 6px rgba(0, 0, 0, .14);
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 3px 8px;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  min-width: 0;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 4px;
  border: 0;
  border-bottom: 1px solid rgba(242, 222, 156, .1);
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch:hover {
  background: linear-gradient(90deg, rgba(215, 182, 107, .1), rgba(215, 182, 107, .025));
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch:last-child { border-bottom: 0; }
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__label {
  flex: 1 1 auto;
  min-width: 0;
  color: #d6c59c;
  font-size: 12px;
  line-height: 34px;
  white-space: nowrap;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__track {
  position: relative;
  flex: 0 0 52px;
  box-sizing: border-box;
  width: 52px;
  height: 24px;
  border: 1px solid rgba(242, 222, 156, .26);
  border-radius: 999px;
  background: linear-gradient(180deg, #221e1a 0%, #1a1613 100%);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, .4);
  transition: background .2s ease, border-color .2s ease, box-shadow .2s ease;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch:hover .xiaochao-setting-switch__track {
  border-color: rgba(242, 222, 156, .42);
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(180deg, #f5e6b8 0%, #dcc98a 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .28);
  transition: transform .2s cubic-bezier(.4, 0, .2, 1), background .2s ease;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__status {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  color: rgba(169, 149, 114, .92);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: .04em;
  pointer-events: none;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track {
  border-color: rgba(242, 222, 156, .55);
  background: linear-gradient(180deg, #d4b56a 0%, #b8923f 100%);
  box-shadow: inset 0 1px 0 rgba(255, 248, 210, .25), 0 0 8px rgba(212, 181, 106, .18);
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track .xiaochao-setting-switch__thumb {
  transform: translateX(28px);
  background: linear-gradient(180deg, #fffaf0 0%, #f2de9c 100%);
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track .xiaochao-setting-switch__status {
  right: auto;
  left: 6px;
  color: #2a2010;
}
:is(#createIframe, .xiaochao-dialog) .xiaochao-setting-switch__input:focus-visible + .xiaochao-setting-switch__track {
  box-shadow: 0 0 0 2px rgba(242, 222, 156, .2);
}
.xiaochao-block-dialog {
  width: min(250px, calc(100vw - 32px));
}
.xiaochao-block-dialog .xiaochao-dialog__content {
  padding: 12px 10px 14px;
}
.xiaochao-block-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}
.xiaochao-block-group:first-child { margin-top: 0; }
.xiaochao-block-group__title {
  box-sizing: border-box;
  min-height: 26px;
  margin: 0;
  padding: 4px 8px;
  border-left: 3px solid rgba(255, 215, 94, .65);
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(107, 68, 39, .5), rgba(46, 39, 22, .32) 72%, rgba(46, 39, 22, .08));
  color: #f2de9c;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}
.xiaochao-block-group__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 4px;
}
.xiaochao-block-switch {
  box-sizing: border-box;
  min-width: 0;
}
.xiaochao-block-switch__label {
  display: block;
  margin: 0 10px 2px;
  color: #f2de9c;
  font-size: 12.5px;
  white-space: nowrap;
}
.xiaochao-block-switch__toggle {
  position: relative;
  display: block;
  width: 52px;
  height: 24px;
  margin-left: 10px;
}
.xiaochao-block-switch__toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.xiaochao-block-switch__slider {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(242, 222, 156, .26);
  border-radius: 999px;
  background: linear-gradient(180deg, #221e1a 0%, #1a1613 100%);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, .4);
  cursor: pointer;
  transition: background .2s ease, border-color .2s ease, box-shadow .2s ease;
}
.xiaochao-block-switch__slider::before {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(180deg, #f5e6b8 0%, #dcc98a 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .28);
  content: "";
  transition: transform .2s cubic-bezier(.4, 0, .2, 1), background .2s ease, box-shadow .2s ease;
}
.xiaochao-block-switch__toggle:hover input + .xiaochao-block-switch__slider {
  border-color: rgba(242, 222, 156, .42);
}
.xiaochao-block-switch__toggle input:checked + .xiaochao-block-switch__slider {
  border-color: rgba(242, 222, 156, .55);
  background: linear-gradient(180deg, #d4b56a 0%, #b8923f 100%);
  box-shadow: inset 0 1px 0 rgba(255, 248, 210, .25), 0 0 8px rgba(212, 181, 106, .18);
}
.xiaochao-block-switch__toggle input:checked + .xiaochao-block-switch__slider::before {
  transform: translateX(28px);
  background: linear-gradient(180deg, #fffaf0 0%, #f2de9c 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .5);
}
.xiaochao-block-switch__toggle input:focus-visible + .xiaochao-block-switch__slider {
  box-shadow: 0 0 0 2px rgba(242, 222, 156, .2);
}
#createIframe .xiaochao-block-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: #d6c59c;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  pointer-events: auto;
}
#createIframe .xiaochao-block-entry:hover {
  background: linear-gradient(90deg, rgba(215, 182, 107, .1), rgba(215, 182, 107, .025));
  color: #f2de9c;
}
#createIframe .xiaochao-block-entry__count {
  color: rgba(214, 197, 156, .7);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
`;

/** 安装一次面板样式，并返回可供生命周期注册的清理函数。 */
export function installPanelShellStyles(documentObject: Document = document): () => void {
  const existingStyle = documentObject.getElementById(PANEL_SHELL_STYLE_ID);
  if (existingStyle) return () => {};
  const styleElement = documentObject.createElement('style');
  styleElement.id = PANEL_SHELL_STYLE_ID;
  styleElement.textContent = PANEL_SHELL_CSS;
  (documentObject.head || documentObject.documentElement).appendChild(styleElement);
  return () => styleElement.remove();
}
