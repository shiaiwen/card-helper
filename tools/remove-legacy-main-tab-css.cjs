const fs = require('node:fs');
const acorn = require('acorn');

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node tools/remove-legacy-main-tab-css.cjs <legacy-file>');

const source = fs.readFileSync(filePath, 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
let templateLiteral;

function visit(node) {
  if (!node || templateLiteral || typeof node !== 'object') return;
  if (
    node.type === 'VariableDeclarator' && node.id?.name === 'S8' &&
    node.init?.type === 'Literal' && typeof node.init.value === 'string'
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

const startMarker = '.tab-bar,\n.xc-main-tabs {';
const endMarker = '/* 主面板四个 tab 的统一内容容器；';
const start = templateLiteral.value.indexOf(startMarker);
const end = templateLiteral.value.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Legacy main-tab CSS section was not found.');

const html = templateLiteral.value.slice(0, start) + templateLiteral.value.slice(end);
const updated = source.slice(0, templateLiteral.start) + JSON.stringify(html) + source.slice(templateLiteral.end);
fs.writeFileSync(filePath, updated, 'utf8');
console.log('Removed legacy main-tab button CSS from S8.');
