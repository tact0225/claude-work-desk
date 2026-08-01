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
[ $FAIL -eq 0 ] && note "構文 OK ($(echo $JS_FILES | wc -w | tr -d ' ') ファイル)"

# 2) i18n の t() を隠すローカル変数の禁止
#    2026-07-28: addFeedEntry の `const t = new Date(...)` が t() を関数スコープで上書きし、
#    「ファイルは _inbox に着地するのに受領フィードだけ出ない」バグになった。
#    静的な辞書チェックでは絶対に捕まらない（キーは正しく、呼び出し側が壊れる）ので専用に見る。
#    ※ 正規表現は POSIX の -E だけで書く（macOS の BSD grep に -P が無い。-P を使うと
#      Mac では grep 自体が失敗し、`|| true` に吸われて「検査したつもりの無検査」になる）。
SHADOW=$(grep -nE '^[[:space:]]*(const|let|var)[[:space:]]+t[[:space:]]*=' main.js renderer/app.js \
  | grep -vE '(const|let|var)[[:space:]]+t[[:space:]]*=[[:space:]]*\(key' || true)
SHADOW_PARAM=$(grep -nE 'function[[:space:]]+[A-Za-z0-9_$]+[[:space:]]*\(([[:space:]]*|[^)]*,[[:space:]]*)t[[:space:]]*(\)|,)' main.js renderer/app.js || true)
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
#    （ここも -P を使わない。理由は 2) と同じ）
API_USED=$(grep -oE 'api\.[A-Za-z_][A-Za-z0-9_]*' renderer/app.js | sed 's/^api\.//' | sort -u)
MISSING_API=""
for m in $API_USED; do
  grep -qE "^[[:space:]]*$m[[:space:]]*:" preload.js || MISSING_API="$MISSING_API $m"
done
if [ -n "$MISSING_API" ]; then
  fail "preload.js に公開されていない api:$MISSING_API"
else
  note "api の公開面 OK ($(echo "$API_USED" | wc -w | tr -d ' ')個)"
fi

# 7) 既定フォントのチェーンが styles.css と app.js で一致しているか
#    （--font-ui / --mono の既定値は CSS の :root と renderer の FALLBACK_* に二重管理されている。
#      applyFonts() が起動時に CSS を上書きするので、片方だけ直すと「設定を触るまでは旧チェーン」
#      という気づけないズレになる。Mac対応でチェーンを伸ばした時に実際に踏みやすい）
css_var() { grep -m1 -- "--$1:" renderer/styles.css | sed -e "s/.*--$1:[[:space:]]*//" -e 's/;.*//' -e 's/[[:space:]]*$//'; }
js_const() { grep -m1 "const $1 =" renderer/app.js | sed -e "s/.*= *'//" -e "s/'[[:space:]]*$//"; }
FONT_MISMATCH=""
[ "$(css_var font-ui)" = "$(js_const FALLBACK_UI)" ] || FONT_MISMATCH="$FONT_MISMATCH --font-ui/FALLBACK_UI"
[ "$(css_var mono)" = "$(js_const FALLBACK_MONO)" ] || FONT_MISMATCH="$FONT_MISMATCH --mono/FALLBACK_MONO"
if [ -n "$FONT_MISMATCH" ]; then
  fail "既定フォントのチェーンが styles.css と app.js でズレています:$FONT_MISMATCH"
  echo "      css : $(css_var font-ui) / $(css_var mono)" | sed 's/^/  /'
  echo "      js  : $(js_const FALLBACK_UI) / $(js_const FALLBACK_MONO)" | sed 's/^/  /'
else
  note "既定フォントのチェーン一致 (css :root == app.js FALLBACK_*)"
fi

echo
[ $FAIL -eq 0 ] && { echo "check.sh: PASS"; exit 0; } || { echo "check.sh: FAIL"; exit 1; }
