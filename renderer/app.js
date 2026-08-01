const $ = (s) => document.querySelector(s)

let CONFIG = null
let selectedRow = null
let currentFile = null
let mdMode = 'rendered' // 'rendered' | 'source'
let internalDragPath = null // ツリーからの持ち出し中は自ウィンドウへのドロップを無視する
let navHistory = [] // wikilink を辿った履歴（戻る用）
const openDirs = new Set() // F5リロード後に展開状態を復元する

// ツリーが今表示しているフォルダ。CONFIG.root（ワークスペース＝_inboxの置き場）とは別物で、
// パス欄で worktree レーンなど外のフォルダに移っても _inbox の投入先は動かさない。
let browseRoot = ''

// 入力モード（書き込み）の状態。既定はプレビュー＝読むだけ。
let editMode = false
let editDirty = false
let editorEl = null
// 入力モード中に外部（レナード）がファイルを書き換えた印。上書きせず知らせるだけに使う。
let externalChange = false

// ---------- 自動更新の状態 ----------
// ツリーの中身を差分で貼り替えるので、行の実体を path から引けるようにしておく。
// 全消し再描画を撃たない＝スクロール位置・選択行・展開状態がそのまま残る（本田さん明示）。
const nodeByPath = new Map() // pathKey → ノードの wrap 要素
let rootBox = null           // ツリー最上段のコンテナ（差分適用の起点）
let treeEpoch = 0            // ツリーを作り直したら +1。走行中のポーリング結果を捨てる目印
let watchKeys = new Set()    // 新着ウォッチ中のフォルダ（pathKey）
let unreadKeys = new Set()   // 未読ファイル（pathKey）
let unreadCounts = new Map()  // ウォッチフォルダ（pathKey）→ 直下の未読数
let previewMtime = null      // 今プレビューに出している版の mtime

init()

// ---------- 多言語（i18n.js の辞書を画面に流し込む） ----------

const t = (key, vars) => I18N.t(key, vars)

// 画面の文言に共通で差し込む値。ドロップ先フォルダ名は設定で変えられるので、
// 「_inbox」を文言側にベタ書きしない（変えた瞬間に全部の案内が嘘になるため）。
const uiVars = () => ({ inbox: (CONFIG && CONFIG.inboxName) || '_inbox' })

// data-i18n=本文 / data-i18n-html=HTMLを含む本文 / data-i18n-title=ツールチップ / data-i18n-ph=プレースホルダ
function applyI18n(scope = document) {
  const v = uiVars()
  for (const el of scope.querySelectorAll('[data-i18n]')) {
    if (el.dataset.i18nHtml !== undefined) el.innerHTML = t(el.dataset.i18n, v)
    else el.textContent = t(el.dataset.i18n, v)
  }
  for (const el of scope.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle, v)
  for (const el of scope.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh, v)
  document.documentElement.lang = I18N.getLang()
}

// 投入先の名前が出ている箇所をまとめて貼り直す。設定変更のたびに呼ぶ。
// ⚠ サイドバー見出しだけ直して「ワークスペース外にいます」の注記を忘れると、
//    そこだけ古いフォルダ名が残る（QA指摘）ので同じ関数の中で面倒を見る。
function refreshInboxLabel() {
  if (!CONFIG) return
  $('#inbox-name').textContent = CONFIG.inboxName || '_inbox'
  $('#inbox-header').title = CONFIG.inbox ? t('tip.inboxTarget', { inbox: CONFIG.inbox }) : ''
  if (browseRoot) {
    const away = !samePath(browseRoot, CONFIG.root)
    $('#root-name').title = away
      ? t('tip.awayRoot', { path: browseRoot, inbox: CONFIG.inbox })
      : browseRoot
  }
}

async function init() {
  CONFIG = await api.getConfig()
  I18N.setLang(CONFIG.lang)
  I18N.checkMissing((m) => console.warn(m)) // 腐り検知: 翻訳漏れは起動ログに出す
  applyI18n()
  refreshInboxLabel()
  applyFonts()
  setupDrop()
  setupGlobal()
  setupPathBar()
  // ⚠ ルートピッカーで止まる経路でも腐り検知の窓口を空にしない。空文字だと幅が0になり、
  //    「止まっている」ことが画面に出ないうえクリックでの再開すら押せない（QA致命1）
  setSyncStatus()
  if (!CONFIG.rootOk) { showRootPicker(); return }
  await openWorkspace(await startingRoot())
}

// ワークスペースを開く＝ツリーを出して自動更新を動かすところまで。
// ⚠ init と reloadRoot で手順を書き分けない。片方に startPolling を書き忘れるだけで、
//    その経路で起動したセッションは自動更新も未読の印も丸ごと死に、v0.4.3 の
//    「手動F5でしか更新されない Desk」に黙って戻る（QA致命1）。ルートピッカー経由＝
//    初回起動と、WSLが上がる前にDeskを開いた朝の「選び直し」で実際に踏む動線。
// ⚠ ツリー構築が転んでもポーリングだけは必ず始める（finally）。途中の例外ひとつで
//    そのセッションが二度と自動更新しなくなる、という同じ壊れ方をここで閉じておく。
async function openWorkspace(dir) {
  try {
    await setBrowseRoot(dir)
  } catch (err) {
    console.error('[init] ツリーの初期表示に失敗:', err)
  } finally {
    await startAutoRefresh()
  }
}

// 未読の取り込み → 印 → ポーリング開始。
async function startAutoRefresh() {
  try {
    setWatchState(await api.getWatch())
    applyMarks()
  } catch (err) {
    console.warn('[watch]', err)
  } finally {
    // 何が落ちてもポーリングは始める。何度呼んでも安全＝schedulePoll が毎回 clearTimeout して
    // から張り直すのでタイマーは常に1本、失敗で止まっていた場合はここで復帰する
    // （ルートを選び直した＝再開したい、と読む）
    startPolling()
  }
}

// 前回見ていたフォルダを復元。撤収済みレーン等で消えていたら黙ってワークスペースへ戻る
async function startingRoot() {
  const saved = localStorage.browseRoot
  if (saved && saved !== CONFIG.root) {
    const r = await api.resolveTarget(saved)
    if (r.ok && r.isDir) return r.path
    localStorage.removeItem('browseRoot')
  }
  return CONFIG.root
}

// ルート変更（初回設定・設定パネルからの変更 共通）
async function reloadRoot() {
  CONFIG = await api.getConfig()
  if (!CONFIG.rootOk) { showRootPicker(); setSyncStatus(); return }
  localStorage.removeItem('browseRoot')
  await openWorkspace(CONFIG.root)
}

// ---------- パス欄（アドレスバー） ----------

function baseName(p) {
  const s = String(p).replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || s
}

// パスの比較・Mapのキーはこれ1本に統一する。main 側と renderer 側で正規化がズレると
// 未読の印だけ当たらない（クリックしても消えない）という気づきにくい壊れ方をする。
function pathKey(p) {
  return String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

function samePath(a, b) {
  return pathKey(a) === pathKey(b)
}

function parentOf(p) {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  if (i <= 0) return null
  const up = s.slice(0, i)
  return up.replace(/[\\/]+$/, '').length >= 2 ? up : null
}

async function setBrowseRoot(dir, { record = false } = {}) {
  browseRoot = dir
  if (samePath(dir, CONFIG.root)) localStorage.removeItem('browseRoot')
  else localStorage.browseRoot = dir
  if (record) pushPathHistory(dir)

  const away = !samePath(dir, CONFIG.root)
  $('#path-input').value = dir
  $('#path-input').title = dir
  $('#root-name').textContent = baseName(dir)
  $('#root-name').classList.toggle('away', away)
  refreshInboxLabel() // #root-name の title もここで貼る
  openDirs.clear()
  await loadTreeRoot()
}

async function gotoPath(input) {
  const r = await api.resolveTarget(input)
  if (!r.ok) { pathBarError(r.error); return }
  await setBrowseRoot(r.path, { record: true })
  if (r.filePath) openPreview(r.filePath) // ファイルを貼られたら親を開いてその1枚を出す
}

function pathBarError(msg) {
  const el = $('#path-input')
  el.classList.add('bad')
  el.title = msg
  setTimeout(() => el.classList.remove('bad'), 1400)
}

function pathHistory() {
  try { return JSON.parse(localStorage.pathHistory || '[]') } catch (e) { return [] }
}

function pushPathHistory(p) {
  const list = pathHistory().filter(x => !samePath(x, p))
  list.unshift(p)
  localStorage.pathHistory = JSON.stringify(list.slice(0, 20))
}

function hidePathHist() { $('#path-hist').classList.remove('show') }

let pathHistBusy = false // レーン実測（await）中の二度押しで二重描画しないための鍵

async function togglePathHist() {
  const box = $('#path-hist')
  if (box.classList.contains('show')) { hidePathHist(); return }
  if (pathHistBusy) return
  pathHistBusy = true
  // worktree レーンは開くたびに実測する＝撤収済みレーンが残らない・新レーンは次に開けば出る。
  // 検出に失敗しても履歴だけは必ず出す（レーンはおまけ、履歴が本体）。
  let lanes = []
  try { lanes = await api.listWorktrees() } catch (e) { /* 履歴だけ出す */ }
  pathHistBusy = false
  const list = pathHistory()
  box.innerHTML = ''
  if (lanes.length) {
    const head = document.createElement('div')
    head.className = 'hist-head'
    head.textContent = t('hist.lanes')
    box.appendChild(head)
    for (const ln of lanes) {
      const it = document.createElement('div')
      it.className = 'hist-item' + (samePath(ln.path, browseRoot) ? ' current' : '')
      it.textContent = `🌿 ${ln.name}`
      it.title = ln.path
      it.addEventListener('click', () => { hidePathHist(); gotoPath(ln.path) })
      box.appendChild(it)
    }
    if (list.length) {
      const head2 = document.createElement('div')
      head2.className = 'hist-head'
      head2.textContent = t('hist.recent')
      box.appendChild(head2)
    }
  }
  if (!list.length && !lanes.length) {
    box.innerHTML = `<div class="hist-empty">${escapeHtml(t('hist.empty'))}</div>`
  } else if (list.length) {
    for (const p of list) {
      const it = document.createElement('div')
      it.className = 'hist-item' + (samePath(p, browseRoot) ? ' current' : '')
      it.textContent = p
      it.title = p
      it.addEventListener('click', () => { hidePathHist(); gotoPath(p) })
      box.appendChild(it)
    }
    const clear = document.createElement('div')
    clear.className = 'hist-clear'
    clear.textContent = t('hist.clear')
    clear.addEventListener('click', () => { localStorage.removeItem('pathHistory'); hidePathHist() })
    box.appendChild(clear)
  }
  box.classList.add('show')
}

function setupPathBar() {
  const input = $('#path-input')
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { hidePathHist(); gotoPath(input.value) }
    if (e.key === 'Escape') { input.value = browseRoot; input.blur(); hidePathHist() }
    if (e.key === 'ArrowDown') { e.preventDefault(); togglePathHist() }
  })
  input.addEventListener('focus', () => input.select())
  $('#btn-path-go').addEventListener('click', () => gotoPath(input.value))
  $('#btn-path-hist').addEventListener('click', (e) => { e.stopPropagation(); togglePathHist() })
  $('#btn-home').addEventListener('click', () => { if (CONFIG.rootOk) setBrowseRoot(CONFIG.root) })
  $('#btn-up').addEventListener('click', () => {
    const up = parentOf(browseRoot)
    if (up) gotoPath(up)
  })
}

function showRootPicker() {
  const isUnset = !CONFIG.root
  $('#preview-body').innerHTML = `
    <div class="welcome ${isUnset ? '' : 'error'}">
      <h2>${escapeHtml(isUnset ? t('root.welcome') : t('root.unreachable'))}</h2>
      ${isUnset ? '' : `<p>${t('root.pathNote', { path: escapeHtml(CONFIG.root) })}</p>`}
      <p>${t('root.hint')}</p>
      <p><button id="btn-choose-root" class="big-btn">${escapeHtml(t('root.choose'))}</button></p>
    </div>`
  $('#tree').innerHTML = ''
  $('#btn-choose-root').addEventListener('click', async () => {
    if (await api.chooseRoot()) reloadRoot()
  })
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------- ツリー ----------

async function loadTreeRoot() {
  // ワークスペース未設定のまま F5 や ⟳ を押すと readDir('') に落ちてエラー表示が出る。
  // 呼び出し側ごとに guard を書くと必ず漏れるので、入口で止める（QA指摘）
  if (!CONFIG || !CONFIG.rootOk) return
  const tree = $('#tree')
  treeEpoch++ // 走っている途中のポーリング結果を捨てる（作り直した後のツリーに古い差分を当てない）
  nodeByPath.clear()
  selectedRow = null
  rootBox = null
  tree.innerHTML = `<div class="loading">${escapeHtml(t('loading'))}</div>`
  const box = document.createElement('div')
  await loadChildren(browseRoot || CONFIG.root, box, 0)
  tree.innerHTML = ''
  tree.appendChild(box)
  rootBox = box
  applyMarks()
}

async function loadChildren(dirPath, container, depth) {
  let entries
  try { entries = await api.readDir(dirPath) } catch (e) {
    container.innerHTML = `<div class="loading">${escapeHtml(t('err.read', { msg: e.message }))}</div>`
    return
  }
  container.innerHTML = ''
  for (const en of entries) {
    if (CONFIG.hidden.includes(en.name)) continue
    container.appendChild(makeNode(en, depth))
  }
}

function makeNode(en, depth) {
  const wrap = document.createElement('div')
  wrap.className = 'node'
  const row = document.createElement('div')
  row.className = 'row ' + (en.isDir ? 'dir' : 'file')
  row.style.paddingLeft = (8 + depth * 14) + 'px'
  row.draggable = true

  const arrow = document.createElement('span')
  arrow.className = 'arrow'
  arrow.textContent = en.isDir ? '▸' : ''
  const icon = document.createElement('span')
  icon.className = 'ficon'
  icon.textContent = en.isDir ? '📁' : fileIcon(en.name)
  const label = document.createElement('span')
  label.className = 'fname'
  label.textContent = en.name
  // 新着ウォッチ（👁）と未読（●）の印。中身が空でも先に置いておく＝
  // 印が付いた時に行の構造を組み替えずテキストの差し替えだけで済む。
  const badge = document.createElement('span')
  badge.className = 'badge'

  row.append(arrow, icon, label, badge)
  wrap.appendChild(row)

  // ⚠ 開閉状態を closure に隠すと2秒ごとの差分適用から読めない（どこが開いているか分からず
  //    再帰できない）。状態は要素側に持たせる。
  const st = { path: en.path, name: en.name, isDir: en.isDir, depth, row, arrow, icon, badge, childBox: null, loaded: false, open: false, mark: '' }
  wrap._node = st
  nodeByPath.set(pathKey(en.path), wrap)

  async function toggleDir(forceOpen) {
    if (!st.childBox) { st.childBox = document.createElement('div'); wrap.appendChild(st.childBox) }
    st.open = forceOpen === undefined ? !st.open : forceOpen
    arrow.textContent = st.open ? '▾' : '▸'
    icon.textContent = st.open ? '📂' : '📁'
    st.childBox.style.display = st.open ? '' : 'none'
    if (st.open) openDirs.add(en.path); else openDirs.delete(en.path)
    if (st.open && !st.loaded) {
      st.childBox.innerHTML = '<div class="loading">…</div>'
      await loadChildren(en.path, st.childBox, depth + 1)
      // ⚠ loaded を立てるのは読み終えた後。先に立てると読み込み中のコンテナに
      //    ポーリングの差分が割り込み、二重に行が並ぶ。
      st.loaded = true
      applyMarks()
    }
  }

  row.addEventListener('click', async () => {
    // 入力モードの確認で開くのを取り消した時は選択も動かさない（表示中のファイルと選択をずらさない）
    if (en.isDir) { toggleDir() } else if (await openPreview(en.path)) selectRow(row)
  })
  row.addEventListener('dblclick', () => api.openPath(en.path))
  row.addEventListener('dragstart', (e) => {
    e.preventDefault()
    internalDragPath = en.path
    api.dragStart(en.path)
    setTimeout(() => { if (internalDragPath === en.path) internalDragPath = null }, 5000)
  })
  row.addEventListener('contextmenu', (e) => showCtxMenu(e, en))

  if (en.isDir && openDirs.has(en.path)) toggleDir(true)
  return wrap
}

function selectRow(row) {
  if (selectedRow) selectedRow.classList.remove('selected')
  selectedRow = row
  row.classList.add('selected')
}

function fileIcon(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (['.md', '.markdown'].includes(ext)) return '📝'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return '🖼️'
  if (ext === '.pdf') return '📕'
  if (['.docx', '.doc'].includes(ext)) return '📘'
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return '📊'
  if (['.py', '.js', '.ts', '.sh', '.gs', '.bat', '.ps1', '.html', '.css', '.json', '.yaml', '.yml'].includes(ext)) return '⚙️'
  return '📄'
}

// ---------- ツリーの差分適用（自動更新の本体） ----------
// 増えた行を挿す・消えた行を抜く・変わらない行のDOMには触らない。
// ⚠ 2秒ごとに loadTreeRoot()（全消し再描画）を撃つのは禁止。本田さんは左ペインを
//    出しっぱなしで描き変わる瞬間を常に見ているので、スクロール位置と選択行が飛ぶ。

// ノード（とその配下）を捨てる。参照を残すと選択行が幽霊になり、
// openDirs に消えたフォルダが溜まってポーリングが毎回そこを読みに行く。
function dropNode(el) {
  const list = [el, ...el.querySelectorAll('.node')]
  for (const sub of list) {
    const st = sub._node
    if (!st) continue
    nodeByPath.delete(pathKey(st.path))
    openDirs.delete(st.path)
    if (selectedRow === st.row) selectedRow = null
  }
  el.remove()
}

function applyDirDiff(container, depth, entries) {
  const want = entries.filter(en => !CONFIG.hidden.includes(en.name))
  // ⚠ 「読み込み中…」やエラー行が混ざっていると位置合わせが1つずつずれる。
  //    差分を当てる前に、ノード以外の子は落としておく。
  for (const el of [...container.children]) if (!el._node) el.remove()

  const have = new Map()
  for (const el of container.children) have.set(pathKey(el._node.path), el)
  const wanted = new Set(want.map(en => pathKey(en.path)))
  for (const [key, el] of have) {
    if (!wanted.has(key)) { dropNode(el); have.delete(key) }
  }

  let i = 0
  for (const en of want) {
    const key = pathKey(en.path)
    let el = have.get(key)
    // 同じ名前でファイル↔フォルダが入れ替わった時だけ作り直す（行の性格ごと変わるため）
    if (el && el._node.isDir !== en.isDir) { dropNode(el); el = undefined }
    if (!el) el = makeNode(en, depth)
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null)
    i++
  }
}

// 展開しているフォルダだけを辿って差分を当てる（畳んである配下は見ない＝そのぶん軽い）
function refreshTree(container, dirPath, depth, res) {
  const r = res.dirs[dirPath]
  if (!r) return
  // ⚠ 読めなかったフォルダは今の表示をそのまま残す。消すとWSLが一瞬途切れただけで
  //    ツリーが真っ白になり、戻ってくるまで何も見えなくなる。
  if (r.error || !r.entries) return
  applyDirDiff(container, depth, r.entries)
  for (const el of [...container.children]) {
    const st = el._node
    if (st && st.isDir && st.open && st.loaded && st.childBox) refreshTree(st.childBox, st.path, depth + 1, res)
  }
}

// ポーリングで見るフォルダ = ツリーのルート＋今ひらいて見えているフォルダ（浅く）。
// ⚠ openDirs をそのまま使わない。親を畳んでも子は openDirs に残る＝畳んだ先の
//    見えないフォルダを2秒ごとに読み続けることになる。実際に見えている連なりだけ辿る。
function pollDirs() {
  const dirs = []
  if (!rootBox || !rootBox.isConnected || !browseRoot) return dirs
  dirs.push(browseRoot)
  const walk = (container) => {
    for (const el of container.children) {
      const st = el._node
      if (st && st.isDir && st.open && st.loaded && st.childBox) { dirs.push(st.path); walk(st.childBox) }
    }
  }
  walk(rootBox)
  return dirs
}

// ---------- 新着（未読）の印 ----------

function setWatchState(payload) {
  watchKeys = new Set((payload.watchDirs || []).map(pathKey))
  unreadKeys = new Set((payload.unread || []).map(pathKey))
  unreadCounts = new Map(Object.entries(payload.counts || {}).map(([k, v]) => [pathKey(k), v]))
}

// 未読の印は数秒で消さない＝クリックするまでずっと残す（本田さん明示）。
// 描き替えは変化した行だけに絞る（毎tick全行を触るとツリー全体が再計算される）。
function applyMarks() {
  for (const [key, el] of [...nodeByPath]) {
    if (!el.isConnected) { nodeByPath.delete(key); continue } // 作り直し前の取り残しを掃除
    const st = el._node
    const watched = st.isDir && watchKeys.has(key)
    const count = watched ? (unreadCounts.get(key) || 0) : 0
    const isUnread = !st.isDir && unreadKeys.has(key)
    // 畳んでいても気づけるよう、ウォッチフォルダの行自体にも配下の未読を出す
    const mark = isUnread || count ? '●' : (watched ? '👁' : '')
    if (st.row.classList.contains('unread') !== isUnread) st.row.classList.toggle('unread', isUnread)
    if (st.row.classList.contains('watched') !== watched) st.row.classList.toggle('watched', watched)
    // ⚠ 件数まで含めて比べる。印の文字だけで比べると 1件→2件 で吹き出しが古いまま残る
    const sig = mark + '/' + count
    if (st.mark !== sig) {
      st.mark = sig
      st.badge.textContent = mark
      st.badge.classList.toggle('new', mark === '●')
      st.badge.title = count ? t('tip.unread', { n: count }) : (isUnread ? t('tip.unread', { n: 1 }) : (watched ? t('tip.watched') : ''))
    }
  }
}

async function toggleWatch(dir, on) {
  if (on) {
    // 名前でなく実測で弾く（ワークスペース全体・巨大フォルダを指定させない）
    const probe = await api.probeWatch(dir, browseRoot)
    if (!probe.ok) {
      // 断る理由はそのまま見せる。定型文だけ出すと「なぜ弾かれたか分からない」になる（既存のQA指摘と同じ轍）
      if (probe.reason === 'big') alert(t('watch.refusedBig', { files: probe.files }))
      else if (probe.reason === 'root') alert(t('watch.refusedRoot'))
      else alert(t('err.read', { msg: probe.error || '' }))
      return
    }
  }
  setWatchState(await api.setWatch(dir, on))
  applyMarks()
}

// ---------- プレビュー ----------

async function openPreview(p) {
  if (!await leaveEditMode()) return false
  const body = $('#preview-body')
  body.innerHTML = `<div class="loading">${escapeHtml(t('loading'))}</div>`
  let res
  try { res = await api.readFile(p) } catch (e) {
    body.innerHTML = `<div class="welcome error"><p>${escapeHtml(t('err.read', { msg: e.message }))}</p></div>`
    return false
  }
  currentFile = res
  previewMtime = res.mtimeMs
  externalChange = false
  renderPreview(res)
  // 開いた＝読んだ、とみなして未読を落とす。印が消えるのを待たずに先に描き替える
  // （IPCの往復ぶん色が残ると「クリックしたのに消えない」と見える）
  if (unreadKeys.has(pathKey(p))) {
    unreadKeys.delete(pathKey(p))
    applyMarks()
    api.markRead(p).then(payload => { setWatchState(payload); applyMarks() }).catch(err => console.warn('[watch]', err))
  }
  return true
}

function goBack() {
  const prev = navHistory.pop()
  if (prev) openPreview(prev)
}

function renderPreview(res) {
  updatePreviewTitle(res)
  const actions = $('#preview-actions')
  actions.innerHTML = ''
  if (navHistory.length && !editMode) {
    const btnBack = document.createElement('button')
    btnBack.textContent = '←'
    btnBack.title = t('tip.back')
    btnBack.onclick = goBack
    actions.appendChild(btnBack)
  }
  if (res.kind === 'markdown' && !editMode) {
    const btn = document.createElement('button')
    btn.textContent = mdMode === 'rendered' ? t('btn.source') : t('btn.rendered')
    btn.onclick = () => { mdMode = mdMode === 'rendered' ? 'source' : 'rendered'; renderPreview(res) }
    actions.appendChild(btn)
  }
  if (isEditable(res)) {
    if (editMode) {
      // Undo/Redo は入力モードの時だけ出す（読むだけの時は不要なので置かない）
      const btnUndo = editToolButton('↶', t('tip.undo'), () => runEditCmd('undo'))
      const btnRedo = editToolButton('↷', t('tip.redo'), () => runEditCmd('redo'))
      btnUndo.classList.add('icon-btn')
      btnRedo.classList.add('icon-btn')
      actions.append(btnUndo, btnRedo)
      const btnSave = editToolButton(t('btn.save'), t('tip.save'), saveEdit)
      btnSave.id = 'btn-save'
      actions.appendChild(btnSave)
    }
    const btnEdit = document.createElement('button')
    btnEdit.textContent = t('btn.edit')
    if (editMode) btnEdit.classList.add('toggled')
    btnEdit.title = editMode ? t('tip.editOff') : t('tip.editOn')
    btnEdit.onclick = toggleEdit
    actions.appendChild(btnEdit)
  }
  const btnExp = document.createElement('button')
  btnExp.textContent = 'Explorer'
  btnExp.title = t('tip.explorer')
  btnExp.onclick = () => api.showInFolder(res.path)
  const btnOpen = document.createElement('button')
  btnOpen.textContent = t('btn.open')
  btnOpen.title = t('tip.open')
  btnOpen.onclick = () => api.openPath(res.path)
  actions.append(btnExp, btnOpen)

  const body = $('#preview-body')
  if (editMode && isEditable(res)) { renderEditor(res); return }
  switch (res.kind) {
    case 'markdown':
      if (mdMode === 'rendered') { body.innerHTML = `<div class="md-body">${res.html}</div>`; addCopyButtons(body); enhanceTables(body) }
      else body.innerHTML = codeView(res.sourceHtml, res.lineCount)
      break
    case 'code':
      body.innerHTML = codeView(res.html, res.lineCount)
      break
    case 'docx':
      body.innerHTML = `<div class="md-body docx">${res.html}</div>`
      addCopyButtons(body)
      enhanceTables(body)
      break
    case 'image':
      body.innerHTML = `<div class="media"><img src="${res.url}"></div>`
      break
    case 'pdf':
      body.innerHTML = `<iframe class="pdfframe" src="${res.url}"></iframe>`
      break
    case 'toolarge':
      body.innerHTML = `<div class="welcome"><p>${escapeHtml(t('preview.toolarge'))}</p></div>`
      break
    case 'binary':
      body.innerHTML = `<div class="welcome"><p>${escapeHtml(t('preview.unsupported'))}</p></div>`
      break
    default:
      body.innerHTML = `<div class="welcome error"><p>${escapeHtml(res.message || t('preview.cannotShow'))}</p></div>`
  }
}

// ---------- 入力モード（書き込み） ----------
// 既定はあくまでプレビュー（読むだけ）。「入力」を押した時だけ textarea に切り替わる。

function isEditable(res) {
  return !!res && typeof res.source === 'string' && (res.kind === 'markdown' || res.kind === 'code')
}

// 入力モードのツールバー用ボタン。mousedown を止めて textarea からフォーカスを奪わない
// ＝押した瞬間もカーソルは編集中の位置に残り、Undo/Redo が編集欄に当たる。
function editToolButton(label, title, fn) {
  const b = document.createElement('button')
  b.textContent = label
  b.title = title
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.onclick = fn
  return b
}

function runEditCmd(cmd) {
  if (!editMode || !editorEl) return
  editorEl.focus() // パス欄などに移っていた場合の保険
  if (cmd === 'undo') api.editorUndo(); else api.editorRedo()
}

// 保存済みの内容と一致していれば「未保存」印を消す（Undoで元に戻した時も消える）
function refreshDirty() {
  const dirty = !!editorEl && !!currentFile && editorEl.value !== currentFile.source
  if (dirty !== editDirty) { editDirty = dirty; updatePreviewTitle() }
}

function updatePreviewTitle(res) {
  const f = res || currentFile
  if (!f) return
  const mark = editMode ? (editDirty ? t('title.editingDirty') : t('title.editing')) : ''
  // 入力モード中に外部で書き換わった時の告知。上書きはせず、保存/破棄の判断は本田さんに委ねる
  const ext = externalChange ? t('title.external') : ''
  const el = $('#preview-title')
  el.textContent = `${mark}${ext}${f.name}  (${fmtSize(f.size)})`
  el.title = externalChange ? t('tip.external') : ''
  el.classList.toggle('editing', editMode)
  el.classList.toggle('external', externalChange)
}

function renderEditor(res) {
  const body = $('#preview-body')
  body.innerHTML = '<div class="editwrap"><textarea class="editor" spellcheck="false"></textarea></div>'
  editorEl = body.querySelector('.editor')
  editorEl.value = res.source
  editorEl.addEventListener('input', refreshDirty)
  editorEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveEdit() }
    if (e.key === 'Tab') {
      e.preventDefault()
      // insertText は Chromium の編集履歴に乗る＝Tabで入れた分も Ctrl+Z で戻せる
      // （setRangeText は履歴に乗らないので、使えない時だけの保険）
      let ok = false
      try { ok = document.execCommand('insertText', false, '  ') } catch (err) { ok = false }
      if (!ok) {
        const s = editorEl.selectionStart
        editorEl.setRangeText('  ', s, editorEl.selectionEnd, 'end')
        refreshDirty()
      }
    }
  })
  editorEl.focus()
}

function toggleEdit() {
  if (editMode) { leaveEditMode().then(ok => { if (ok) renderPreview(currentFile) }); return }
  editMode = true
  editDirty = false
  renderPreview(currentFile)
}

// 入力モードを抜ける（他ファイルへ移る時も通す）。未保存があれば必ず訊く。
// 破棄した時はディスクの内容を読み直す＝画面に編集途中の文字が残らない。
async function leaveEditMode() {
  if (!editMode) return true
  if (editDirty && !confirm(t('confirm.discard'))) return false
  const stale = editDirty || externalChange // 外部で書き換わっていた場合もディスクの内容に戻す
  editMode = false
  editDirty = false
  editorEl = null
  externalChange = false
  if (stale && currentFile) {
    try {
      currentFile = await api.readFile(currentFile.path)
      previewMtime = currentFile.mtimeMs
    } catch (e) { /* 消えていたら現状のまま */ }
  }
  return true
}

async function saveEdit() {
  if (!editMode || !editorEl || !currentFile) return
  const content = editorEl.value
  const r = await api.writeFile(currentFile.path, content)
  if (!r.ok) { alert(t('err.save', { msg: r.error })); return }
  // 保存後に読み直す＝プレビューへ戻した時に古い内容が出ない（html/行数も更新される）。
  // ただし textarea は作り直さない＝保存を挟んでも Undo 履歴とカーソル位置が切れない。
  // 読み直せなかった時も source は書いた内容に更新する（でないと ● が消えず未保存に見える）
  try { currentFile = await api.readFile(currentFile.path) }
  catch (e) { currentFile.size = r.size; currentFile.source = content }
  // ⚠ 自分の保存で mtime が動く。ここで持ち直さないと次のポーリングが
  //    「外部で書き換わった」と誤検知して ⚠ を出す（自分の書き込みなのに）
  previewMtime = currentFile.mtimeMs != null ? currentFile.mtimeMs : previewMtime
  externalChange = false
  refreshDirty() // 保存中に打ち続けていた場合は ● が残る
  updatePreviewTitle()
  const btn = $('#btn-save')
  if (btn) {
    btn.textContent = t('btn.saved')
    btn.classList.add('saved')
    setTimeout(() => { if ($('#btn-save') === btn) { btn.textContent = t('btn.save'); btn.classList.remove('saved') } }, 1600)
  }
}

// レンダリング表示のコードブロックにホバーで出る「コピー」ボタンを付ける
function addCopyButtons(scope) {
  for (const pre of scope.querySelectorAll('.md-body pre')) {
    const text = pre.textContent
    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.textContent = t('btn.copy')
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await navigator.clipboard.writeText(text)
      btn.textContent = t('btn.copied')
      setTimeout(() => { btn.textContent = t('btn.copy') }, 1500)
    })
    pre.appendChild(btn)
  }
}

// 表: 横スクロール用ラッパー ＋ ヘッダー境界ドラッグで列幅調整
function enhanceTables(scope) {
  for (const table of scope.querySelectorAll('.md-body table')) {
    const wrap = document.createElement('div')
    wrap.className = 'table-wrap'
    table.parentNode.insertBefore(wrap, table)
    wrap.appendChild(table)

    const firstRow = table.querySelector('tr')
    if (!firstRow) continue
    const headCells = [...firstRow.children]
    const colgroup = document.createElement('colgroup')
    for (let i = 0; i < headCells.length; i++) colgroup.appendChild(document.createElement('col'))
    table.insertBefore(colgroup, table.firstChild)

    headCells.forEach((th, i) => {
      const grip = document.createElement('div')
      grip.className = 'col-grip'
      grip.title = t('tip.colGrip')
      th.style.position = 'relative'
      th.appendChild(grip)
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        // いったん現在の実幅で全列を固定してから、対象列だけ動かす
        const cols = colgroup.children
        const widths = headCells.map(c => c.offsetWidth)
        for (let j = 0; j < cols.length; j++) cols[j].style.width = widths[j] + 'px'
        table.style.tableLayout = 'fixed'
        const startX = e.clientX
        const startW = widths[i]
        document.body.classList.add('resizing')
        const onMove = (ev) => { cols[i].style.width = Math.max(48, startW + ev.clientX - startX) + 'px' }
        const onUp = () => {
          document.body.classList.remove('resizing')
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      })
    })
  }
}

function codeView(html, lineCount) {
  let nums = ''
  for (let i = 1; i <= lineCount; i++) nums += i + '\n'
  return `<div class="codewrap"><pre class="gutter">${nums}</pre><pre class="code"><code class="hljs">${html}</code></pre></div>`
}

function fmtSize(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

// ---------- ドロップ受領（→ _inbox） ----------

function setupDrop() {
  const overlay = $('#drop-overlay')
  let depth = 0
  window.addEventListener('dragenter', (e) => {
    if (internalDragPath) return
    if (![...e.dataTransfer.types].includes('Files')) return
    depth++
    overlay.classList.add('show')
  })
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1)
    if (depth === 0) overlay.classList.remove('show')
  })
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    depth = 0
    overlay.classList.remove('show')
    if (internalDragPath) { internalDragPath = null; return }
    const paths = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    // 投入先が壊れている等で main 側が失敗すると invoke ごと reject する。
    // 拾わないとドロップが完全に無反応になる（何も起きない＝一番分かりにくい壊れ方・QA指摘）
    let results
    try {
      results = await api.dropFiles(paths)
    } catch (err) {
      addFeedEntry({ ok: false, name: baseName(paths[0]), error: String(err.message || err), ts: new Date().toISOString() })
      return
    }
    for (const r of results) addFeedEntry(r)
  })
}

// 受領確認灯: 1分表示して自動で消える（記録は userData/drop-log.json に残る）
const FEED_TTL_MS = 60 * 1000

function addFeedEntry(r) {
  const feed = $('#inbox-feed')
  const el = document.createElement('div')
  el.className = 'feed-entry fresh' + (r.ok ? '' : ' failed')
  // 変数名を t にしない: i18n の t() を関数スコープで隠してしまう（2026-07-28 実際に事故った）
  const at = new Date(r.ts)
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')
  const dateStr = `${at.getMonth() + 1}/${at.getDate()} ${hh}:${mm}`
  el.innerHTML = `<span class="feed-time">${dateStr}</span><span class="feed-status">${r.ok ? '✓' : '✗'}</span><span class="feed-name">${escapeHtml(r.name)}</span>${r.ok ? '' : `<span class="feed-err">${escapeHtml(r.error || '')}</span>`}`
  if (r.ok && r.path) {
    el.title = t('tip.feedClick')
    el.addEventListener('click', () => openPreview(r.path))
  }
  feed.prepend(el)
  setTimeout(() => {
    el.classList.add('expiring')
    setTimeout(() => el.remove(), 700)
  }, FEED_TTL_MS)
}

// ---------- 右クリックメニュー ----------

// 新着ウォッチに指定できないフォルダ（main の isTooBroad と同じ線を引く）。
// ⚠ 「一致」だけを見ると、ワークスペースの親フォルダを表示している時に root の祖先の行が
//    有効に見え、押した瞬間に main が root を理由に断って alert が出る＝「出すなら無効表示に」
//    という約束が半端になる（QA指摘）。main が正なので判定をこちらに揃える。
function isBroadDir(p) {
  const d = pathKey(p)
  const r = pathKey(CONFIG.root)
  return d === r || (!!r && r.startsWith(d + '\\')) || samePath(p, browseRoot)
}

function showCtxMenu(e, en) {
  const items = [
    [t('ctx.open'), () => api.openPath(en.path)],
    [t('ctx.explorer'), () => api.showInFolder(en.path)],
    [t('ctx.copyWin'), () => navigator.clipboard.writeText(en.path)],
    [t('ctx.copyWsl'), () => navigator.clipboard.writeText(toWslPath(en.path))],
  ]
  // 新着ウォッチはフォルダの行にだけ出す。ワークスペース全体と今見ているルートは
  // 指定させない（全部が光ると未読という印そのものが意味を失う・本田さん明示）。
  // 理由を見せたいので、隠さず無効表示にする。
  if (en.isDir) {
    const on = watchKeys.has(pathKey(en.path))
    const broad = isBroadDir(en.path)
    items.push([
      (on ? '✓ ' : '') + t('ctx.watchNew'),
      () => toggleWatch(en.path, !on),
      { disabled: broad && !on, title: t('watch.refusedRoot') },
    ])
  }
  showMenu(e, items)
}

function showMenu(e, items) {
  e.preventDefault()
  const m = $('#ctxmenu')
  m.innerHTML = ''
  for (const [labelText, fn, opt] of items) {
    const it = document.createElement('div')
    it.className = 'ctxitem' + (opt && opt.disabled ? ' disabled' : '')
    it.textContent = labelText
    if (opt && opt.title) it.title = opt.title
    if (opt && opt.disabled) it.addEventListener('click', (ev) => ev.stopPropagation()) // 閉じずに理由（title）を読ませる
    else it.addEventListener('click', () => { hideCtxMenu(); fn() })
    m.appendChild(it)
  }
  // ⚠ 位置は「出してから実寸で」決める。項目数を増やした時に決め打ちの高さが嘘になり、
  //    一番下の項目が画面外に出る（5つ目を足した時に実際に起きる）
  m.classList.add('show')
  m.style.left = Math.min(e.clientX, Math.max(0, window.innerWidth - m.offsetWidth - 8)) + 'px'
  m.style.top = Math.min(e.clientY, Math.max(0, window.innerHeight - m.offsetHeight - 8)) + 'px'
}

function hideCtxMenu() { $('#ctxmenu').classList.remove('show') }

// WSL UNCパス → /home/... 形式（Claude Codeのチャットに貼る用）
function toWslPath(p) {
  const m = p.replace(/\\/g, '/').match(/^\/\/wsl(\.localhost|\$)\/[^/]+(\/.*)$/)
  return m ? m[2] : p
}

// ---------- 自動更新のポーリング ----------
// WSL越しでは fs.watch が使えない（EISDIR で即死ぬ）ので OSの変更通知は無い。ポーリング一択。
// タイマーは renderer 側に置く: 何を見るか（展開中フォルダ・開いているファイル）は画面の状態そのもので、
// main に持たせると同じ状態を二重管理することになる。fs を触るのは main（既存のIPC設計どおり）。

const POLL_MIN_MS = 2000
const POLL_MAX_FAILS = 3 // 連続でこれだけ失敗したら自動で止めて画面に出す

let pollTimer = null
let pollFails = 0
let pollStopped = false
let pollBusy = false     // 1tickが走行中（応答待ち）。重ねて走らせない
let pollIdle = true      // まだ一度も成功していない／ワークスペースに届かず空回りしている
let lastPollAt = 0
let lastPollError = ''   // 直近のtickで出た例外。止まる手前でも画面に出す（緑のまま黙らせない）

function schedulePoll(delay) {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(pollTick, Math.max(0, delay))
}

function startPolling() {
  pollStopped = false
  pollFails = 0
  lastPollError = ''
  schedulePoll(POLL_MIN_MS)
  setSyncStatus()
}

function stopPolling(msg) {
  pollStopped = true
  clearTimeout(pollTimer)
  pollTimer = null
  console.error('[poll] 自動更新を停止しました:', msg)
  setSyncStatus(msg)
}

// 腐り検知の窓口。生きていれば最終確認時刻、止まったら理由が読める＝
// 「更新されない Desk」に黙って戻らない（クリックで即再開）。
// ⚠ 状態は3つ（停止＝赤／待機＝空回り中／稼働＝最終確認時刻）。どの状態でも必ず何か書く。
//    空文字にすると幅が0になって存在ごと消え、腐っていることにも気づけずクリックも押せない。
// errMsg を渡した時だけ直近エラーを更新する（'' で明示的にクリア・省略で据え置き）。
function setSyncStatus(errMsg) {
  const el = $('#sync-status')
  if (!el) return
  if (errMsg !== undefined) lastPollError = errMsg || ''
  el.classList.toggle('bad', pollStopped || !!lastPollError)
  el.classList.toggle('idle', !pollStopped && !lastPollError && pollIdle)
  if (pollStopped) {
    el.textContent = t('sync.stopped')
    el.title = t('tip.syncStopped', { msg: lastPollError })
    return
  }
  // ワークスペースに届いていない間は時計を進めようがない。無印のまま凍らせると
  // 「通常色なのに更新されない」に見えるので、待機中だと分かる表示にする
  if (pollIdle) {
    el.textContent = t('sync.waiting')
    el.title = lastPollError ? t('tip.syncError', { msg: lastPollError }) : t('tip.syncWaiting')
    return
  }
  const at = new Date(lastPollAt)
  const pad = (n) => String(n).padStart(2, '0')
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  el.textContent = (lastPollError ? '⚠ ' : '⟳ ') + clock
  el.title = lastPollError ? t('tip.syncError', { msg: lastPollError }) : t('tip.syncOk')
}

async function pollTick() {
  pollTimer = null
  // 最小化中は止める。復帰は visibilitychange が即1回叩き直す（ここで予約し直さない）
  if (pollStopped || document.hidden) return
  // ⚠ 走行中に重ねない。#sync-status の連打や最小化⇄復帰の速い往復で schedulePoll(0) が
  //    重なると、前のtickの応答が後から当たって1周ぶん古い差分を書く／プレビューを二重に描く
  if (pollBusy) { schedulePoll(POLL_MIN_MS); return }
  if (!CONFIG || !CONFIG.rootOk) {
    pollIdle = true
    setSyncStatus('')
    schedulePoll(POLL_MIN_MS)
    return
  }

  pollBusy = true
  const epoch = treeEpoch
  let res
  try {
    res = await api.pollFs({ dirs: pollDirs(), previewPath: currentFile ? currentFile.path : null })
  } catch (err) {
    // ⚠ 握り潰さない。ポーリングが唯一の生命線で、黙って止まると本田さんは原因が分からないまま
    //    手動リロードに戻る（仕様: 腐り検知）
    console.error('[poll]', err)
    pollBusy = false
    if (++pollFails >= POLL_MAX_FAILS) { stopPolling(String(err.message || err)); return }
    setSyncStatus(String(err.message || err))
    schedulePoll(POLL_MIN_MS)
    return
  }

  lastPollAt = Date.now()
  pollIdle = false
  let applyErr = ''
  try {
    setWatchState(res)
    // ツリーを作り直した後なら、この結果は古いツリー向け＝当てない
    if (epoch === treeEpoch && rootBox && rootBox.isConnected) refreshTree(rootBox, browseRoot, 0, res)
    applyMarks()
    await refreshPreview(res.preview)
  } catch (err) {
    // ⚠ ここも握り潰さない。適用フェーズで落ちるとツリーも未読もプレビューも止まるのに、
    //    IPCは成功しているので「最終確認 HH:MM:SS」だけ進み続け、画面が「動いています」と
    //    嘘をつく。時刻は進むのに中身が更新されない、が一番気づけない壊れ方（仕様§4）
    console.error('[poll:apply]', err)
    applyErr = String(err.message || err)
    if (++pollFails >= POLL_MAX_FAILS) { pollBusy = false; stopPolling(applyErr); return }
  }
  // ⚠ 失敗カウンタは「IPCも適用も通った」時だけ戻す。IPC成功で毎回0に戻すと、
  //    適用フェーズが壊れ続けても3回に到達せず永久に止まらない
  if (!applyErr) pollFails = 0
  pollBusy = false
  setSyncStatus(applyErr)
  // 自己調整: 重いフォルダを掴んでもCPUを食い潰せないようにする最終backstop。
  // 更新が遅くなるだけでPCは重くならない。
  schedulePoll(Math.max(POLL_MIN_MS, (res.ms || 0) * 20))
}

// 開いているファイルが外部（レナード）に書き換えられたら読み直す
async function refreshPreview(info) {
  if (!currentFile || !info) return
  // 消えたファイルはそのまま出しておく（開いていた内容が突然消えるほうが困る）
  if (info.gone) return
  if (previewMtime == null) { previewMtime = info.mtimeMs; return }
  // ⚠ info は「そのtickの先頭で main が stat した値」＝自分の保存より前に採られた応答が
  //    後から返ってくる。この古い mtime を当てると previewMtime が巻き戻り、入力モードでは
  //    自分で保存しただけなのに「⚠ 外部で更新」が点いて次tick以降も真のまま残る（QA指摘）。
  //    saveEdit 側は「保存が先・poll応答が後」しか潰せないので、逆順はここで捨てる。
  if (info.mtimeMs != null && info.mtimeMs < previewMtime) return
  if (info.mtimeMs === previewMtime && info.size === currentFile.size) return
  // ⚠ 入力モード中は絶対に上書きしない。編集中バッファを外部変更で潰すのは事故（本田さん明示）。
  //    印だけ出して、保存/破棄の判断は本田さんに委ねる。
  if (editMode) { previewMtime = info.mtimeMs; externalChange = true; updatePreviewTitle(); return }
  const target = currentFile.path
  const body = $('#preview-body')
  const top = body.scrollTop
  let res
  try { res = await api.readFile(target) } catch (e) { return }
  // ⚠ 読んでいる間に別のファイルを開かれていたら捨てる。当てると
  //    「クリックしたのに一瞬前のファイルが出る」になる
  if (!currentFile || currentFile.path !== target || editMode) return
  currentFile = res
  previewMtime = res.mtimeMs
  renderPreview(res)
  body.scrollTop = top // レナードが追記していくのを左側で追える（先頭に戻さない）
}

// ---------- グローバル ----------

async function pasteToInbox() {
  let results
  try {
    results = await api.pasteClipboard()
  } catch (err) {
    addFeedEntry({ ok: false, name: '', error: String(err.message || err), ts: new Date().toISOString() })
    return
  }
  for (const r of results) addFeedEntry(r)
}

// ---------- サイドバー幅・ズーム（localStorageに記憶） ----------

function setupSplitter() {
  const sidebar = $('#sidebar')
  const splitter = $('#splitter')
  if (localStorage.sidebarWidth) sidebar.style.width = localStorage.sidebarWidth
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault()
    splitter.classList.add('dragging')
    document.body.classList.add('resizing')
    const onMove = (ev) => {
      const w = Math.min(window.innerWidth * 0.6, Math.max(160, ev.clientX))
      sidebar.style.width = w + 'px'
    }
    const onUp = () => {
      splitter.classList.remove('dragging')
      document.body.classList.remove('resizing')
      localStorage.sidebarWidth = sidebar.style.width
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })
}

let zoom = 1
let zoomToastTimer = null

function setupZoom() {
  zoom = parseFloat(localStorage.zoom || '1')
  if (zoom !== 1) api.setZoom(zoom)
  window.addEventListener('wheel', (e) => {
    // macOS は Cmd（metaKey）が修飾キー。トラックパッドのピンチは ctrlKey で来るので両方見る
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    changeZoom(e.deltaY < 0 ? 0.05 : -0.05)
  }, { passive: false })
}

function changeZoom(delta) {
  setZoomTo(delta === 0 ? 1 : zoom + delta)
}

function setZoomTo(factor) {
  zoom = Math.min(2.5, Math.max(0.5, +(+factor).toFixed(2)))
  api.setZoom(zoom)
  localStorage.zoom = zoom
  const pct = Math.round(zoom * 100)
  $('#set-zoom').value = pct
  $('#zoom-val').textContent = pct + '%'
  const toast = $('#zoom-toast')
  toast.textContent = pct + '%'
  toast.classList.add('show')
  clearTimeout(zoomToastTimer)
  zoomToastTimer = setTimeout(() => toast.classList.remove('show'), 900)
}

// ---------- フォント設定（localStorage優先、config.jsonが下地） ----------

// styles.css の :root と同じチェーン（applyFonts が起動時に CSS を上書きするので、
// 片方だけ直すと「設定を触るまで旧チェーン」というズレになる。check.sh 7) が一致を見る）
const FALLBACK_UI = '"Segoe UI", "Yu Gothic UI", Meiryo, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif'
const FALLBACK_MONO = 'Consolas, "Cascadia Mono", "BIZ UDGothic", "SF Mono", Menlo, monospace'

function applyFonts() {
  const ui = localStorage.fontUi || CONFIG.fontUi
  const mono = localStorage.fontMono || CONFIG.fontMono
  const root = document.documentElement.style
  root.setProperty('--font-ui', ui ? `"${ui}", ${FALLBACK_UI}` : FALLBACK_UI)
  root.setProperty('--mono', mono ? `"${mono}", ${FALLBACK_MONO}` : FALLBACK_MONO)
}

function setupSettings() {
  const overlay = $('#settings-overlay')
  $('#btn-settings').addEventListener('click', () => { syncSettingsUI(); overlay.classList.add('show') })
  $('#set-close').addEventListener('click', () => overlay.classList.remove('show'))
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('show') })
  $('#set-zoom').addEventListener('input', (e) => setZoomTo(e.target.value / 100))

  // 言語切替。選択肢の表示名は常にその言語自身の表記（読めない言語で迷子にならないため）
  const langSel = $('#set-lang')
  for (const lang of I18N.LANGS) {
    const o = document.createElement('option')
    o.value = lang
    o.textContent = I18N.LANG_NAMES[lang]
    langSel.appendChild(o)
  }
  // 切り替えたら読み込み直す＝画面に出ている文言を1つ残らず確実に入れ替える。
  // 未保存の入力があれば leaveEditMode が確認するので、書きかけは失われない。
  langSel.addEventListener('change', async () => {
    if (!await leaveEditMode()) { langSel.value = I18N.getLang(); return }
    await api.setLang(langSel.value)
    location.reload()
  })

  const onFontChange = () => {
    const ui = $('#set-font-ui-custom').value.trim() || $('#set-font-ui').value
    const mono = $('#set-font-mono-custom').value.trim() || $('#set-font-mono').value
    if (ui) localStorage.fontUi = ui; else localStorage.removeItem('fontUi')
    if (mono) localStorage.fontMono = mono; else localStorage.removeItem('fontMono')
    applyFonts()
  }
  $('#set-font-ui').addEventListener('change', onFontChange)
  $('#set-font-mono').addEventListener('change', onFontChange)
  $('#set-font-ui-custom').addEventListener('input', onFontChange)
  $('#set-font-mono-custom').addEventListener('input', onFontChange)

  $('#set-root-change').addEventListener('click', async () => {
    if (await api.chooseRoot()) { await reloadRoot(); syncSettingsUI() }
  })

  // ドロップ先フォルダ。弾かれたら赤く光らせて元の値に戻す（黙って無視しない）
  const inboxInput = $('#set-inbox')
  inboxInput.addEventListener('change', async () => {
    // main 側が throw すると invoke ごと reject する。拾わないと
    // 「赤くもならず何も出ないのに設定は変わっていない」になる（QA指摘）
    let r
    try {
      r = await api.setInbox(inboxInput.value)
    } catch (err) {
      r = { ok: false, error: String(err.message || err) }
    }
    if (!r.ok) {
      // 作れなかった理由（既存ファイルと同名など）は握り潰さず、そのまま見せる。
      // 定型文だけ出すと「なぜ弾かれたか分からない」になる（QA指摘）
      inboxInput.classList.add('bad')
      inboxInput.title = r.error || t('err.inbox')
      setTimeout(() => inboxInput.classList.remove('bad'), 1600)
      inboxInput.value = CONFIG.inboxName
      return
    }
    inboxInput.title = ''
    CONFIG = await api.getConfig()
    applyI18n()        // 「_inbox に入れる」等の案内文を新しい名前で作り直す
    // ⚠ applyI18n は #preview-title も初期文言で塗り替える。開いているファイル名と
    //    「● 入力中」の印が消えたまま戻らなくなるので、ここで貼り直す（QA指摘）
    if (currentFile) updatePreviewTitle()
    refreshInboxLabel()
    syncSettingsUI()
    if (CONFIG.rootOk) await loadTreeRoot() // 新しいフォルダを作った場合はツリーに出す
  })

  $('#set-reset').addEventListener('click', () => {
    localStorage.removeItem('fontUi')
    localStorage.removeItem('fontMono')
    setZoomTo(1)
    applyFonts()
    syncSettingsUI()
  })
}

function syncSettingsUI() {
  $('#set-version').textContent = CONFIG.version ? `v${CONFIG.version}` : ''
  $('#set-lang').value = I18N.getLang()
  $('#set-root-path').textContent = CONFIG.root || t('notSet')
  $('#set-root-path').title = CONFIG.root || ''
  $('#set-inbox').value = CONFIG.inboxName || ''
  const pct = Math.round(zoom * 100)
  $('#set-zoom').value = pct
  $('#zoom-val').textContent = pct + '%'
  for (const [key, selId, customId] of [['fontUi', '#set-font-ui', '#set-font-ui-custom'], ['fontMono', '#set-font-mono', '#set-font-mono-custom']]) {
    const val = localStorage.getItem(key) || ''
    const sel = $(selId)
    if ([...sel.options].some(o => o.value === val)) { sel.value = val; $(customId).value = '' }
    else { sel.value = ''; $(customId).value = val }
  }
}

function isTypingTarget(el) {
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)
}

function setupGlobal() {
  $('#btn-refresh').addEventListener('click', loadTreeRoot)
  $('#btn-paste').addEventListener('click', pasteToInbox)
  // 最小化中は Electron 側でもタイマーが絞られるが、当てにせず自分で止める。
  // 復帰時は待たずに1回走らせる（左ペインに戻った瞬間が一番見たい時）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(pollTimer); pollTimer = null }
    else if (!pollStopped) schedulePoll(0)
  })
  // 止まっていたらクリックで再開、生きていれば今すぐ1回
  $('#sync-status').addEventListener('click', () => { if (pollStopped) startPolling(); schedulePoll(0) })
  $('#btn-clear-feed').addEventListener('click', () => { $('#inbox-feed').innerHTML = '' })
  setupSplitter()
  setupZoom()
  setupSettings()
  // プレビュー内の選択テキストを右クリックでコピー
  $('#preview-body').addEventListener('contextmenu', (e) => {
    const sel = window.getSelection().toString()
    if (!sel) return
    showMenu(e, [[t('ctx.copySelection'), () => navigator.clipboard.writeText(sel)]])
  })
  // [[ページ名]] のクリックで対象ノートへ飛ぶ（解決済みのものだけ data-wiki を持つ）
  $('#preview-body').addEventListener('click', (e) => {
    const a = e.target.closest('a.wikilink[data-wiki]')
    if (!a) return
    e.preventDefault()
    if (currentFile) navHistory.push(currentFile.path)
    openPreview(a.dataset.wiki)
  })
  window.addEventListener('keydown', (e) => {
    // 文字を打つ場所（入力モードのtextarea・パス欄・設定の入力）ではアプリのショートカットを譲る。
    // 特に Ctrl+V は _inbox 投入に奪われると編集中に貼り付けられなくなる。
    const typing = isTypingTarget(e.target)
    if (e.key === 'F5' && !typing) { e.preventDefault(); loadTreeRoot() }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack() }
    if (e.key === 'Escape') { hideCtxMenu(); hidePathHist(); $('#settings-overlay').classList.remove('show') }
    if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteToInbox() }
    // ズームも Ctrl/Cmd 両対応（macOS の Cmd+ / Cmd- / Cmd+0）。上の保存・貼り付けと同じ書き方に揃える
    const mod = e.ctrlKey || e.metaKey
    if (mod && (e.key === '+' || e.key === '=' || e.key === ';')) { e.preventDefault(); changeZoom(0.1) }
    if (mod && e.key === '-') { e.preventDefault(); changeZoom(-0.1) }
    if (mod && e.key === '0') { e.preventDefault(); changeZoom(0) }
  })
  window.addEventListener('click', () => { hideCtxMenu(); hidePathHist() })
  // 入力モードで未保存のまま閉じるのを止める
  window.addEventListener('beforeunload', (e) => {
    if (editMode && editDirty) { e.preventDefault(); e.returnValue = '' }
  })
}
