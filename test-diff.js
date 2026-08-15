// 差分（開いた時点 → 今）のロジック検証テスト。check.sh から呼ばれる。
//   A) renderer/app.js の buildDiff / lcsOps / collapseSame を「ソースから切り出して実体で」叩く
//      （コピーを採点しても意味がない＝本体だけ直して腐るのを防ぐ）。
//   B) 基準（ベースライン）の扱いと本文のエスケープを、app.js のソース構造として縛る。
//
// ここが緩むと壊れ方が静か（差分が出るには出るが「開いた時点」から見ていない・
// 無変更行を全部出す・巨大ファイルで固まる）で、目では気づけない。
const fs = require('fs')
const path = require('path')

let failed = 0
let checks = 0
const ok = (cond, why) => { checks++; if (!cond) { console.error('    NG  ' + why); failed++ } }

// ⚠ 最後まで到達した時だけ 0 にする。途中で例外を握り潰して黙って抜けると、
//    何も出力しないまま終了コード0＝check.sh が PASS してしまう（test-watch.js と同じ流儀）
process.exitCode = 1

// app.js は DOM 前提で丸ごと require できないので、検査したい関数だけをソースから切り出す。
// ⚠ 波括弧を数えるだけだと文字列・テンプレート・コメントの中の { } で壊れるのでそこは読み飛ばす
//   （正規表現リテラル内の { } だけは見分けられない＝対象関数に置かないこと）。
const APP_SRC = fs.readFileSync(path.join(__dirname, 'renderer', 'app.js'), 'utf8')
function grabFn(name) {
  const src = APP_SRC
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) throw new Error('app.js に ' + name + ' が無い（改名したらこのテストも直す）')
  const from = src.slice(Math.max(0, i - 6), i) === 'async ' ? i - 6 : i
  let depth = 0
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k]
    if (c === '/' && src[k + 1] === '/') {
      const nl = src.indexOf('\n', k)
      if (nl < 0) break
      k = nl
      continue
    }
    if (c === '/' && src[k + 1] === '*') {
      const end = src.indexOf('*/', k + 2)
      if (end < 0) break
      k = end + 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      for (k++; k < src.length; k++) {
        if (src[k] === '\\') { k++; continue }
        if (src[k] === c) break
      }
      continue
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (!depth) return src.slice(from, k + 1) }
  }
  throw new Error('unbalanced: ' + name + '（grabFn が読み切れなかった＝関数の書き方を変えたら直す）')
}

// しきい値も本体から読む＝テストに数字を書き写すと、本体を緩めた時にテストだけ古い数字で通る
function grabConst(name) {
  const m = APP_SRC.match(new RegExp('^const ' + name + ' = (\\d+)', 'm'))
  if (!m) throw new Error('app.js に const ' + name + ' が無い')
  return Number(m[1])
}

// 宣言行を丸ごと持ってくる（配列や正規表現リテラルを写経しないため。写経すると
// 本体の正規表現を直した時にテストだけ古い定義で通る＝一番たちの悪い腐り方をする）
function grabDecl(name) {
  const m = APP_SRC.match(new RegExp('^const ' + name + ' = .*$', 'm'))
  if (!m) throw new Error('app.js に const ' + name + ' の宣言が無い')
  return m[0]
}

const DIFF_CONTEXT = grabConst('DIFF_CONTEXT')
const DIFF_MAX_CELLS = grabConst('DIFF_MAX_CELLS')
const DIFF_FULL_MAX_ROWS = grabConst('DIFF_FULL_MAX_ROWS')

const factory = new Function(`
  const DIFF_CONTEXT = ${DIFF_CONTEXT}
  const DIFF_MAX_CELLS = ${DIFF_MAX_CELLS}
  const DIFF_FULL_MAX_ROWS = ${DIFF_FULL_MAX_ROWS}
  ${grabFn('diffNormalize')}
  ${grabFn('diffLines')}
  ${grabFn('lcsOps')}
  ${grabFn('collapseSame')}
  ${grabFn('buildDiff')}
  return { buildDiff, collapseSame, diffLines }
`)
const D = factory()

// ---------- 読みやすい形に畳んだ検査用ヘルパ ----------
// 行は "+追加" / "-削除" / " 無変更" / "~N省略" の1文字目で種類が分かるようにする
const sig = (rows) => rows.map((r) => {
  if (r.kind === 'gap') return '~' + r.count
  return (r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ') + r.text
}).join('|')

const lines = (n, prefix) => Array.from({ length: n }, (_, i) => (prefix || 'same') + i)
const txt = (arr) => arr.join('\n')

// ---------- 1) 基本の4パターン ----------
{
  const base = 'a\nb\nc'

  let d = D.buildDiff(base, base)
  ok(d.ok && d.rows.length === 0 && d.added === 0 && d.removed === 0,
    `変更なしなのに差分が出た: ${JSON.stringify(d)}`)

  d = D.buildDiff(base, 'a\nb\nc\nd')
  ok(d.ok && d.added === 1 && d.removed === 0, `末尾への追記の勘定が違う: +${d.added} -${d.removed}`)
  ok(sig(d.rows) === ' a| b| c|+d', `末尾への追記の並びが違う: ${sig(d.rows)}`)

  d = D.buildDiff(base, 'a\nc')
  ok(d.ok && d.added === 0 && d.removed === 1, `削除のみの勘定が違う: +${d.added} -${d.removed}`)
  ok(sig(d.rows) === ' a|-b| c', `削除のみの並びが違う: ${sig(d.rows)}`)

  d = D.buildDiff(base, 'a\nB\nc')
  ok(d.ok && d.added === 1 && d.removed === 1, `置換の勘定が違う: +${d.added} -${d.removed}`)
  // 削除が先・追加が後（赤の下に書き直された緑が来る読み方を固定する）
  ok(sig(d.rows) === ' a|-b|+B| c', `置換で削除→追加の順になっていない: ${sig(d.rows)}`)

  d = D.buildDiff(base, 'z\na\nb\nc')
  ok(d.ok && sig(d.rows) === '+z| a| b| c', `先頭への挿入がおかしい: ${sig(d.rows)}`)

  // 複数箇所の書き換えが1画面にまとまるか（レナードが5回直した後、が本番の使われ方）
  d = D.buildDiff(txt(['h1', ...lines(20), 'tail']), txt(['H1', ...lines(20), 'TAIL']))
  ok(d.ok && d.added === 2 && d.removed === 2, `離れた2箇所の変更が拾えていない: +${d.added} -${d.removed}`)
  // 期待値も DIFF_CONTEXT から組む（数字を書き写すと、本体のコンテキスト行数を変えた時に
  // 「テストだけが古い前提で落ちる」＝本体は正しいのに直す先を見失う）
  const ctxHead = lines(20).slice(0, DIFF_CONTEXT).map((s) => ' ' + s).join('|')
  const ctxTail = lines(20).slice(20 - DIFF_CONTEXT).map((s) => ' ' + s).join('|')
  ok(sig(d.rows) === `-h1|+H1|${ctxHead}|~${20 - DIFF_CONTEXT * 2}|${ctxTail}|-tail|+TAIL`,
    `離れた2箇所の畳み方がおかしい: ${sig(d.rows)}`)
}

// ---------- 2) 無変更行の省略（コンテキスト行数の境界） ----------
{
  const ctx = DIFF_CONTEXT
  // 変更に挟まれた無変更の連なり: 前後 ctx 行ずつ残るので、隠れるのは len - ctx*2 行。
  // 隠すのが1行だけなら畳まない（畳んでも行数が減らないため）＝境界は ctx*2+1。
  const between = (n) => sig(D.buildDiff(
    txt(['x', ...lines(n), 'y']),
    txt(['X', ...lines(n), 'Y']),
  ).rows)

  ok(!between(ctx * 2).includes('~'), `隠す行が無いのに畳んだ (${ctx * 2}行): ${between(ctx * 2)}`)
  ok(!between(ctx * 2 + 1).includes('~'),
    `1行しか隠せないのに畳んだ (${ctx * 2 + 1}行): ${between(ctx * 2 + 1)}`)
  ok(between(ctx * 2 + 2).includes('~2'),
    `2行隠せる時に畳んでいない (${ctx * 2 + 2}行): ${between(ctx * 2 + 2)}`)
  ok(between(50).includes('~' + (50 - ctx * 2)),
    `畳んだ行数の勘定が違う (50行): ${between(50)}`)

  // 先頭・末尾（＝変更の外側）は面していない側のコンテキストを残さない＝隠れるのは len - ctx 行
  const before = (n) => sig(D.buildDiff(txt([...lines(n), 'x']), txt([...lines(n), 'X'])).rows)
  ok(!before(ctx + 1).includes('~'), `先頭側: 1行しか隠せないのに畳んだ: ${before(ctx + 1)}`)
  ok(before(ctx + 2).startsWith('~2'), `先頭側の畳み方がおかしい: ${before(ctx + 2)}`)

  const after = (n) => sig(D.buildDiff(txt(['x', ...lines(n)]), txt(['X', ...lines(n)])).rows)
  ok(!after(ctx + 1).includes('~'), `末尾側: 1行しか隠せないのに畳んだ: ${after(ctx + 1)}`)
  ok(after(ctx + 2).endsWith('~2'), `末尾側の畳み方がおかしい: ${after(ctx + 2)}`)

  // 省略した行数の合計が元の無変更行数と一致するか（数字だけ嘘をつく畳み方を弾く）
  const d = D.buildDiff(txt(['x', ...lines(40), 'y']), txt(['X', ...lines(40), 'Y']))
  const shown = d.rows.filter((r) => r.kind === 'same').length
  const hidden = d.rows.filter((r) => r.kind === 'gap').reduce((n, r) => n + r.count, 0)
  ok(shown + hidden === 40, `表示 ${shown} + 省略 ${hidden} が元の 40行 と合わない`)
}

// ---------- 2b) 全文表示（畳まない） ----------
// 記事を頭から通して読み、赤だけ拾えば直す前・緑だけ拾えば直した後が読める、が成立するか。
// ここが緩むと壊れ方が静か（全文と言いながら畳まれている／無変更行が抜けて文章が繋がらない）。
{
  const full = (a, b) => D.buildDiff(a, b, Infinity)

  // 畳まない＝省略の帯が1本も出ない。畳んだ側では出る同じ入力で見る（対比で固定する）
  const wide = [txt(['x', ...lines(50), 'y']), txt(['X', ...lines(50), 'Y'])]
  ok(sig(D.buildDiff(wide[0], wide[1]).rows).includes('~'),
    '前提が崩れている: 変更箇所モードで畳めていない（この対比が成立しない）')
  const f = full(wide[0], wide[1])
  ok(!sig(f.rows).includes('~'), `全文表示なのに省略の帯が出た: ${sig(f.rows).slice(0, 120)}`)

  // 出た行だけで「直す前」と「直した後」がそれぞれ元の全文に復元できるか＝この機能の本体。
  // 行数や帯の有無ではなく、復元できるかで縛る（読み比べができるか、そのものの検査）
  const oldSide = f.rows.filter((r) => r.kind !== 'add').map((r) => r.text).join('\n')
  const newSide = f.rows.filter((r) => r.kind !== 'del').map((r) => r.text).join('\n')
  ok(oldSide === wide[0], '全文表示から「直す前」の全文が復元できない（赤＋無変更が元に戻らない）')
  ok(newSide === wide[1], '全文表示から「直した後」の全文が復元できない（緑＋無変更が元に戻らない）')

  // 件数は畳み方に依らない（表示の出し方を変えただけで統計が動くと、どちらかが嘘になる）
  const collapsed = D.buildDiff(wide[0], wide[1])
  ok(f.added === collapsed.added && f.removed === collapsed.removed,
    `全文と変更箇所で件数が違う: 全文 +${f.added}-${f.removed} / 変更箇所 +${collapsed.added}-${collapsed.removed}`)

  // 変更が無い時は全文でも空を返す（renderDiff 側で「変更はありません」に落とすため）
  ok(full('a\nb', 'a\nb').rows.length === 0, '変更が無いのに全文表示が行を返した')

  // 行数の天井: 超えたら畳んだ側へ落とし、落としたことを必ず返す（黙って畳まない）
  const many = lines(DIFF_FULL_MAX_ROWS + 10)
  const manyEdited = many.slice()
  manyEdited[0] = 'edited-head'
  const over = full(txt(many), txt(manyEdited))
  ok(over.ok && over.fellBack === true,
    `全文の行数上限(${DIFF_FULL_MAX_ROWS})を超えても畳んでいない／落としたことを返していない: rows=${over.rows.length}`)
  ok(sig(over.rows).includes('~'), '上限超えで畳んだのに省略の帯が無い（畳めていない）')

  const justUnder = lines(DIFF_FULL_MAX_ROWS - 10)
  const justUnderEdited = justUnder.slice()
  justUnderEdited[0] = 'edited-head'
  const under = full(txt(justUnder), txt(justUnderEdited))
  ok(under.ok && !under.fellBack && under.rows.length === DIFF_FULL_MAX_ROWS - 9,
    `上限の下なのに畳んだ／行数が合わない: fellBack=${under.fellBack} rows=${under.rows.length}`)

  // 境界ちょうど（表示行数 == 上限）は畳まない。> と >= の取り違えはここだけで出る
  // ⚠ 数えるのは元のファイルの行数ではなく「出す行数」＝無変更＋赤＋緑。1行の書き換えで
  //    ops は1本増えるので、ちょうどにするには元を上限-1行にする
  const exact = lines(DIFF_FULL_MAX_ROWS - 1)
  const exactEdited = exact.slice()
  exactEdited[0] = 'edited-head'
  const atLimit = full(txt(exact), txt(exactEdited))
  ok(atLimit.ok && !atLimit.fellBack && atLimit.rows.length === DIFF_FULL_MAX_ROWS,
    `上限ちょうど(${DIFF_FULL_MAX_ROWS}行)で畳んだ: fellBack=${atLimit.fellBack} rows=${atLimit.rows.length}`)
}

// ---------- 3) サイズガード ----------
{
  // ガードは前後トリムの「後」に効く＝実際に計算するセル数で測る
  const side = Math.ceil(Math.sqrt(DIFF_MAX_CELLS))
  const big = (n, prefix) => txt(lines(n, prefix))

  const over = D.buildDiff(big(side, 'old'), big(side, 'new'))
  ok(!over.ok && over.reason === 'toobig',
    `しきい値(${DIFF_MAX_CELLS}セル)を超えても打ち切っていない: ${JSON.stringify(over).slice(0, 80)}`)

  const under = D.buildDiff(big(200, 'old'), big(200, 'new'))
  ok(under.ok && under.added === 200 && under.removed === 200,
    `しきい値の下なのに打ち切った: ${JSON.stringify(under).slice(0, 80)}`)

  // 巨大でも「1行だけ直した」なら通る（前後トリムが効いていないとここで落ちる＝
  // 長い記事ほど差分が見られない、という一番困る腐り方の検知）
  const huge = lines(20000)
  const edited = huge.slice()
  edited[9999] = 'edited-line'
  const small = D.buildDiff(txt(huge), txt(edited))
  ok(small.ok && small.added === 1 && small.removed === 1,
    `巨大ファイルの1行修正が前後トリムで縮んでいない: ${JSON.stringify(small).slice(0, 80)}`)
  ok(small.rows.length < 20, `巨大ファイルの1行修正で無変更行を畳めていない: ${small.rows.length}行`)
}

// ---------- 4) 空ファイル・改行コード ----------
{
  let d = D.buildDiff('', 'a\nb')
  ok(d.ok && d.added === 2 && d.removed === 0 && sig(d.rows) === '+a|+b',
    `空 → 内容あり がおかしい: ${sig(d.rows)} (+${d.added} -${d.removed})`)

  d = D.buildDiff('a\nb', '')
  ok(d.ok && d.added === 0 && d.removed === 2 && sig(d.rows) === '-a|-b',
    `内容あり → 空 がおかしい: ${sig(d.rows)} (+${d.added} -${d.removed})`)

  d = D.buildDiff('', '')
  ok(d.ok && d.rows.length === 0, `空 → 空 で差分が出た: ${sig(d.rows)}`)

  ok(D.diffLines('').length === 0, "'' が 0行として扱われていない（空行1行になっている）")

  // CRLF↔LF だけの違いで全行が変わったことにしない
  d = D.buildDiff('a\r\nb\r\nc', 'a\nb\nc')
  ok(d.ok && d.rows.length === 0, `改行コードの違いだけで差分が出た: ${sig(d.rows)}`)

  // 空行の削除・追加も1行として数える（min-height で高さを残す前提）
  d = D.buildDiff('a\n\nb', 'a\nb')
  ok(d.ok && d.removed === 1 && sig(d.rows) === ' a|-| b', `空行の削除がおかしい: ${sig(d.rows)}`)
}

// ---------- 5) ソース構造の縛り（機能の肝が消えていないか） ----------
{
  const openPreview = grabFn('openPreview')
  const refreshPreview = grabFn('refreshPreview')
  const saveEdit = grabFn('saveEdit')
  const renderPreview = grabFn('renderPreview')
  const renderDiff = grabFn('renderDiff')

  const toggleEdit = grabFn('toggleEdit')

  const ackDiff = grabFn('ackDiff')

  ok(openPreview.includes('setDiffBase('), '開いた時点で基準を取り直していない（openPreview）')
  ok(saveEdit.includes('setDiffBase('), '自分の保存で基準を進めていない（saveEdit）')
  // ⚠ ここが本体。refreshPreview で基準を進めると「1回ぶんの書き換え」しか見えなくなる
  ok(!refreshPreview.includes('setDiffBase(') && !refreshPreview.includes('diffBases'),
    'refreshPreview が基準を動かしている（開いた時点 → 今 がまとめて見えなくなる）')

  // ⚠ 確認済みは「今その差分ビューに出しているファイル」を進める。グローバルの currentFile を
  //    直に見ると、それが editable でない版に入れ替わっていた時に基準ごと捨てる経路が残る
  ok(/^function ackDiff\(res\)/m.test(ackDiff), '確認済みが対象のファイルを受け取っていない（ackDiff(res)）')
  ok(renderDiff.includes('ackDiff(res)'), '確認済みボタンが、今出しているファイルを渡していない')

  // 全文 / 変更箇所は renderDiff が毎回決めて buildDiff に渡す（既定値に任せると、
  // トグルを押しても畳んだままになる＝押しても何も起きないボタンになる）
  ok(renderDiff.includes('diffRange(res)'), 'renderDiff が全文／変更箇所を決めていない')
  ok(/buildDiff\([^)]*, ctx\)/.test(renderDiff),
    'renderDiff が buildDiff に出し方（ctx）を渡していない（既定の畳み方に固定される）')
  // ⚠ 「変更が無い」の判定を行数に戻さない。全文表示は無変更行も行として持つので、
  //    行数で見ると変更ゼロでも全文が出て、本文に戻る道が消える
  ok(renderDiff.includes('!d.added && !d.removed'),
    '「変更が無い」を件数でなく行数で判定している（全文表示で本文に戻れなくなる）')
  // 据え置く時も「最近見た」印だけは更新する（更新しないと本命ほど先に捨てられる）
  ok(openPreview.includes('touchDiffBase('),
    'openPreview が据え置いた基準の新しさを更新していない（退避順が「最初に取った順」になる）')
  // ⚠ 印の更新で中身を書き換えたら、開き直した瞬間に未確認の書き換えが消える（元のバグの再来）
  ok(!grabFn('touchDiffBase').includes('diffNormalize'),
    'touchDiffBase が基準テキストを書き換えている（開き直しで未確認の変更が消える）')
  // 基準を「消す」経路を作らない（editable でないファイルを1枚挟むだけで全部飛ぶ）
  ok(!/diffBases\s*=\s*(null|new Map)/.test(grabFn('setDiffBase')), 'setDiffBase が基準の入れ物ごと捨てている')
  // ⚠ ● の判定に文章モードの絞り込みを持ち込まない。持ち込むと frontmatter やコードブロックだけ
  //    書き換わった時に ● すら出ず、書き換えられたこと自体に気づけない（無言の取りこぼし）
  ok(!grabFn('hasDiff').includes('splitProse'),
    '● の判定（hasDiff）に文章モードの絞り込みが入っている（本文以外の書き換えに気づけなくなる）')

  // ⚠ openPreview は同じファイルに対して何度でも走る（再クリック・ダブルクリック・← で戻る・
  //    受領フィード）。無条件に setDiffBase を呼ぶと、その瞬間に未確認の書き換えが消える。
  ok(openPreview.includes('shouldKeepDiffBase('),
    'openPreview が基準の据え置き判定を通さずに取り直している（同じファイルを再クリックすると差分が消える）')
  ok(!/^[ \t]*setDiffBase\(/m.test(openPreview),
    'openPreview に無条件の setDiffBase がある（据え置き判定の外で取り直している）')

  // ● が点いたまま入力モードに入ると saveEdit の setDiffBase で未確認の変更ごと基準が進む
  ok(toggleEdit.includes('hasDiff(') && toggleEdit.includes('confirm('),
    '未確認の外部変更があるまま入力モードに入れてしまう（保存で基準が進み二度と見られない）')

  // 入力モードの分岐が先＝差分ビューが編集欄を押しのけない
  const iEdit = renderPreview.indexOf('editMode && isEditable(res)')
  const iDiff = renderPreview.indexOf('diffMode && isEditable(res)')
  ok(iEdit >= 0 && iDiff > iEdit, '入力モードより先に差分ビューを描いている（編集中の内容が消える）')

  // editable でなくなったら（4MB超に育つ等）差分ビューは畳む。true のまま残すと、
  // 縮んで戻った瞬間に「押していない差分ビュー」が復活する
  ok(/!isEditable\(res\)\)[ \t]*diffMode = false/.test(renderPreview),
    'editable でなくなった時に diffMode を落としていない（縮んで戻ると勝手に差分ビューが復活する）')

  // rows が空（レナードが編集を巻き戻した）なら差分ビューに取り残さず本文へ戻す
  ok(/if \(renderDiff\(res\)\) return/.test(renderPreview),
    'renderPreview が renderDiff の戻り値を見ていない（変更なし画面に取り残される）')
  ok(/renderDiff\(res\)\) return[\s\S]{0,400}diffMode = false/.test(renderPreview),
    '描くものが無かった時に diffMode を落としていない')
  ok(/renderDiff\(res\)\) return[\s\S]{0,400}showToast\(/.test(renderPreview),
    '本文へ戻す時に無言で戻している（「押したのに何も起きない」に見える）')

  // 本文が素通しでHTMLに入る経路を作らない
  ok(renderDiff.includes('escapeHtml(text)'), 'renderDiff が本文を escapeHtml に通していない')
  ok(!renderDiff.includes('${row.text}'), 'renderDiff が本文を素のままHTMLに埋めている')
}

// 差分ビューの描画を「実体の renderDiff」で叩くための入口。9) の文章モードからも使うので、
// ブロックの外に置く（同じ偽DOMを2回書くと片方だけ古くなる）
let render = null
const pathKeyLower = (p) => String(p || '').toLowerCase()

// ---------- 6) 描画（本文が素通しでHTMLにならないか・実際に組んだ文字列で見る） ----------
// grep だけだと「escapeHtml は呼んでいるが別の場所で素通ししている」を捕まえられないので、
// renderDiff を偽のDOMで実際に走らせて、出来上がったHTMLを見る。
{
  const renderFactory = new Function(`
    const out = {}
    const mkBtn = () => ({ textContent: '', title: '', classList: { toggle() {} }, addEventListener() {} })
    const btns = {}
    const bodyEl = {
      set innerHTML(v) { out.html = v },
      get innerHTML() { return out.html },
      querySelector(sel) { return (btns[sel] = btns[sel] || mkBtn()) },
    }
    const $ = () => bodyEl
    const pathKey = (p) => String(p || '').toLowerCase()
    const isEditable = (res) => !!res && typeof res.source === 'string'
    const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const t = (key) => key
    function ackDiff() {}
    function renderPreview() {}
    const DIFF_CONTEXT = ${DIFF_CONTEXT}
    const DIFF_MAX_CELLS = ${DIFF_MAX_CELLS}
    const DIFF_FULL_MAX_ROWS = ${DIFF_FULL_MAX_ROWS}
    const DIFF_BASE_MAX = ${grabConst('DIFF_BASE_MAX')}
    const DIFF_BASE_MAX_CHARS = ${grabConst('DIFF_BASE_MAX_CHARS')}
    const diffBases = new Map()
    // 永続化は 10) で本物の入れ物を当てて見る。ここは描画だけを見るので受け皿だけ置く
    const localStorage = { removeItem() {} }
    let diffBasesLoaded = true
    ${grabDecl('DIFF_BASE_STORE_KEY')}
    const DIFF_BASE_STORE_MAX_CHARS = ${grabConst('DIFF_BASE_STORE_MAX_CHARS')}
    ${grabFn('saveDiffBases')}
    let diffProseKey = null
    let diffProseChoice = null
    let diffRangeKey = null
    let diffRangeChoice = null
    ${grabFn('diffNormalize')}
    ${grabFn('diffLines')}
    ${grabFn('setDiffBase')}
    ${grabFn('trimDiffBases')}
    ${grabFn('diffBaseOf')}
    ${grabFn('diffViewMode')}
    ${grabFn('diffRange')}
    ${grabFn('splitProse')}
    ${grabFn('lcsOps')}
    ${grabFn('collapseSame')}
    ${grabFn('buildDiff')}
    ${grabFn('renderDiff')}
    ${grabDecl('DIFF_PROSE_EXT')}
    ${grabDecl('DIFF_IMG_RE')}
    ${grabDecl('DIFF_TAG_RE')}
    ${grabDecl('DIFF_FENCE_RE')}
    // path を差し替えると拡張子で文章／コードが切り替わる（既定は拡張子なし＝コードモード）。
    // 第4引数に 'full' / 'changed' を渡すと、そのファイルの手動トグルを押した状態で描く
    return (baseText, nowText, path, rangeChoice) => {
      const p = path || 'P'
      diffRangeKey = rangeChoice ? pathKey(p) : null
      diffRangeChoice = rangeChoice || null
      diffBases.clear()
      if (baseText != null) setDiffBase({ path: p, source: baseText, kind: 'markdown' })
      out.html = ''
      const drew = renderDiff({ path: p, source: nowText, kind: 'markdown' })
      return { drew, html: out.html }
    }
  `)
  render = renderFactory()

  const evil = '<script>alert(1)</script>'
  const html = render('a\nb', 'a\n' + evil).html
  ok(!html.includes('<script>'), '本文中のタグが素のままHTMLに入った（描画結果に <script> がある）')
  ok(html.includes('&lt;script&gt;'), '本文がエスケープされて描画されていない')
  ok(html.includes('class="dline del"') && html.includes('class="dline add"'),
    `削除行・追加行のクラスが付いていない: ${html.slice(0, 200)}`)

  // 変更が無い＝描かずに false を返す（呼び出し側が本文へ戻す。ここで「変更はありません」を
  // 描いて居座ると、本文に戻るのにもう一度ボタンを押させることになる）
  const none = render('a', 'a')
  ok(none.drew === false && !none.html, `変更が無いのに差分ビューを描いた: ${JSON.stringify(none).slice(0, 120)}`)

  const side = Math.ceil(Math.sqrt(DIFF_MAX_CELLS))
  const over = render(txt(lines(side, 'old')), txt(lines(side, 'new')))
  // 打ち切りは畳まない＝ここから抜ける唯一の道が「確認済み」なので、ボタンごと残す
  ok(over.drew === true && over.html.includes('diff.toobig'), '打ち切った時に理由を画面に出していない')
  ok(over.html.includes('diff-ack'), '打ち切り画面に「確認済み」が無い（基準を進める脱出路が消える）')

  // 基準が無くても（別ファイルの基準しか無い等）落ちずに「見るものが無い」を返す
  ok(render(null, 'a\nb').drew === false, '基準が無い時に落ちている／差分ビューに取り残している')

  // 空行の増減は無地の帯にせず、目に見えるプレースホルダを置く
  const blank = render('a\n\nb', 'a\nb')
  ok(blank.drew === true && blank.html.includes('class="dline del blank"'),
    `空行の削除にプレースホルダのクラスが付いていない: ${blank.html.slice(0, 200)}`)
  ok(blank.html.includes('diff.blank'), '空行の差分が無地の帯のまま（何が起きたか読めない）')

  // 既定の出し分け（記事＝通して読む／コード＝変更箇所を確かめる）。
  // 同じ入力を拡張子だけ変えて2回描く＝「畳む・畳まない」が拡張子で決まっていることを見る
  const wideOld = txt(['x', ...lines(30), 'y'])
  const wideNew = txt(['X', ...lines(30), 'Y'])
  const md = render(wideOld, wideNew, '/w/a.md')
  ok(md.drew === true && !md.html.includes('dline gap'),
    '.md の差分が既定で全文になっていない（省略の帯が出ている）')
  ok(md.html.includes('class="diff-body full prose"'),
    `全文／文章モードのクラスが本文側に付いていない: ${(md.html.match(/class="diff-body[^"]*"/) || [''])[0]}`)
  const code = render(wideOld, wideNew, '/w/a.js')
  ok(code.drew === true && code.html.includes('dline gap'),
    'コードの差分が既定で変更箇所だけになっていない（畳めていない）')
  ok(code.html.includes('class="diff-body changed code"'),
    `変更箇所／コードモードのクラスが本文側に付いていない: ${(code.html.match(/class="diff-body[^"]*"/) || [''])[0]}`)

  // トグルは差分ビューに常に出す（打ち切り画面でも出る＝ここから抜ける導線を消さない）
  ok(md.html.includes('class="diff-range"'), '全文／変更箇所のトグルが出ていない')
  ok(over.html.includes('class="diff-range"'), '打ち切り画面に全文／変更箇所のトグルが無い')

  // 全文表示でも「変更が無いなら描かない」（行数で判定すると、変更ゼロで全文が出て
  // 本文に戻れなくなる＝差分ボタンが効かなくなったようにしか見えない）
  const noneMd = render('a\nb', 'a\nb', '/w/a.md')
  ok(noneMd.drew === false && !noneMd.html,
    `全文表示で、変更が無いのに差分ビューを描いた: ${JSON.stringify(noneMd).slice(0, 120)}`)

  // ⚠ ここが「全文」の本体。文章モードの絞り込み（frontmatter・コードブロック・画像・
  //    行内の生HTML・空行を落とす）を全文表示に掛けると、緑だけ拾って読んでも
  //    「直した後」の全文にならない。しかも落とした側が変わっていなければ告知すら出ない
  //    ＝画面に痕跡が残らないまま嘘の全文になる。既定の .md でそれが起きないかを見る
  const rich = [
    '---', 'title: 記事', '---', '',
    '本文の1行目', '![図](img/a.png)',
    '```js', 'const a = 1', '```',
    '本文の<b>2</b>行目',
  ].join('\n')
  const richNew = rich.replace('本文の1行目', '本文の1行目（直した）')
  const richMd = render(rich, richNew, '/w/a.md')
  ok(richMd.drew === true, '前提が崩れている: 書き換えたのに差分ビューが出ていない')
  for (const must of ['title: 記事', 'const a = 1', '![図](img/a.png)', '&lt;b&gt;']) {
    ok(richMd.html.includes(must),
      `全文表示なのに「${must}」が落ちている（文章モードの絞り込みが掛かっている＝全文ではない）`)
  }
  // 無変更の空行は「（空行）」ではなく素の空行で出す（段落の切れ目として働かせる）
  ok(!richMd.html.includes('class="dline same blank"'),
    '無変更の空行に「（空行）」のプレースホルダを置いている（段落の切れ目ごとに並んで記事として読めない）')
  // 増減した空行では今までどおりプレースホルダを出す（無地の帯にしない）
  ok(blank.html.includes('class="dline del blank"'), '空行の削除でプレースホルダが出なくなった')

  // 全文表示では文章／コードのトグルを出さない（絞り込みが効かない＝押しても何も起きない）
  ok(!md.html.includes('diff-viewmode'), '全文表示に、効かない文章／コードのトグルが出ている')
  ok(code.html.includes('diff-viewmode'), '変更箇所モードで文章／コードのトグルが消えている')

  // 打ち切り（toobig）は「比べる量」で起きるので、畳んでも解けない＝全文表示のままだと
  // 文章モードのファイルが既定で打ち切られうる。その時の逃げ道を画面に出しているか。
  // ⚠ ここで案内しないと、見えている脱出路が「確認済み」だけになる＝押すと基準が今に進み、
  //    読まないまま変更内容を失う（一番損する操作を唯一の道として見せてしまう）
  const fenced = (p) => ['本文', '```js', ...lines(Math.ceil(Math.sqrt(DIFF_MAX_CELLS)) + 1, p), '```'].join('\n')
  const tb = render(fenced('old'), fenced('new'), '/w/a.md')
  ok(tb.drew === true && tb.html.includes('diff.toobig'),
    '前提が崩れている: 全文表示で打ち切られていない（この検査が成立しない）')
  ok(tb.html.includes('diff.toobigTryChanged'),
    '全文表示で打ち切られた時に「変更箇所なら出るかもしれない」を案内していない')
  // 実際に変更箇所へ切り替えれば、絞り込みが効いて打ち切られない（案内が嘘でないこと）
  const tbChanged = render(fenced('old'), fenced('new'), '/w/a.md', 'changed')
  ok(!tbChanged.html.includes('diff.toobig'),
    '変更箇所に切り替えても打ち切られる（打ち切り画面の案内が嘘になっている）')

  // 上限超えで畳んだ時は、畳んだことを必ず画面に出す（黙って畳むと全文表示が信用されなくなる）
  const fellOld = txt(lines(DIFF_FULL_MAX_ROWS + 10))
  const fellNew = txt(['edited-head', ...lines(DIFF_FULL_MAX_ROWS + 10).slice(1)])
  const fell = render(fellOld, fellNew, '/w/a.md')
  ok(fell.drew === true && fell.html.includes('diff.fullFellBack'),
    '全文の行数上限で畳んだのに、画面に理由を出していない')
}

// ---------- 7) 基準の据え置き（同じファイルを開き直しても消えない） ----------
// QAの本丸。openPreview は「もう開いているファイル」に対しても走る（再クリック・
// ダブルクリックで外部起動・← で戻る・受領フィード）ので、実体の関数で挙動を固定する。
{
  const openFactory = new Function(`
    const pathKey = (p) => String(p || '').toLowerCase()
    const isEditable = (res) => !!res && typeof res.source === 'string'
    const DIFF_BASE_MAX = ${grabConst('DIFF_BASE_MAX')}
    const DIFF_BASE_MAX_CHARS = ${grabConst('DIFF_BASE_MAX_CHARS')}
    const diffBases = new Map()
    // 永続化は 10) で本物の入れ物を当てて見る。ここは基準の扱いだけを見るので受け皿だけ置く
    const localStorage = { removeItem() {} }
    let diffBasesLoaded = true
    ${grabDecl('DIFF_BASE_STORE_KEY')}
    const DIFF_BASE_STORE_MAX_CHARS = ${grabConst('DIFF_BASE_STORE_MAX_CHARS')}
    ${grabFn('saveDiffBases')}
    ${grabFn('diffNormalize')}
    ${grabFn('setDiffBase')}
    ${grabFn('trimDiffBases')}
    ${grabFn('diffBaseOf')}
    ${grabFn('shouldKeepDiffBase')}
    ${grabFn('touchDiffBase')}
    ${grabFn('hasDiff')}
    ${grabFn('ackDiff')}
    // openPreview の該当部分と同じ順序（ここを変えるなら app.js 側も変わっているはず）
    const open = (path, source) => {
      const res = { path, source }
      if (shouldKeepDiffBase(res)) touchDiffBase(res)
      else setDiffBase(res)
      return res
    }
    // ackDiff の中の renderPreview / diffMode は描画の話なので、ここでは基準だけ見る
    let diffMode = false
    let currentFile = null
    function renderPreview() {}
    return {
      open, ack: (path, source) => ackDiff({ path, source }),
      base: (path) => diffBaseOf({ path, source: '' }),
      count: () => diffBases.size,
      hasDiff: (r) => hasDiff(r),
    }
  `)
  const S = openFactory()

  // 開いた後にレナードが5回書き換え、その途中で同じ行をもう一度クリック（＋ダブルクリック）
  S.open('/w/a.md', 'v1')
  S.open('/w/a.md', 'v3')
  S.open('/w/a.md', 'v5')
  ok(S.base('/w/a.md') === 'v1', `同じファイルを開き直したら基準が進んだ（未確認の変更が消える）: ${S.base('/w/a.md')}`)
  ok(S.hasDiff({ path: '/w/a.md', source: 'v5' }) === true, '据え置いた基準で ● が点かない')

  // 大文字小文字だけ違うパス（Windows）でも同じファイルとして据え置く
  S.open('/W/A.MD', 'v6')
  ok(S.base('/w/a.md') === 'v1', `パスの大文字小文字だけで基準が進んだ: ${S.base('/w/a.md')}`)

  // ⚠ 基準はファイルごとに持つ。別のファイルを見に行っても消えず、戻っても取り直さない。
  //    v0.10 まではスロット1つで、離れた瞬間に前のファイルの基準が消えていた＝
  //    「確認済みを押す → 別のファイルを覗く → 留守中に書き換えられる → 戻ると何も出ない」
  //    という実測のバグの正体。ここが緩むと同じ事故が黙って戻る。
  S.open('/w/b.md', 'other')
  ok(S.base('/w/b.md') === 'other', `別ファイルの基準を取っていない: ${S.base('/w/b.md')}`)
  ok(S.base('/w/a.md') === 'v1', `別ファイルを開いたら前のファイルの基準が消えた: ${S.base('/w/a.md')}`)
  S.open('/w/a.md', 'v6')
  ok(S.base('/w/a.md') === 'v1', `離れて戻ったら基準を取り直してしまった（留守中の書き換えが消える）: ${S.base('/w/a.md')}`)
  ok(S.hasDiff({ path: '/w/a.md', source: 'v6' }) === true, '留守の間に書き換えられたのに ● が点かない')

  // editable でないファイル（画像・PDF・4MB超）を挟んでも、追いかけている基準は消さない
  S.open('/w/pic.png', undefined)
  ok(S.base('/w/a.md') === 'v1', `対象外のファイルを開いたら基準が消えた: ${S.base('/w/a.md')}`)

  // ---- 確認済み（ack）: ここが実測で壊れていた本丸 ----
  S.ack('/w/a.md', 'v6')
  ok(S.base('/w/a.md') === 'v6', `確認済みで基準が今に進んでいない: ${S.base('/w/a.md')}`)
  ok(S.hasDiff({ path: '/w/a.md', source: 'v6' }) === false, '確認済みの直後なのに ● が残っている')
  // 確認済みの後も、次の書き換えは必ず見える（＝これが出なくなるのが報告されたバグ）
  ok(S.hasDiff({ path: '/w/a.md', source: 'v7' }) === true, '確認済みの後に書き換えても ● が点かない')
  // 確認済みの後に別のファイルを覗いて戻ってきても、留守中の書き換えは残っている
  S.open('/w/b.md', 'other2')
  S.open('/w/a.md', 'v8')
  ok(S.base('/w/a.md') === 'v6', `確認済みの基準が、別ファイルを覗いた往復で消えた: ${S.base('/w/a.md')}`)
  ok(S.hasDiff({ path: '/w/a.md', source: 'v8' }) === true, '確認済み → 離席 → 書き換え、で ● が点かない')

  // 溜め込みの上限（際限なく基準を抱えない）。⚠ 最後の1本は必ず残す
  const T = openFactory()
  for (let i = 0; i < 200; i++) T.open('/w/f' + i + '.md', 'x'.repeat(10))
  ok(T.count() <= grabConst('DIFF_BASE_MAX'), `基準の件数が上限を超えて溜まっている: ${T.count()}`)
  ok(T.base('/w/f199.md') === 'x'.repeat(10), '一番新しい基準まで捨てている')
  const U = openFactory()
  U.open('/w/huge.md', 'y'.repeat(grabConst('DIFF_BASE_MAX_CHARS') + 10))
  ok(U.count() === 1, `1本で文字数の上限を超えるファイルの基準を自分で捨てた（差分が一生出ない）: ${U.count()}`)

  // ⚠ 退避の順は「最後に見た順」。追いかけている本命は据え置き判定で setDiffBase を通らないので、
  //    開き直した時に並びを末尾へ寄せないと「最初に基準を取った順」で捨てることになり、
  //    一番よく使っているファイルが、一度開いたきりのファイルより先に消える（＝報告されたバグが
  //    上限の向こう側でそのまま戻る）。v0.10 のタブ復元は openPreview を勝手に撃つので本数は進む。
  {
    const MAX = grabConst('DIFF_BASE_MAX')
    const L = openFactory()
    L.open('/w/watch.md', 'v1')                                  // 本命（確認済みにした想定）
    for (let i = 0; i < MAX - 1; i++) L.open('/w/o' + i + '.md', 'x') // ここでちょうど上限
    L.open('/w/watch.md', 'v1-now')                              // 本命に戻る（基準は据え置き）
    ok(L.base('/w/watch.md') === 'v1',
      `再訪問で基準が今に貼り直された（未確認の書き換えが消える）: ${L.base('/w/watch.md')}`)
    for (let i = 0; i < MAX - 1; i++) L.open('/w/n' + i + '.md', 'y') // さらに埋める
    ok(L.base('/w/watch.md') === 'v1',
      `一番よく使っているファイルの基準が先に捨てられた（退避順が「最後に見た順」になっていない）: ${L.base('/w/watch.md')}`)
    ok(L.base('/w/o0.md') === undefined,
      '一度開いたきりの古いファイルが残っている（本命より後に捨てられていない）')
    ok(L.count() <= MAX, `再訪問を挟むと件数の上限が効かなくなった: ${L.count()}`)
  }

  // 末尾改行だけの差では ● を点けない（整形ツールが足し引きするだけで赤い空行が出る）
  S.open('/w/c.md', 'a\nb')
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\nb\n' }) === false, '末尾改行が増えただけで ● が点いた')
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\nb\n\n  \n' }) === false, '末尾の空行が増えただけで ● が点いた')
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\nb\nc' }) === true, '本文が増えたのに ● が点かない')
  // 本文中の空行の増減は意味のある変更＝消さない
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\n\nb' }) === true, '本文中に空行が入ったのに ● が点かない')
  // ⚠ ● は文章モードの絞り込みを受けない。frontmatter だけ・コードブロックだけの書き換えでも
  //    「何か動いた」ことは必ず伝える（ここを絞ると書き換えに一生気づけない）
  S.open('/w/d.md', '---\ntitle: a\n---\n\n本文\n')
  ok(S.hasDiff({ path: '/w/d.md', source: '---\ntitle: b\n---\n\n本文\n' }) === true,
    'frontmatter だけの書き換えで ● が点かない（文章モードの絞り込みが ● にまで効いている）')
}

// ---------- 8) 末尾の空行だけの差はノイズ扱い（差分そのものにも出さない） ----------
{
  let d = D.buildDiff('a\nb\n', 'a\nb')
  ok(d.ok && d.rows.length === 0 && d.removed === 0,
    `末尾改行の削除がノイズとして差分に出た: ${sig(d.rows)} (+${d.added} -${d.removed})`)

  d = D.buildDiff('a\nb', 'a\nb\n\n\n')
  ok(d.ok && d.rows.length === 0 && d.added === 0,
    `末尾に空行が増えただけで差分が出た: ${sig(d.rows)} (+${d.added} -${d.removed})`)

  // ⚠ 消しすぎの担保。本文中の空行は段落を割った／繋いだという意味のある変更なので残す
  d = D.buildDiff('a\nb', 'a\n\nb')
  ok(d.ok && d.added === 1 && sig(d.rows) === ' a|+| b',
    `本文中に空行を足した差分が消えた: ${sig(d.rows)} (+${d.added} -${d.removed})`)

  d = D.buildDiff('a\n\n\nb', 'a\nb')
  ok(d.ok && d.removed === 2, `本文中の空行の削除が消えた: ${sig(d.rows)} (+${d.added} -${d.removed})`)

  // 末尾のノイズを落としても、同じ書き換えの中の本文の変更は残る
  d = D.buildDiff('a\nb\n', 'a\nB')
  ok(d.ok && d.added === 1 && d.removed === 1 && sig(d.rows) === ' a|-b|+B',
    `末尾改行の差と一緒に本文の変更まで落ちた: ${sig(d.rows)}`)

  // 空白だけの行も末尾なら空行扱い（エディタが入れるインデントの残骸）
  d = D.buildDiff('a\nb', 'a\nb\n   \n\t\n')
  ok(d.ok && d.rows.length === 0, `末尾の空白だけの行で差分が出た: ${sig(d.rows)}`)

  // ⚠ 落とすのは「行ごと」まで。最後の行の行末スペースは残す＝Markdownの強制改行
  //    （`/\s+$/` で刈ると、この2スペースが黙って消えて差分から見えなくなる）
  d = D.buildDiff('a\nb', 'a\nb  ')
  ok(d.ok && d.added === 1 && d.removed === 1,
    `最終行の行末スペース（Markdownの強制改行）まで落ちている: ${sig(d.rows)}`)
}

// ---------- 9) 文章モード / コードモード ----------
// 読む用途（記事）とコードで落とすものが違う。⚠ 一番大事なのは「落とした変更を黙って消さない」＝
// 本文に変更が無くても、落とした側が動いていたら画面から消さずに件数で知らせること。
{
  const proseFactory = new Function(`
    const pathKey = (p) => String(p || '').toLowerCase()
    ${grabDecl('DIFF_PROSE_EXT')}
    ${grabDecl('DIFF_IMG_RE')}
    ${grabDecl('DIFF_TAG_RE')}
    ${grabDecl('DIFF_FENCE_RE')}
    let diffProseKey = null
    let diffProseChoice = null
    ${grabFn('diffNormalize')}
    ${grabFn('diffLines')}
    ${grabFn('splitProse')}
    ${grabFn('diffViewMode')}
    let diffRangeKey = null
    let diffRangeChoice = null
    ${grabFn('diffRange')}
    return {
      splitProse, diffViewMode, diffRange,
      choose: (k, v) => { diffProseKey = k; diffProseChoice = v },
      chooseRange: (k, v) => { diffRangeKey = k; diffRangeChoice = v },
    }
  `)
  const P = proseFactory()

  // 拡張子での自動判定
  ok(P.diffViewMode({ path: 'C:\\w\\a.md' }) === 'prose', '.md が文章モードになっていない')
  ok(P.diffViewMode({ path: '/w/a.MARKDOWN' }) === 'prose', '.markdown（大文字）が文章モードになっていない')
  ok(P.diffViewMode({ path: '/w/note.txt' }) === 'prose', '.txt が文章モードになっていない')
  for (const p of ['/w/a.js', '/w/a.py', '/w/a.json', '/w/a.css', '/w/a.html', '/w/noext']) {
    ok(P.diffViewMode({ path: p }) === 'code', `${p} がコードモードになっていない`)
  }
  // 手動トグルは自動判定を上書きする。⚠ ただし切り替えたファイルにだけ効く
  P.choose(pathKeyLower('/w/a.md'), 'code')
  ok(P.diffViewMode({ path: '/w/a.md' }) === 'code', '手動でコードモードに切り替えられない')
  ok(P.diffViewMode({ path: '/w/b.md' }) === 'prose', '手動の切替が別のファイルにまで効いている')
  P.choose(pathKeyLower('/w/a.js'), 'prose')
  ok(P.diffViewMode({ path: '/w/a.js' }) === 'prose', 'コードを手動で文章モードにできない')
  P.choose(null, null)

  // 全文 / 変更箇所の既定は「文章モードなら全文・コードモードなら変更箇所」。
  // ⚠ 拡張子ではなく diffViewMode の結果にぶら下げる（文章モードへ手動で切り替えたコードも
  //    全文で読めるように＝2つのトグルが噛み合っていないと、片方が効かなく見える）
  ok(P.diffRange({ path: '/w/a.md' }) === 'full', '.md の既定が全文表示になっていない')
  ok(P.diffRange({ path: '/w/note.txt' }) === 'full', '.txt の既定が全文表示になっていない')
  ok(P.diffRange({ path: '/w/a.js' }) === 'changed', 'コードの既定が変更箇所だけになっていない')
  P.choose(pathKeyLower('/w/a.js'), 'prose')
  ok(P.diffRange({ path: '/w/a.js' }) === 'full',
    '手動で文章モードにしたのに全文表示の既定になっていない（2つのトグルが噛み合っていない）')
  P.choose(null, null)
  // 手動の選択は自動判定を上書きし、切り替えたファイルにだけ効く（文章／コードと同じ作法）
  P.chooseRange(pathKeyLower('/w/a.md'), 'changed')
  ok(P.diffRange({ path: '/w/a.md' }) === 'changed', '手動で変更箇所だけに切り替えられない')
  ok(P.diffRange({ path: '/w/b.md' }) === 'full', '全文／変更箇所の切替が別のファイルにまで効いている')
  P.chooseRange(pathKeyLower('/w/a.js'), 'full')
  ok(P.diffRange({ path: '/w/a.js' }) === 'full', 'コードを手動で全文表示にできない')
  P.chooseRange(null, null)

  // 落とす4つ（本文と本文以外にきれいに割れているか）
  const src = [
    '---', 'title: 記事', 'tags: [a]', '---',
    '',
    '本文の1行目',
    '![図](img/a.png)',
    '```js', 'const a = 1', '```',
    '<div class="box">',
    '本文の2行目<br>続き',
    '',
    '本文の3行目',
  ].join('\n')
  const s = P.splitProse(src)
  ok(s.body === '本文の1行目\n本文の2行目続き\n本文の3行目',
    `文章モードの本文の抜き出しがおかしい: ${JSON.stringify(s.body)}`)
  ok(s.other.includes('title: 記事'), 'frontmatter が本文以外に回っていない')
  ok(s.other.includes('const a = 1'), 'コードブロックの中身が本文以外に回っていない')
  ok(s.other.includes('![図](img/a.png)'), '画像リンク行が本文以外に回っていない')
  ok(s.other.includes('<div class="box">') && s.other.includes('<br>'), '生HTMLが本文以外に回っていない')
  // ⚠ 空行は本文にも本文以外にも入れない（「本文以外に変更があります」が空行で点くと、
  //    その表示自体が信用されなくなる）。コードモードでは今までどおり出る。
  ok(!/(^|\n)\s*(\n|$)/.test(s.other), `空行が本文以外に混ざっている: ${JSON.stringify(s.other)}`)

  // 閉じていない frontmatter は本文として扱う（--- 区切り線を frontmatter と誤認しない）
  ok(P.splitProse('---\n本文\nもう1行').body.includes('本文'), '閉じていない --- で本文を落としている')
  // 比較記号を含む日本語の本文をタグと間違えて刈らない
  ok(P.splitProse('a < b > c の話').body === 'a < b > c の話',
    `比較記号を含む本文をHTMLタグとして刈った: ${JSON.stringify(P.splitProse('a < b > c の話').body)}`)

  // ---- 描画: 落とした変更を黙って消さない ----
  const A0 = '---\ntitle: 旧\n---\n\n本文はそのまま\n'
  // frontmatter だけ書き換わった＝文章モードでは本文に変更なし。それでも画面を畳まない
  const only = render(A0, '---\ntitle: 新\n---\n\n本文はそのまま\n', '/w/a.md', 'changed')
  ok(only.drew === true, '本文以外だけが変わった時に差分ビューを畳んだ（● が点いたのに開くと何も無い）')
  ok(only.html.includes('diff.otherChanges'), '本文以外の変更を件数で知らせていない')
  ok(only.html.includes('diff.proseNone'), '本文に変更が無いことを画面に書いていない')

  // 本文も本文以外も変わった時は、本文の差分を出しつつ告知も出す
  const both = render(A0, '---\ntitle: 新\n---\n\n本文が変わった\n', '/w/a.md', 'changed')
  ok(both.html.includes('class="dline add"') && both.html.includes('diff.otherChanges'),
    '本文の差分と本文以外の告知が両立していない')

  // 本文だけ変わった時に、余計な告知を出さない（出しっぱなしだと誰も読まなくなる）
  const bodyOnly = render(A0, '---\ntitle: 旧\n---\n\n本文が変わった\n', '/w/a.md', 'changed')
  ok(!bodyOnly.html.includes('diff.otherChanges'), '本文以外が変わっていないのに告知を出した')

  // ⚠ 空行だけが増減した時も畳まない。生の中身では違う＝● は点いているので、
  //    ここで畳むと「● を見て開いたのに『変更はありません』に飛ばされる」になる
  const blankOnly = render('本文A\n本文B\n', '本文A\n\n本文B\n', '/w/a.md', 'changed')
  ok(blankOnly.drew === true && blankOnly.html.includes('diff.blankOnly'),
    `空行だけの増減で差分ビューを畳んだ（● が点いているのに何も出ない）: ${JSON.stringify(blankOnly).slice(0, 160)}`)
  // 本当に何も変わっていない時は今までどおり畳む（余計な画面に取り残さない）
  ok(render('本文A\n', '本文A\n', '/w/a.md', 'changed').drew === false, '変更が無いのに文章モードで差分ビューを描いた')

  // コードモード（.js）は今までどおり全部出す＝frontmatter 相当の行も本文の差分に並ぶ
  const code = render('---\ntitle: 旧\n---\nx\n', '---\ntitle: 新\n---\nx\n', '/w/a.js')
  ok(code.drew === true && code.html.includes('class="dline del"') && !code.html.includes('diff.otherChanges'),
    'コードモードで行を落としている（何も落とさないのが仕様）')

  // 文章モードでも本文が素通しでHTMLに入らない
  const evil2 = render('本文\n', '本文\n＜script＞alert(1)＜/script＞\n'.replace(/＜/g, '<').replace(/＞/g, '>'), '/w/a.md')
  ok(!evil2.html.includes('<script>'), '文章モードで本文中のタグが素のままHTMLに入った')
}

// ---------- 10) 基準の永続化（アプリを閉じて開き直しても消えない） ----------
// ここが緩むと、v0.10 で潰した事故が**クリックを1つも挟まずに**そのまま戻る＝
// 「夜に確認済みを押して閉じる → 留守の間に書き換えられる → 翌朝開くと ● も差分も出ない」。
// 実測（Electron を起動して CDP でリロード）で確認した経路なので、テストでも実体で縛る。
{
  // localStorage の偽物。枠（文字数）を指定でき、超えたら本物と同じように例外を投げる。
  // ⚠ 本物と同じく「プロパティ代入」で書けること＝app.js の書き方をそのまま通せる形にする。
  function mkStore(limitChars, seed) {
    const data = Object.assign(Object.create(null), seed || {})
    return new Proxy(data, {
      get(target, key) {
        if (key === 'removeItem') return (k) => { delete target[k] }
        if (key === 'getItem') return (k) => (k in target ? target[k] : null)
        return target[key]
      },
      set(target, key, value) {
        const v = String(value)
        let total = v.length
        for (const k of Object.keys(target)) if (k !== key) total += String(target[k]).length
        if (limitChars != null && total > limitChars) throw new Error('QuotaExceededError')
        target[key] = v
        return true
      },
    })
  }

  const STORE_KEY = grabDecl('DIFF_BASE_STORE_KEY').replace(/^.*=\s*'([^']*)'.*$/, '$1')
  const STORE_MAX = grabConst('DIFF_BASE_STORE_MAX_CHARS')

  // ⚠ 永続化側の枠がメモリ側の枠以上だと、localStorage（概ね5〜10MB・UTF-16）に
  //    そのまま書きにいって確実に溢れる。ここは大小関係そのものを縛る
  ok(STORE_MAX < grabConst('DIFF_BASE_MAX_CHARS'),
    `永続化の枠がメモリ側の枠を下回っていない（localStorage が溢れる）: ${STORE_MAX}`)

  // 1セッションぶんの renderer。store を渡し回すことで「アプリを閉じて開き直す」を再現する
  const sessionFactory = new Function('localStorage', `
    const pathKey = (p) => String(p || '').toLowerCase()
    const isEditable = (res) => !!res && typeof res.source === 'string'
    const DIFF_BASE_MAX = ${grabConst('DIFF_BASE_MAX')}
    const DIFF_BASE_MAX_CHARS = ${grabConst('DIFF_BASE_MAX_CHARS')}
    ${grabDecl('DIFF_BASE_STORE_KEY')}
    const DIFF_BASE_STORE_MAX_CHARS = ${STORE_MAX}
    const diffBases = new Map()
    let diffBasesLoaded = false
    ${grabFn('diffNormalize')}
    ${grabFn('setDiffBase')}
    ${grabFn('trimDiffBases')}
    ${grabFn('diffBaseOf')}
    ${grabFn('shouldKeepDiffBase')}
    ${grabFn('touchDiffBase')}
    ${grabFn('hasDiff')}
    ${grabFn('saveDiffBases')}
    ${grabFn('loadDiffBases')}
    // openPreview の該当部分と同じ順序（7) と同じ形）
    const open = (path, source) => {
      const res = { path, source }
      if (shouldKeepDiffBase(res)) touchDiffBase(res)
      else setDiffBase(res)
      return res
    }
    return {
      boot: () => loadDiffBases(),          // 起動（init の loadDiffBases）
      quit: () => saveDiffBases(),          // 終了（beforeunload の saveDiffBases）
      open,
      base: (path) => diffBaseOf({ path, source: '' }),
      hasDiff: (path, source) => hasDiff({ path, source }),
      keys: () => [...diffBases.keys()],
      count: () => diffBases.size,
    }
  `)
  const boot = (store) => { const s = sessionFactory(store); s.boot(); return s }
  const stored = (store) => { try { return JSON.parse(store[STORE_KEY] || 'null') } catch (e) { return 'PARSE-FAIL' } }

  // ---- 本丸: 閉じて開き直しても基準が残り、留守中の書き換えが差分として見える ----
  {
    const store = mkStore()
    const s1 = boot(store)
    s1.open('/w/a.md', 'v1')      // 開いた＝基準を取った（確認済みを押した場合も同じ経路）
    s1.quit()                     // アプリを閉じる
    // ここでレナードが書き換える（Desk は動いていない）
    const s2 = boot(store)        // 翌朝また開く
    ok(s2.base('/w/a.md') === 'v1',
      `再起動で基準が消えた（留守中の書き換えが復元不能で消える）: ${JSON.stringify(s2.base('/w/a.md'))}`)
    ok(s2.hasDiff('/w/a.md', 'v2') === true, '再起動をまたいだ書き換えで ● が点かない')
    // 起動直後にタブの「続きから」で同じファイルが開き直される（restoreTabSelection）。
    // ⚠ ここで基準を取り直したら永続化した意味が丸ごと無くなる
    s2.open('/w/a.md', 'v2')
    ok(s2.base('/w/a.md') === 'v1',
      `起動直後の復元で基準が今に貼り直された（永続化が無効化されている）: ${JSON.stringify(s2.base('/w/a.md'))}`)
    ok(s2.hasDiff('/w/a.md', 'v2') === true, '起動直後の復元の後に ● が消えた')
    // 何度閉じ開きしても消えない（保存が空で上書きしていないか）
    s2.quit()
    const s3 = boot(store)
    ok(s3.base('/w/a.md') === 'v1', '2回目の再起動で基準が消えた')
  }

  // ---- 落ちて閉じても（終了処理を通らなくても）基準は残っている ----
  // ⚠ 終了時（beforeunload）の保存だけに頼らない。WSLごと落ちる・強制終了・電源断では
  //    beforeunload は走らない。基準を取った時点で書き出していないと、そこで丸ごと消える。
  // ⚠ 実機ではこの上に「localStorage のディスク書き込みが数秒遅れる」という層が乗るので、
  //    落ちる直前の1本までは守れない（実測済み・README/CHANGELOG に明記）。ここで縛るのは
  //    「書き出す場所が終了処理ではなく基準を取った時点であること」＝守れる範囲を最大にする形。
  {
    const store = mkStore()
    const s1 = boot(store)
    s1.open('/w/a.md', 'v1')
    // ここで quit() を呼ばない＝アプリが落ちた
    const s2 = boot(store)
    ok(s2.base('/w/a.md') === 'v1',
      `終了処理を通らずに落ちたら基準が消えた（基準を取った時点で保存していない）: ${JSON.stringify(s2.base('/w/a.md'))}`)
    ok(s2.hasDiff('/w/a.md', 'v2') === true, '落ちた後に書き換えられた変更で ● が点かない')
  }

  // ---- 手で書き換えられた保存値が上限を超えていても、そのまま抱え込まない ----
  {
    const MAX = grabConst('DIFF_BASE_MAX')
    const items = []
    for (let i = 0; i < MAX * 2; i++) items.push({ k: '/w/f' + i + '.md', v: 'x' })
    const store = mkStore(null, { [STORE_KEY]: JSON.stringify({ v: 1, items }) })
    const s = boot(store)
    ok(s.count() <= MAX, `保存値から上限を超える基準を読み込んだ: ${s.count()}`)
    // 落とすのは古い側＝一番新しい基準は必ず残す
    ok(s.base('/w/f' + (MAX * 2 - 1) + '.md') === 'x', '読み戻しで一番新しい基準まで捨てた')
  }

  // ---- 読み戻す前に保存させない（空で上書きして全部消さない） ----
  {
    const store = mkStore()
    const s1 = boot(store)
    s1.open('/w/a.md', 'keep-me')
    const before = store[STORE_KEY]
    // boot を通していないセッション（＝ルートピッカーで止まった等）が書き出そうとする
    const raw = sessionFactory(store)
    raw.open('/w/other.md', 'junk')
    raw.quit()
    ok(store[STORE_KEY] === before,
      '読み戻す前に保存してしまい、前回ぶんの基準が上書きで消えた（diffBasesLoaded の歯止めが効いていない）')
    ok(boot(store).base('/w/a.md') === 'keep-me', '上書きされた保存値から基準が復元できない')
  }

  // ---- 溢れても描画を止めない（例外を外に出さない） ----
  {
    const tiny = mkStore(20) // どう詰めても入らない枠
    const s = boot(tiny)
    let threw = false
    try { s.open('/w/a.md', 'x'.repeat(100)) } catch (e) { threw = true }
    ok(!threw, 'localStorage の枠を超えた時に例外が外へ出た（差分の描画ごと止まる）')
    ok(s.base('/w/a.md') === 'x'.repeat(100), '保存に失敗したらメモリ上の基準まで失われた')
    let threw2 = false
    try { s.quit() } catch (e) { threw2 = true }
    ok(!threw2, '終了時の保存で例外が外へ出た')
    // ⚠ 「古い保存値を消したか」はここでは見ない。空の入れ物から始めているので、
    //    removeItem を消しても undefined のままで**素通りする**（実際にそれで変異が抜けた）。
    //    前回ぶんを入れた状態で見るのが正しい＝すぐ下の専用ブロックへ分けた。
  }

  // ---- 1本も書き出せなかった時は、古い保存値を残さない ----
  // ⚠ 残すと、次の起動でその古い基準を読み戻して「実際とは違う地点からの差分」を平然と出す。
  //    ● も差分も出るので、嘘だと気づく手がかりが画面に一つも無い（黙って消えるより質が悪い）。
  // ⚠ 必ず「前回ぶんが入っている」状態から始めること。空の入れ物で試すと、removeItem を
  //    消す変異が素通りする（元から undefined なため）＝実際にそれで網の外になっていた。
  {
    const old = JSON.stringify({ v: 1, items: [{ k: '/w/old.md', v: 'OLD' }] })
    const store = mkStore(old.length, { [STORE_KEY]: old }) // 前回ぶんは在るが、書き直す余地は無い枠
    const s = boot(store)
    ok(s.base('/w/old.md') === 'OLD', '前提が崩れている（古い保存値を読み戻せていない）')
    s.open('/w/big.md', 'x'.repeat(500)) // 何本に減らしても枠に入らない＝全滅する
    ok(store[STORE_KEY] === undefined,
      `1本も書き出せなかったのに古い保存値が残った（次の起動で嘘の基準から差分を出す）: ${store[STORE_KEY]}`)
    ok(boot(store).count() === 0, '書き出せなかった後の起動で、古い基準が生き返った')
  }

  // ---- 枠を超える大物は飛ばして次を入れる（1本に枠を持っていかれない） ----
  {
    const store = mkStore()
    const s = boot(store)
    s.open('/w/old.md', 'o')                        // 古い小物
    s.open('/w/huge.md', 'z'.repeat(STORE_MAX + 1)) // 1本で枠を超える
    s.open('/w/small.md', 's')                      // 新しい小物
    s.quit()
    const keys = (stored(store).items || []).map(it => it.k)
    ok(keys.includes('/w/small.md') && keys.includes('/w/old.md'),
      `枠を超える1本に引きずられて他の基準が保存されなかった: ${JSON.stringify(keys)}`)
    ok(!keys.includes('/w/huge.md'), `枠を超える基準をそのまま書き出した: ${JSON.stringify(keys)}`)
    // 並びは古い順で保存する＝読み戻した時に LRU の順（最後に見たものが末尾）がそのまま戻る
    ok(boot(store).keys().join(',') === '/w/old.md,/w/small.md',
      `保存の並びが LRU の順で戻らない: ${boot(store).keys().join(',')}`)
  }

  // ---- 壊れた／手で書き換えられた保存値を読んでも落ちない ----
  for (const bad of [
    '{ this is not json',
    '{"v":1,"items":"nope"}',
    'null', '[]', '""', '0',
    '{"v":1,"items":[null,3,"x",{"k":5,"v":"a"},{"k":"/w/nov.md"},{"k":"","v":"a"},{"k":"/w/ok.md","v":"fine"}]}',
  ]) {
    const store = mkStore(null, { [STORE_KEY]: bad })
    let s = null
    let err = null
    try { s = boot(store) } catch (e) { err = e }
    ok(!err, `壊れた保存値で起動が死んだ（Desk が開かなくなる）: ${bad} / ${err && err.message}`)
    if (s) {
      const good = bad.includes('/w/ok.md')
      ok(s.count() === (good ? 1 : 0), `壊れた要素まで基準として拾った: ${bad} / ${JSON.stringify(s.keys())}`)
      if (good) ok(s.base('/w/ok.md') === 'fine', '壊れた要素に混ざっていた正しい基準を捨てた')
    }
  }

  // ---- 保存値の改行コードは正規化してから使う（● が点きっぱなしにならない） ----
  {
    const store = mkStore(null, { [STORE_KEY]: JSON.stringify({ v: 1, items: [{ k: '/w/a.md', v: 'a\r\nb\r\n' }] }) })
    ok(boot(store).hasDiff('/w/a.md', 'a\nb\n') === false,
      '保存値の CRLF をそのまま基準にしたため、中身が同じなのに ● が点いた')
  }

  // ---- ソース構造の縛り（呼ぶ場所そのものが機能の成否） ----
  {
    const init = grabFn('init')
    const setupGlobal = grabFn('setupGlobal')
    const iLoad = init.indexOf('loadDiffBases()')
    ok(iLoad >= 0, 'init が基準を読み戻していない（再起動で毎回消える）')
    // ⚠ openWorkspace はタブの「続きから」で openPreview を撃つ。その後に読むと、
    //    復元した1枚が「今の内容」で基準を取り直して留守中の書き換えが消える
    ok(iLoad >= 0 && init.indexOf('openWorkspace(') > iLoad,
      'init が openWorkspace より後に基準を読んでいる（起動直後の復元で基準を取り直す）')
    ok(iLoad >= 0 && init.indexOf('CONFIG.rootOk') > iLoad,
      'init がルートピッカーの分岐より後に基準を読んでいる（その経路だけ保存が止まる）')
    ok(setupGlobal.includes('saveDiffBases()'), '閉じる時に基準（の並び）を書き出していない')
    ok(grabFn('setDiffBase').includes('saveDiffBases()'), '基準を取っても永続化していない')
    // ⚠ touchDiffBase は openPreview のたびに走る。ここから保存を呼ぶと、ファイルを1枚
    //    開くたびに数十万文字の JSON.stringify が走る（並びのズレは次の保存で直る）
    ok(!grabFn('touchDiffBase').includes('saveDiffBases'),
      'touchDiffBase から保存を呼んでいる（ファイルを開くたびに全基準を書き出すことになる）')
    // 書き出しも読み戻しも、例外を外へ出さない形になっているか
    ok(/try\s*{/.test(grabFn('saveDiffBases')), 'saveDiffBases が書き込みを try で囲っていない')
    ok(/try\s*{/.test(grabFn('loadDiffBases')), 'loadDiffBases が読み込みを try で囲っていない')
    // 保存の中身はファイルの写し＝repo にも config.json にも出さない（localStorage だけ）
    ok(!fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8').includes('diffBase'),
      '基準の保存先が config.json（配布物）に漏れている')
  }
}

if (failed) { console.error(`  差分ビューのテスト: ${failed}件 失敗`); process.exit(1) }
// 観点数は数えて出す（手で書くと足しても増えない＝数字だけ嘘になる）
console.log(`  差分（開いた時点 → 今）OK (${checks}観点: 追加・削除・置換／省略の境界／サイズガード／空・改行コード／基準のファイル別保持と確認済み／基準の永続化（再起動・容量超過・壊れた保存値）／末尾空行のノイズ除去／文章・コードモード／全文・変更箇所の出し分け／描画とエスケープ)`)
process.exit(0)
