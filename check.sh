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

# 8) 差分ビュー（開いた時点 → 今）
#    ※ 番号は追記式にする。renderer/app.js のコメントが「check.sh 7)」を名指ししているので、
#      既存の番号は動かさない（動かした瞬間に、直しようのない嘘の参照になる）。
#    壊れ方が静か（基準が毎回進んで1回ぶんしか見えない／無変更行を畳めていない／
#    巨大な書き換えで固まる）で目では気づけないので、動線に埋め込んで毎回回す
node test-diff.js || fail "差分（開いた時点 → 今）のロジックが壊れている"

# 9) 差分のしきい値が README / CHANGELOG に書いた数字と一致しているか
#    （DIFF_CONTEXT と DIFF_MAX_CELLS はドキュメント側に手で書き写されている。test-diff.js は
#      本体から読むので気づかないが、DIFF_CONTEXT を 4 にした瞬間に README が静かに嘘になる。
#      ドキュメントの腐りは実行しても分からない＝ここで突合する）
#    （ここも -P を使わない。理由は 2) と同じ）
group3() { # 4000000 → 4,000,000（ドキュメントは桁区切りで書いてある）
  local n=$1 out=""
  while [ ${#n} -gt 3 ]; do out=",${n: -3}$out"; n=${n:0:${#n}-3}; done
  echo "$n$out"
}
DIFF_CTX=$(grep -m1 -E '^const DIFF_CONTEXT = [0-9]+' renderer/app.js | sed -E 's/^const DIFF_CONTEXT = ([0-9]+).*/\1/')
DIFF_CELLS=$(grep -m1 -E '^const DIFF_MAX_CELLS = [0-9]+' renderer/app.js | sed -E 's/^const DIFF_MAX_CELLS = ([0-9]+).*/\1/')
# 基準の枠（メモリ側／永続化側）もドキュメントに手で書き写してある。片方だけ変えると、
# 「500,000文字までは翌日も残る」という約束だけが静かに嘘になる（動かしても分からない）
DIFF_BASE_CHARS=$(grep -m1 -E '^const DIFF_BASE_MAX_CHARS = [0-9]+' renderer/app.js | sed -E 's/^const DIFF_BASE_MAX_CHARS = ([0-9]+).*/\1/')
DIFF_STORE_CHARS=$(grep -m1 -E '^const DIFF_BASE_STORE_MAX_CHARS = [0-9]+' renderer/app.js | sed -E 's/^const DIFF_BASE_STORE_MAX_CHARS = ([0-9]+).*/\1/')
# 全文表示の行数の天井も同じ扱い（README/CHANGELOG に手で書き写してある）
DIFF_FULL_ROWS=$(grep -m1 -E '^const DIFF_FULL_MAX_ROWS = [0-9]+' renderer/app.js | sed -E 's/^const DIFF_FULL_MAX_ROWS = ([0-9]+).*/\1/')
DOC_STALE=""
doc_has() { grep -qF "$2" "$1" || DOC_STALE="$DOC_STALE
      $1 に「$2」が無い"; }
if [ -z "$DIFF_CTX" ] || [ -z "$DIFF_CELLS" ] || [ -z "$DIFF_BASE_CHARS" ] || [ -z "$DIFF_STORE_CHARS" ] || [ -z "$DIFF_FULL_ROWS" ]; then
  fail "renderer/app.js から差分の定数を読めません（定数を改名したら check.sh 9) も直す）"
else
  DIFF_CELLS_H=$(group3 "$DIFF_CELLS")
  DIFF_BASE_H=$(group3 "$DIFF_BASE_CHARS")
  DIFF_STORE_H=$(group3 "$DIFF_STORE_CHARS")
  DIFF_FULL_H=$(group3 "$DIFF_FULL_ROWS")
  doc_has README.ja.md    "前後${DIFF_CTX}行"
  doc_has README.md       "${DIFF_CTX} lines of context"
  doc_has CHANGELOG.ja.md "前後${DIFF_CTX}行"
  doc_has CHANGELOG.md    "${DIFF_CTX} lines of context"
  doc_has CHANGELOG.ja.md "${DIFF_CELLS_H}セル"
  doc_has CHANGELOG.md    "${DIFF_CELLS_H} cells"
  doc_has README.ja.md    "${DIFF_BASE_H}文字"
  doc_has README.md       "${DIFF_BASE_H} characters"
  doc_has README.ja.md    "${DIFF_STORE_H}文字"
  doc_has README.md       "${DIFF_STORE_H} characters"
  doc_has CHANGELOG.ja.md "${DIFF_STORE_H}文字"
  doc_has CHANGELOG.md    "${DIFF_STORE_H} characters"
  doc_has README.ja.md    "${DIFF_FULL_H}行"
  doc_has README.md       "${DIFF_FULL_H} lines"
  doc_has CHANGELOG.ja.md "${DIFF_FULL_H}行"
  doc_has CHANGELOG.md    "${DIFF_FULL_H} lines"
  if [ -n "$DOC_STALE" ]; then
    fail "差分のしきい値がドキュメントとズレています (app.js: 前後${DIFF_CTX}行 / ${DIFF_CELLS_H}セル / 基準${DIFF_BASE_H}文字 / 保存${DIFF_STORE_H}文字 / 全文${DIFF_FULL_H}行):$DOC_STALE"
  else
    note "差分のしきい値の記述一致 (app.js == README/CHANGELOG: 前後${DIFF_CTX}行・${DIFF_CELLS_H}セル・基準${DIFF_BASE_H}文字・保存${DIFF_STORE_H}文字・全文${DIFF_FULL_H}行)"
  fi
  # ⚠ 永続化の枠がメモリ側の枠以上だと localStorage（概ね5〜10MB・UTF-16）に必ず溢れる。
  #    test-diff.js でも縛っているが、数字を触るのはこのファイルを見ている時なのでここにも置く
  if [ "$DIFF_STORE_CHARS" -ge "$DIFF_BASE_CHARS" ]; then
    fail "永続化の枠がメモリ側の枠を下回っていません（localStorage が溢れる）: ${DIFF_STORE_H} >= ${DIFF_BASE_H}"
  fi
fi

# 10) Mermaid の同梱物（renderer/vendor/mermaid.min.js）
#     壊れ方がとにかく静か。読み込めなければ app.js が「元のコードブロック表示」に落とすので、
#     ファイルが消えても・途中で切れていても・読み込み順がズレても、画面は普通に動いたまま
#     図だけが出なくなる（誰も気づけない）。フォールバックが優秀なぶん、ここで機械的に見る。
MERMAID_VENDOR=renderer/vendor/mermaid.min.js
MERMAID_MIN_BYTES=2000000 # 実体は約3.5MB。半分を切ったら「取得に失敗した残骸」を疑う
if [ ! -f "$MERMAID_VENDOR" ]; then
  fail "Mermaid の同梱物がありません: $MERMAID_VENDOR（図は黙ってコードブロック表示に戻る）"
else
  MERMAID_BYTES=$(wc -c < "$MERMAID_VENDOR" | tr -d ' ')
  if [ "$MERMAID_BYTES" -lt "$MERMAID_MIN_BYTES" ]; then
    fail "Mermaid の同梱物が小さすぎます（切り詰め／取得失敗の疑い）: ${MERMAID_BYTES} バイト < ${MERMAID_MIN_BYTES} バイト"
  fi
  # 読み込み順。vendor は i18n.js / app.js より前に置く（後ろに回すと、起動直後に開いた
  # ファイルだけ図が出ない競合になる＝index.html のコメントと同じ理由）
  script_line() { grep -nF "<script src=\"$1\">" renderer/index.html | head -1 | cut -d: -f1; }
  L_MERMAID=$(script_line 'vendor/mermaid.min.js')
  L_I18N=$(script_line 'i18n.js')
  L_APP=$(script_line 'app.js')
  if [ -z "$L_MERMAID" ]; then
    fail "renderer/index.html が $MERMAID_VENDOR を読んでいません（同梱していても読まなければ図は出ない）"
  elif [ -z "$L_I18N" ] || [ -z "$L_APP" ]; then
    fail "renderer/index.html の i18n.js / app.js の <script> を読めません（check.sh 10) も直す）"
  elif [ "$L_MERMAID" -gt "$L_I18N" ] || [ "$L_MERMAID" -gt "$L_APP" ]; then
    fail "vendor/mermaid.min.js は i18n.js / app.js より前に置く（行 $L_MERMAID / i18n $L_I18N / app $L_APP）"
  fi
  # バージョン整合。同梱物は npm の mermaid を固めたもの＝「package.json だけ動いて vendor が
  # 古いまま」を無検知にしない。バンドルの中には mermaid 自身の version 文字列が入っているので、
  # 実体そのものから読む（隣に置いたメモを信じない）。THIRD-PARTY-NOTICES.md にも同じ番号を
  # 手で書き写してあるので、ここで一緒に突合する（帰属表示の腐りは動かしても分からない）
  PKG_MERMAID=$(node -p "(require('./package.json').devDependencies.mermaid||'').replace(/^[^0-9]*/,'')" 2>/dev/null)
  if [ -z "$PKG_MERMAID" ]; then
    fail "package.json の devDependencies.mermaid を読めません（Mermaid を外したなら check.sh 10) も畳む）"
  else
    if ! grep -qF "version:\"$PKG_MERMAID\"" "$MERMAID_VENDOR"; then
      fail "package.json の mermaid ($PKG_MERMAID) と同梱物の中身が一致しません（vendor を作り直す）"
    fi
    if [ -f node_modules/mermaid/package.json ]; then
      NM_MERMAID=$(node -p "require('./node_modules/mermaid/package.json').version" 2>/dev/null)
      [ "$NM_MERMAID" = "$PKG_MERMAID" ] || fail "入っている mermaid ($NM_MERMAID) が package.json ($PKG_MERMAID) とズレています（vendor を作り直すか package.json を合わせる）"
    fi
    if [ ! -f THIRD-PARTY-NOTICES.md ]; then
      fail "THIRD-PARTY-NOTICES.md がありません（同梱物を再配布している以上、帰属表示は外せない）"
    elif ! grep -qF "$PKG_MERMAID" THIRD-PARTY-NOTICES.md; then
      fail "THIRD-PARTY-NOTICES.md が mermaid $PKG_MERMAID を指していません（同梱物を上げたら帰属表示も直す）"
    fi
  fi
  [ $FAIL -eq 0 ] && note "Mermaid 同梱物 OK ($((MERMAID_BYTES / 1024 / 1024))MB・v$PKG_MERMAID・i18n/app より前・帰属表示あり)"
fi

echo
[ $FAIL -eq 0 ] && { echo "check.sh: PASS"; exit 0; } || { echo "check.sh: FAIL"; exit 1; }
