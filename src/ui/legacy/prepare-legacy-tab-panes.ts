import { ALL_BLOCK_SETTINGS } from '../../features/block-effects/block-effect-settings.ts';
import { LEGACY_AUTO_TASK_SWITCH_ID } from '../../features/auto-task/auto-task-settings.ts';
import { LEGACY_SKIN_BACKGROUND_INPUT_IDS } from '../../features/skin-background/skin-background-settings.ts';
import { placeToolsIdentity } from '../settings/tools-identity.ts';

export { placeToolsIdentity };
export const LEGACY_TAB_CONTENT_READY_EVENT = 'xiaochao:legacy-tab-content-ready';
const FULLY_MIGRATED_DISPLAY_SWITCH_IDS = [
  'seatUISwitch',
  'recentCardSwitch',
  'deckRecordSwitch',
  'countDownSwitch',
  'cardLabelSwitch'
] as const;

const TAB_LABEL_ORDER = ['卡牌', '山河图', '配置', '工具'] as const;
const TAB_ID_BY_LABEL: Record<typeof TAB_LABEL_ORDER[number], string> = {
  卡牌: 'cards',
  山河图: 'rogue',
  配置: 'settings',
  工具: 'tools'
};

/** legacy 页面按 `data-xc-tab` 查找；配置页会被移到“常规”页，不能依赖顺序下标。 */
export function findLegacyTabPane(tabId: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(`.xc-main-tab-pane[data-xc-tab="${tabId}"]`);
}

/**
 * 迁移期间把旧模板的四个 section 转成纯内容容器。
 * 此函数不创建标签按钮、不保存激活状态，也不注册点击事件；这些职责全部属于 Vue。
 */
export function prepareLegacyTabPanes(contentElement: HTMLElement): void {
  // app.bak 原实现使用 getElementById('content')；这里是 id，不是 <content> 标签。
  const legacyContent = contentElement.querySelector<HTMLElement>('#content');
  if (!legacyContent) return;
  removeMigratedBlockSettings(legacyContent);
  removeMigratedSkinBackgroundSettings(legacyContent);
  removeMigratedAutoTaskSettings(legacyContent);
  removeUnsupportedCardCustomization(legacyContent);
  hideDeferredGameAssistSwitches(legacyContent);
  removeGameAssistSectionTitle(legacyContent);
  trimRoguePane(legacyContent);
  trimToolsPane(legacyContent);
  // legacy 初始化可能晚于本次裁剪；短延迟再卸几次，避免隐藏对白关着仍被关窗。
  const schedule = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout.bind(window)
    : null;
  if (schedule) {
    for (const delay of [0, 500, 2000, 5000]) {
      schedule(() => disarmLegacyRogueSwitches(), delay);
    }
  } else {
    disarmLegacyRogueSwitches();
  }

  // 热更新或异常中断后可能残留旧控制器创建的横向栏，Vue 是唯一标签栏所有者。
  legacyContent.querySelectorAll(':scope > .tab-bar.xc-main-tabs').forEach((tabBar) => {
    tabBar.remove();
  });

  const existingPanes = legacyContent.querySelectorAll<HTMLElement>(
    ':scope > .xc-main-tab-pane'
  );
  if (existingPanes.length) {
    prepareVueSeatHandsMount(findLegacyTabPane('cards', legacyContent) ?? undefined);
    prepareVueSettingsMount(findLegacyTabPane('settings') ?? undefined);
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
    const label = readPanelLabel(panel) as typeof TAB_LABEL_ORDER[number];
    if (TAB_ID_BY_LABEL[label]) pane.dataset.xcTab = TAB_ID_BY_LABEL[label];
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

/** 屏蔽设置已由 Vue 接管；先关闭旧开关让 legacy 补丁透传，再删除入口和弹窗。 */
function removeMigratedBlockSettings(legacyContent: HTMLElement): void {
  for (const { legacyInputId } of ALL_BLOCK_SETTINGS) {
    const input = legacyContent.querySelector<HTMLInputElement>(`#${legacyInputId}`);
    if (!input?.checked) continue;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  legacyContent.querySelector('#openBlockEffectDialogBtn')?.remove();
  legacyContent.querySelector('#blockEffectDialog')?.remove();
}

/** 皮肤与背景已由 Vue 接管；与屏蔽设置相同，先关闭旧开关再删除入口和弹窗。 */
function removeMigratedSkinBackgroundSettings(legacyContent: HTMLElement): void {
  for (const inputId of LEGACY_SKIN_BACKGROUND_INPUT_IDS) {
    const input = legacyContent.querySelector<HTMLInputElement>(`#${inputId}`);
    if (!input) continue;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  legacyContent.querySelector('#openWallpaperDialogBtn')?.remove();
  legacyContent.querySelector('#wallpaperDialog')?.remove();
}

/** 自动领取已由 Vue 接管；先关闭总开关让 legacy 停止调度，再删除整组。 */
function removeMigratedAutoTaskSettings(legacyContent: HTMLElement): void {
  const input = legacyContent.querySelector<HTMLInputElement>(`#${LEGACY_AUTO_TASK_SWITCH_ID}`);
  if (input?.checked) {
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  input?.closest('.xc-section')?.remove();
}

/**
 * 暂缓：游戏辅助下「自动挂机 / 盖主速刷 / 进阶辅助」三个开关先往后放。
 * 只隐藏三列开关行，不影响同区块其它项。
 */
function hideDeferredGameAssistSwitches(legacyContent: HTMLElement): void {
  const row = legacyContent.querySelector<HTMLElement>('.xc-three-column-switch-row');
  if (row) {
    hideLegacyHookElement(row);
    return;
  }
  for (const inputId of ['autoBotSwitch', 'autoHGSwitch', 'extraAssistSwitch'] as const) {
    const input = legacyContent.querySelector<HTMLInputElement>(`#${inputId}`);
    const container = input?.closest<HTMLElement>('.switch-container');
    if (container) hideLegacyHookElement(container);
  }
}

/** 去掉「游戏辅助」分区标题，区块内容仍保留。 */
function removeGameAssistSectionTitle(legacyContent: HTMLElement): void {
  for (const title of legacyContent.querySelectorAll<HTMLElement>('.xc-section-title')) {
    if (title.textContent?.trim() !== '游戏辅助') continue;
    title.remove();
    return;
  }
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
  if (!interfaceRow || interfaceRow.querySelector('.interface-dialog-btn')) return;
  // 三个入口都已迁到 Vue，只剩空标题的“界面显示”分组一并删除。
  const section = interfaceRow.closest<HTMLElement>('.xc-section');
  interfaceRow.remove();
  if (section && !section.querySelector('.xc-section-body > *')) section.remove();
}

/**
 * 山河图页已由 Vue 接管三个功能：山河地图、隐藏对白、打开集市。
 * 本文件随 xiaochao-legacy 删除；此处只做过渡期卸开关，功能本体在 src/features/rogue。
 */
function disarmLegacyRogueSwitches(): void {
  try {
    const config = (window as unknown as { XC?: { globalConfig?: Record<string, unknown> } }).XC?.globalConfig;
    if (config) {
      config.rogueStorySwitch = false;
      config.rogueCitySwitch = false;
    }
  } catch {
    // ignore
  }
  try {
    window.localStorage.setItem('ROGUE_STORY_SWITCH', 'false');
  } catch {
    // ignore
  }
}

/**
 * 山河图页已由 Vue 接管：山河地图、隐藏对白、集市透视、打开集市。
 * 影响标注 / 资料站 / 流派 / 结局 / legacy 集市按钮区先摘掉。
 * `#rogueCitySwitch` 保留并关掉隐藏，防止过渡期 legacy 再画城池面板。
 * `#rogueStorySwitch` 先关闭再删除；并卸掉 globalConfig，避免 Vue 关着隐藏对白时仍被关窗。
 */
function trimRoguePane(legacyContent: HTMLElement): void {
  legacyContent.querySelector('.rogue-site-link')?.remove();

  for (const inputId of ['rogueImpactSwitch', 'rogueStorySwitch', 'rogueUploadSwitch'] as const) {
    const input = legacyContent.querySelector<HTMLInputElement>(`#${inputId}`);
    if (input?.checked) {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (inputId === 'rogueUploadSwitch') continue;
    input?.closest('.switch-container')?.remove();
  }
  disarmLegacyRogueSwitches();

  const school = legacyContent.querySelector('#rogueSchoolInfo');
  school?.closest('.xc-section')?.remove();

  const ending = legacyContent.querySelector('#rogueAttrInfo');
  ending?.closest('.xc-section')?.remove();

  // 集市预览区：打开逻辑已迁到 Vue。保留隐藏的 #openStore，避免 legacy tC() 空引用崩溃。
  const openStore = legacyContent.querySelector<HTMLButtonElement>('#openStore');
  const storeSection = openStore?.closest<HTMLElement>('.xc-section');
  if (storeSection) {
    storeSection.querySelector('#storeDetail')?.remove();
    storeSection.hidden = true;
    storeSection.style.display = 'none';
    storeSection.setAttribute('data-migrated-to-vue', 'true');
  }

  // 地图透视已由 TypeScript 独立绘制；强制关掉 legacy 开关并隐藏控件。
  const citySwitch = legacyContent.querySelector<HTMLInputElement>('#rogueCitySwitch');
  if (citySwitch?.checked) {
    citySwitch.checked = false;
    citySwitch.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const cityContainer = citySwitch?.closest<HTMLElement>('.switch-container');
  if (cityContainer) {
    cityContainer.hidden = true;
    cityContainer.style.display = 'none';
    cityContainer.setAttribute('data-migrated-to-vue', 'true');
  }
  const switchRow = cityContainer?.parentElement;
  if (switchRow) {
    switchRow.hidden = true;
    switchRow.style.display = 'none';
  }

  const roguePane = findLegacyTabPane('rogue', legacyContent);
  if (roguePane) {
    // 与卡牌页相同：节点保留给 legacy 初始化，界面改由 Vue 渲染。
    roguePane.hidden = true;
    roguePane.style.display = 'none';
  }
}

/**
 * legacy `ty()` 会不判空地给这些按钮写 onclick。
 * 界面已迁到 Vue，节点必须保留并隐藏，删除会导致整段初始化（含山河地图 `PI`/`Pm` 开关绑定）崩溃。
 */
export const LEGACY_TY_HOOK_BUTTON_IDS = new Set([
  'guanxing',
  'redDot',
  'goutuo',
  'baisheng',
  'gamerecord',
  'goodsreport',
  'pifu'
]);

function hideLegacyHookElement(element: HTMLElement): void {
  element.hidden = true;
  element.style.setProperty('display', 'none', 'important');
  element.setAttribute('data-migrated-to-vue', 'true');
}

/**
 * 工具页临时精简：界面只留 Vue 按钮。
 * `ty()` 仍要绑定的旧按钮只隐藏不删除，否则 `onclick` 空引用会让小抄初始化失败，山河地图永不绘制。
 */
function trimToolsPane(legacyContent: HTMLElement): void {
  const toolRoot = legacyContent.querySelector('#layaDiv') ?? legacyContent.querySelector('#laya') ?? legacyContent;

  for (const button of Array.from(toolRoot.querySelectorAll<HTMLElement>('button.calRes, .calRes-group > button'))) {
    if (LEGACY_TY_HOOK_BUTTON_IDS.has(button.id)) {
      hideLegacyHookElement(button);
      continue;
    }
    button.remove();
  }

  for (const panelId of [
    'secKillPanel',
    'chatFacePanel',
    'goodsFlowPanel'
  ]) {
    const panel = legacyContent.querySelector<HTMLElement>(`#${panelId}`);
    if (panel) hideLegacyHookElement(panel);
  }

  // 成对按钮行：钩子按钮提到 group 下并隐藏行；无钩子的空行直接删。
  toolRoot.querySelectorAll('.tool-pair-row, .goods-report-row').forEach((row) => {
    const hooks = Array.from(row.querySelectorAll<HTMLElement>('button')).filter((button) => (
      LEGACY_TY_HOOK_BUTTON_IDS.has(button.id)
    ));
    if (!hooks.length) {
      row.remove();
      return;
    }
    const group = row.parentElement;
    for (const button of hooks) {
      hideLegacyHookElement(button);
      group?.insertBefore(button, row);
    }
    hideLegacyHookElement(row as HTMLElement);
  });

  for (const id of ['guildName', 'guildID', 'vipRedeem', 'footerActionGroup']) {
    legacyContent.querySelector(`#${id}`)?.remove();
  }
  legacyContent.querySelector('.xc-version')?.remove();
  legacyContent.querySelector('.nav-divider.action-divider')?.remove();
  for (const group of Array.from(toolRoot.querySelectorAll<HTMLElement>('.calRes-group'))) {
    const hasHook = Array.from(group.querySelectorAll<HTMLElement>('button')).some((button) => (
      LEGACY_TY_HOOK_BUTTON_IDS.has(button.id)
    ));
    if (hasHook) {
      hideLegacyHookElement(group);
      continue;
    }
    const visibleButton = Array.from(group.querySelectorAll<HTMLElement>('button')).some((button) => !button.hidden);
    if (!visibleButton) group.remove();
  }
  legacyContent.querySelectorAll<HTMLElement>('.xc-meta-footer').forEach((footer) => {
    const hasHook = Array.from(footer.querySelectorAll<HTMLElement>('button')).some((button) => (
      LEGACY_TY_HOOK_BUTTON_IDS.has(button.id)
    ));
    if (hasHook) {
      hideLegacyHookElement(footer);
      return;
    }
    if (!footer.querySelector('button:not([hidden]), input, a')) footer.remove();
  });
  placeToolsIdentity(legacyContent);
}

export const GUANXING_PAGE_URL = 'https://gx.95chong.cn/';

/** 请求打开观星页面。微端会把它收成应用内窗口，而不是系统浏览器。 */
export function openGuanxingPage(): void {
  window.open(GUANXING_PAGE_URL, '_blank', 'noopener');
}

/** 卡牌页由 Vue 独立渲染；legacy 卡牌页整体隐藏，只为让 legacy 自身初始化不崩溃。 */
function prepareVueSeatHandsMount(cardsPane: HTMLElement | undefined): void {
  if (!cardsPane) return;
  // legacy 初始化（ty）会不判空地给 #mizhu 等节点绑事件，不能 remove，只能隐藏。
  cardsPane.hidden = true;
  cardsPane.style.display = 'none';
}

/** 删除已由 Vue 接管的旧开关，删除前先关闭以通知旧实现销毁其 Laya 节点。 */
function prepareVueSettingsMount(settingsPane: HTMLElement | undefined): void {
  if (!settingsPane) return;
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
