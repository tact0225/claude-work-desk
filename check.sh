#!/usr/bin/env bash
# 配布前の自己検査。sync_to_windows.sh と publish_public.sh の両方から呼ばれる＝
# 「手で思い出して走らせる検査」にしない（腐り検知は動線に埋め込む）。
#   単体で回すなら: bash check.sh
set -uo pipefail
cd "$(dirname "$0")"
FAIL=0
note() { echo "  $1"; }
fail() { echo "NG  $1"; FAIL=1; }

JS_FILES="main.js preload.js wikilink.js renderer/app.js renderer/i18n.js"

# 1) 構文
for f in $JS_FILES; do
  node --check "$f" >/dev/null 2>&1 || fail "構文エラー: $f"
done
[ $FAIL -eq 0 ] && note "構文 OK ($(echo $JS_FILES | wc -w) ファイル)"

# 2) i18n の t() を隠すローカル変数の禁止
#    2026-07-28: addFeedEntry の `const t = new Date(...)` が t() を関数スコープで上書きし、
#    「ファイルは _inbox に着地するのに受領フィードだけ出ない」バグになった。
#    静的な辞書チェックでは絶対に捕まらない（キーは正しく、呼び出し側が壊れる）ので専用に見る。
SHADOW=$(grep -nP '^\s*(const|let|var)\s+t\s*=(?!\s*\(key)' main.js renderer/app.js || true)
SHADOW_PARAM=$(grep -nP 'function\s+\w+\s*\((\s*|[^)]*,\s*)t\s*(\)|,)' main.js renderer/app.js || true)
if [ -n "$SHADOW$SHADOW_PARAM" ]; then
  fail "識別子 t は i18n 専用。ローカルで再定義すると t() が呼べなくなる:"
  echo "$SHADOW$SHADOW_PARAM" | sed 's/^/      /'
else
  note "t() のシャドウイング なし"
fi

# 3) 辞書の穴 ＋ 使用キーとの突合
node check-i18n.js || fail "i18n 辞書／キーの不整合"

# 4) ドロップ先フォルダの検証（ワークスペース外への脱出を弾けているか）
node test-inbox.js || fail "ドロップ先の検証ロジックが緩い"

# 5) 自動更新（ポーリング）と新着ウォッチ
#    壊れ方が静か（無言で光らない／全部光る／全消し再描画に戻る）で気づけないので毎回回す
node test-watch.js || fail "自動更新／新着ウォッチのロジックが壊れている"

# 6) renderer が呼ぶ api.* が preload で公開されているか
#    （公開し忘れは実行時まで分からず「押しても何も起きない」になる）
MISSING_API=""
for m in $(grep -oP 'api\.\K\w+' renderer/app.js | sort -u); do
  grep -qP "^\s*$m\s*:" preload.js || MISSING_API="$MISSING_API $m"
done
if [ -n "$MISSING_API" ]; then
  fail "preload.js に公開されていない api:$MISSING_API"
else
  note "api の公開面 OK ($(grep -oP 'api\.\K\w+' renderer/app.js | sort -u | wc -l)個)"
fi

echo
[ $FAIL -eq 0 ] && { echo "check.sh: PASS"; exit 0; } || { echo "check.sh: FAIL"; exit 1; }
