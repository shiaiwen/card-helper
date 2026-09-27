const fs = require('node:fs');
const path = require('node:path');
const { waitForRuntime } = require('../script/runtime-startup.cjs');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, '../readable/xiaochao.js'), 'utf8');
const start = source.indexOf('      function rR() {');
const end = source.indexOf('      function rQ() {', start);
if (start < 0 || end < 0 || !source.slice(start,end).includes('等待游戏运行时初始化超时')) throw Error('Unexpected source layout');
const replacement = `      function rR() {
  const waitForRuntime = ${waitForRuntime.toString()};
  window.WDVerSion = '1.0.0';
  window.padding = nS.padding || 0;
  rt();
  Q(window, 'resize', rt);
  const status = window.__XIAOCHAO_STARTUP__ = {};
  return waitForRuntime({
    status,
    registerCleanup: R,
    probe() {
      if (typeof PUERTS_JS_RESOURCES !== 'undefined') return [];
      const missing = [];
      if (typeof JSZipUtils === 'undefined') missing.push('JSZipUtils');
      if (typeof CtrUtil === 'undefined' || typeof CtrUtil?.Ctr?.Ofb_Dec === 'undefined') missing.push('CtrUtil.Ctr.Ofb_Dec');
      if (typeof SystemContext === 'undefined') missing.push('SystemContext');
      if (!document.getElementById('bgDiv')) missing.push('bgDiv');
      return missing;
    },
    async initialize() {
      if (typeof JSZipUtils === 'undefined' || typeof CtrUtil === 'undefined' || typeof CtrUtil?.Ctr?.Ofb_Dec === 'undefined' || typeof SystemContext === 'undefined' || !document.getElementById('bgDiv')) { rb(); return true; }
      rG();
      const ready = await rx(true);
      pd();
      if (ready) { rb(); Ax(); Ll('startup'); }
      return ready;
    }
  });
}
`;
fs.writeFileSync(path.join(root,'xiaochao.js'),source.slice(0,start)+replacement+source.slice(end));
console.log('Patched runtime startup: readiness polling with lifecycle cleanup.');
