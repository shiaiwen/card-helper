export const LEGACY_TAB_CONTENT_READY_EVENT = 'xiaochao:legacy-tab-content-ready';
export const VUE_SETTINGS_DISPLAY_MOUNT_ID = 'xiaochao-vue-settings-display';
const FULLY_MIGRATED_DISPLAY_SWITCH_IDS = [
  'seatUISwitch',
  'recentCardSwitch',
  'deckRecordSwitch',
  'countDownSwitch',
  'cardLabelSwitch'
] as const;

const TAB_LABEL_ORDER = ['卡牌', '山河图', '配置', '工具'] as const;

/**
 * 迁移期间把旧模板的四个 section 转成纯内容容器。
 * 此函数不创建标签按钮、不保存激活状态，也不注册点击事件；这些职责全部属于 Vue。
 */
export function prepareLegacyTabPanes(contentElement: HTMLElement): void {
  // app.bak 原实现使用 getElementById('content')；这里是 id，不是 <content> 标签。
  const legacyContent = contentElement.querySelector<HTMLElement>('#content');
  if (!legacyContent) return;
  removeUnsupportedCardCustomization(legacyContent);

  // 热更新或异常中断后可能残留旧控制器创建的横向栏，Vue 是唯一标签栏所有者。
  legacyContent.querySelectorAll(':scope > .tab-bar.xc-main-tabs').forEach((tabBar) => {
    tabBar.remove();
  });

  const existingPanes = legacyContent.querySelectorAll<HTMLElement>(
    ':scope > .xc-main-tab-pane'
  );
  if (existingPanes.length) {
    prepareVueSeatHandsMount(existingPanes[0]);
    prepareVueSettingsMount(existingPanes[2]);
    window.dispatchEvent(new CustomEvent(LEGACY_TAB_CONTENT_READY_EVENT));
    return;
  }

  const panels = Array.from(legacyContent.children).filter((element): element is HTMLElement => (
    element instanceof HTMLElement &&
    Boolean(element.querySelector(':scope > .panel-header'))
  ));
  if (!panels.length) return;

  const panelByLabel = new Map(panels.map((panel) => [readPanelLabel(panel), panel]));
  const orderedPanels = TAB_LABEL_ORDER
    .map((label) => panelByLabel.get(label))
    .filter((panel): panel is HTMLElement => Boolean(panel));

  legacyContent.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
    if (dialog.parentElement !== legacyContent) legacyContent.appendChild(dialog);
  });

  const panes = orderedPanels.map((panel) => {
    const panelBody = panel.querySelector<HTMLElement>(':scope > .panel-content');
    const pane = document.createElement('div');
    pane.className = 'tab-pane xc-main-tab-pane';
    if (panelBody) pane.append(...Array.from(panelBody.childNodes));
    panel.remove();
    return pane;
  });

  const toolsPane = panes[TAB_LABEL_ORDER.indexOf('工具')];
  prepareVueSeatHandsMount(panes[TAB_LABEL_ORDER.indexOf('卡牌')]);
  prepareVueSettingsMount(panes[TAB_LABEL_ORDER.indexOf('配置')]);
  if (toolsPane) {
    const clearFloat = document.createElement('div');
    clearFloat.style.clear = 'both';
    toolsPane.appendChild(clearFloat);
    Array.from(legacyContent.children).forEach((element) => {
      if (element.tagName !== 'DIALOG') toolsPane.appendChild(element);
    });
  }

  // 逆序插入可保持页面顺序，同时让 dialog 继续留在 content 尾部。
  panes.slice().reverse().forEach((pane) => legacyContent.prepend(pane));
  window.dispatchEvent(new CustomEvent(LEGACY_TAB_CONTENT_READY_EVENT));
}

/**
 * 新工程不提供喵喵卡面、黄金/自定义卡背。先关闭可能由旧配置恢复的效果，
 * 再删除入口和弹窗；保留正常卡牌渲染使用的官方资源不受影响。
 */
function removeUnsupportedCardCustomization(legacyContent: HTMLElement): void {
  for (const inputId of ['miaoCardSwitch', 'cardBackSwitch']) {
    const input = legacyContent.querySelector<HTMLInputElement>(`#${inputId}`);
    if (!input?.checked) continue;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  legacyContent.querySelector('#openCardThemeDialogBtn')?.remove();
  legacyContent.querySelector('#cardThemeDialog')?.remove();
  const interfaceRow = legacyContent.querySelector<HTMLElement>('.interface-dialog-row');
  if (interfaceRow && !interfaceRow.querySelector('.interface-dialog-btn')) interfaceRow.remove();
}

/** 卡牌页由 Vue 独立渲染；legacy 卡牌页整体隐藏，只为让 legacy 自身初始化不崩溃。 */
function prepareVueSeatHandsMount(cardsPane: HTMLElement | undefined): void {
  if (!cardsPane) return;
  // legacy 初始化（ty）会不判空地给 #mizhu 等节点绑事件，不能 remove，只能隐藏。
  cardsPane.hidden = true;
  cardsPane.style.display = 'none';
}

/** 隐藏已由 Vue 接管的控件，但保留 input 供迁移期业务桥触发旧游戏逻辑。 */
function prepareVueSettingsMount(settingsPane: HTMLElement | undefined): void {
  if (!settingsPane) return;
  let mountElement = settingsPane.querySelector<HTMLElement>(`#${VUE_SETTINGS_DISPLAY_MOUNT_ID}`);
  if (!mountElement) {
    mountElement = document.createElement('div');
    mountElement.id = VUE_SETTINGS_DISPLAY_MOUNT_ID;
    settingsPane.prepend(mountElement);
  }

  for (const inputId of FULLY_MIGRATED_DISPLAY_SWITCH_IDS) {
    const input = settingsPane.querySelector<HTMLInputElement>(`#${inputId}`);
    // 游戏内覆盖层已有独立渲染器，先通知旧实现销毁 Laya 节点，再删除旧控件。
    if (input?.checked) {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input?.closest('.switch-container')?.remove();
  }
  settingsPane.querySelectorAll<HTMLElement>('.switch-container-row').forEach((row) => {
    const controls = Array.from(row.querySelectorAll<HTMLElement>(':scope > .switch-container'));
    if (controls.length && controls.every((control) => control.hidden)) row.hidden = true;
  });
}

function readPanelLabel(panel: HTMLElement): string {
  const title = panel.querySelector<HTMLElement>('.panel-title')
    ?? panel.querySelector<HTMLElement>(':scope > .panel-header');
  return title?.textContent?.trim() || '';
}
