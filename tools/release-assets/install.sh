#!/bin/bash
set -euo pipefail

# 小抄微端安装脚本（macOS）
# 手动操作步骤请查看本目录的安装说明.txt。

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$CURRENT_DIR/install.log"
ASAR_FILE="$CURRENT_DIR/app.asar"
ASAR_BAK="$CURRENT_DIR/app.asar.bak"
ZIP_FILE="$CURRENT_DIR/app.zip"
APP_DIR="$CURRENT_DIR/app"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "开始安装"

if [ ! -f "$ZIP_FILE" ]; then
  echo
  echo "错误：当前目录缺少 app.zip。"
  echo "请确认 app.zip 与 install.sh 位于同一目录（通常为官方微端的 Contents/Resources）。"
  echo
  exit 1
fi

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
  echo "  sudo bash install.sh"
  echo
  exit 1
fi

if [ -d "$APP_DIR" ]; then
  log "删除旧 app 目录"
  rm -rf "$APP_DIR"
fi

log "解压 app.zip"
if ! unzip -q -o "$ZIP_FILE" -d "$CURRENT_DIR"; then
  log "错误：解压 app.zip 失败"
  echo
  echo "错误：解压 app.zip 失败，文件可能已损坏。"
  echo
  exit 1
fi

if [ ! -f "$APP_DIR/package.json" ]; then
  log "错误：解压后缺少 package.json"
  echo
  echo "错误：解压后缺少 app/package.json。"
  echo
  exit 1
fi

if [ -f "$ASAR_FILE" ]; then
  log "备份 app.asar"
  rm -f "$ASAR_BAK"
  mv "$ASAR_FILE" "$ASAR_BAK"
fi

log "安装成功"
echo
echo "小抄微端安装完成，请重新打开三国杀微端。"
echo
