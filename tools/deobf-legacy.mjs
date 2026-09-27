// 一次性分析工具：把 src/legacy 的字符串表解码，产出可读副本，仅供逆向参考。
import fs from 'node:fs';

const src = fs.readFileSync(process.argv[2] ?? 'src/legacy/xiaochao-legacy.js', 'utf8');

const cStart = src.indexOf('\n  function c() {');
if (cStart < 0) throw new Error('no c()');
const cBody = src.slice(cStart, src.lastIndexOf('    return c();\n  }') + '    return c();\n  }'.length);
const sStart = src.indexOf('\n  function S(g, h) {');
const sBody = src.slice(sStart, cStart);
const rotStart = src.indexOf('  (function (g, h) {');
const rotEnd = src.indexOf('})(c, 0x672c0)', rotStart) + '})(c, 0x672c0)'.length;
const rot = src.slice(rotStart, rotEnd);

const code = `${cBody}\n${sBody}\n${rot};\nreturn S;`;
const S = new Function(code)();

const OUT = process.argv[3] ?? '.dev-data/legacy-deobf.js';
let text = src;

// 收集字符串表别名（`const c5n = S,` 之类）。
const aliases = new Set(['S']);
for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*S\b/g)) {
  aliases.add(m[1]);
}

const aliasRe = /(^|[^.\w$])([A-Za-z_$][\w$]*)\(\s*(0x[0-9a-fA-F]+)\s*,?\s*\)/g;
text = text.replace(aliasRe, (m, lead, name, hex) => {
  if (!aliases.has(name)) return m;
  const v = S(Number(hex));
  return typeof v === 'string' ? lead + JSON.stringify(v) : m;
});

// ["prop"] → .prop（合法标识符）；多轮以处理嵌套。
for (let i = 0; i < 3; i += 1) {
  text = text.replace(/\?\.\s*\[\s*"([A-Za-z_$][\w$]*)"\s*\]/g, '?.$1');
  text = text.replace(/([A-Za-z_$\w)\]])\[\s*"([A-Za-z_$][\w$]*)"\s*\]/g, '$1.$2');
}
fs.mkdirSync('.dev-data', { recursive: true });
fs.writeFileSync(OUT, text);
console.log('written', OUT, text.length);
