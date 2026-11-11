#!/usr/bin/env bash
# 冷备份强制显式声明已停服；在线部署请使用 PocketBase 原生备份 API。
set -euo pipefail
: "${PB_DIR:?请指定本次隔离实例根目录}"
: "${BACKUP_DIR:?请指定备份目录}"
[[ "${PB_STOPPED:-}" == 1 ]] || { echo '拒绝热拷贝：先停止本实例并设置 PB_STOPPED=1，或使用 PB 原生在线备份' >&2; exit 1; }
python3 "$(dirname "$0")/snapshot.py" backup --source "$PB_DIR/pb_data" --target "$BACKUP_DIR" --retain-days "${RETAIN_DAYS:-14}"
