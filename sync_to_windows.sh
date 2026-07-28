#!/usr/bin/env bash
# claude-work Desk を Windows 側 (%LOCALAPPDATA%\claude-work-desk) に配布して npm install する。
# WSL からこれ1本: bash sync_to_windows.sh
# Windowsユーザー名は自動検出。複数ユーザー環境などで指定したい時は WINUSER=名前 bash sync_to_windows.sh
# コード更新後は本スクリプト再実行が反映手順（配布先は生成物・直接編集しない）。
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"

# 壊れたものを配らない。検査は動線に埋め込む＝手で思い出す運用にしない。
echo "==> 自己検査"
bash "$SRC/check.sh" || { echo "ERROR: check.sh が落ちました。配布を中止します"; exit 1; }
echo

WINUSER="${WINUSER:-}"
if [ -z "$WINUSER" ]; then
  for d in /mnt/c/Users/*/; do
    u="$(basename "$d")"
    case "$u" in Public|Default|"Default User"|"All Users") continue ;; esac
    [ -d "${d}AppData/Local" ] && WINUSER="$u" && break
  done
fi
[ -z "$WINUSER" ] && { echo "ERROR: Windowsユーザーを検出できません。WINUSER=名前 を付けて再実行してください"; exit 1; }

DST="/mnt/c/Users/$WINUSER/AppData/Local/claude-work-desk"

# .cmd はWSL interopで直接実行できないため node.exe + npm-cli.js で呼ぶ
NODE_EXE="/mnt/c/Program Files/nodejs/node.exe"
NPM_CLI='C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
[ -x "$NODE_EXE" ] || { echo "ERROR: Windows側にNode.jsがありません。https://nodejs.org からLTSをインストールしてください"; exit 1; }

echo "==> 配布: $SRC -> $DST (user=$WINUSER)"
mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules --exclude .git \
  --exclude sync_to_windows.sh --exclude publish_public.sh \
  "$SRC/" "$DST/"

echo "==> npm install (初回はElectron本体DLで数分かかります)"
cd "$DST"
"$NODE_EXE" "$NPM_CLI" install --no-audit --no-fund

# 起動用バッチ
cat > "$DST/run.bat" <<'BAT'
@echo off
cd /d %~dp0
start "" ".\node_modules\electron\dist\electron.exe" .
BAT

# デスクトップにショートカット作成（毎回上書き・冪等）
powershell.exe -NoProfile -Command "
  \$ws = New-Object -ComObject WScript.Shell;
  \$desktop = [Environment]::GetFolderPath('Desktop');
  \$sc = \$ws.CreateShortcut(\"\$desktop\\claude-work Desk.lnk\");
  \$sc.TargetPath = \"\$env:LOCALAPPDATA\\claude-work-desk\\node_modules\\electron\\dist\\electron.exe\";
  \$sc.Arguments = '.';
  \$sc.WorkingDirectory = \"\$env:LOCALAPPDATA\\claude-work-desk\";
  \$sc.Save();
" >/dev/null 2>&1 || echo "WARN: ショートカット作成に失敗（run.bat から起動できます）"

echo ""
echo "==> 完了。デスクトップの「claude-work Desk」か $DST/run.bat で起動できます"
echo "    初回起動時にワークスペースフォルダを選んでください（設定は再配布しても保持されます）"
