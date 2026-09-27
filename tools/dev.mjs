import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = process.env.SGSOL_ELECTRON_PATH ||
  'C:\\Program Files\\SGSOL\\resources\\xiaochao-electron-runtime\\electron.exe';
const children = new Set();

/** 启动一个属于本次开发会话的子进程，并跟踪其退出状态。 */
function run(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: false });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

// 先启动持续构建，再启动独立 Electron；已有 dist 可保证两者启动竞态时仍能注入。
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const builder = run(process.execPath, [
  viteCli,
  'build',
  '--watch',
  '--config',
  path.join(root, 'vite.electron.config.mts')
]);
const electron = run(electronPath, [root]);

/** 终端退出时同时停止构建器和 Electron，避免遗留后台进程。 */
function shutdown() {
  for (const child of children) child.kill();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
electron.once('exit', (code) => {
  builder.kill();
  process.exitCode = code || 0;
});
