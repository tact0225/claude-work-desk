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
  // ⚠ 本体の起点は「引数リストを閉じた後の { 」。素直に最初の { から数えると、
  //    分割代入の既定引数（activateTab(i, { force = false } = {}) 等）を本体と誤認して
  //    そこで切ってしまい、半分だけの関数が SyntaxError になる（読み切れずに落ちる）
  let pd = 0
  let bodyStart = -1
  for (let k = src.indexOf('(', i); k < src.length; k++) {
    if (src[k] === '(') pd++
    else if (src[k] === ')') { pd--; if (!pd) { bodyStart = src.indexOf('{', k); break } }
  }
  if (bodyStart < 0) throw new Error('引数リストを読み切れない: ' + name)
  let depth = 0
  for (let k = bodyStart; k < src.length; k++) {
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
// タブ機構（v0.10.0）も起動経路の一部になった＝起動時にどのタブを開くかの判断（startingTab）と
// 保存の読み書き（loadTabs / saveTabs）まで実体で走らせる。ここを偽物で埋めると
// 「消えたレーンを指すタブで起動したセッションだけツリーが出ない」が素通りする。
const HARNESS_FNS = ['init', 'newTab', 'resetTabTo', 'loadTabs', 'saveTabs', 'startingTab', 'pathKey', 'samePath',
  'reloadRoot', 'openWorkspace', 'startAutoRefresh', 'startPolling',
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
  // タブの保存先。実体（loadTabs / saveTabs）を走らせるので、素の入れ物として振る舞わせる
  ctx.localStorage = { removeItem(k) { ctx.bump('lsRemove'); delete this[k] } }
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
    let tabs = [], activeTab = 0, tabsLoaded = false
    const TABS_KEY = 'tabs'
    const { api, document, localStorage, t, I18N, $, console, setTimeout, clearTimeout, bump } = ctx
    const applyI18n = () => bump('applyI18n')
    const refreshInboxLabel = () => bump('refreshInboxLabel')
    const applyFonts = () => bump('applyFonts')
    const setupDrop = () => bump('setupDrop')
    const setupGlobal = () => bump('setupGlobal')
    const setupPathBar = () => bump('setupPathBar')
    const setupTabs = () => bump('setupTabs')
    const renderTabs = () => bump('renderTabs')
    const baseName = (p) => String(p).replace(/[\\\\/]+$/, '').split(/[\\\\/]/).pop()
    const showRootPicker = () => bump('showRootPicker')
    const setBrowseRoot = async (d) => { bump('setBrowseRoot'); if (ctx.throwOnTree) throw new Error('tree boom'); browseRoot = d }
    // openTab の中身（展開・選択・スクロールの復元）はDOMの話なので、ここではツリーを
    // 開くところだけ本物と同じ順序で走らせる＝転んだ時に startAutoRefresh へ抜ける経路を見る
    const openTab = async (tb) => { bump('openTab'); await setBrowseRoot(tb.path) }
    const setWatchState = () => bump('setWatchState')
    const refreshTree = () => bump('refreshTree')
    const pollDirs = () => []
    const renderPreview = () => bump('renderPreview')
    const updatePreviewTitle = () => bump('updatePreviewTitle')
    const applyMarks = () => { bump('applyMarks'); if (ctx.throwOnApply) throw new Error('applyMarks boom') }
    ${HARNESS_FNS.map(grabFn).join('\n')}
    return {
      init, reloadRoot, pollTick, refreshPreview, startPolling, saveTabs,
      state: () => ({ pollTimer, pollFails, pollStopped, pollBusy, pollIdle, lastPollError,
        previewMtime, externalChange, currentFile }),
      tabs: () => tabs.map(tb => ({ path: tb.path, bad: tb.bad })),
      active: () => activeTab,
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

  // 7) タブ（v0.10.0）: 1枚目は必ずワークスペース。初回起動でも閉じられないタブが1枚できる
  h = makeHarness()
  await h.init()
  ok(h.tabs().length === 1 && h.tabs()[0].path === 'C:\\ws', `1枚目がワークスペースになっていない: ${JSON.stringify(h.tabs())}`)

  // 8) 撤収済みレーンを指すタブで終えた後の起動。⚠を付けてタブは残し（勝手に消さない）、
  //    表示だけワークスペースへ落とす。ここで転ぶとそのセッションはツリーごと出ない
  h = makeHarness()
  h.ctx.localStorage.tabs = JSON.stringify({ v: 1, active: 1, tabs: [{ path: 'C:\\ws' }, { path: 'C:\\ws-gone' }] })
  h.ctx.api.resolveTarget = async () => ({ ok: false }) // 行き先が消えている
  await h.init()
  ok(h.active() === 0, 'タブの行き先が消えている時にワークスペースへ落ちていない')
  ok(h.tabs().length === 2 && h.tabs()[1].bad === true, `消えたタブを勝手に消している／⚠が付いていない: ${JSON.stringify(h.tabs())}`)
  ok(h.ctx.timers.size === 1, 'タブの行き先が消えていると自動更新が起動しない')

  // 9) 生きているタブは復元する（正規化後のパスで持ち直す＝WSL形式のまま readDir に渡さない）
  h = makeHarness()
  h.ctx.localStorage.tabs = JSON.stringify({ v: 1, active: 1, tabs: [{ path: 'C:\\ws' }, { path: '/home/me/lane' }] })
  h.ctx.api.resolveTarget = async () => ({ ok: true, isDir: true, path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\lane' })
  await h.init()
  ok(h.active() === 1 && h.tabs()[1].path.startsWith('\\\\wsl'), `タブのパスを正規化後で持ち直していない: ${JSON.stringify(h.tabs())}`)

  // 10) 壊れたJSONを読んでも起動不能にならない（手で触られた localStorage で立ち上がらない、を防ぐ）
  h = makeHarness()
  h.ctx.localStorage.tabs = '{壊れ'
  await h.init()
  ok(h.tabs().length === 1 && h.ctx.timers.size === 1, '壊れた保存データで起動が止まっている')

  // 11) v0.9 までの localStorage.browseRoot はタブとして拾ってから消す（行き先を失わせない）
  h = makeHarness()
  h.ctx.localStorage.browseRoot = 'C:\\ws-lane'
  h.ctx.api.resolveTarget = async () => ({ ok: true, isDir: true, path: 'C:\\ws-lane' })
  await h.init()
  ok(h.tabs().length === 2 && h.tabs()[1].path === 'C:\\ws-lane', `旧 browseRoot をタブに移行していない: ${JSON.stringify(h.tabs())}`)
  ok(h.ctx.localStorage.browseRoot === undefined, '移行後も旧 browseRoot が残っている（次回二重に拾う）')

  // 12) ★P0-2 の回帰（実機の再現手順そのまま）: WSLが上がる前に開くとルートピッカーで止まり、
  //     タブは一度も読み込まれない。その状態で終了処理（beforeunload の captureTab/saveTabs）が
  //     走っても、前の晩のタブを空配列で上書きしないこと
  h = makeHarness({ rootOk: false })
  const saved = JSON.stringify({ v: 1, active: 1, tabs: [{ path: 'C:\\ws' }, { path: 'C:\\lane' }] })
  h.ctx.localStorage.tabs = saved
  await h.init()
  ok(h.ctx.calls.showRootPicker === 1, 'root 未到達なのにピッカーが出ていない（前提が崩れている）')
  h.saveTabs() // 終了時にここが走る
  ok(h.ctx.localStorage.tabs === saved, 'ワークスペースに届かない起動で終了すると保存済みのタブが消える（P0-2）')
}

// ---------- D) 最下段のフォルダタブ（切替・退避・復元・閉じる） ----------
// ⚠ ここが無検査だったせいで P0 が2件出た（閉じる時の確認の順序・保存の入口の歯止め）。
//    起動経路（C）だけでは captureTab / activateTab / closeTab / goHome / addTab / stepTab に
//    一度も触れない＝タブ機能の本体が丸ごと素通りしていた。DOMは偽物にするが、
//    タブの状態を動かす関数は全部**実体**を走らせる。
const TAB_FNS = ['newTab', 'resetTabTo', 'tabLabel', 'saveTabs', 'loadTabs', 'captureTab',
  'settleOpenWaiters', 'restoreTabSelection', 'openTab', 'activateTab', 'goHome', 'stepTab',
  'addTab', 'createTab', 'pinCurrentTab', 'closeTab', 'setBrowseRoot', 'gotoPath', 'pathKey', 'samePath', 'baseName', 'parentOf',
  // タブを増やす動線（本田さんが実機で見つけられなかった箇所）。押した時に何が起きるかまで実体で見る
  'setupTabs', 'showTabAddMenu', 'showCtxMenu',
  // パス欄の履歴（▾）。積む場所を間違えると静かに壊れる（タブ切替で汚れる／上限が外れる）
  'pathHistory', 'pushPathHistory', 'togglePathHist', 'hidePathHist',
  // ツリーの行そのもの。フォルダとファイルでダブルクリックの扱いが違う
  'makeNode', 'fileIcon']

// 仮想ファイルシステム。キーがフォルダ、値が直下の名前（キーに無い名前＝ファイル）
const VFS = {
  'C:\\ws': ['docs', 'top.md'],
  'C:\\ws\\docs': ['deep', 'a.md'],
  'C:\\ws\\docs\\deep': ['d.md'],
  'C:\\lane1': ['l1.md'],
  'C:\\lane2': ['l2.md'],
}

function makeTabHarness() {
  const calls = {}
  const nodes = {}
  const ctx = {
    calls,
    vfs: Object.assign({}, VFS),
    config: { rootOk: true, root: 'C:\\ws', inbox: 'C:\\ws\\_inbox', hidden: [] },
    localStorage: { removeItem(k) { delete this[k] } },
    allowLeave: true,   // 入力モードの破棄確認（false = 〈いいえ〉を押した）
    previewOk: true,
    gate: null,         // resolveTarget をここで止めると「切替の走行中」が作れる
    drawn: [],          // renderTabs が描いたであろうタブ列（見た目の突合用）
    selected: null,
  }
  ctx.bump = (k) => { calls[k] = (calls[k] || 0) + 1 }
  // 偽のDOMノード。addEventListener は捨てずに覚える＝登録したハンドラを
  // テストから実際に呼べる（＋ボタンの左/右クリックの分岐を実体で踏むため）
  // 偽の要素。履歴（▾）の中身は要素を組んで作るので、children と classList.contains まで持たせる
  ctx.mkEl = () => {
    const cls = new Set()
    const el = {
      className: '', textContent: '', title: '', value: '', scrollTop: 0,
      children: [], handlers: {}, style: {}, draggable: false, _node: null,
      addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn) },
      append(...kids) { for (const k of kids) this.children.push(k) },
      appendChild(c) { this.children.push(c); return c },
      insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c },
      querySelectorAll() { return [] },
      remove() {},
      classList: {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c),
        contains: (c) => cls.has(c), toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c) },
      },
    }
    Object.defineProperty(el, 'innerHTML', { get: () => '', set: (v) => { if (v === '') el.children.length = 0 } })
    return el
  }
  ctx.node = (sel) => (nodes[sel] || (nodes[sel] = ctx.mkEl()))
  ctx.fire = (sel, type) => {
    const e = { stopPropagation() {}, preventDefault() {}, clientX: 0, clientY: 0 }
    const list = (ctx.node(sel).handlers[type] || [])
    if (!list.length) throw new Error(`${sel} に ${type} のハンドラが無い`)
    return Promise.all(list.map(fn => fn(e)))
  }

  const factory = new Function('ctx', `
    'use strict'
    const TABS_KEY = 'tabs'
    const PATH_HIST_MAX = 20
    let CONFIG = ctx.config
    let tabs = [], activeTab = 0, tabsLoaded = false
    let tabSwitchBusy = false, tabSwitchPending = null, tabMenuBusy = false
    let browseRoot = '', currentFile = null, openWaiters = null
    const openDirs = new Set()
    const nodeByPath = new Map()
    const watchKeys = new Set()
    const { localStorage, bump } = ctx
    const $ = (sel) => ctx.node(sel)
    const t = (k) => k
    // 右クリックメニューは「何が並んだか」だけ覚える（描画はDOMの仕事）。
    // 項目の中身は実体で組ませる＝並び順も、押した時に何が起きるかも検査できる
    const showMenu = (e, items) => { ctx.menu = items }
    const flashTab = (i) => { ctx.flashed = i }
    const toWslPath = (p) => p
    const isBroadDir = () => false
    const toggleWatch = () => bump('toggleWatch')
    const chooseFolderTab = async () => bump('chooseFolderTab')
    const navigator = { clipboard: { writeText: (s) => { ctx.copied = s } } }
    const document = { createElement: () => ctx.mkEl() }
    let internalDragPath = null
    const loadChildren = async () => bump('loadChildren')
    const applyMarks = () => bump('applyMarks')
    const showToast = () => bump('showToast')
    const pathBarError = () => bump('pathBarError')
    const refreshInboxLabel = () => bump('refreshInboxLabel')
    const leaveEditMode = async () => { bump('leaveEditMode'); return ctx.allowLeave }
    const openPreview = async (p) => { bump('openPreview'); if (!ctx.previewOk) return false; currentFile = { path: p }; return true }
    const selectRow = (row) => { ctx.selected = row }
    // 見た目は描かないが、何をどう描くかは実体（tabLabel）で決めさせる＝
    // 「反転しているタブ」と「実際に開いているタブ」の食い違いを突き合わせられる
    const renderTabs = () => { bump('renderTabs'); ctx.drawn = tabs.map((tb, i) => ({ label: tabLabel(tb, i), active: i === activeTab, bad: !!tb.bad })) }
    // ツリーの読み込み。展開中フォルダのぶんまで索引に載せる（選択の復元が当たるかを見るため）
    const loadTreeRoot = async () => {
      bump('loadTreeRoot')
      nodeByPath.clear()
      const add = (dir) => {
        for (const name of (ctx.vfs[dir] || [])) {
          const p = dir + '\\\\' + name
          nodeByPath.set(pathKey(p), { _node: { path: p, isDir: !!ctx.vfs[p], row: { path: p } } })
        }
      }
      add(browseRoot)
      for (const d of openDirs) add(d)
    }
    const api = {
      resolveTarget: async (p) => {
        bump('resolveTarget')
        if (ctx.gate) await ctx.gate
        if (ctx.vfs[p]) return { ok: true, isDir: true, path: p, filePath: null }
        return { ok: false, error: 'gone' }
      },
      listWorktrees: async () => { bump('listWorktrees'); if (ctx.lanesThrow) throw new Error('lane boom'); return ctx.lanes || [] },
      openPath: (p) => { bump('openPath'); ctx.opened = p },
      dragStart: () => bump('dragStart'),
      showInFolder: () => bump('showInFolder'),
    }
    ${TAB_FNS.map(grabFn).join('\n')}
    return {
      loadTabs, saveTabs, captureTab, activateTab, goHome, stepTab, addTab, pinCurrentTab, closeTab, gotoPath, renderTabs,
      setupTabs, showCtxMenu, pathHistory, togglePathHist, makeNode,
      state: () => ({ tabs: tabs.map(tb => ({ path: tb.path, name: tb.name, open: [...tb.open], sel: tb.sel, scroll: tb.scroll, bad: !!tb.bad })),
        activeTab, browseRoot, openDirs: [...openDirs], currentFile, tabsLoaded, busy: tabSwitchBusy }),
      expand: (list) => { openDirs.clear(); for (const p of list) openDirs.add(p) },
      setPreview: (p) => { currentFile = p ? { path: p } : null },
      // ルートピッカーで止まったまま（＝タブを一度も読み込んでいない）を再現する
      neverLoaded: () => { tabsLoaded = false; tabs = []; activeTab = 0 },
    }
  `)
  return Object.assign(factory(ctx), { ctx })
}

async function testTabOps() {
  const S = (h) => h.state()
  // 切替が静まるまで待つ。stepTab は（キーハンドラと同じく）activateTab を await しない＝
  // 呼び出しの Promise を待っただけでは終わっていない。ここを待たずに次を始めると
  // テスト側の都合で結果が揺れる（実装の是非とは無関係のノイズ）
  const settle = async (h) => { for (let k = 0; k < 500 && S(h).busy; k++) await new Promise(r => setImmediate(r)) }

  // 1) 起動直後: 1枚目はワークスペース
  let h = makeTabHarness()
  h.loadTabs()
  ok(S(h).tabs.length === 1 && S(h).tabs[0].path === 'C:\\ws', '1枚目がワークスペースになっていない')
  await h.activateTab(0, { force: true })
  ok(S(h).browseRoot === 'C:\\ws', 'タブを開いても browseRoot が動いていない')

  // 2) ★「続きから」の退避と復元。ここが captureTab の変異（tb.open = [] 等）を撃墜する
  await h.addTab('C:\\lane1')
  ok(S(h).tabs.length === 2 && S(h).activeTab === 1, 'タブの追加でアクティブが移らない')
  await h.activateTab(0)
  h.expand(['C:\\ws\\docs', 'C:\\ws\\docs\\deep'])
  h.setPreview('C:\\ws\\docs\\deep\\d.md')
  h.ctx.node('#tree').scrollTop = 42
  await h.activateTab(1)
  ok(S(h).openDirs.length === 0, 'タブを移った先に前のタブの展開が残っている')
  ok(S(h).browseRoot === 'C:\\lane1', 'タブを移っても browseRoot が変わらない')
  await h.activateTab(0)
  const st = S(h)
  ok(st.openDirs.length === 2, `戻った時に展開が復元されない (openDirs=${st.openDirs.length})`)
  ok(st.openDirs.includes('C:\\ws\\docs\\deep'), '深い階層の展開が復元されない')
  ok(st.currentFile && st.currentFile.path.endsWith('d.md'), '戻った時に選択ファイル（プレビュー）が復元されない')
  ok(h.ctx.selected && h.ctx.selected.path.endsWith('d.md'), '戻った時に選択行が復元されない')
  ok(h.ctx.node('#tree').scrollTop === 42, 'スクロール位置が復元されない')
  const savedOpen = JSON.parse(h.ctx.localStorage.tabs).tabs[0].open
  ok(savedOpen && savedOpen.length === 2, `展開が保存されていない: ${JSON.stringify(savedOpen)}`)

  // 3) ★閉じた後の添字。閉じたのが自分より前なら、アクティブは1つ手前へずれる
  await h.addTab('C:\\lane2')
  ok(S(h).activeTab === 2, '3枚目がアクティブになっていない')
  await h.closeTab(1)
  ok(S(h).tabs.length === 2, 'タブを閉じられていない')
  ok(S(h).activeTab === 1 && S(h).tabs[1].path === 'C:\\lane2', `閉じた後のアクティブがずれている (activeTab=${S(h).activeTab})`)
  ok(S(h).browseRoot === 'C:\\lane2', '前のタブを閉じただけで表示中のフォルダが変わっている')
  h.renderTabs()
  const act = h.ctx.drawn.findIndex(d => d.active)
  ok(act === 1 && h.ctx.drawn[act].label === 'lane2', `タブバーの反転位置と開いているフォルダが食い違う: ${JSON.stringify(h.ctx.drawn)}`)
  ok(JSON.parse(h.ctx.localStorage.tabs).active === 1, '閉じた後のアクティブ位置が保存に反映されていない')

  // 4) ★P0-1 の回帰: 未保存のまま閉じて〈いいえ〉を押したら、何も起きていないこと。
  //    先に splice してから確認する実装だと、タブが減ったまま保存まで済んで復旧できない
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  await h.addTab('C:\\lane1')
  await h.addTab('C:\\lane2')
  const before = JSON.stringify(S(h))
  const savedBefore = h.ctx.localStorage.tabs
  h.ctx.allowLeave = false
  await h.closeTab(2)
  ok(JSON.stringify(S(h)) === before, '破棄確認を取り消したのにタブの状態が変わっている（P0-1）')
  ok(h.ctx.localStorage.tabs === savedBefore, '破棄確認を取り消したのに保存が書き換わっている（P0-1）')
  h.ctx.allowLeave = true
  await h.closeTab(2)
  ok(S(h).tabs.length === 2 && S(h).activeTab === 1 && S(h).browseRoot === 'C:\\lane1', 'アクティブなタブを閉じた後の行き先が違う')

  // 5) ★P0-2 の回帰: タブを一度も読み込んでいない状態では絶対に保存しない
  //    （WSLが上がっていない朝＝ルートピッカーで止まったまま閉じると全部消えていた）
  const keep = h.ctx.localStorage.tabs
  h.neverLoaded()
  h.captureTab()
  h.saveTabs()
  ok(h.ctx.localStorage.tabs === keep, '未読み込みの状態で保存して前回のタブを消している（P0-2）')

  // 6) 1枚目は閉じられない
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  await h.addTab('C:\\lane1')
  await h.closeTab(0)
  ok(S(h).tabs.length === 2, '1枚目（ワークスペース）が閉じられてしまう')

  // 7) 同じフォルダは重複追加せず、そのタブへ
  await h.activateTab(0)
  await h.addTab('C:\\lane1')
  ok(S(h).tabs.length === 2 && S(h).activeTab === 1, '同じフォルダのタブが2枚できる／既存タブへ移らない')

  // 8) 隣へ（Ctrl+Tab）。端は回り込む
  h.stepTab(1)
  await new Promise(r => setImmediate(r))
  ok(S(h).activeTab === 0, `stepTab が回り込まない (activeTab=${S(h).activeTab})`)

  // 9) パス欄ナビはアクティブタブを書き換える（タブは増えない）→ ⌂ で必ずワークスペースへ
  await h.activateTab(0, { force: true })
  await h.gotoPath('C:\\ws\\docs')
  ok(S(h).tabs.length === 2 && S(h).tabs[0].path === 'C:\\ws\\docs', 'パス欄ナビがアクティブタブを書き換えていない')
  ok(S(h).browseRoot === 'C:\\ws\\docs', 'パス欄ナビで表示が移っていない')
  await h.goHome()
  ok(S(h).activeTab === 0 && S(h).browseRoot === 'C:\\ws', '⌂ でワークスペースに戻らない')
  ok(S(h).tabs[0].path === 'C:\\ws', '⌂ の後も1枚目のパスがワークスペース外のまま')

  // 10) 未保存のまま パス欄ナビ を取り消したら移動しない（移動すると tb.sel が消え、
  //     ツリーに無いファイルを編集し続ける状態になる）
  h.ctx.allowLeave = false
  await h.gotoPath('C:\\lane2')
  ok(S(h).browseRoot === 'C:\\ws', '破棄確認を取り消したのにパス欄ナビが移動している')
  h.ctx.allowLeave = true

  // 11) 行き先が消えたタブ: ⚠ を付けて残し、アクティブは動かさない
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  await h.addTab('C:\\lane1')
  await h.activateTab(0)
  delete h.ctx.vfs['C:\\lane1']
  await h.activateTab(1)
  ok(S(h).tabs.length === 2, '行き先が消えたタブを勝手に消している')
  ok(S(h).tabs[1].bad === true, '行き先が消えたタブに⚠が付かない')
  ok(S(h).activeTab === 0 && S(h).browseRoot === 'C:\\ws', '行き先が消えているのにアクティブを移している')

  // 12) 切替の走行中に来た指示を捨てない（Ctrl+Tab連打の1回が無反応にならない）
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  await h.addTab('C:\\lane1')
  await h.addTab('C:\\lane2')
  await h.activateTab(0)
  let release
  h.ctx.gate = new Promise(r => { release = r })
  const running = h.activateTab(1)
  await new Promise(r => setImmediate(r))
  h.stepTab(1) // 走行中に「隣へ」
  release()
  h.ctx.gate = null
  await running
  await settle(h)
  ok(S(h).activeTab === 2, `走行中の「隣へ」が捨てられている (activeTab=${S(h).activeTab})`)
  ok(S(h).browseRoot === 'C:\\lane2', '最後に指示したタブの中身が出ていない')

  // 走行中に来た「n枚目へ」（タブのクリック・Ctrl+2）も同じく捨てない。
  // ⚠ stepTab と activateTab で入口が2つある＝両方を踏まないと、片方だけ捨てる実装が素通りする
  h.ctx.gate = new Promise(r => { release = r })
  const running2 = h.activateTab(0)
  await new Promise(r => setImmediate(r))
  h.activateTab(1) // 走行中の指名
  release()
  h.ctx.gate = null
  await running2
  await settle(h)
  ok(S(h).activeTab === 1 && S(h).browseRoot === 'C:\\lane1', `走行中の「n枚目へ」が捨てられている (activeTab=${S(h).activeTab})`)

  // 12.5) ★パス欄の履歴（▾）。タブ＝意図して固定する場所／履歴＝さっき行った場所で別物
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  await h.addTab('C:\\lane1')
  ok(h.pathHistory().length === 0, 'タブを足しただけで履歴に積まれている')
  await h.gotoPath('C:\\ws\\docs')
  await h.gotoPath('C:\\ws\\docs\\deep')
  ok(JSON.stringify(h.pathHistory()) === JSON.stringify(['C:\\ws\\docs\\deep', 'C:\\ws\\docs']),
    `パス欄で行った先が新しい順に積まれない: ${JSON.stringify(h.pathHistory())}`)
  // ★タブの切替では積まない（切り替えるたびに履歴が同じ場所で埋まると履歴の役目が消える）
  const histBefore = JSON.stringify(h.pathHistory())
  await h.activateTab(1)
  await h.activateTab(0)
  await h.goHome()
  await settle(h)
  ok(JSON.stringify(h.pathHistory()) === histBefore, `タブの切替／⌂で履歴が汚れている: ${JSON.stringify(h.pathHistory())}`)
  // 同じ場所は積み直さず先頭へ（同じ行が並ばない）
  await h.gotoPath('C:\\ws\\docs')
  ok(h.pathHistory()[0] === 'C:\\ws\\docs' && h.pathHistory().filter(p => p === 'C:\\ws\\docs').length === 1,
    `同じ場所が履歴に二重に並ぶ: ${JSON.stringify(h.pathHistory())}`)
  // 上限20件（パス欄で動くたびに積むので、外すと localStorage が際限なく太る）
  h.ctx.vfs['C:\\ws\\docs\\deep'] = ['d.md']
  for (let k = 0; k < 30; k++) {
    h.ctx.vfs['C:\\many\\f' + k] = []
    await h.gotoPath('C:\\many\\f' + k)
  }
  ok(h.pathHistory().length === 20, `履歴の上限20件が効いていない (${h.pathHistory().length}件)`)
  ok(h.pathHistory()[0] === 'C:\\many\\f29', '履歴の先頭が最後に行った場所でない')
  // 壊れた保存データで落ちない（旧 pathHistory と同じ作法）
  h.ctx.localStorage.pathHistory = '{壊れ'
  ok(h.pathHistory().length === 0, '壊れた履歴データで空に落ちていない')
  h.ctx.localStorage.pathHistory = JSON.stringify(['C:\\ws', 42, null, 'C:\\lane1'])
  ok(h.pathHistory().length === 2, `履歴に文字列以外が混ざっていても弾けていない: ${JSON.stringify(h.pathHistory())}`)

  // ▾ の中身: 履歴の並び＋末尾に「履歴を消す」。🌿レーンは出さない（＋の右クリックに一本化）
  h.togglePathHist()
  let box = h.ctx.node('#path-hist')
  ok(box.classList.contains('show'), '▾ を押しても履歴が開かない')
  ok(box.children.length === 3, `▾ の項目数が合わない: ${box.children.map(c => c.textContent)}`)
  ok(!box.children.some(c => c.textContent.includes('🌿')), '履歴に🌿レーンが混ざっている（入口が2つになる）')
  ok(box.children[2].className === 'hist-clear' && box.children[2].textContent === 'hist.clear', '末尾に「履歴を消す」が無い')
  // 履歴の行を押すとそこへ飛ぶ
  await box.children[0].handlers.click[0]()
  await settle(h)
  ok(S(h).browseRoot === 'C:\\ws', `履歴の行を押しても移動しない (${S(h).browseRoot})`)
  ok(!box.classList.contains('show'), '履歴を押した後に閉じていない')
  // 「履歴を消す」で空になり、次に開くと「履歴はまだありません」
  h.togglePathHist()
  box = h.ctx.node('#path-hist')
  box.children[box.children.length - 1].handlers.click[0]()
  ok(h.pathHistory().length === 0, '「履歴を消す」で履歴が消えていない')
  h.togglePathHist()
  ok(box.children.length === 1 && box.children[0].className === 'hist-empty', '履歴が空の時の表示が出ていない')

  // 12.7) ★ツリー行のダブルクリック。フォルダ＝タブで開く（右クリックメニューと同じ addTab を通す）／
  //       ファイル＝今までどおり既定のアプリで開く。以前ここでエクスプローラーが開いていたのは不要と明示
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  const dirWrap = h.makeNode({ name: 'docs', isDir: true, path: 'C:\\ws\\docs' }, 0)
  const dirRow = dirWrap.children[0]
  ok((dirRow.handlers.dblclick || []).length === 1, 'フォルダ行にダブルクリックが無い')
  ok((dirRow.handlers.click || []).length === 1, 'フォルダ行のクリック（開閉）が消えている')
  ok((dirRow.handlers.contextmenu || []).length === 1, 'フォルダ行の右クリックが消えている')
  h.ctx.opened = null
  await dirRow.handlers.dblclick[0]()
  await settle(h)
  ok(h.ctx.opened === null, 'フォルダのダブルクリックでエクスプローラー（既定のアプリ）に渡している')
  ok(S(h).tabs.length === 2 && S(h).tabs[1].path === 'C:\\ws\\docs', `フォルダのダブルクリックでタブが増えない: ${JSON.stringify(S(h).tabs.map(x => x.path))}`)
  ok(S(h).activeTab === 1 && S(h).browseRoot === 'C:\\ws\\docs', 'ダブルクリックで足したタブが開いていない')
  // ⚠ 単クリックの開閉は生きたまま。ただしダブルクリックの2発目（detail=2）では動かさない
  //    （「開く→閉じる」が一瞬走ってちらつくため）
  const dirWrap2 = h.makeNode({ name: 'deep', isDir: true, path: 'C:\\ws\\docs\\deep' }, 1)
  const dirRow2 = dirWrap2.children[0]
  await dirRow2.handlers.click[0]({ detail: 1 })
  ok(S(h).openDirs.includes('C:\\ws\\docs\\deep'), '単クリックでフォルダが開かない')
  await dirRow2.handlers.click[0]({ detail: 2 })
  ok(S(h).openDirs.includes('C:\\ws\\docs\\deep'), 'ダブルクリックの2発目で開閉が動いている（ちらつく）')
  // 既に同じパスのタブがある時は増やさず、そのタブへ移って光らせる（＋と同じ）
  await h.activateTab(0)
  h.ctx.flashed = null
  await dirRow.handlers.dblclick[0]()
  await settle(h)
  ok(S(h).tabs.length === 2, '既にタブがあるフォルダをダブルクリックして2枚目ができている')
  ok(S(h).activeTab === 1 && h.ctx.flashed === 1, '既存タブへ移った合図が出ていない')
  // ★編集中のガード: 取り消したらタブも表示も動かない
  h.ctx.allowLeave = false
  await h.activateTab(0)
  const beforeDbl = JSON.stringify(S(h))
  const dirWrap3 = h.makeNode({ name: 'lane1', isDir: true, path: 'C:\\lane1' }, 0)
  await dirWrap3.children[0].handlers.dblclick[0]()
  await settle(h)
  ok(JSON.stringify(S(h)) === beforeDbl, `未保存を取り消したのにダブルクリックでタブ／表示が動いている: ${JSON.stringify(S(h).tabs.map(x => x.path))}`)
  h.ctx.allowLeave = true
  // ファイルは従来どおり既定のアプリへ
  const fileWrap = h.makeNode({ name: 'top.md', isDir: false, path: 'C:\\ws\\top.md' }, 0)
  const fileRow = fileWrap.children[0]
  ok((fileRow.handlers.dblclick || []).length === 1, 'ファイル行のダブルクリックが消えている（既定のアプリで開けない）')
  const tabsBeforeFile = S(h).tabs.length
  h.ctx.opened = null
  await fileRow.handlers.dblclick[0]()
  await settle(h)
  ok(h.ctx.opened === 'C:\\ws\\top.md', 'ファイルのダブルクリックで既定のアプリに渡していない')
  ok(S(h).tabs.length === tabsBeforeFile, 'ファイルのダブルクリックでタブが増えている（フォルダと取り違えている）')

  // 13) ★タブの増やし方（本田さんが実機で見つけられなかった動線）
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  h.setupTabs()
  // 左クリック＝今見ているフォルダが即タブになる（メニューを開かない）
  await h.gotoPath('C:\\ws\\docs')
  await h.ctx.fire('#btn-tab-add', 'click')
  await settle(h)
  ok(h.ctx.menu === undefined, '＋の左クリックでメニューが開いている（即追加になっていない）')
  ok(S(h).tabs.length === 2 && S(h).tabs[1].path === 'C:\\ws\\docs', `＋の左クリックでタブが増えない: ${JSON.stringify(S(h).tabs.map(x => x.path))}`)
  ok(S(h).activeTab === 1, '＋で足したタブがアクティブになっていない')
  // ⚠ browseRoot は常にアクティブタブのパスと一致する（パス欄ナビがアクティブタブを書き換えるため）。
  //    ここで「今のタブ」まで重複判定に入れると、＋は永久に1枚も増やさない無反応ボタンになる
  ok(S(h).tabs[0].path === S(h).tabs[1].path, '前提: ＋を押した時点で今のタブと同じ場所だった')
  // 他所に同じ場所のタブがある時は増やさず、そこへ移って光らせる（何も起きないように見せない）
  h.ctx.flashed = null
  await h.ctx.fire('#btn-tab-add', 'click')
  await settle(h)
  ok(S(h).tabs.length === 2, '同じ場所のタブが他にあるのに3枚目ができている')
  ok(S(h).activeTab === 0, '同じ場所の既存タブへ移っていない')
  ok(h.ctx.flashed === 0, '既存タブへ移った時の合図（ハイライト）が出ていない＝押しても何も起きないように見える')

  // 右クリック＝従来の追加メニュー（レーン一覧／今のフォルダ／フォルダを選ぶ）は残っている
  h.ctx.lanes = [{ name: 'ws-lane1', path: 'C:\\lane1' }]
  await h.ctx.fire('#btn-tab-add', 'contextmenu')
  await settle(h)
  let labels = (h.ctx.menu || []).map(it => it[0])
  ok(labels.includes('tab.lanes') && labels.includes('tab.addCurrent') && labels.includes('tab.addFolder'),
    `＋の右クリックメニューの項目が足りない: ${JSON.stringify(labels)}`)
  const laneItem = h.ctx.menu.find(it => it[0].includes('ws-lane1'))
  ok(!!laneItem, 'レーンがメニューに出ていない')
  await laneItem[1]()
  await settle(h)
  ok(S(h).tabs.length === 3 && S(h).tabs[2].path === 'C:\\lane1', 'メニューのレーンを押してもタブが増えない')
  // レーン検出が転んでも他の項目は出す（レーンはおまけ）
  h.ctx.menu = undefined
  h.ctx.lanesThrow = true
  await h.ctx.fire('#btn-tab-add', 'contextmenu')
  await settle(h)
  labels = (h.ctx.menu || []).map(it => it[0])
  ok(labels.includes('tab.addCurrent') && labels.includes('tab.addFolder'), 'レーン検出が失敗すると他の追加方法まで消える')
  h.ctx.lanesThrow = false

  // 14) ★ツリーのフォルダ右クリック →「タブで開く」（本命の動線）
  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  h.showCtxMenu({ preventDefault() {} }, { path: 'C:\\ws\\docs', name: 'docs', isDir: true })
  ok(h.ctx.menu[0][0] === 'ctx.openInTab', `フォルダの右クリックに「タブで開く」が無い／先頭でない: ${JSON.stringify(h.ctx.menu.map(x => x[0]))}`)
  await h.ctx.menu[0][1]()
  await settle(h)
  ok(S(h).tabs.length === 2 && S(h).tabs[1].path === 'C:\\ws\\docs', 'ツリーの右クリックからタブを足せない')
  ok(S(h).activeTab === 1 && S(h).browseRoot === 'C:\\ws\\docs', 'ツリーから足したタブがアクティブになっていない')
  h.showCtxMenu({ preventDefault() {} }, { path: 'C:\\ws\\top.md', name: 'top.md', isDir: false })
  ok(!h.ctx.menu.some(it => it[0] === 'ctx.openInTab'), 'ファイル行にも「タブで開く」が出ている')
  // 同じフォルダをもう一度「タブで開く」＝増やさずそのタブへ。増えないので合図が要る
  await h.activateTab(0)
  h.ctx.flashed = null
  h.showCtxMenu({ preventDefault() {} }, { path: 'C:\\ws\\docs', name: 'docs', isDir: true })
  await h.ctx.menu[0][1]()
  await settle(h)
  ok(S(h).tabs.length === 2, '既にタブがあるフォルダで2枚目ができている')
  ok(S(h).activeTab === 1, '既存のタブへ移っていない')
  ok(h.ctx.flashed === 1, '既にタブがある時の合図（ハイライト）が出ていない＝押しても何も起きないように見える')

  // 15) 新しい入口からでも編集中のガードは効く（addTab → activateTab → leaveEditMode）
  h.ctx.allowLeave = false
  const beforeGuard = JSON.stringify(S(h))
  h.showCtxMenu({ preventDefault() {} }, { path: 'C:\\lane1', name: 'lane1', isDir: true })
  await h.ctx.menu[0][1]()
  await settle(h)
  ok(S(h).browseRoot === 'C:\\ws\\docs', '未保存を取り消したのにツリーが移動している（新しい入口でガードが抜けている）')
  // ⚠ タブだけ増えて切り替わらない、も不合格。確認はタブを足す前に出す（閉じる時と同じ）
  ok(JSON.stringify(S(h)) === beforeGuard, `未保存を取り消したのにタブの状態が変わっている: ${JSON.stringify(S(h).tabs.map(x => x.path))}`)
  h.ctx.allowLeave = true

  h = makeTabHarness()
  h.loadTabs()
  await h.activateTab(0, { force: true })
  await h.addTab('C:\\lane1')
  await h.addTab('C:\\lane2')
  await h.activateTab(2)
  await settle(h)

  // 切替の走行中は閉じない。走行中に配列をいじると、進行中の切替が別のタブを開き終えた後に
  // 添字だけズレて残る＝タブバーの反転位置とツリーの中身が食い違ったまま保存される
  await h.activateTab(2)
  await settle(h)
  h.ctx.gate = new Promise(r => { release = r })
  const running3 = h.activateTab(0)
  await new Promise(r => setImmediate(r))
  h.closeTab(2) // 走行中に「タブを閉じる」
  release()
  h.ctx.gate = null
  await running3
  await settle(h)
  ok(S(h).tabs.length === 3, `切替の走行中にタブを閉じてしまう (tabs=${S(h).tabs.length})`)
  ok(S(h).activeTab === 0 && S(h).browseRoot === 'C:\\ws', `走行中に閉じた後の表示と反転位置が食い違う (activeTab=${S(h).activeTab}, browseRoot=${S(h).browseRoot})`)
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
  await testTabOps()
  await testPollLoop()
  await testPreviewGuard()

  fs.rmSync(WS, { recursive: true, force: true })
  fs.rmSync(USER, { recursive: true, force: true })
  if (failed) { console.error(`  自動更新／新着ウォッチのテスト: ${failed}件 失敗`); process.exit(1) }
  // 観点数は数えて出す（手で書くと足しても増えない＝数字だけ嘘になる）
  console.log(`  自動更新／新着ウォッチ OK (${checks}観点: main のIPC実叩き／renderer の起動経路・ポーリング層／タブ操作／ツリー差分)`)
  // 未読の遅延書き込みタイマーが残っていると、片付けた後に発火して
  // 「未読の保存に失敗: ENOENT」が毎回出る（テストの合否とは無関係のノイズ）
  process.exit(0)
})()
