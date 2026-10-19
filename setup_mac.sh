#!/usr/bin/env bash
# claude-work Desk を macOS でネイティブ起動できるようにする。Mac ではこれ1本: bash setup_mac.sh
#
# Windows版 (sync_to_windows.sh) と違い、どこへも rsync 配布しない。あちらが
# %LOCALAPPDATA% へ配るのは WSL と Windows でファイルシステムが分かれているからで、
# Mac は checkout がそのまま実行環境（同一FS）＝この場で npm install して動かすのが正しい。
# 結果として更新手順も違う: Windows は「pull → 再配布」、Mac は「pull だけ」で反映される。
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: setup_mac.sh は macOS 用です（今の環境: $(uname -s)）"
  echo "       WSL/Windows は bash sync_to_windows.sh を使ってください"
  exit 1
fi

# Node の存在確認は check.sh より前に置く（順序が意味を持つ）。check.sh は中で
# `node --check` を使い、その stderr を捨てている（check.sh の 1) 構文チェック）ため、
# node が無いと「構文エラー: main.js」等を5件並べて落ちる＝実際は健全なソースを
# 壊れていると誤報し、この下の nodejs.org 案内には永久に到達しない。
# Node 不在は Mac 初回セットアップで最も踏みやすいので、先に名指しで止める。
command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || {
  echo "ERROR: Node.js が見つかりません。https://nodejs.org からLTSをインストールしてください"
  echo "       （インストール後、ターミナルを開き直してから再実行してください）"
  exit 1
}

# 壊れたものを起動動線に載せない。検査は動線に埋め込む＝手で思い出す運用にしない。
echo "==> 自己検査"
bash "$SRC/check.sh" || { echo "ERROR: check.sh が落ちました。セットアップを中止します"; exit 1; }
echo

echo "==> npm install (初回はElectron本体DLで数分かかります)"
cd "$SRC"
npm install --no-audit --no-fund

# デスクトップのランチャ。毎回上書き＝冪等。
# repo のパスはハードコードせず生成時の $SRC を埋める＝checkout をどこに置いても動く。
LAUNCHER="$HOME/Desktop/claude-work Desk.command"
mkdir -p "$HOME/Desktop"
cat > "$LAUNCHER" <<EOF
#!/bin/bash
# claude-work Desk 起動用ランチャ。setup_mac.sh が生成するので手で直さない
# （直しても次の setup_mac.sh 実行で上書きされる）。
cd "$SRC" || exit 1
BIN="./node_modules/.bin/electron"
if [ ! -x "\$BIN" ]; then
  echo "electron がありません。ターミナルで次を実行してください:"
  echo "  bash \"$SRC/setup_mac.sh\""
  read -n 1 -s -r -p "何かキーを押すと閉じます"
  exit 1
fi
# ターミナル窓を閉じてもアプリが落ちないよう切り離して起動する
nohup "\$BIN" . >/dev/null 2>&1 &
EOF
chmod +x "$LAUNCHER"

# Dock に置ける .app。node_modules の Electron.app を丸ごと複製し（APFS は clone＝容量ほぼゼロ）、
# Resources/app → この checkout へのシンボリックリンクにする＝Electron がここの main.js を読む。
# electron-builder の配布物と違い中身を焼き込まないので「pull だけで反映」の Mac 作法を崩さない。
# 素の Electron.app を Dock に置くと Electron の空アプリが立ち上がるだけ（2026-10-10 実際に踏んだ）。
# Electron を上げたら本スクリプトを再実行（複製元が変わるため）。
APP="$HOME/Applications/claude-work Desk.app"
EAPP="$SRC/node_modules/electron/dist/Electron.app"
echo "==> $APP を生成"
mkdir -p "$HOME/Applications"
rm -rf "$APP"
cp -cR "$EAPP" "$APP" 2>/dev/null || cp -R "$EAPP" "$APP"
rm -f "$APP/Contents/Resources/default_app.asar"
ln -s "$SRC" "$APP/Contents/Resources/app"
ICONSET="$(mktemp -d)/desk.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC/build/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$SRC/build/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/desk.icns"
PL="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName claude-work Desk" \
  -c "Set :CFBundleDisplayName claude-work Desk" \
  -c "Set :CFBundleIdentifier com.tact0225.claude-work-desk.dev" \
  -c "Set :CFBundleIconFile desk.icns" "$PL"
# Info.plist を書き換えると署名が壊れる＝arm64 は無署名だと起動拒否されるので ad-hoc で署名し直す
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "WARN: codesign に失敗（起動できない時は再実行）"
touch "$APP"

echo ""
echo "==> 完了。~/Applications の「claude-work Desk」を Dock に置けばそこから起動できます"
echo "    （デスクトップの「claude-work Desk」ダブルクリックでも起動できます）"
echo "    初回起動時にワークスペースフォルダを選んでください（設定は git pull しても保持されます）"
echo "    更新: git pull するだけ（依存が変わった時だけ本スクリプトを再実行）"
