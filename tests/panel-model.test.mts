import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createXiaochaoPanelModel,
  XIAOCHAO_PANEL_TABS
} from '../src/ui/panel/panel-model.ts';
import {
  installPanelShellStyles,
  PANEL_SHELL_CSS,
  PANEL_SHELL_STYLE_ID
} from '../src/ui/panel/panel-shell-styles.ts';
import { constrainPanelPosition, shouldDockToRight } from '../src/ui/panel/panel-drag.ts';
import {
  getOwnedPanelLayoutValue,
  setOwnedPanelLayout
} from '../src/ui/panel/panel-layout-ownership.ts';
import { calculateTooltipPosition } from '../src/ui/tooltip/tooltip-position.ts';
import { calculateDialogPosition } from '../src/ui/dialog/dialog-position.ts';

test('uses the parsed legacy tab order and defaults to settings', () => {
  assert.deepEqual(XIAOCHAO_PANEL_TABS.map((tab) => tab.label), [
    '卡牌', '山河图', '配置', '工具'
  ]);
  const panel = createXiaochaoPanelModel();
  assert.equal(panel.activeTabId.value, 'settings');
  assert.equal(panel.activeTabLabel.value, '配置');
});

test('toggles collapsed state without touching business state', () => {
  const collapsedStates: boolean[] = [];
  const panel = createXiaochaoPanelModel(
    'cards',
    undefined,
    true,
    (collapsed) => collapsedStates.push(collapsed)
  );
  assert.equal(panel.isCollapsed.value, true);
  panel.toggleCollapsed();
  assert.equal(panel.isCollapsed.value, false);
  assert.equal(panel.activeTabId.value, 'cards');
  panel.toggleCollapsed();
  assert.equal(panel.isCollapsed.value, true);
  assert.deepEqual(collapsedStates, [false, true]);
});

test('selects a valid tab', () => {
  const selectedTabs: string[] = [];
  const panel = createXiaochaoPanelModel('settings', (tabId) => selectedTabs.push(tabId));
  panel.selectTab('tools');
  assert.equal(panel.activeTabId.value, 'tools');
  assert.equal(panel.activeTabLabel.value, '工具');
  assert.deepEqual(selectedTabs, ['tools']);
});

test('installs the Vue panel shell styles once and removes the owned element', () => {
  const elements = new Map<string, any>();
  const head = {
    appendChild(element: any) {
      elements.set(element.id, element);
    }
  };
  const documentObject = {
    head,
    documentElement: head,
    getElementById(id: string) {
      return elements.get(id) || null;
    },
    createElement() {
      return {
        id: '',
        textContent: '',
        remove() {
          elements.delete(this.id);
        }
      };
    }
  } as unknown as Document;

  const dispose = installPanelShellStyles(documentObject);
  const disposeDuplicate = installPanelShellStyles(documentObject);
  assert.ok(elements.has(PANEL_SHELL_STYLE_ID));
  assert.equal(elements.size, 1);

  disposeDuplicate();
  assert.equal(elements.size, 1);
  dispose();
  assert.equal(elements.size, 0);
});

test('keeps Vue layout in namespaced variables instead of legacy-owned inline properties', () => {
  const values = new Map<string, string>();
  const panelElement = {
    style: {
      setProperty(name: string, value: string) {
        values.set(name, value);
      },
      removeProperty(name: string) {
        values.delete(name);
      },
      getPropertyValue(name: string) {
        return values.get(name) || '';
      }
    }
  } as unknown as HTMLElement;

  setOwnedPanelLayout(panelElement, {
    left: '24px',
    height: '28px',
    minHeight: '28px'
  });
  assert.equal(getOwnedPanelLayoutValue(panelElement, 'left'), '24px');
  assert.equal(getOwnedPanelLayoutValue(panelElement, 'height'), '28px');

  setOwnedPanelLayout(panelElement, { minHeight: undefined });
  assert.equal(getOwnedPanelLayoutValue(panelElement, 'minHeight'), '');
  assert.match(PANEL_SHELL_CSS, /left:\s*var\(--xc-panel-left, auto\) !important/);
  assert.match(PANEL_SHELL_CSS, /height:\s*var\(--xc-panel-height, 720px\) !important/);
});

test('keeps a dragged panel inside the game viewport', () => {
  assert.deepEqual(
    constrainPanelPosition({ left: -20, top: 900 }, { width: 300, height: 400 }, { width: 1000, height: 700 }),
    { left: 8, top: 292 }
  );
});

test('docks when the pointer or panel reaches the right edge', () => {
  assert.equal(shouldDockToRight(980, 900, 1000), true);
  assert.equal(shouldDockToRight(800, 978, 1000), true);
  assert.equal(shouldDockToRight(800, 900, 1000), false);
});

test('keeps tooltips inside the viewport and flips below near the top edge', () => {
  assert.deepEqual(
    calculateTooltipPosition(
      { left: 2, right: 42, top: 4, bottom: 24 },
      { width: 100, height: 30 },
      { width: 320, height: 200 }
    ),
    { left: 8, top: 32, placement: 'bottom' }
  );
  assert.deepEqual(
    calculateTooltipPosition(
      { left: 280, right: 310, top: 100, bottom: 120 },
      { width: 90, height: 30 },
      { width: 320, height: 200 }
    ),
    { left: 222, top: 62, placement: 'top' }
  );
});

test('centers dialogs on their anchor without leaving the viewport', () => {
  assert.deepEqual(
    calculateDialogPosition(
      { left: 900, right: 1200, top: 100, bottom: 700 },
      { width: 420, height: 500 },
      { width: 1200, height: 800 }
    ),
    { left: 768, top: 150 }
  );
  assert.deepEqual(
    calculateDialogPosition(
      { left: 0, right: 80, top: 0, bottom: 60 },
      { width: 300, height: 200 },
      { width: 800, height: 600 }
    ),
    { left: 12, top: 12 }
  );
});
