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

const DIFF_CONTEXT = grabConst('DIFF_CONTEXT')
const DIFF_MAX_CELLS = grabConst('DIFF_MAX_CELLS')

const factory = new Function(`
  const DIFF_CONTEXT = ${DIFF_CONTEXT}
  const DIFF_MAX_CELLS = ${DIFF_MAX_CELLS}
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

  ok(openPreview.includes('setDiffBase('), '開いた時点で基準を取り直していない（openPreview）')
  ok(saveEdit.includes('setDiffBase('), '自分の保存で基準を進めていない（saveEdit）')
  // ⚠ ここが本体。refreshPreview で基準を進めると「1回ぶんの書き換え」しか見えなくなる
  ok(!refreshPreview.includes('setDiffBase(') && !refreshPreview.includes('diffBase ='),
    'refreshPreview が基準を動かしている（開いた時点 → 今 がまとめて見えなくなる）')

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

// ---------- 6) 描画（本文が素通しでHTMLにならないか・実際に組んだ文字列で見る） ----------
// grep だけだと「escapeHtml は呼んでいるが別の場所で素通ししている」を捕まえられないので、
// renderDiff を偽のDOMで実際に走らせて、出来上がったHTMLを見る。
{
  const renderFactory = new Function(`
    const out = {}
    const btn = { textContent: '', title: '', addEventListener() {} }
    const bodyEl = {
      set innerHTML(v) { out.html = v },
      get innerHTML() { return out.html },
      querySelector() { return btn },
    }
    const $ = () => bodyEl
    const pathKey = (p) => String(p || '').toLowerCase()
    const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const t = (key) => key
    function ackDiff() {}
    let diffBase = null
    const DIFF_CONTEXT = ${DIFF_CONTEXT}
    const DIFF_MAX_CELLS = ${DIFF_MAX_CELLS}
    ${grabFn('diffNormalize')}
    ${grabFn('diffLines')}
    ${grabFn('lcsOps')}
    ${grabFn('collapseSame')}
    ${grabFn('buildDiff')}
    ${grabFn('renderDiff')}
    return (baseText, nowText) => {
      diffBase = baseText == null ? null : { key: 'p', text: baseText }
      out.html = ''
      const drew = renderDiff({ path: 'P', source: nowText, kind: 'markdown' })
      return { drew, html: out.html }
    }
  `)
  const render = renderFactory()

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
}

// ---------- 7) 基準の据え置き（同じファイルを開き直しても消えない） ----------
// QAの本丸。openPreview は「もう開いているファイル」に対しても走る（再クリック・
// ダブルクリックで外部起動・← で戻る・受領フィード）ので、実体の関数で挙動を固定する。
{
  const openFactory = new Function(`
    const pathKey = (p) => String(p || '').toLowerCase()
    const isEditable = (res) => !!res && typeof res.source === 'string'
    let diffBase = null
    ${grabFn('diffNormalize')}
    ${grabFn('setDiffBase')}
    ${grabFn('shouldKeepDiffBase')}
    ${grabFn('hasDiff')}
    // openPreview の該当部分と同じ順序（ここを変えるなら app.js 側も変わっているはず）
    const open = (path, source) => {
      const res = { path, source }
      if (!shouldKeepDiffBase(res)) setDiffBase(res)
      return res
    }
    return { open, base: () => diffBase && diffBase.text, hasDiff: (r) => hasDiff(r) }
  `)
  const S = openFactory()

  // 開いた後にレナードが5回書き換え、その途中で同じ行をもう一度クリック（＋ダブルクリック）
  S.open('/w/a.md', 'v1')
  S.open('/w/a.md', 'v3')
  S.open('/w/a.md', 'v5')
  ok(S.base() === 'v1', `同じファイルを開き直したら基準が進んだ（未確認の変更が消える）: ${S.base()}`)
  ok(S.hasDiff({ path: '/w/a.md', source: 'v5' }) === true, '据え置いた基準で ● が点かない')

  // 大文字小文字だけ違うパス（Windows）でも同じファイルとして据え置く
  S.open('/W/A.MD', 'v6')
  ok(S.base() === 'v1', `パスの大文字小文字だけで基準が進んだ: ${S.base()}`)

  // 別のファイルへ移れば取り直す。戻ってきた時も取り直し（＝連続で開いた時だけ据え置く）
  S.open('/w/b.md', 'other')
  ok(S.base() === 'other', `別ファイルを開いても基準が古いままだった: ${S.base()}`)
  S.open('/w/a.md', 'v6')
  ok(S.base() === 'v6', `離れて戻った時に基準を取り直していない: ${S.base()}`)

  // 末尾改行だけの差では ● を点けない（整形ツールが足し引きするだけで赤い空行が出る）
  S.open('/w/c.md', 'a\nb')
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\nb\n' }) === false, '末尾改行が増えただけで ● が点いた')
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\nb\n\n  \n' }) === false, '末尾の空行が増えただけで ● が点いた')
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\nb\nc' }) === true, '本文が増えたのに ● が点かない')
  // 本文中の空行の増減は意味のある変更＝消さない
  ok(S.hasDiff({ path: '/w/c.md', source: 'a\n\nb' }) === true, '本文中に空行が入ったのに ● が点かない')
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

if (failed) { console.error(`  差分ビューのテスト: ${failed}件 失敗`); process.exit(1) }
// 観点数は数えて出す（手で書くと足しても増えない＝数字だけ嘘になる）
console.log(`  差分（開いた時点 → 今）OK (${checks}観点: 追加・削除・置換／省略の境界／サイズガード／空・改行コード／基準の固定と据え置き／末尾空行のノイズ除去／描画とエスケープ)`)
process.exit(0)
