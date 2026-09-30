const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
for (const file of ['main.cjs','interceptor.cjs','shared-store.cjs','report-window.cjs','script/electron_frame.cjs','script/electron_renderer.cjs','dist/electron/xiaochao.js','dev-main.cjs']) {
  new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
}
const html = fs.readFileSync(path.join(root,'index_wd.html'),'utf8').replace(/<!--[\s\S]*?-->/g, '');
for (const [,file] of html.matchAll(/(?:src|preload)=["']([^"']+)["']/g)) {
  if (!/^https?:/.test(file) && !fs.existsSync(path.join(root,file))) throw new Error('Missing resource: '+file);
}
console.log('Electron source syntax and HTML resource checks passed.');
