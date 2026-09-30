#!/bin/bash
set -euo pipefail

# 小抄微端恢复脚本（macOS）
# 手动操作步骤请查看本目录的安装说明.txt。

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$CURRENT_DIR/restore.log"
ASAR_FILE="$CURRENT_DIR/app.asar"
ASAR_BAK="$CURRENT_DIR/app.asar.bak"
APP_DIR="$CURRENT_DIR/app"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "开始恢复"

if pgrep -xq SGSOL 2>/dev/null; then
  log "错误：三国杀微端正在运行"
  echo
  echo "错误：三国杀微端仍在运行，请先完全退出。"
  echo
  exit 1
fi

if [ ! -w "$CURRENT_DIR" ]; then
  log "错误：没有写入权限"
  echo
  echo "错误：没有写入权限。"
  echo "请在本目录打开终端并执行："
  echo "  sudo bash restore.sh"
  echo
  exit 1
fi

log "删除 app 目录"
if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_DIR"
fi

if [ -d "$APP_DIR" ]; then
  log "错误：无法删除 app 目录"
  echo
  echo "错误：无法删除 app 目录，可能仍被占用。"
  echo
  exit 1
fi

if [ -f "$ASAR_BAK" ]; then
  log "恢复 app.asar"
  mv "$ASAR_BAK" "$ASAR_FILE"
fi

log "恢复成功"
echo
echo "已恢复官方微端，请重新打开三国杀微端。"
echo
