import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LEGACY_TY_HOOK_BUTTON_IDS,
  prepareLegacyTabPanes
} from '../src/ui/legacy/prepare-legacy-tab-panes.ts';

type FakeNode = {
  id: string;
  tagName: string;
  className: string;
  hidden: boolean;
  style: { display: string; setProperty(name: string, value: string, priority?: string): void };
  parentElement: FakeNode | null;
  childNodes: FakeNode[];
  attributes: Map<string, string>;
  dataset: Record<string, string>;
  textContent: string;
  closest(selector: string): FakeNode | null;
  querySelector(selector: string): FakeNode | null;
  querySelectorAll(selector: string): FakeNode[];
  matches(selector: string): boolean;
  remove(): void;
  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode;
  append(...nodes: FakeNode[]): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  contains(node: FakeNode): boolean;
};

function createNode(tagName: string, attrs: Record<string, string> = {}): FakeNode {
  const styleStore: Record<string, string> = {};
  const node: FakeNode = {
    id: attrs.id || '',
    tagName: tagName.toUpperCase(),
    className: attrs.class || '',
    hidden: false,
    style: {
      get display() {
        return styleStore.display || '';
      },
      set display(value: string) {
        styleStore.display = value;
      },
      setProperty(name: string, value: string) {
        styleStore[name] = value;
      }
    },
    parentElement: null,
    childNodes: [],
    attributes: new Map(Object.entries(attrs)),
    dataset: {},
    textContent: '',
    closest(selector: string) {
      let current: FakeNode | null = node;
      while (current) {
        if (current.matches(selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    querySelector(selector: string) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      const out: FakeNode[] = [];
      const visit = (current: FakeNode) => {
        if (current !== node && current.matches(selector)) out.push(current);
        for (const child of current.childNodes) visit(child);
      };
      visit(node);
      return out;
    },
    matches(selector: string) {
      if (selector.startsWith('#')) return node.id === selector.slice(1);
      if (selector.startsWith('.')) {
        return node.className.split(/\s+/).includes(selector.slice(1));
      }
      if (selector.includes('[')) {
        // data-xc-tab="tools"
        const match = selector.match(/^([.[#\w-]*)\[([^=]+)=["']?([^"'\]]+)["']?\]$/);
        if (!match) return false;
        const [, base, attr, value] = match;
        if (base && !node.matches(base)) return false;
        if (attr === 'data-xc-tab') return node.dataset.xcTab === value;
        return node.attributes.get(attr) === value;
      }
      if (selector.includes(',')) {
        return selector.split(',').map((part) => part.trim()).some((part) => node.matches(part));
      }
      if (selector.includes(' ')) {
        // not needed for this test
        return false;
      }
      if (selector.includes('>')) {
        return false;
      }
      if (selector === 'button.calRes' || selector === 'button') {
        return node.tagName === 'BUTTON' && (selector === 'button' || node.className.split(/\s+/).includes('calRes'));
      }
      if (selector === '.calRes-group > button') {
        return false;
      }
      if (selector.startsWith(':scope')) return false;
      return node.tagName === selector.toUpperCase();
    },
    remove() {
      if (!node.parentElement) return;
      node.parentElement.childNodes = node.parentElement.childNodes.filter((child) => child !== node);
      node.parentElement = null;
    },
    insertBefore(child: FakeNode, ref: FakeNode | null) {
      if (child.parentElement) child.remove();
      child.parentElement = node;
      if (!ref) {
        node.childNodes.push(child);
        return child;
      }
      const index = node.childNodes.indexOf(ref);
      if (index < 0) node.childNodes.push(child);
      else node.childNodes.splice(index, 0, child);
      return child;
    },
    append(...nodes: FakeNode[]) {
      for (const child of nodes) {
        if (child.parentElement) child.remove();
        child.parentElement = node;
        node.childNodes.push(child);
      }
    },
    setAttribute(name: string, value: string) {
      node.attributes.set(name, value);
      if (name === 'data-migrated-to-vue') node.dataset.migratedToVue = value;
      if (name === 'data-xc-tab') node.dataset.xcTab = value;
      if (name === 'id') node.id = value;
      if (name === 'class') node.className = value;
    },
    getAttribute(name: string) {
      return node.attributes.get(name) ?? null;
    },
    contains(other: FakeNode) {
      if (other === node) return true;
      return node.childNodes.some((child) => child.contains(other));
    }
  };
  if (attrs['data-xc-tab']) node.dataset.xcTab = attrs['data-xc-tab'];
  return node;
}

function buildToolsContent(): { content: FakeNode; documentObject: { getElementById(id: string): FakeNode | null; querySelectorAll(selector: string): FakeNode[]; dispatchEvent(): boolean } } {
  const content = createNode('div', { id: 'iframe-source' });
  const legacyContent = createNode('div', { id: 'content' });
  const toolsPane = createNode('div', { class: 'tab-pane xc-main-tab-pane', 'data-xc-tab': 'tools' });
  toolsPane.className = 'tab-pane xc-main-tab-pane';
  toolsPane.dataset.xcTab = 'tools';
  const roguePane = createNode('div', { class: 'tab-pane xc-main-tab-pane', 'data-xc-tab': 'rogue' });
  roguePane.className = 'tab-pane xc-main-tab-pane';
  roguePane.dataset.xcTab = 'rogue';
  const layaDiv = createNode('div', { id: 'layaDiv' });
  const group = createNode('div', { class: 'calRes-group' });
  group.className = 'calRes-group';

  const makeButton = (id: string) => {
    const button = createNode('button', { id, class: 'calRes' });
    button.className = 'calRes';
    button.id = id;
    return button;
  };

  const row1 = createNode('div', { class: 'tool-pair-row' });
  row1.className = 'tool-pair-row';
  row1.append(makeButton('goutuo'), makeButton('redDot'));
  const row2 = createNode('div', { class: 'tool-pair-row' });
  row2.className = 'tool-pair-row';
  row2.append(makeButton('pifu'), makeButton('baisheng'));
  const row3 = createNode('div', { class: 'tool-pair-row' });
  row3.className = 'tool-pair-row';
  row3.append(makeButton('gamerecord'), makeButton('guanxing'));
  const row4 = createNode('div', { class: 'goods-report-row' });
  row4.className = 'goods-report-row';
  row4.append(makeButton('goodsreport'));

  group.append(row1, row2, row3, row4);
  layaDiv.append(group, createNode('div', { id: 'secKillPanel' }));
  toolsPane.append(layaDiv);

  const switchContainer = createNode('div', { class: 'switch-container' });
  switchContainer.className = 'switch-container';
  const switchLabel = createNode('label', { class: 'switch' });
  switchLabel.className = 'switch';
  const citySwitch = createNode('input', { id: 'rogueCitySwitch', type: 'checkbox' });
  citySwitch.id = 'rogueCitySwitch';
  switchLabel.append(citySwitch);
  switchContainer.append(switchLabel);
  const openStore = createNode('button', { id: 'openStore' });
  openStore.id = 'openStore';
  roguePane.append(switchContainer, openStore);

  legacyContent.append(toolsPane, roguePane);
  content.append(legacyContent);

  const documentObject = {
    getElementById(id: string) {
      if (content.id === id) return content;
      return content.querySelector(`#${id}`);
    },
    querySelector(selector: string) {
      return content.querySelector(selector);
    },
    querySelectorAll(selector: string) {
      return content.querySelectorAll(selector);
    },
    dispatchEvent() {
      return true;
    }
  };

  // enhance matches for compound selectors used by trimToolsPane
  const originalMatches = createNode('div').matches;
  const patch = (node: FakeNode) => {
    const baseMatches = node.matches.bind(node);
    node.matches = (selector: string) => {
      if (selector === 'button.calRes, .calRes-group > button') {
        return (node.tagName === 'BUTTON' && node.className.split(/\s+/).includes('calRes'))
          || (node.tagName === 'BUTTON' && node.parentElement?.className.split(/\s+/).includes('calRes-group'));
      }
      if (selector === '.tool-pair-row, .goods-report-row') {
        return node.className.split(/\s+/).includes('tool-pair-row')
          || node.className.split(/\s+/).includes('goods-report-row');
      }
      if (selector === '.calRes-group') return node.className.split(/\s+/).includes('calRes-group');
      if (selector === '.xc-meta-footer') return node.className.split(/\s+/).includes('xc-meta-footer');
      if (selector === '.xc-main-tab-pane[data-xc-tab]') {
        return node.className.split(/\s+/).includes('xc-main-tab-pane') && Boolean(node.dataset.xcTab);
      }
      if (selector === ':scope > .xc-main-tab-pane') {
        return false;
      }
      if (selector === 'button') return node.tagName === 'BUTTON';
      return baseMatches(selector);
    };
    for (const child of node.childNodes) patch(child);
  };
  patch(content);

  // Fix :scope > .xc-main-tab-pane on legacyContent
  const legacyQueryAll = legacyContent.querySelectorAll.bind(legacyContent);
  legacyContent.querySelectorAll = (selector: string) => {
    if (selector === ':scope > .xc-main-tab-pane') {
      return legacyContent.childNodes.filter((child) => (
        child.className.split(/\s+/).includes('xc-main-tab-pane')
      ));
    }
    if (selector === ':scope > .tab-bar.xc-main-tabs') return [];
    return legacyQueryAll(selector);
  };

  void originalMatches;
  return { content, documentObject };
}

describe('prepareLegacyTabPanes 工具页钩子', () => {
  it('钩子按钮 id 覆盖 ty() 会直接写 onclick 的全部节点', () => {
    for (const id of [
      'guanxing',
      'redDot',
      'goutuo',
      'baisheng',
      'gamerecord',
      'goodsreport',
      'pifu'
    ]) {
      assert.equal(LEGACY_TY_HOOK_BUTTON_IDS.has(id), true, id);
    }
  });

  it('只隐藏不删除 ty 钩子按钮，并保留山河地图开关', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const { content, documentObject } = buildToolsContent();

    globalThis.document = documentObject as unknown as Document;
    globalThis.window = {
      document: documentObject,
      dispatchEvent: () => true,
      addEventListener() {},
      removeEventListener() {}
    } as unknown as Window & typeof globalThis;

    try {
      prepareLegacyTabPanes(content as unknown as HTMLElement);

      for (const id of LEGACY_TY_HOOK_BUTTON_IDS) {
        const button = documentObject.getElementById(id);
        assert.ok(button, `应保留 #${id}`);
        assert.equal(button.hidden, true);
        assert.equal(button.getAttribute('data-migrated-to-vue'), 'true');
      }

      assert.ok(documentObject.getElementById('rogueCitySwitch'), '应保留 #rogueCitySwitch');
      assert.ok(documentObject.getElementById('openStore'), '应保留 #openStore');
    } finally {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  });
});
