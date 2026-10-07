/**
 * 本地开发启动器：在加载正式 main.cjs 之前配置隔离环境。
 *
 * - 将 userData 指到仓库内 .dev-data，避免污染正式微端数据；
 * - 关闭首次公告、清理过期远程脚本配置项；
 * - 可选诊断模式（SGSOL_DIAGNOSTICS=1）轮询 webview 健康、明牌/皮肤追踪、probe.js；
 * - 将渲染进程错误与加载失败写入 .dev-data/runtime.log。
 *
 * 用法：electron 指向本文件（或 npm 脚本包装），最终 require('./main.cjs')。
 */

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
// 尽早关掉 Chromium 文件日志，避免在仓库里生成 debug.log
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-file', process.platform === 'win32' ? 'NUL' : '/dev/null');
// 默认保留硬件加速（游戏 WebGL 需要）；仅诊断 GPU 问题时再开软件渲染。
if (process.env.SGSOL_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration();
process.chdir(root);
const data = path.join(root, '.dev-data');
fs.mkdirSync(path.join(data, 'xiaochao'), { recursive: true });
app.setPath('userData', data);
const configPath = path.join(data, 'xiaochao/config.json');
/** 为 1 时启用 webview 健康探针、明牌/皮肤 trace 与 probe.js 热执行。 */
const diagnosticsEnabled = process.env.SGSOL_DIAGNOSTICS === '1';
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
Object.assign(config, { firstTime: false, firstTimeAnnouncementSeen: true });
delete config.scriptUrl;
delete config.autoUpdateEnabled;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const logPath = path.join(data, 'runtime.log');
fs.writeFileSync(logPath, '');
/** 追加 JSON 行到 runtime.log；URL 只保留 origin+pathname。 */
function log(event, detail) {
  fs.appendFileSync(logPath, JSON.stringify({ time: new Date().toISOString(), event, detail }, (key, value) => {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) { try { const u = new URL(value); return u.origin + u.pathname; } catch {} }
    return value;
  }) + '\n');
}
process.on('uncaughtException', error => { log('uncaughtException', error.stack); console.error(error); });
process.on('unhandledRejection', error => { log('unhandledRejection', String(error?.stack || error)); console.error(error); });
app.on('web-contents-created', (_, contents) => {
  // 这些主动探针会向游戏 WebContents 频繁排入 executeJavaScript/capturePage；
  // 只在明确诊断时启用，避免普通开发游玩时监控本身拖慢或堵住游戏页。
  if (contents.getType() === 'webview' && diagnosticsEnabled) {
    let lastStatus = '';
    const monitor = setInterval(async () => {
      if (contents.isDestroyed()) { clearInterval(monitor); return; }
      try {
        const state = await contents.executeJavaScript(`(()=>{const bridge=window.__XIAOCHAO_ENGINEERING__;const deck=bridge?.getDeckRecordState?.();const sampleId=deck?.currentTurnDiscardCardIds?.[0]||deck?.discardCardIds?.[0]||0;const sample=sampleId?bridge?.resolveGameCard?.(sampleId):null;const deckSection=document.querySelector('.xc-deck-record');const emptySlots=[...document.querySelectorAll('.xc-deck-record__cards')].map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,display:getComputedStyle(node).display}));return {path:location.pathname,bridge:typeof window.electron,injected:!!window.__XIAOCHAO_MICROCLIENT_INJECTED__,startup:window.__XIAOCHAO_STARTUP__||null,modules:window.SGSMODULE?.length||0,panel:!!document.getElementById('createIframe'),canvas:document.querySelectorAll('canvas').length,messageQueue:Array.isArray(window.VIiR0YfvE4s)?window.VIiR0YfvE4s.length:null,cardDictionary:Object.keys(window.__XIAOCHAO_OFFICIAL_CARD_DICTIONARY__||{}).length,cardSample:sample?{id:sample.cardId,name:sample.name,suit:sample.suit,rank:sample.rank,artworkLength:sample.artworkUrl?.length||0}:null,deckSection:deckSection?{width:deckSection.getBoundingClientRect().width,height:deckSection.getBoundingClientRect().height,display:getComputedStyle(deckSection).display}:null,emptySlots,deck:deck?{movements:deck.movements?.length||0,discard:deck.discardCardIds?.length||0,currentTurnDiscard:deck.currentTurnDiscardCardIds?.length||0,deckTop:deck.deckTopCardIds?.length||0,deckBottom:deck.deckBottomCardIds?.length||0}:null}})()`);
        const encoded = JSON.stringify(state);
        if (encoded !== lastStatus) { lastStatus = encoded; log('game-health', state); fs.writeFileSync(path.join(data, 'game-health.json'),JSON.stringify(state,null,2)); fs.writeFileSync(path.join(data,'webview-live.png'),(await contents.capturePage()).toPNG()); }
      } catch {}
    },5000);
    const tracePath = path.join(data, 'mingpai-trace.log');
    const traceMonitor = setInterval(async () => {
      if (contents.isDestroyed()) { clearInterval(traceMonitor); return; }
      try {
        // 取走即清空，座位快照去重也放在页面内，多个监控实例或页面刷新都不会重复写。
        const result = await contents.executeJavaScript(`(()=>{const bridge=window.__XIAOCHAO_ENGINEERING__;const buffer=window.__XIAOCHAO_MINGPAI_TRACE__||[];const label=id=>{if(!(id>0))return String(id);const c=bridge?.resolveGameCard?.(id);return c?.name?(c.name+(c.suitGlyph||'')+(c.rank||'')+'#'+id):('#'+id);};const withNames=d=>{const o={...d};for(const k of ['cardIds','rawIds','resolvedIds'])if(Array.isArray(o[k]))o[k]=o[k].map(label);return o;};const entries=buffer.splice(0).map(e=>({...e,detail:withNames(e.detail)}));const seat=bridge?.getSeatState?.();const digest=JSON.stringify({inGame:!!seat?.inGame,mode:seat?.mode,self:seat?.selfSeatId,controlled:seat?.controlledSeatIds,seats:(seat?.seats||[]).map(s=>({seat:s.seatId,name:s.playerName,self:s.isSelf,known:s.knownCards.map(c=>label(c.cardId)+(c.tags.length?'['+c.tags.join(',')+']':'')),unknown:s.unknownCardCount}))});const changed=digest!==window.__XIAOCHAO_TRACE_SEAT_DIGEST__;window.__XIAOCHAO_TRACE_SEAT_DIGEST__=digest;return {entries,seats:changed?digest:null};})()`);
        const lines = result.entries.map((entry) => JSON.stringify({ t: new Date(entry.time).toISOString().slice(11, 23), kind: entry.kind, ...entry.detail }));
        if (result.seats) lines.push(JSON.stringify({ t: new Date().toISOString().slice(11, 23), kind: 'seats', ...JSON.parse(result.seats) }));
        if (lines.length) fs.appendFileSync(tracePath, lines.join('\n') + '\n');
      } catch {}
    }, 2000);
    const skinTracePath = path.join(data, 'skin-trace.log');
    const skinTraceMonitor = setInterval(async () => {
      if (contents.isDestroyed()) { clearInterval(skinTraceMonitor); return; }
      try {
        const entries = await contents.executeJavaScript(`(window.__XIAOCHAO_SKIN_TRACE__||[]).splice(0)`);
        if (entries.length) fs.appendFileSync(skinTracePath, entries.map((entry) => JSON.stringify({ t: new Date(entry.time).toISOString().slice(11, 23), kind: entry.kind, ...entry.detail })).join('\n') + '\n');
      } catch {}
    }, 2000);
    // 修改 .dev-data/probe.js 即在游戏页执行一次，结果写入 probe-result.json 与 probe.png。
    const probePath = path.join(data, 'probe.js');
    let lastProbe = '';
    const probeMonitor = setInterval(async () => {
      if (contents.isDestroyed() || !fs.existsSync(probePath)) return;
      const source = fs.readFileSync(probePath, 'utf8');
      if (!source.trim() || source === lastProbe) return;
      lastProbe = source;
      let result;
      try { result = await contents.executeJavaScript(source); } catch (error) { result = { probeError: String(error?.stack || error) }; }
      try { fs.writeFileSync(path.join(data, 'probe-result.json'), JSON.stringify(result, null, 2)); } catch (error) { fs.writeFileSync(path.join(data, 'probe-result.json'), JSON.stringify({ serializeError: String(error) })); }
      try { fs.writeFileSync(path.join(data, 'probe.png'), (await contents.capturePage()).toPNG()); } catch {}
    }, 1000);
    contents.once('destroyed',()=>{ clearInterval(monitor); clearInterval(traceMonitor); clearInterval(skinTraceMonitor); clearInterval(probeMonitor); });
  }
  contents.on('console-message', details => {
    if (details.level === 'error' || details.level === 3) log('renderer-error', {message: details.message, source: details.sourceId, line: details.lineNumber});
  });
  contents.on('preload-error', (_, file, error) => log('preload-error', {file, error:String(error)}));
  contents.on('render-process-gone', (_, details) => log('render-process-gone', details));
  contents.on('did-fail-load', (_, code, description, url, mainFrame) => log('did-fail-load', {code,description,url,mainFrame}));
  contents.on('did-finish-load', () => {
    log('did-finish-load', {type:contents.getType(),url:contents.getURL()});
    if(diagnosticsEnabled && contents.getType()==='webview') setTimeout(async()=>{
      try {
        log('webview-status',await contents.executeJavaScript(`({title:document.title,bodyLength:document.body?.innerText.length,htmlLength:document.body?.innerHTML.length,bridge:typeof window.electron,require:typeof require,images:document.images.length,width:innerWidth,height:innerHeight,loginInputs:document.querySelectorAll('#sgsPassApp input').length})`));
        fs.writeFileSync(path.join(data,'webview.png'),(await contents.capturePage()).toPNG());
      }catch(error){log('webview-probe-error',String(error));}
    },10000);
  });
});
app.on('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', () => {
    win.setTitle('SGSOL 本地开发版');
    if (!diagnosticsEnabled) return;
    setTimeout(async () => {
      if (win.isDestroyed()) return;
      try {
        const status = await win.webContents.executeJavaScript(`({title:document.title,readyState:document.readyState,images:[...document.images].map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0})),webviewUrl:document.querySelector('webview')?.getURL(),webviewBounds:document.querySelector('webview')?.getBoundingClientRect().toJSON()})`);
        fs.writeFileSync(path.join(data, 'startup-status.json'), JSON.stringify(status,null,2));
        fs.writeFileSync(path.join(data, 'startup.png'), (await win.webContents.capturePage()).toPNG());
        log('startup-status',status);
      } catch(error) { log('startup-probe-error',String(error)); }
    }, 15000);
  });
});
log('runtime', {electron:process.versions.electron,appPath:app.getAppPath(),data});
require('./main.cjs');
