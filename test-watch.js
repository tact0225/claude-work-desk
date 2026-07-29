// 自動更新（ポーリング）と新着ウォッチの検証テスト。
//   A) main.js を electron 差し替えで素の node に読み込み、実際に登録される
//      'poll-fs' / 'probe-watch' / 'set-watch' / 'mark-read' ハンドラをそのまま叩く。
//   B) renderer/app.js の差分適用（applyDirDiff / dropNode）を最小のDOMもどきで叩く。
//
// ここが緩むと壊れ方が静か（無言で光らない・無言で全部光る・毎回全消し再描画に戻る）で
// 気づけないので、動線（check.sh）に埋め込んで毎回回す。
const Module = require('module')
const path = require('path')
const fs = require('fs')
const os = require('os')

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-watch-test-'))
const USER = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-watch-user-'))
const OUT = path.join(WS, '_outbox')
const MEMO = path.join(WS, 'memo')
fs.mkdirSync(path.join(OUT, 'sub'), { recursive: true })
fs.mkdirSync(MEMO)
fs.writeFileSync(path.join(OUT, 'old1.md'), '1')
fs.writeFileSync(path.join(OUT, 'old2.md'), '2')
fs.writeFileSync(path.join(MEMO, 'kept.md'), 'k')
fs.writeFileSync(path.join(USER, 'user-config.json'), JSON.stringify({ root: WS, watchDirs: ['_outbox'] }))

const handlers = {}
const stub = {
  app: {
    getPath: () => USER,
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en-US',
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: function () { return { loadFile: () => {} } },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn }, on: () => {} },
  shell: {}, clipboard: {}, dialog: {},
  nativeImage: { createFromDataURL: () => ({}) },
}

const origLoad = Module._load
Module._load = function (req) {
  if (req === 'electron') return stub
  return origLoad.apply(this, arguments)
}
require('./main.js')
Module._load = origLoad

let failed = 0
let checks = 0
const ok = (cond, why) => { checks++; if (!cond) { console.error('    NG  ' + why); failed++ } }

// ⚠ 最後まで到達した時だけ 0 にする。途中で例外を握り潰したり await を取りこぼして
//    黙って抜けると、何も出力しないまま終了コード0＝check.sh が PASS してしまう
//    （テストが「落ちた」のか「通った」のか区別できないのが一番たちが悪い）。
process.exitCode = 1
process.on('unhandledRejection', (err) => {
  console.error('    NG  テスト自体が落ちた（握り潰されたPromise）:', err)
  process.exit(1)
})
const poll = (dirs, previewPath) => handlers['poll-fs'](null, { dirs: dirs || [], previewPath: previewPath || null })
const rel = (p) => p.slice(WS.length + 1)

// ---------- B) ツリーの差分適用 ----------
// 「変わらない行のDOMには触らない」が本体。全消し再描画に戻ると本田さんの左ペインで
// スクロール位置と選択行が飛ぶ（明示の禁止事項）ので、行の同一性まで見る。
function fakeEl(node) {
  return {
    _node: node, children: [], parent: null, isConnected: true,
    insertBefore(el, ref) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
      const at = ref ? this.children.indexOf(ref) : this.children.length
      this.children.splice(at < 0 ? this.children.length : at, 0, el)
      el.parent = this
      return el
    },
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1)
      this.parent = null
      this.isConnected = false
    },
    querySelectorAll() {
      const out = []
      const walk = (c) => { for (const el of c.children) { out.push(el); walk(el) } }
      walk(this)
      return out
    },
  }
}

// app.js は DOM 前提で丸ごと require できないので、検査したい関数だけをソースから切り出して
// 実体を実行する（差し替えた偽物を採点しないため）。
// ⚠ 波括弧を数えるだけだと、文字列・テンプレート・コメントの中の { } で壊れて
//    「テストが謎の SyntaxError で落ちる」という分かりにくい腐り方をする（QA指摘）ので
//    そこは読み飛ばす。正規表現リテラル内の { } だけは見分けられない＝対象関数に置かないこと。
const APP_SRC = fs.readFileSync(path.join(__dirname, 'renderer', 'app.js'), 'utf8')
function grabFn(name) {
  const src = APP_SRC
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) throw new Error('app.js に ' + name + ' が無い（改名したらこのテストも直す）')
  // ⚠ async を落とさない。落とすと中の await が構文エラーになり「テストが謎の
  //    SyntaxError で落ちる」腐り方をする（切り出しの起点は function より前）
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

function testTreeDiff() {
  const grab = grabFn
  const factory = new Function('El', `
    let selectedRow = null
    const CONFIG = { hidden: ['.git'] }
    const nodeByPath = new Map()
    const openDirs = new Set()
    const made = []
    const pathKey = (p) => String(p || '').replace(/[\\\\/]+$/, '').replace(/\\//g, '\\\\').toLowerCase()
    function makeNode(en, depth) {
      const el = El({ path: en.path, isDir: en.isDir, depth, row: 'row:' + en.path, childBox: null, loaded: false, open: false, mark: '' })
      nodeByPath.set(pathKey(en.path), el)
      made.push(en.path)
      return el
    }
    ${grab('dropNode')}
    ${grab('applyDirDiff')}
    return { applyDirDiff, nodeByPath, made }
  `)
  const api = factory(fakeEl)
  const ent = (name, isDir) => ({ name, isDir: !!isDir, path: 'C:\\w\\' + name })
  const names = (c) => c.children.map(el => (el._node ? el._node.path.split('\\').pop() : '(stray)')).join()

  const box = fakeEl(null)
  api.applyDirDiff(box, 0, [ent('a.md'), ent('b.md'), ent('c.md')])
  ok(names(box) === 'a.md,b.md,c.md', `初期構築が並び順どおりでない: ${names(box)}`)
  const [elA, elB, elC] = box.children

  api.made.length = 0
  api.applyDirDiff(box, 0, [ent('a.md'), ent('b.md'), ent('c.md')])
  ok(box.children[0] === elA && box.children[1] === elB && box.children[2] === elC,
    '変化が無いのに行を作り直している（全消し再描画に戻っている）')
  ok(api.made.length === 0, '変化が無いのに makeNode を呼んでいる')

  api.applyDirDiff(box, 0, [ent('a.md'), ent('b.md'), ent('bb.md'), ent('c.md')])
  ok(names(box) === 'a.md,b.md,bb.md,c.md', `中間挿入の位置がおかしい: ${names(box)}`)
  ok(box.children[0] === elA && box.children[3] === elC, '挿入で前後の既存行が作り直されている')

  api.applyDirDiff(box, 0, [ent('a.md'), ent('bb.md'), ent('c.md')])
  ok(names(box) === 'a.md,bb.md,c.md', `削除の反映がおかしい: ${names(box)}`)
  ok(!api.nodeByPath.has('c:\\w\\b.md'), '消した行が索引に残っている（幽霊行）')
  ok(elB.isConnected === false, '消した行がDOMに残っている')

  api.applyDirDiff(box, 0, [ent('zdir', true), ent('a.md'), ent('bb.md'), ent('c.md')])
  ok(names(box) === 'zdir,a.md,bb.md,c.md', `フォルダ優先の並びが崩れた: ${names(box)}`)
  ok(box.children[1] === elA, 'フォルダ挿入で既存ファイル行が作り直されている')

  const oldA = box.children[1]
  api.applyDirDiff(box, 0, [ent('zdir', true), ent('a.md', true), ent('bb.md'), ent('c.md')])
  ok(box.children[1] !== oldA && box.children[1]._node.isDir === true, '同名でファイル↔フォルダが入れ替わった時に作り直していない')

  box.insertBefore(fakeEl(null), box.children[0]) // 「読み込み中…」の残骸
  api.applyDirDiff(box, 0, [ent('zdir', true), ent('a.md', true), ent('bb.md'), ent('c.md')])
  ok(names(box) === 'zdir,a.md,bb.md,c.md', `ノード以外の子で位置合わせがずれる: ${names(box)}`)

  api.applyDirDiff(box, 0, [ent('.git', true), ent('zdir', true), ent('a.md', true), ent('bb.md'), ent('c.md')])
  ok(names(box) === 'zdir,a.md,bb.md,c.md', `hidden が差分適用で効いていない: ${names(box)}`)

  api.applyDirDiff(box, 0, [])
  ok(box.children.length === 0 && api.nodeByPath.size === 0, '全消しで索引が空にならない')
}

// ---------- C) renderer の起動経路とポーリング層 ----------
// ⚠ ここが丸ごと未検証だったせいで「ルートピッカー経由で起動したセッションでは
//    startPolling が一度も呼ばれない＝自動更新も未読の印も丸ごと死ぬ」が素通りした（QA致命1）。
//    ツリー自体は普通に出るので目でも気づけない壊れ方＝テストで縛るしかない層。
const HARNESS_FNS = ['init', 'startingRoot', 'reloadRoot', 'openWorkspace', 'startAutoRefresh', 'startPolling',
  'stopPolling', 'setSyncStatus', 'schedulePoll', 'pollTick', 'refreshPreview']

function fakeNode() {
  const cls = new Set()
  return {
    textContent: '', title: '', scrollTop: 0, isConnected: true,
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c) },
    },
  }
}

// app.js の起動〜ポーリングを、fs も DOM もタイマーも偽物にした場所で実際に走らせる。
// タイマーは Map で持つ＝「予約が1本だけか（多重起動していないか）」まで見える。
function makeHarness(cfg) {
  const calls = {}
  const timers = new Map()
  let seq = 0
  const ctx = {
    calls,
    timers,
    sync: fakeNode(),
    previewBody: fakeNode(),
    config: Object.assign({ rootOk: true, root: 'C:\\ws', lang: 'ja', hidden: [] }, cfg || {}),
    pollResult: { dirs: {}, unread: [], counts: {}, preview: null, ms: 1 },
    readFileResult: { path: 'C:\\ws\\a.md', size: 30, mtimeMs: 2000 },
    throwOnApply: false,
    gate: null, // ここに Promise を入れるとスキャンが応答待ちで止まる（走行中の重なりを作る）
    document: { hidden: false },
  }
  ctx.bump = (k) => { calls[k] = (calls[k] || 0) + 1 }
  ctx.console = { warn: () => ctx.bump('warn'), error: () => ctx.bump('error') }
  ctx.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id }
  ctx.clearTimeout = (id) => { timers.delete(id) }
  ctx.localStorage = { removeItem: () => ctx.bump('lsRemove') }
  ctx.t = (key) => key
  ctx.I18N = { setLang: () => {}, checkMissing: () => {} }
  ctx.$ = (sel) => (sel === '#sync-status' ? ctx.sync : ctx.previewBody)
  ctx.api = {
    getConfig: async () => { ctx.bump('getConfig'); return ctx.config },
    getWatch: async () => { ctx.bump('getWatch'); return { watchDirs: [], unread: [], counts: {} } },
    resolveTarget: async () => ({ ok: false }),
    readFile: async () => { ctx.bump('readFile'); return ctx.readFileResult },
    pollFs: async () => {
      ctx.bump('pollFs')
      if (ctx.gate) await ctx.gate
      if (ctx.pollThrow) throw new Error(ctx.pollThrow)
      return ctx.pollResult
    },
  }

  const factory = new Function('ctx', `
    'use strict'
    const POLL_MIN_MS = 2000
    const POLL_MAX_FAILS = 3
    let pollTimer = null, pollFails = 0, pollStopped = false, pollBusy = false
    let pollIdle = true, lastPollAt = 0, lastPollError = ''
    let CONFIG = null, browseRoot = '', currentFile = null, previewMtime = null
    let editMode = false, externalChange = false, treeEpoch = 0, rootBox = null
    const { api, document, localStorage, t, I18N, $, console, setTimeout, clearTimeout, bump } = ctx
    const applyI18n = () => bump('applyI18n')
    const refreshInboxLabel = () => bump('refreshInboxLabel')
    const applyFonts = () => bump('applyFonts')
    const setupDrop = () => bump('setupDrop')
    const setupGlobal = () => bump('setupGlobal')
    const setupPathBar = () => bump('setupPathBar')
    const showRootPicker = () => bump('showRootPicker')
    const setBrowseRoot = async (d) => { bump('setBrowseRoot'); if (ctx.throwOnTree) throw new Error('tree boom'); browseRoot = d }
    const setWatchState = () => bump('setWatchState')
    const refreshTree = () => bump('refreshTree')
    const pollDirs = () => []
    const renderPreview = () => bump('renderPreview')
    const updatePreviewTitle = () => bump('updatePreviewTitle')
    const applyMarks = () => { bump('applyMarks'); if (ctx.throwOnApply) throw new Error('applyMarks boom') }
    ${HARNESS_FNS.map(grabFn).join('\n')}
    return {
      init, reloadRoot, pollTick, refreshPreview, startPolling,
      state: () => ({ pollTimer, pollFails, pollStopped, pollBusy, pollIdle, lastPollError,
        previewMtime, externalChange, currentFile }),
      setConfig: (c) => { CONFIG = c }, // init を通さずポーリング単体を叩く時用
      setPreview: (f, m) => { currentFile = f; previewMtime = m },
      setEdit: (v) => { editMode = v },
      setExternal: (v) => { externalChange = v },
    }
  `)
  return Object.assign(factory(ctx), { ctx })
}

async function testStartupPaths() {
  // 1) 通常の起動: ウォッチ状態を取り込み、印を当て、ポーリングが動き出す
  let h = makeHarness()
  await h.init()
  ok(h.ctx.calls.getWatch === 1, 'init でウォッチ状態を取りに行っていない（未読の印が出ない）')
  ok(h.ctx.calls.applyMarks >= 1, 'init で未読の印を当てていない')
  ok(h.ctx.timers.size === 1, `init 後に自動更新が予約されていない (timers=${h.ctx.timers.size})`)
  ok(h.state().pollStopped === false, 'init 直後に停止状態になっている')
  ok(h.ctx.sync.textContent !== '', 'init 後に #sync-status が空（腐り検知の窓口が消えている）')

  // 2) ワークスペースに届かない起動 → ルートピッカー。ポーリングは動かないが窓口だけは必ず出す
  h = makeHarness({ rootOk: false })
  await h.init()
  ok(h.ctx.calls.showRootPicker === 1, 'root 未到達でルートピッカーを出していない')
  ok(h.ctx.timers.size === 0, 'root 未到達なのにポーリングを予約している')
  ok(h.ctx.sync.textContent !== '', '#sync-status が空文字（幅0で見えず、クリックでの再開も押せない）')

  // 3) ★致命1の回帰テスト。ルートピッカーで選び直した経路でも自動更新が始まること。
  //    ここが抜けると、そのセッションだけ「手動F5でしか更新されない Desk」に黙って戻る。
  //    初回起動と、WSLが上がる前に Desk を開いた朝の選び直しで実際に踏む動線。
  h.ctx.config = { rootOk: true, root: 'C:\\ws', lang: 'ja', hidden: [] }
  await h.reloadRoot()
  ok(h.ctx.timers.size === 1, 'ルートピッカーで選び直すと自動更新が起動しない（QA致命1）')
  ok(h.ctx.calls.getWatch === 1, 'ルートピッカー経由だとウォッチ状態を取りに行かない（未読が出ない）')
  ok(h.ctx.sync.textContent !== '', 'ルートピッカー経由だと #sync-status が空のまま')

  // 4) ルート変更を繰り返してもタイマーは1本（増殖させない）
  await h.reloadRoot()
  await h.reloadRoot()
  ok(h.ctx.timers.size === 1, `ルート変更のたびにポーリングが増殖している (timers=${h.ctx.timers.size})`)

  // 5) 変更先に届かなければピッカーへ戻る。ここでも窓口を空にしない
  h.ctx.config = { rootOk: false, root: 'C:\\gone', lang: 'ja', hidden: [] }
  h.ctx.sync.textContent = ''
  await h.reloadRoot()
  ok(h.ctx.sync.textContent !== '', 'ルート変更に失敗した時に #sync-status が空になる')

  // 6) 途中で何が転んでも自動更新だけは動き出す。ここを素通りされると「そのセッションだけ
  //    二度と更新されない」＝致命1と同じ壊れ方が、別の原因で何度でも生えてくる
  h = makeHarness()
  h.ctx.throwOnTree = true
  await h.init()
  ok(h.ctx.timers.size === 1, 'ツリーの初期表示で転ぶと自動更新が起動しない')
  h = makeHarness()
  h.ctx.throwOnApply = true
  await h.init()
  ok(h.ctx.timers.size === 1, '未読の取り込み／印付けで転ぶと自動更新が起動しない')
}

async function testPollLoop() {
  // 最小化中は走らない。復帰は visibilitychange の担当なので、ここで張り直さない
  let h = makeHarness()
  h.setConfig(h.ctx.config)
  h.ctx.document.hidden = true
  await h.pollTick()
  ok(!h.ctx.calls.pollFs, '最小化中なのにスキャンしている（CPUを食い続ける）')
  ok(h.ctx.timers.size === 0, '最小化中にタイマーを張り直している')

  // ワークスペースに届かない間は「待機中」を出す。時計を凍らせたまま通常色にしない
  h = makeHarness({ rootOk: false })
  h.setConfig(h.ctx.config)
  await h.pollTick()
  ok(h.ctx.sync.textContent === 'sync.waiting', `root 未到達時の表示がおかしい: ${h.ctx.sync.textContent}`)
  ok(h.ctx.sync.classList.contains('idle') && !h.ctx.sync.classList.contains('bad'),
    'root 未到達が待機表示になっていない（通常色のまま＝動いているように見える）')
  ok(h.ctx.timers.size === 1, 'root 未到達で空回りをやめている（届いても動き出さない）')

  // 適用フェーズ（ツリー差分・未読の印・プレビュー）の例外を握り潰さない。
  // console だけだと「最終確認の時刻は進むのに中身は止まっている」が画面から読めない
  h = makeHarness()
  h.setConfig(h.ctx.config)
  h.ctx.throwOnApply = true
  await h.pollTick()
  ok(h.state().lastPollError !== '', '適用フェーズの例外を握り潰している')
  ok(h.ctx.sync.classList.contains('bad'), '適用フェーズで落ちたのに画面が通常色のまま（緑の嘘）')
  ok(h.state().pollFails === 1, '適用フェーズの失敗を数えていない')

  // IPC が毎回成功していても、適用が壊れ続けたら止まる（成功でカウンタを0に戻さない）
  await h.pollTick()
  await h.pollTick()
  ok(h.state().pollStopped === true, '適用フェーズが壊れ続けても自動停止しない（IPC成功でカウンタが戻っている）')
  ok(h.ctx.sync.textContent === 'sync.stopped', '停止したことが画面に出ていない')

  // 復帰（#sync-status クリック相当）。直ったらエラー表示が焼き付かずに通常へ戻る
  h.ctx.throwOnApply = false
  h.startPolling()
  await h.pollTick()
  ok(h.state().pollStopped === false && h.state().lastPollError === '', '再開しても停止／エラー状態が残っている')
  ok(h.ctx.sync.textContent.startsWith('⟳ ') && !h.ctx.sync.classList.contains('bad'),
    `復帰後の表示が通常に戻っていない: ${h.ctx.sync.textContent}`)

  // 走行中に重ねて走らせない（#sync-status の連打・最小化⇄復帰の速い往復）
  h = makeHarness()
  h.setConfig(h.ctx.config)
  let release
  h.ctx.gate = new Promise((res) => { release = res })
  const first = h.pollTick()
  // ⚠ 2本目を await してから数えない。ガードが外れていると2本目も応答待ちに入り、
  //    テストが NG ではなく「無言で固まる」で終わる（落ちたのか通ったのか分からない）。
  //    pollTick は最初の await までは同期に進むので、投げた直後に数えれば足りる。
  const second = h.pollTick()
  ok(h.ctx.calls.pollFs === 1, `前のtickが応答待ちなのに重ねて走らせている (${h.ctx.calls.pollFs}回)`)
  release()
  await first
  await second
  ok(h.state().pollBusy === false, '走行フラグが下りていない（以後ポーリングが二度と走らない）')
}

async function testPreviewGuard() {
  const h = makeHarness()
  // ★ 入力モード中は絶対に読み直さない。編集中バッファを外部変更で潰すのは事故（本田さん明示）
  h.setPreview({ path: 'C:\\ws\\a.md', size: 10 }, 1000)
  h.setEdit(true)
  await h.refreshPreview({ mtimeMs: 2000, size: 30 })
  ok(!h.ctx.calls.readFile, '入力モード中に外部変更でファイルを読み直している（打った内容が飛ぶ）')
  ok(h.state().externalChange === true, '入力モード中の外部変更を知らせていない')
  ok(h.state().currentFile.size === 10, '入力モード中に currentFile を差し替えている')

  // 自分の保存より前に stat された応答が後から返ってきた時に「⚠ 外部で更新」を誤点灯しない
  h.setPreview({ path: 'C:\\ws\\a.md', size: 30 }, 3000) // 保存後に持ち直した mtime
  h.setExternal(false)
  await h.refreshPreview({ mtimeMs: 2000, size: 10 })    // 保存前に採られた古い応答
  ok(h.state().externalChange === false, '自分の保存を「外部で更新」と誤検知している')
  ok(h.state().previewMtime === 3000, `古い応答で previewMtime が巻き戻っている: ${h.state().previewMtime}`)

  // 消えたファイルは読み直さない（開いていた内容が突然消えるほうが困る）
  h.setEdit(false)
  await h.refreshPreview({ gone: true })
  ok(!h.ctx.calls.readFile, '消えたファイルを読み直そうとしている')

  // 通常時は読み直す。スクロール位置は先頭に戻さない（左ペインで追記を追える）
  h.setPreview({ path: 'C:\\ws\\a.md', size: 10 }, 1000)
  h.ctx.previewBody.scrollTop = 420
  await h.refreshPreview({ mtimeMs: 2000, size: 30 })
  ok(h.ctx.calls.readFile === 1, '外部で書き換わったのに読み直していない')
  ok(h.state().previewMtime === 2000, '読み直した後に mtime を持ち直していない（毎tick読み直しになる）')
  ok(h.ctx.previewBody.scrollTop === 420, 'プレビュー再読込でスクロール位置が飛んでいる')
}

;(async () => {
  // whenReady().then(loadConfig) がマイクロタスクなので、設定が入るまで1周待つ
  await new Promise((r) => setImmediate(r))

  // 1) 起動直後の1回目は baseline を張るだけ。ここで光ると初回に全画面が光る
  let r = await poll([WS])
  ok(r.unread.length === 0, `1回目のポーリングで既存ファイルが未読になった (${r.unread.length}件)`)
  ok(!!r.dirs[WS] && Array.isArray(r.dirs[WS].entries), 'ツリー用の readdir 結果が返っていない')
  ok(r.dirs[WS].entries.some(en => en.name === '_outbox' && en.isDir), 'readdir の中身がおかしい')
  ok(typeof r.ms === 'number', 'スキャン所要時間を返していない（自己調整ができない）')

  // 2) 直下の新規ファイルだけ未読にする。サブフォルダの中は見ない（非再帰・本田さん明示）
  fs.writeFileSync(path.join(OUT, 'new1.md'), 'n')
  fs.writeFileSync(path.join(OUT, 'sub', 'deep.md'), 'd')
  r = await poll([])
  ok(r.unread.length === 1 && rel(r.unread[0]) === path.join('_outbox', 'new1.md'),
    `直下の新着だけを拾えていない: ${JSON.stringify(r.unread.map(rel))}`)
  ok(r.counts[OUT] === 1, `ウォッチフォルダの未読数がおかしい: ${JSON.stringify(r.counts)}`)

  // 3) 同じ状態で2回目を回しても増えない（毎tick「新着」を作らない）
  r = await poll([])
  ok(r.unread.length === 1, `変化が無いのに未読が増えた (${r.unread.length}件)`)

  // 4) 読んだら既読
  r = await handlers['mark-read'](null, path.join(OUT, 'new1.md'))
  ok(r.unread.length === 0, '既読にできていない')

  // 5) 消えたファイルの未読は掃除する（集合が永久に太らないように）
  fs.writeFileSync(path.join(OUT, 'new2.md'), 'n2')
  r = await poll([])
  ok(r.unread.length === 1, '2つ目の新着を拾えていない')
  fs.unlinkSync(path.join(OUT, 'new2.md'))
  r = await poll([])
  ok(r.unread.length === 0, '消えたファイルの未読が残っている')

  // 6) 読めなかった tick は状態を触らない。
  //    WSLが一瞬途切れただけで「全部消えた→全部新規」と誤認すると全画面が光る
  fs.renameSync(OUT, OUT + '_away')
  r = await poll([])
  ok(r.unread.length === 0, '読めない間に未読が湧いた')
  fs.renameSync(OUT + '_away', OUT)
  r = await poll([])
  ok(r.unread.length === 0, `復帰した瞬間に既存ファイルが全部新着になった (${r.unread.length}件)`)

  // 7) ワークスペース全体は指定させない（本田さん明示）
  ok((await handlers['probe-watch'](null, WS, WS)).reason === 'root', 'ワークスペース全体を弾いていない')
  ok((await handlers['probe-watch'](null, path.dirname(WS), WS)).reason === 'root', 'ルートの祖先を弾いていない')
  // ツリーのルート（パス欄で潜った先そのもの）も指定できない
  ok((await handlers['probe-watch'](null, MEMO, MEMO)).reason === 'root', '今表示しているフォルダ自身を弾いていない')
  ok((await handlers['probe-watch'](null, MEMO, WS)).ok === true, '普通のフォルダを弾いてしまっている')

  // 8) 設定に手で書かれていても無視する
  r = await handlers['set-watch'](null, WS, true)
  ok(!r.watchDirs.some(d => d === WS), '設定経由でワークスペース全体がウォッチに入った')

  // 9) ONにした瞬間の既存ファイルは既読（さもないと追加した瞬間に全部光る）
  r = await handlers['set-watch'](null, MEMO, true)
  ok(r.watchDirs.length === 2, `ウォッチの追加が効いていない: ${JSON.stringify(r.watchDirs.map(rel))}`)
  r = await poll([])
  ok(r.unread.length === 0, `ウォッチON直後に既存ファイルが未読になった (${r.unread.length}件)`)
  fs.writeFileSync(path.join(MEMO, 'fresh.md'), 'f')
  r = await poll([])
  ok(r.unread.length === 1 && rel(r.unread[0]) === path.join('memo', 'fresh.md'), '追加したフォルダの新着を拾えていない')

  // 10) ウォッチを外したら未読も残さない（外しても光り続けるのを防ぐ）
  r = await handlers['set-watch'](null, MEMO, false)
  ok(r.unread.length === 0 && r.watchDirs.length === 1, `ウォッチ解除後に未読が残っている: ${JSON.stringify(r.unread)}`)

  // 11) プレビューの mtime（自動更新の判定材料）
  const f = path.join(OUT, 'old1.md')
  r = await poll([], f)
  ok(r.preview && typeof r.preview.mtimeMs === 'number', 'プレビュー対象の mtime を返していない')
  fs.writeFileSync(f, 'changed by someone else')
  r = await poll([], f)
  ok(r.preview.size === 23, `サイズの変化を拾えていない: ${JSON.stringify(r.preview)}`)
  // ⚠ サイズと OR で見ると mtime 検知が壊れていてもサイズ変化だけで素通りする（QA指摘）。
  //    サイズを据え置いたまま mtime だけ動かして、単独で効いているかを確かめる
  const sameSize = r.preview.size
  const mtimeBefore = r.preview.mtimeMs
  fs.utimesSync(f, new Date(), new Date(Date.now() - 60000))
  r = await poll([], f)
  ok(r.preview.size === sameSize && r.preview.mtimeMs !== mtimeBefore,
    `サイズが変わらない書き換え（mtimeだけ動く）を検知できていない: ${JSON.stringify(r.preview)}`)
  r = await poll([], path.join(OUT, 'nope.md'))
  ok(r.preview && r.preview.gone === true, '消えたファイルを gone として返していない')

  // 12) 未読は再起動をまたいで残す（保存は遅延書き込み）
  fs.writeFileSync(path.join(OUT, 'persist.md'), 'p')
  await poll([])
  await new Promise((res) => setTimeout(res, 1500))
  const saved = JSON.parse(fs.readFileSync(path.join(USER, 'user-config.json'), 'utf8'))
  ok(Array.isArray(saved.unread) && saved.unread.some(p => p.endsWith('persist.md')),
    '未読が user-config.json に保存されていない（再起動で消える）')
  ok(Array.isArray(saved.watchDirs), 'ウォッチ指定が user-config.json に保存されていない')
  // ⚠ 相対で書かれた既定は相対のまま保存する。トグル1回で絶対パスに焼き付くと、
  //    ワークスペースを引っ越した時に既定のウォッチが黙って外れる
  ok(saved.watchDirs.includes('_outbox'),
    `既定のウォッチが絶対パスに焼き付いている: ${JSON.stringify(saved.watchDirs)}`)

  // 13) 直下1000超は断る。probe だけでなく set-watch を直に叩いた時も通さない
  //     （UIは必ず probe→set の順に呼ぶが、歯止めは入口の数だけ要る）
  const BIG = path.join(WS, 'big')
  fs.mkdirSync(BIG)
  for (let i = 0; i < 1001; i++) fs.writeFileSync(path.join(BIG, `f${i}.md`), 'x')
  const probeBig = await handlers['probe-watch'](null, BIG, WS)
  ok(probeBig.ok === false && probeBig.reason === 'big' && probeBig.files === 1001,
    `直下1000超のフォルダを断っていない: ${JSON.stringify(probeBig)}`)
  r = await handlers['set-watch'](null, BIG, true)
  ok(!r.watchDirs.some(d => d === BIG), 'set-watch を直に叩くと1000件の上限を素通りできる')

  // 14) hidden はウォッチ側にも効く。.git は「フォルダ」とは限らず、git worktree /
  //     submodule では中身がテキストの“ファイル”として置かれる＝実際に踏みうる
  fs.writeFileSync(path.join(OUT, '.git'), 'gitdir: /somewhere')
  r = await poll([])
  ok(!r.unread.some(p => p.endsWith('.git')), 'hidden 指定のファイルを新着として拾っている')

  // 15) 「読めない」と「消えた」を区別する。WSLが落ちている間に未読を巻き添えで消すと、
  //     「クリックするまで残す」という約束（本田さん明示）が静かに壊れる
  const LANE = path.join(WS, 'lane')
  const BOX = path.join(LANE, 'box')
  fs.mkdirSync(BOX, { recursive: true })
  await handlers['set-watch'](null, BOX, true)
  fs.writeFileSync(path.join(BOX, 'note.md'), 'n')
  r = await poll([])
  ok(r.unread.some(p => p.endsWith('note.md')), '追加したフォルダの新着を拾えていない')
  const keep = r.unread.length
  fs.renameSync(LANE, LANE + '_away') // 親ごと読めない＝WSLが落ちた相当
  r = await poll([])
  ok(r.unread.length === keep, '親ごと読めないだけ（WSLが落ちた）で未読を消している')
  fs.renameSync(LANE + '_away', LANE)
  r = await poll([])
  ok(r.unread.length === keep, '復帰した時に未読が変わった')
  fs.rmSync(BOX, { recursive: true, force: true }) // 親は読めて自分だけ居ない＝削除確定
  r = await poll([])
  ok(!r.unread.some(p => p.endsWith('note.md')), 'ウォッチフォルダごと消えた時に未読が永久に残る')

  testTreeDiff()
  await testStartupPaths()
  await testPollLoop()
  await testPreviewGuard()

  fs.rmSync(WS, { recursive: true, force: true })
  fs.rmSync(USER, { recursive: true, force: true })
  if (failed) { console.error(`  自動更新／新着ウォッチのテスト: ${failed}件 失敗`); process.exit(1) }
  // 観点数は数えて出す（手で書くと足しても増えない＝数字だけ嘘になる）
  console.log(`  自動更新／新着ウォッチ OK (${checks}観点: main のIPC実叩き／renderer の起動経路・ポーリング層／ツリー差分)`)
  // 未読の遅延書き込みタイマーが残っていると、片付けた後に発火して
  // 「未読の保存に失敗: ENOENT」が毎回出る（テストの合否とは無関係のノイズ）
  process.exit(0)
})()
