const fs = require('node:fs');
const acorn = require('acorn');

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node tools/remove-legacy-panel-collapse-css.cjs <legacy-file>');

const source = fs.readFileSync(filePath, 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
let templateLiteral;

function visit(node) {
  if (!node || templateLiteral || typeof node !== 'object') return;
  if (
    node.type === 'VariableDeclarator' &&
    node.id?.type === 'Identifier' &&
    node.id.name === 'S8' &&
    node.init?.type === 'Literal' &&
    typeof node.init.value === 'string'
  ) {
    templateLiteral = node.init;
    return;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}

visit(tree);

if (!templateLiteral) throw new Error('Legacy HTML template S8 was not found.');

const collapseStyleStart = '/* 窗口折叠/展开：';
const collapseStyleEnd = '#frame-resize-handle {';
const glowStyleStart = '/* 折叠跑马灯样式已改为注入';
const glowStyleEnd = '::-webkit-scrollbar {';

let html = templateLiteral.value;

function removeSection(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Expected legacy CSS section was not found: ${startMarker}`);
  }
  html = html.slice(0, start) + html.slice(end);
}

removeSection(collapseStyleStart, collapseStyleEnd);
removeSection(glowStyleStart, glowStyleEnd);

// Vue owns the toggle styling, so the old template no longer needs this selector.
html = html.replace(',\n#createIframe .xc-frame-toggle', '');

const replacement = JSON.stringify(html);
const updated = source.slice(0, templateLiteral.start) + replacement + source.slice(templateLiteral.end);
fs.writeFileSync(filePath, updated, 'utf8');
console.log('Removed legacy panel collapse CSS from S8.');
