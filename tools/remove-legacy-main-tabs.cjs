const fs = require('node:fs');
const acorn = require('acorn');

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node tools/remove-legacy-main-tabs.cjs <legacy-file>');

const source = fs.readFileSync(filePath, 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
let targetStatement;

function visit(node, parent) {
  if (!node || targetStatement || typeof node !== 'object') return;
  if (
    node.type === 'FunctionExpression' &&
    node.id?.name === 'Kp' &&
    source.slice(node.start, node.end).includes('tab-bar\\x20xc-main-tabs') &&
    parent?.type === 'CallExpression'
  ) {
    targetStatement = parent;
    while (targetStatement && targetStatement.type !== 'ExpressionStatement') {
      targetStatement = targetStatement.__parent;
    }
    return;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object') {
          Object.defineProperty(child, '__parent', { value: node, configurable: true });
          visit(child, node);
        }
      }
    } else if (value && typeof value === 'object' && value.type) {
      Object.defineProperty(value, '__parent', { value: node, configurable: true });
      visit(value, node);
    }
  }
}

visit(tree, null);
if (!targetStatement) throw new Error('Legacy main-tab controller was not found.');

const replacement = 'window.__XIAOCHAO_ENGINEERING__?.mountPanelShell?.()?.prepareLegacyTabPanes?.();\n            wA();';
const updated = source.slice(0, targetStatement.start) + replacement + source.slice(targetStatement.end);
fs.writeFileSync(filePath, updated, 'utf8');
console.log('Removed legacy main-tab DOM, state and click controller.');
