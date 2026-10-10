/**
 * 把 release/wd-xc-<版本>.zip、app.zip 和 xiaochao-manifest.json 拷到 portal 的 public/downloads。
 * 网站上分别是 /downloads/wd-xc-<版本>.zip、/downloads/app.zip 和 /downloads/manifest.json。
 * 用法：
 *   npm run copy:portal
 *   npm run pack:portal   （先打包再拷贝）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseAppZip = path.join(root, 'release', 'app.zip');
const releaseManifest = path.join(root, 'release', 'xiaochao-manifest.json');
if (!existsSync(releaseManifest)) {
  console.error(`[portal] 缺少 ${releaseManifest}`);
  console.error('[portal] 请先执行 npm run pack，或直接 npm run pack:portal');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(releaseManifest, 'utf8'));
const zipName = `wd-xc-${String(manifest.version || '').trim()}.zip`;
const releaseZip = path.join(root, 'release', zipName);
const portalRoot = process.env.PORTAL_ROOT
  ? path.resolve(process.env.PORTAL_ROOT)
  : path.resolve(root, '..', 'sgs-xc-portal');
const portalDownloads = path.join(portalRoot, 'public', 'downloads');
const portalZip = path.join(portalDownloads, zipName);
const portalAppZip = path.join(portalDownloads, 'app.zip');
const portalManifest = path.join(portalDownloads, 'manifest.json');
const userscriptName = 'sgs-xc.user.js';
const releaseUserscript = path.join(root, 'dist', 'userscript', 'xiaochao.user.js');
const portalUserscript = path.join(portalDownloads, userscriptName);

if (!existsSync(releaseZip) || !existsSync(releaseAppZip) || !existsSync(releaseManifest) || !existsSync(releaseUserscript)) {
  console.error(`[portal] 缺少安装包、清单或 ${releaseUserscript}`);
  console.error('[portal] 请先执行 npm run pack，或直接 npm run pack:portal');
  process.exitCode = 1;
  process.exit();
}

if (!existsSync(portalRoot)) {
  console.error(`[portal] 找不到门户目录: ${portalRoot}`);
  console.error('[portal] 可用环境变量 PORTAL_ROOT 指定路径');
  process.exitCode = 1;
  process.exit();
}

mkdirSync(portalDownloads, { recursive: true });
for (const name of readdirSync(portalDownloads)) {
  if (!name.toLowerCase().endsWith('.zip')) continue;
  const target = path.join(portalDownloads, name);
  unlinkSync(target);
  console.log(`[portal] 已删除旧包 ${target}`);
}
copyFileSync(releaseZip, portalZip);
copyFileSync(releaseAppZip, portalAppZip);
copyFileSync(releaseManifest, portalManifest);
copyFileSync(releaseUserscript, portalUserscript);

const kb = (statSync(portalZip).size / 1024).toFixed(1);
console.log(`[portal] 已拷贝到 ${portalZip}`);
console.log(`[portal] 已拷贝到 ${portalAppZip}`);
console.log(`[portal] 已拷贝到 ${portalManifest}`);
console.log(`[portal] 已拷贝到 ${portalUserscript}`);
console.log(`[portal] ${kb} KB`);
console.log('[portal] 网站发布请到 sgs-xc-portal 目录执行 npm run deploy');
