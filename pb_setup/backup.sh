#!/usr/bin/env bash
#
# 寻鸽工作台 · PocketBase 定时备份脚本
# 备份内容 = SQLite 主库（在线安全方式）+ pb_data/storage 附件目录（开发计划 第八节：备份 = 拷 SQLite + pb_data）
# 建议通过 cron 每 4 小时执行一次（示例见文件底部注释）
#
# 用法：
#   chmod +x backup.sh
#   ./backup.sh                 # 使用默认路径（/opt/nexus/pocketbase → /opt/nexus/backups）
#   PB_DIR=/srv/pb BACKUP_DIR=/mnt/backup ./backup.sh
#
set -euo pipefail

PB_DIR="${PB_DIR:-/opt/nexus/pocketbase}"       # pocketbase 可执行文件与 pb_data 所在目录
BACKUP_DIR="${BACKUP_DIR:-/opt/nexus/backups}"  # 备份输出目录
RETAIN_DAYS="${RETAIN_DAYS:-14}"                # 备份保留天数

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"

# 1) 主库：优先用 sqlite3 .backup 在线一致性备份（不锁表、不怕 WAL）
#    未安装 sqlite3 时退化为冷拷贝三件套（data.db / -wal / -shm）
DB="$PB_DIR/pb_data/data.db"
if [[ -f "$DB" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" ".backup '$DEST/data.db'"
  else
    cp "$DB" "$DEST/data.db"
    [[ -f "$DB-wal" ]] && cp "$DB-wal" "$DEST/data.db-wal" || true
    [[ -f "$DB-shm" ]] && cp "$DB-shm" "$DEST/data.db-shm" || true
  fi
  echo "[backup] 主库已备份 → $DEST/data.db"
else
  echo "[backup] 警告：未找到 $DB，跳过主库" >&2
fi

# 2) 附件目录（pb_data/storage 下按 collection 分桶存放的上传文件）
if [[ -d "$PB_DIR/pb_data/storage" ]]; then
  cp -r "$PB_DIR/pb_data/storage" "$DEST/storage"
  echo "[backup] 附件目录已备份 → $DEST/storage"
fi

# 3) auxiliary 库（logs.db / auxiliaries，体积小，顺手拷走）
for aux in logs.db auxiliaries.db; do
  [[ -f "$PB_DIR/pb_data/$aux" ]] && cp "$PB_DIR/pb_data/$aux" "$DEST/$aux" || true
done

# 4) 清理过期备份
if command -v find >/dev/null 2>&1; then
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETAIN_DAYS" -exec rm -rf {} +
fi

echo "[backup] 完成：$DEST"

# ── cron 示例（crontab -e）──
# 0 */4 * * * /opt/nexus/pocketbase/backup.sh >> /var/log/nexus-backup.log 2>&1
#
# 恢复方法：
#   systemctl stop pocketbase
#   cp <备份目录>/data.db /opt/nexus/pocketbase/pb_data/data.db
#   rm -f /opt/nexus/pocketbase/pb_data/data.db-wal /opt/nexus/pocketbase/pb_data/data.db-shm
#   cp -r <备份目录>/storage/* /opt/nexus/pocketbase/pb_data/storage/
#   chown -R pocketbase:pocketbase /opt/nexus/pocketbase/pb_data
#   systemctl start pocketbase
