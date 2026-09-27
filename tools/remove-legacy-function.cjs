const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const functionNames = new Set(process.argv.slice(2));
if (!functionNames.size) {
  throw new Error('请提供至少一个需要删除的 legacy 函数名');
}

const sourcePath = path.join(__dirname, '..', 'src', 'legacy', 'xiaochao-legacy.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const syntaxTree = acorn.parse(source, {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowHashBang: true
});
const matchedFunctions = [];

function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && functionNames.has(node.id?.name)) {
    matchedFunctions.push({ name: node.id.name, start: node.start, end: node.end });
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}

visit(syntaxTree);
for (const functionName of functionNames) {
  const matches = matchedFunctions.filter((item) => item.name === functionName);
  if (matches.length !== 1) {
    throw new Error(`${functionName} 应唯一匹配一个函数，实际匹配 ${matches.length} 个`);
  }
}

let rewrittenSource = source;
for (const match of matchedFunctions.sort((left, right) => right.start - left.start)) {
  rewrittenSource = rewrittenSource.slice(0, match.start) + rewrittenSource.slice(match.end);
  console.log(`Removed legacy function ${match.name} (${match.end - match.start} characters).`);
}
fs.writeFileSync(sourcePath, rewrittenSource);
