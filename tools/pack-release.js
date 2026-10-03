import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'tools', 'release-assets');
/** 已验证可启动的微端壳（不含 xiaochao.js）；打包时只替换脚本。 */
const shellDir = path.join(root, 'tools', 'release-app-shell');
const stagingRoot = path.join(root, 'release', '.staging');
const appDir = path.join(stagingRoot, 'app');
const packDir = path.join(stagingRoot, 'pack');
const builtScript = path.join(root, 'dist', 'electron', 'xiaochao.js');
const RELEASE_ZIP_NAME = 'wd-xc.zip';

const RELEASE_ASSET_FILES = [
  'install.bat',
  'install.sh',
  'restore.bat',
  'restore.sh',
  '安装说明.txt'
];

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`));
    });
  });
}

function writeBundledScript(version) {
  const body = readFileSync(builtScript, 'utf8');
  const banner = [
    '// ==UserScript==',
    '// @name         小抄',
    `// @version      ${version}`,
    '// @author       many people',
    '// @description  三国杀OL辅助插件',
    '// ==/UserScript==',
    ''
  ].join('\n');
  writeFileSync(path.join(appDir, 'xiaochao.js'), banner + body);
}

/** 在 cwd 下把 entries 打成 zipPath（正斜杠路径，跨平台可解压）。 */
async function createZip(zipPath, entries, cwd) {
  if (existsSync(zipPath)) rmSync(zipPath);
  await run('zip', ['-r', '-q', zipPath, ...entries], cwd);
}

async function main() {
  if (!existsSync(path.join(shellDir, 'main.js')) || !existsSync(path.join(shellDir, 'package.json'))) {
    throw new Error(`缺少发布壳目录 tools/release-app-shell（需含 main.js / package.json）`);
  }

  console.log('[pack] 构建小抄脚本…');
  await run(process.execPath, [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    path.join(root, 'vite.electron.config.ts')
  ]);
  if (!existsSync(builtScript)) throw new Error(`缺少构建产物: ${builtScript}`);

  console.log('[pack] 组装 app 目录（正式微端壳 + 当前脚本）…');
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  cpSync(shellDir, appDir, { recursive: true });
  // 壳里不应残留旧脚本或说明文档；始终用本次构建产物覆盖。
  if (existsSync(path.join(appDir, 'xiaochao.js'))) rmSync(path.join(appDir, 'xiaochao.js'));
  for (const name of readdirSync(appDir)) {
    if (name.endsWith('.md')) rmSync(path.join(appDir, name));
  }

  const shellPackage = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const projectPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  // 微端壳版本保持壳自身；脚本版本用工程 package.json，写入 @version 头。
  const scriptVersion = String(projectPackage.version || shellPackage.version || '0');
  shellPackage.main = 'main.js';
  shellPackage.IsDebug = false;
  shellPackage.IsTest = false;
  writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify(shellPackage, null, 2)}\n`);
  writeBundledScript(scriptVersion);

  if (!existsSync(path.join(appDir, 'package.json')) || !existsSync(path.join(appDir, 'main.js'))) {
    throw new Error('组装后的 app 缺少 package.json 或 main.js');
  }

  const appZipPath = path.join(packDir, 'app.zip');
  console.log('[pack] 生成 app.zip…');
  await createZip(appZipPath, ['app'], stagingRoot);

  for (const file of RELEASE_ASSET_FILES) {
    const from = path.join(assetsDir, file);
    if (!existsSync(from)) throw new Error(`缺少发布资源: ${file}`);
    copyFileSync(from, path.join(packDir, file));
  }

  mkdirSync(path.join(root, 'release'), { recursive: true });
  const releaseZipPath = path.join(root, 'release', RELEASE_ZIP_NAME);
  const releaseAppZipPath = path.join(root, 'release', 'app.zip');
  copyFileSync(appZipPath, releaseAppZipPath);
  console.log(`[pack] 生成 ${RELEASE_ZIP_NAME}…`);
  await createZip(releaseZipPath, RELEASE_ASSET_FILES.concat('app.zip'), packDir);

  rmSync(stagingRoot, { recursive: true, force: true });

  const zipSize = statSync(releaseZipPath).size;
  const appSha256 = createHash('sha256').update(readFileSync(releaseAppZipPath)).digest('hex');
  const manifest = {
    version: scriptVersion,
    notes: '',
    pageUrl: 'https://xc.95chong.cn/downloads',
    appUrl: 'https://xc.95chong.cn/downloads/app.zip',
    appSha256
  };
  const manifestPath = path.join(root, 'release', 'xiaochao-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[pack] 完成: ${releaseZipPath}`);
  console.log(`[pack] ${(zipSize / 1024).toFixed(1)} KB（脚本 v${scriptVersion}，微端壳 v${shellPackage.version}）`);
  console.log(`[pack] 清单: ${manifestPath}（copy:portal 会放到门户 /downloads/manifest.json）`);
}

main().catch((error) => {
  console.error('[pack] 失败:', error.message || error);
  process.exitCode = 1;
});
