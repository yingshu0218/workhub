#!/usr/bin/env python3
"""可校验冷备份与隔离恢复；不接触其他实例。附件/删除登记与库一起核对。"""
import argparse, datetime, hashlib, json, os, pathlib, shutil, sqlite3, tempfile, uuid

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def manifest(root):
    return {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'manifest.json'}
def integrity(db):
    with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as c:
        if c.execute('pragma integrity_check').fetchone()[0] != 'ok': raise RuntimeError('SQLite integrity_check failed')
def run(args):
    source, target = pathlib.Path(args.source), pathlib.Path(args.target)
    if args.action == 'backup':
        if not (source/'data.db').is_file(): raise RuntimeError('缺少 data.db，拒绝成功或清理历史备份')
        integrity(source/'data.db')
        target.mkdir(parents=True, exist_ok=True)
        stage = pathlib.Path(tempfile.mkdtemp(prefix='.incomplete-', dir=target))
        try:
            # sqlite backup API 合并 WAL，禁止裸拷贝三件套伪称一致快照。
            with sqlite3.connect(f'file:{source}/data.db?mode=ro', uri=True) as src, sqlite3.connect(stage/'data.db') as dst: src.backup(dst)
            if (source/'storage').is_dir(): shutil.copytree(source/'storage', stage/'storage')
            integrity(stage/'data.db')
            report = {'version': 1, 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': manifest(stage)}
            (stage/'manifest.json').write_text(json.dumps(report, indent=2))
            dest = target/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8])
            stage.rename(dest)
            # 只有已验证的新备份落位后，才清理本脚本创建且带清单的旧备份。
            cutoff = datetime.datetime.now().timestamp()-args.retain_days*86400
            for old in target.iterdir():
                if old != dest and old.is_dir() and (old/'manifest.json').is_file() and old.stat().st_mtime < cutoff: shutil.rmtree(old)
            print(json.dumps({'backup': str(dest), 'files': len(report['files']), 'integrity': 'ok'}))
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True); raise
    else:
        if not args.isolated: raise RuntimeError('恢复必须显式 --isolated；恢复环境先隔离核对')
        report = json.loads((source/'manifest.json').read_text())
        if manifest(source) != report['files']: raise RuntimeError('备份校验不符')
        integrity(source/'data.db')
        if target.exists() and any(target.iterdir()): raise RuntimeError('恢复目标必须为空，禁止覆盖现有库')
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = pathlib.Path(tempfile.mkdtemp(prefix='.restore-isolated-', dir=target.parent))
        # 隔离标记必须先于任何恢复数据，老 schema 或中途故障也不能留下可启动目标。
        (stage/'RESTORE_REVIEW_REQUIRED').write_text('核对恢复点后的操作、外部删除登记、未提交草稿后才可开放。\n')
        try:
            shutil.copy2(source/'data.db', stage/'data.db')
            if (source/'storage').is_dir(): shutil.copytree(source/'storage', stage/'storage')
            with sqlite3.connect(stage/'data.db') as c:
                exists = c.execute("select count(*) from sqlite_master where type='table' and name='command_state'").fetchone()[0]
                if exists: c.execute('update command_state set generation=?', (uuid.uuid4().hex,))
                else: (stage/'PRE_COMMAND_SCHEMA').write_text('升级前备份：启动兼容新版迁移后生成新世代，核对后再开放。\n')
            integrity(stage/'data.db')
            if target.exists(): target.rmdir()
            stage.rename(target)
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True); raise
        print(json.dumps({'restored': str(target), 'generationRotated': True, 'reviewRequired': True}))

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('action', choices=['backup','restore']); p.add_argument('--source',required=True); p.add_argument('--target',required=True); p.add_argument('--retain-days',type=int,default=14); p.add_argument('--isolated',action='store_true')
    run(p.parse_args())
