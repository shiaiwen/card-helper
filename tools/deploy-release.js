/** 打包并发布当前版本。 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const releaseZip = path.join(root, 'release', `wd-xc-${projectVersion}.zip`);
const defaultResources = process.env.SGSOL_RESOURCES
  || (process.platform === 'darwin'
    ? '/Applications/SGSOL.app/Contents/Resources'
    : 'C:\\Program Files\\SGSOL\\resources');

const cliArgs = process.argv.slice(2);
const skipPack = cliArgs.includes('--no-pack');
const resourcesFlag = cliArgs.find((item) => item.startsWith('--resources='));
const resourcesDir = resourcesFlag ? resourcesFlag.slice('--resources='.length) : defaultResources;

function log(message) {
  console.log(`[deploy] ${message}`);
}

function fail(message) {
  console.error(`[deploy] ${message}`);
  process.exitCode = 1;
}

function run(command, commandArgs, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

function isAdmin() {
  if (process.platform === 'win32') {
    return spawnSync('net', ['session'], { stdio: 'ignore', shell: true }).status === 0;
  }
  try {
    return typeof process.getuid === 'function' && process.getuid() === 0;
  } catch {
    return false;
  }
}

function isSgsRunning() {
  if (process.platform === 'win32') {
    const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq SGSOL.exe'], {
      encoding: 'utf8',
      shell: true
    });
    return /SGSOL\.exe/i.test(result.stdout || '');
  }
  return spawnSync('pgrep', ['-xq', 'SGSOL'], { stdio: 'ignore' }).status === 0;
}

function extractZip(zipPath, destination) {
  mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    const command = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`;
    const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      stdio: 'inherit'
    });
    if (result.status !== 0) throw new Error(`解压失败: ${zipPath}`);
    return;
  }
  const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', destination], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`解压失败: ${zipPath}`);
}

function removeDir(dirPath) {
  if (!existsSync(dirPath)) return;
  rmSync(dirPath, { recursive: true, force: true });
  if (existsSync(dirPath)) throw new Error(`无法删除目录: ${dirPath}`);
}

function installIntoResources(bundleDir) {
  const appZip = path.join(bundleDir, 'app.zip');
  const appDir = path.join(resourcesDir, 'app');
  const asarFile = path.join(resourcesDir, 'app.asar');
  const asarBak = path.join(resourcesDir, 'app.asar.bak');

  if (!existsSync(appZip)) throw new Error(`缺少 app.zip: ${appZip}`);
  if (!existsSync(resourcesDir)) throw new Error(`微端目录不存在: ${resourcesDir}`);

  for (const name of ['app.zip', 'install.bat', 'install.sh', 'restore.bat', 'restore.sh', '安装说明.txt']) {
    const from = path.join(bundleDir, name);
    if (existsSync(from)) copyFileSync(from, path.join(resourcesDir, name));
  }

  log('删除旧 app 目录…');
  removeDir(appDir);

  log('解压 app.zip 到微端目录…');
  extractZip(appZip, resourcesDir);
  if (!existsSync(path.join(appDir, 'package.json'))) {
    throw new Error('解压后缺少 app/package.json');
  }

  if (existsSync(asarFile)) {
    log('备份 app.asar → app.asar.bak…');
    if (existsSync(asarBak)) rmSync(asarBak, { force: true });
    renameSync(asarFile, asarBak);
  } else if (!existsSync(asarBak)) {
    log('未找到 app.asar（可能此前已切换到 app 目录）');
  }

  // 运行时真正注入的是 userData 脚本；只换 app 目录时，旧版缓存（如官网 1.5.91）仍会生效。
  syncUserDataScript(path.join(appDir, 'xiaochao.js'));
}

function userDataXiaochaoDirs() {
  if (process.platform === 'darwin') {
    const home = os.homedir();
    return [
      path.join(home, 'Library', 'Application Support', 'SGSOL', 'xiaochao'),
      path.join(home, 'Library', 'Application Support', 'sgsol', 'xiaochao')
    ];
  }
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    path.join(roaming, 'SGSOL', 'xiaochao'),
    path.join(roaming, 'sgsol', 'xiaochao')
  ];
}

function syncUserDataScript(bundledScript) {
  if (!existsSync(bundledScript)) {
    throw new Error(`缺少内置脚本: ${bundledScript}`);
  }
  for (const dir of userDataXiaochaoDirs()) {
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'xiaochao.js');
    copyFileSync(bundledScript, target);
    log(`已覆盖运行时脚本: ${target}`);

    // 清理旧版远程更新残留字段（已不再使用）。
    const configPath = path.join(dir, 'config.json');
    try {
      if (!existsSync(configPath)) continue;
      const config = JSON.parse(readFileSync(configPath, 'utf8') || '{}');
      if (!config || typeof config !== 'object') continue;
      let changed = false;
      for (const key of ['scriptUrl', 'autoUpdateEnabled']) {
        if (Object.prototype.hasOwnProperty.call(config, key)) {
          delete config[key];
          changed = true;
        }
      }
      if (changed) {
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
        log(`已清理远程更新配置: ${configPath}`);
      }
    } catch (error) {
      log(`写入 config 失败（可忽略）: ${error.message || error}`);
    }
  }
}

async function main() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    fail(`暂不支持平台: ${process.platform}`);
    return;
  }

  if (!isAdmin()) {
    fail(process.platform === 'win32'
      ? '需要管理员权限。用根目录 deploy.bat（会自动提权）。'
      : '需要管理员权限。执行: sudo npm run deploy');
    return;
  }

  if (isSgsRunning()) {
    fail('三国杀微端正在运行，先完全退出 SGSOL.exe 再部署。');
    return;
  }

  if (!skipPack) {
    log(`先打包 release/wd-xc-${projectVersion}.zip…`);
    await run(process.execPath, [path.join(root, 'tools', 'pack-release.js')]);
  }

  if (!existsSync(releaseZip)) {
    fail(`缺少发布包: ${releaseZip}`);
    return;
  }

  const staging = path.join(os.tmpdir(), `wd-xc-deploy-${Date.now()}`);
  try {
    log(`解压 ${releaseZip}…`);
    extractZip(releaseZip, staging);
    log(`安装到 ${resourcesDir}…`);
    installIntoResources(staging);
    log('部署完成，重新打开三国杀微端即可。');
    log(`发布包 ${(statSync(releaseZip).size / 1024).toFixed(1)} KB`);
  } catch (error) {
    fail(error.message || String(error));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main();
