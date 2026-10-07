import { spawn, spawnSync } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const children = new Set();

/**
 * Chromium/Electron 默认会在 cwd 或 electron.exe 旁写 debug.log。
 * 开发启动前清掉仓库内残留，并禁止本会话再创建。
 */
function purgeDebugLogFiles(dir, depth = 0) {
  if (depth > 8) return;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.reference' || entry.name === '.dev-data') continue;
      purgeDebugLogFiles(full, depth + 1);
      continue;
    }
    if (entry.isFile() && entry.name === 'debug.log') {
      try {
        unlinkSync(full);
      } catch {
        // 文件被占用时跳过，进程退出后再清。
      }
    }
  }
}

/**
 * Windows 默认控制台代码页常为 936（GBK）。Electron/Chromium 往控制台写 UTF-8 中文时，
 * 会显示成「绯荤粺…」这类乱码。开发会话尽量切到 65001；Electron 再用管道转发，避免走控制台转码。
 */
function ensureWindowsUtf8Console() {
  if (process.platform !== 'win32') return;
  try {
    // 直接 spawn chcp.com 在部分终端里改不动；经 cmd 更稳。
    spawnSync('cmd.exe', ['/c', 'chcp 65001 >nul'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } catch {
    // 切码页失败时继续；管道转发仍能修好 Electron 日志。
  }
  try {
    if (typeof process.stdout?.setDefaultEncoding === 'function') {
      process.stdout.setDefaultEncoding('utf8');
    }
    if (typeof process.stderr?.setDefaultEncoding === 'function') {
      process.stderr.setDefaultEncoding('utf8');
    }
  } catch {
    // 忽略异常
  }
}

/** 把子进程输出写到当前终端；非 UTF-8 的 Windows 本地编码按 GBK 解码。 */
function forwardChildOutput(chunk, stream) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (process.platform === 'win32' && buf.length > 0 && !isUtf8(buf)) {
    try {
      stream.write(new TextDecoder('gbk').decode(buf));
      return;
    } catch {
      // 计算失败时改走下面的回退
    }
  }
  stream.write(buf);
}

ensureWindowsUtf8Console();
purgeDebugLogFiles(root);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// 禁止 Electron 打开文件日志通道（否则会在仓库/安装目录生成 debug.log）
delete env.ELECTRON_ENABLE_LOGGING;
// 子进程也按 UTF-8 文本环境处理（Git Bash / 部分 Node 工具会读这些变量）。
if (!env.LANG) env.LANG = 'zh_CN.UTF-8';
if (!env.LC_ALL) env.LC_ALL = 'zh_CN.UTF-8';

/**
 * 开发必须用「可接受应用目录参数」的 electron.exe。
 * 官方 SGSOL.exe 是已打包微端，会忽略仓库路径、始终加载 Program Files 里的 app，
 * 导致 dist 热更新和样式改动看起来「完全没生效」。
 */
function resolveElectronPath() {
  const candidates = [
    process.env.SGSOL_ELECTRON_PATH,
    path.join('C:\\Program Files\\SGSOL', 'resources', 'xiaochao-electron-runtime', 'electron.exe'),
    path.join(root, 'tools', 'electron-runtime', 'electron.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, kind: 'runtime' };
  }

  try {
    const fromNpm = require('electron');
    if (typeof fromNpm === 'string' && existsSync(fromNpm)) {
      return { path: fromNpm, kind: 'npm' };
    }
  } catch {
    // electron 未安装
  }

  return null;
}

const resolved = resolveElectronPath();
if (!resolved) {
  console.error([
    '[dev] 找不到可用于加载本仓库的 Electron。',
    '官方 SGSOL.exe 不能用来 npm run dev（它不会加载 D:\\workspace\\sgs-extension）。',
    '',
    '任选其一：',
    '  1) npm i -D electron@44.3.0',
    '  2) 设置 SGSOL_ELECTRON_PATH=完整路径\\electron.exe',
    '  3) 把 electron 解压到 tools\\electron-runtime\\electron.exe',
    '',
    '验证打包样式请用 .\\deploy.bat，不要用 SGSOL.exe 冒充 dev。'
  ].join('\n'));
  process.exit(1);
}

console.log(`[dev] Electron(${resolved.kind}): ${resolved.path}`);

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ pipeConsole?: boolean }} [options]
 * pipeConsole：Windows 下避免 stdio inherit 经 GBK 控制台转码把 UTF-8 中文弄乱。
 */
function run(command, args, options = {}) {
  const pipeConsole = options.pipeConsole === true && process.platform === 'win32';
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: pipeConsole ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    windowsHide: false
  });
  if (pipeConsole) {
    child.stdout.on('data', (chunk) => forwardChildOutput(chunk, process.stdout));
    child.stderr.on('data', (chunk) => forwardChildOutput(chunk, process.stderr));
  }
  children.add(child);
  child.once('error', (error) => {
    console.error(`[dev] 启动失败: ${command}`, error.message || error);
    shutdown();
    process.exitCode = 1;
  });
  child.once('exit', () => children.delete(child));
  return child;
}

const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
run(process.execPath, [
  viteCli,
  'build',
  '--watch',
  '--config',
  path.join(root, 'vite.electron.config.ts')
]);
// Chromium 开关必须放在应用路径之前，否则仍会在仓库里写 debug.log
const electronLogSink = process.platform === 'win32' ? 'NUL' : '/dev/null';
const electron = run(
  resolved.path,
  ['--trace-warnings', '--disable-logging', `--log-file=${electronLogSink}`, root],
  { pipeConsole: true }
);

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // 忽略异常
    }
  }
  purgeDebugLogFiles(root);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
electron.once('exit', (code) => {
  shutdown();
  process.exitCode = code || 0;
});
