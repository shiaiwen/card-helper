import { computed, ref, type Ref } from 'vue';

/** 从旧面板解析出的四个一级页面，顺序与原脚本保持一致。 */
export const XIAOCHAO_PANEL_TABS = [
  { id: 'cards', label: '卡牌' },
  { id: 'rogue', label: '山河图' },
  { id: 'settings', label: '配置' },
  { id: 'tools', label: '工具' }
] as const;

export type XiaochaoPanelTabId = typeof XIAOCHAO_PANEL_TABS[number]['id'];

export interface XiaochaoPanelModel {
  isCollapsed: Ref<boolean>;
  activeTabId: Ref<XiaochaoPanelTabId>;
  activeTabLabel: Readonly<Ref<string>>;
  toggleCollapsed(): void;
  selectTab(tabId: XiaochaoPanelTabId): void;
}

/**
 * 面板的纯 UI 状态。它不读取游戏全局对象，也不直接写 localStorage；持久化由
 * 平台适配器在上层完成，因此 Electron 和油猴可以复用同一套交互逻辑。
 */
export function createXiaochaoPanelModel(
  initialTabId: XiaochaoPanelTabId = 'settings',
  onTabSelected?: (tabId: XiaochaoPanelTabId) => void,
  initialCollapsed = false,
  onCollapsedChanged?: (collapsed: boolean) => void
): XiaochaoPanelModel {
  const isCollapsed = ref(initialCollapsed);
  const activeTabId = ref<XiaochaoPanelTabId>(initialTabId);
  const activeTabLabel = computed(() => (
    XIAOCHAO_PANEL_TABS.find((tab) => tab.id === activeTabId.value)?.label || ''
  ));

  function toggleCollapsed(): void {
    isCollapsed.value = !isCollapsed.value;
    onCollapsedChanged?.(isCollapsed.value);
  }

  function selectTab(tabId: XiaochaoPanelTabId): void {
    if (XIAOCHAO_PANEL_TABS.some((tab) => tab.id === tabId)) {
      activeTabId.value = tabId;
      onTabSelected?.(tabId);
    }
  }

  return { isCollapsed, activeTabId, activeTabLabel, toggleCollapsed, selectTab };
}
