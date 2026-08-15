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

// 最下段のフォルダタブ（Excelのシートタブ風）。1タブ = 1フォルダ。
// ⚠ タブが動かすのは browseRoot（＝見る場所）だけ。CONFIG.root と #inbox-* には触らない。
//    「タブを切り替えても投入先は動かない」がこの機能の不変条件。
let tabs = []
let activeTab = 0

// 展開の復元中だけ、makeNode が撃つ「子フォルダの読み込み」を集める入れ物。
// null の間は集めない＝2秒ごとのポーリング経由で作られたノードのぶんを溜め込まない。
let openWaiters = null

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
  setupTabs()
  // ⚠ ルートピッカーで止まる経路でも腐り検知の窓口を空にしない。空文字だと幅が0になり、
  //    「止まっている」ことが画面に出ないうえクリックでの再開すら押せない（QA致命1）
  setSyncStatus()
  // ⚠ 差分の基準は openPreview より前に必ず戻す。ここより後ろに置くと、タブの「続きから」で
  //    復元した1枚が「今の内容」で基準を取り直し、留守の間の書き換えが起動した瞬間に消える
  //    ＝永続化を足した意味が丸ごと無くなる（この1行の位置が機能の成否そのもの）。
  // ⚠ ルートピッカーで止まる経路より前に置くのも同じ理由＝ここを通らないと保存も止まるので、
  //    「読めていないのに書き出して全部消す」も同時に塞げる。
  loadDiffBases()
  if (!CONFIG.rootOk) { showRootPicker(); return }
  loadTabs()
  const tb = await startingTab()
  saveTabs()
  renderTabs()
  await openWorkspace(tb)
}

// ワークスペースを開く＝ツリーを出して自動更新を動かすところまで。
// ⚠ init と reloadRoot で手順を書き分けない。片方に startPolling を書き忘れるだけで、
//    その経路で起動したセッションは自動更新も未読の印も丸ごと死に、v0.4.3 の
//    「手動F5でしか更新されない Desk」に黙って戻る（QA致命1）。ルートピッカー経由＝
//    初回起動と、WSLが上がる前にDeskを開いた朝の「選び直し」で実際に踏む動線。
// ⚠ ツリー構築が転んでもポーリングだけは必ず始める（finally）。途中の例外ひとつで
//    そのセッションが二度と自動更新しなくなる、という同じ壊れ方をここで閉じておく。
async function openWorkspace(tb) {
  try {
    await openTab(tb)
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

// 起動時に開くタブを決める。撤収済みレーン等で行き先が消えていたら、
// ⚠ を付けたままタブは残し（勝手に消さない＝WSLが上がっていない朝に全部消えるのを防ぐ）、
// 表示だけ1枚目（ワークスペース）へ落とす。
// ⚠ ここで実測するのは「これから開く1枚」だけ。全タブを起動時に stat すると、
//    WSL越しの往復がタブの枚数ぶん積み上がって起動が目に見えて遅くなる。
//    他のタブの⚠は、押した時（activateTab）に付く。
async function startingTab() {
  const tb = tabs[activeTab] || tabs[0]
  if (samePath(tb.path, CONFIG.root)) return tb
  let r = null
  try { r = await api.resolveTarget(tb.path) } catch (err) { r = null }
  if (r && r.ok && r.isDir) { tb.path = r.path; return tb }
  // 1枚目そのものが行方不明なら⚠を付けても意味がない（この後ワークスペースに戻すので嘘になる）
  if (tb !== tabs[0]) tb.bad = true
  activeTab = 0
  resetTabTo(tabs[0], CONFIG.root)
  return tabs[0]
}

// ルート変更（初回設定・設定パネルからの変更 共通）
async function reloadRoot() {
  CONFIG = await api.getConfig()
  if (!CONFIG.rootOk) { showRootPicker(); setSyncStatus(); return }
  // ⚠ ワークスペースが変わったらタブは作り直す。前のワークスペースの隣にあったレーンを
  //    指すタブは新しいワークスペースでは意味を持たず、⚠だらけのタブ列だけが残る。
  localStorage.removeItem(TABS_KEY)
  localStorage.removeItem('browseRoot')
  tabs = [newTab(CONFIG.root)]
  activeTab = 0
  // ここは「新しいワークスペースのタブ集合を確定した」経路＝保存してよい状態になる
  // （ルートピッカーで止まったまま終了した時とは違う。上の tabsLoaded のコメント参照）
  tabsLoaded = true
  saveTabs()
  renderTabs()
  await openWorkspace(tabs[0])
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

// restoreOpen: そのタブで展開していたフォルダの集合（Excelのシートタブ風の「続きから」）。
// ⚠ openDirs は「消す」のではなく「入れ替える」。clear だけにするとタブに戻った時に
//    展開が全部畳まれ、続きから、が成立しない。差分適用とポーリングは openDirs の中身を
//    そのまま信じて動くので、入れ替えは loadTreeRoot の前に済ませておく必要がある。
// record: パス欄の履歴（▾）に積むか。
// ⚠ 積むのはパス欄で「行った」時だけ。タブの切替（openTab）からは積まない——タブは
//    意図して固定した場所、履歴はさっき行った場所で別物なので、タブを往復するたびに
//    履歴が同じ場所で埋まると履歴の役目が消える（本田さんの線引き）。
async function setBrowseRoot(dir, { restoreOpen = null, record = false } = {}) {
  browseRoot = dir
  if (record) pushPathHistory(dir)

  const away = !samePath(dir, CONFIG.root)
  $('#path-input').value = dir
  $('#path-input').title = dir
  $('#root-name').textContent = baseName(dir)
  $('#root-name').classList.toggle('away', away)
  refreshInboxLabel() // #root-name の title もここで貼る
  openDirs.clear()
  if (restoreOpen) for (const p of restoreOpen) openDirs.add(p)
  await loadTreeRoot()
}

// パス欄 Enter / Go / ↑ の行き先。
// ⚠ ブラウザのタブと同じで「アクティブタブのパスが書き換わる」＝新しいタブは作らない
//    （↑ を連打するたびにタブが増えていくと、タブが履歴の墓場になる・本田さん合意）。
async function gotoPath(input) {
  // ⚠ 入力モードの未保存はここでも訊く。移動すると resetTabTo が tb.sel を捨てる＝
  //    「ツリーのどこにも無いファイルを編集し続けている」状態になり、タブを往復した
  //    時点で書きかけが黙って消える（v0.9 までは訊いていなかったが、タブの導入で悪化した）
  if (!await leaveEditMode()) return
  const r = await api.resolveTarget(input)
  if (!r.ok) { pathBarError(r.error); return }
  const tb = tabs[activeTab]
  // 行き先が変わる＝そのタブの「続きから」（展開・選択・スクロール）は別の場所のものになる。
  // ⚠ 同じフォルダへの Go でも捨てる。setBrowseRoot は必ず展開を畳むので、
  //    ここで記録だけ残すと「画面は畳まれているのにタブの記憶は開いたまま」がズレて残る
  if (tb) {
    resetTabTo(tb, r.path)
    saveTabs()
  }
  await setBrowseRoot(r.path, { record: true })
  renderTabs() // 1枚目は表示名がパス由来＝移動したら見出しも変わる
  if (r.filePath) openPreview(r.filePath) // ファイルを貼られたら親を開いてその1枚を出す
}

function pathBarError(msg) {
  const el = $('#path-input')
  el.classList.add('bad')
  el.title = msg
  setTimeout(() => el.classList.remove('bad'), 1400)
}

// ---------- パス欄の履歴（▾） ----------
// タブとは役割が別物。タブ＝意図して固定する場所、履歴＝さっき行った場所（本田さんの線引き）。
// ⚠ 🌿レーンはここに出さない。レーンの入口は ＋ の右クリックに一本化する（同じものへの
//    入口を2つ持つと、直す時にどちらを直せばいいのか分からなくなる）。レーンを出さない＝
//    実測（listWorktrees の await）が要らないので、ここは同期処理で足りる。

const PATH_HIST_MAX = 20

function pathHistory() {
  // ⚠ 壊れたJSON・配列でない・文字列以外が混ざっている、のどれでも落ちない
  try {
    const list = JSON.parse(localStorage.pathHistory || '[]')
    return Array.isArray(list) ? list.filter(p => typeof p === 'string' && p) : []
  } catch (err) { return [] }
}

function pushPathHistory(p) {
  if (!p) return
  const list = pathHistory().filter(x => !samePath(x, p)) // 同じ場所は積み直さず先頭へ
  list.unshift(p)
  // ⚠ 上限を外さない。パス欄で動くたびに積むので、際限なく伸びて localStorage を食う
  const next = JSON.stringify(list.slice(0, PATH_HIST_MAX))
  // ⚠ try で包むのは保存の一行だけ。組み立てごと包むと、この中の書き間違い（未定義の参照など）まで
  //    握り潰されて「履歴が積まれないのにエラーも出ない」になる（実際にテストで踏んだ）
  try { localStorage.pathHistory = next } catch (err) { /* 保存できなくても操作は続ける */ }
}

function hidePathHist() { $('#path-hist').classList.remove('show') }

function togglePathHist() {
  const box = $('#path-hist')
  if (box.classList.contains('show')) { hidePathHist(); return }
  const list = pathHistory()
  box.innerHTML = ''
  if (!list.length) {
    const empty = document.createElement('div')
    empty.className = 'hist-empty'
    empty.textContent = t('hist.empty')
    box.appendChild(empty)
  } else {
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
  $('#btn-path-hist').addEventListener('click', (e) => { e.stopPropagation(); togglePathHist() })
  $('#btn-home').addEventListener('click', goHome)
  $('#btn-up').addEventListener('click', () => {
    const up = parentOf(browseRoot)
    if (up) gotoPath(up)
  })
}

// ---------- 最下段のフォルダタブ（Excelのシートタブ風） ----------
// 1タブ = 1フォルダ。狙いは ~/.claude や memory のような「ワークスペースの外／hidden で
// ツリーに出ないフォルダ」へ一発で行き来すること（hidden 判定は子エントリの名前で弾いて
// いるので、browseRoot 自身が ~/.claude なら中身は普通に見える＝これが成立する理由）。
// v0.9 までのパス欄の ▾履歴 はこれに置き換えた（役割が丸ごと重なるため）。
//
// ⚠ 動かすのは browseRoot だけ。CONFIG.root（_inbox の投入先）は切り替えても動かさない。
// ⚠ 保存先は localStorage。会社PCと自宅PCでパスが違ううえ、この repo は公開しているので
//    config.json に個人のパスを焼き込むのは論外（PC別に正しいのはこちらだけ）。

const TABS_KEY = 'tabs'

function newTab(p, name) {
  // open/sel/scroll がタブごとの「続きから」の中身。bad は保存しない（下の saveTabs 参照）
  return { path: p, name: name || '', open: [], sel: null, scroll: 0, bad: false }
}

// 行き先が変わったタブの状態を捨てる。展開・選択・スクロールは「そのフォルダのもの」なので、
// パスだけ差し替えて持ち回ると、まったく別のフォルダの記憶を復元しようとして空振りする。
function resetTabTo(tb, p) {
  tb.path = p
  tb.open = []
  tb.sel = null
  tb.scroll = 0
  tb.bad = false
}

// タブの見出し。1枚目だけは常にパス由来にする＝「⌂ で必ずワークスペースに戻れる」と対で、
// 1枚目が今どこを指しているかが見出しに出ていないと、タブが嘘の地図になる。
function tabLabel(tb, i) {
  const base = baseName(tb.path) || tb.path
  return i === 0 ? base : (tb.name || base)
}

// タブを一度でも読み込んだか。⚠ これが立つまで保存は絶対にしない。
// WSLが上がっていない朝に開くとルートピッカーで止まり、tabs は空のまま＝そこで保存すると
// 前の晩のタブが空配列で上書きされ、復旧不能で全部消える（実機で3回踏んだ）。
// ⚠ 歯止めは呼び出し側（beforeunload 等）ではなく saveTabs の中に置く。入口は今後も増える。
let tabsLoaded = false

function saveTabs() {
  if (!tabsLoaded) return
  // ⚠ bad は保存しない。WSLが落ちている間に付いた⚠を次の起動まで引きずると、
  //    復旧しているのに壊れて見える（実測で付け直せる印を永続化しない）
  try {
    localStorage[TABS_KEY] = JSON.stringify({
      v: 1,
      active: activeTab,
      tabs: tabs.map(tb => ({ path: tb.path, name: tb.name, open: tb.open, sel: tb.sel, scroll: tb.scroll })),
    })
  } catch (err) { /* 保存できなくても操作は続けさせる（次の起動で既定に戻るだけ） */ }
}

// ⚠ 壊れたJSONを読んでも起動不能にしない（旧 pathHistory と同じ作法）。
//    型もここで1つずつ確かめる＝手で書き換えられた localStorage で描画側が落ちない。
function loadTabs() {
  tabs = []
  activeTab = 0
  let saved = null
  try { saved = JSON.parse(localStorage[TABS_KEY] || 'null') } catch (err) { saved = null }
  if (saved && Array.isArray(saved.tabs)) {
    for (const raw of saved.tabs) {
      if (!raw || typeof raw.path !== 'string' || !raw.path) continue
      const tb = newTab(raw.path, typeof raw.name === 'string' ? raw.name : '')
      tb.open = Array.isArray(raw.open) ? raw.open.filter(x => typeof x === 'string') : []
      tb.sel = typeof raw.sel === 'string' ? raw.sel : null
      tb.scroll = Number(raw.scroll) || 0
      tabs.push(tb)
    }
    if (Number.isInteger(saved.active)) activeTab = saved.active
  }
  // 1枚目（ワークスペース・閉じられないタブ）は必ず1枚ある
  if (!tabs.length) tabs.push(newTab(CONFIG.root))
  // v0.9 までの localStorage.browseRoot（前回見ていたフォルダを1つだけ覚えていた）の移行。
  // 黙って捨てるとレーンを覗いたまま終えた人が次の起動で行き先を失うので、タブとして拾ってから消す。
  const legacy = localStorage.browseRoot
  if (legacy) {
    localStorage.removeItem('browseRoot')
    if (!saved && !samePath(legacy, CONFIG.root)) {
      tabs.push(newTab(legacy))
      activeTab = tabs.length - 1
    }
  }
  if (!(activeTab >= 0 && activeTab < tabs.length)) activeTab = 0
  tabsLoaded = true // ここを通って初めて保存を許す（上の tabsLoaded のコメント参照）
}

function renderTabs() {
  const box = $('#tabs')
  // ⚠ innerHTML を空にしない。＋ボタンは #tabs の子（最後のタブの直後）なので、
  //    まとめて消すと毎回作り直しになりリスナーごと消える。タブ行だけ差し替える。
  const addBtn = $('#btn-tab-add')
  for (const el of [...box.querySelectorAll('.tab')]) el.remove()
  tabs.forEach((tb, i) => {
    const el = document.createElement('div')
    el.className = 'tab' + (i === activeTab ? ' active' : '') + (tb.bad ? ' bad' : '')
    el.textContent = (tb.bad ? '⚠ ' : '') + tabLabel(tb, i)
    el.title = tb.path
    el.addEventListener('click', () => activateTab(i))
    el.addEventListener('contextmenu', (e) => showTabMenu(e, i))
    box.insertBefore(el, addBtn)
  })
  // タブが増えて横スクロールに入っても、今いるタブは見えている状態にする
  const cur = box.children[activeTab]
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

// 今のタブへ「続きから」を退避する。切替の直前に呼ぶ。
function captureTab() {
  const tb = tabs[activeTab]
  if (!tb) return
  if (browseRoot) tb.path = browseRoot
  tb.open = [...openDirs]
  tb.sel = currentFile ? currentFile.path : null
  tb.scroll = $('#tree').scrollTop
}

// 展開の復元は makeNode の中で非同期に走る（子フォルダを読みに行く）。待たずに選択や
// スクロールを戻すと、深い階層の行がまだ生えておらず復元が空振りする。
// ⚠ 回数の上限を置く。openDirs に循環（symlink 等）が紛れても、ここで永久に回らないように。
async function settleOpenWaiters() {
  for (let round = 0; openWaiters && openWaiters.length && round < 50; round++) {
    await Promise.all(openWaiters.splice(0))
  }
}

// 選択していたファイルとプレビューを戻す。
// ⚠ ツリーに見えていない（消えた・読めなかった）なら黙って諦めるが、tb.sel は消さない。
//    WSLが一瞬途切れただけで「次に戻った時の続き」まで失うのは割に合わない。
async function restoreTabSelection(tb) {
  if (!tb.sel) return
  const el = nodeByPath.get(pathKey(tb.sel))
  if (!el || !el._node || el._node.isDir) return
  if (await openPreview(tb.sel)) selectRow(el._node.row)
}

async function openTab(tb) {
  openWaiters = []
  try {
    await setBrowseRoot(tb.path, { restoreOpen: tb.open })
    await settleOpenWaiters()
  } finally {
    openWaiters = null // ⚠ 例外で抜けても必ず戻す。集めっぱなしにするとポーリングぶんが溜まる
  }
  $('#tree').scrollTop = tb.scroll || 0
  await restoreTabSelection(tb)
  renderTabs()
}

// 切替の走行中は次の切替を重ねない鍵。連打で2本の openTab が噛み合うと、
// 片方のツリーの上にもう片方の「続きから」を復元しにいく（選択とスクロールが混ざる）。
let tabSwitchBusy = false
// 走行中に来た切替は捨てず、1件だけ覚えて終わってから実行する（Ctrl+Tab連打の1回が無反応、を防ぐ）。
// ⚠ 覚えるのは「行き先の番号」ではなく処理そのもの。番号で覚えると、連打の2回目が
//    まだ動いていない activeTab から行き先を計算して同じタブへ二度行く。
let tabSwitchPending = null

async function activateTab(i, { force = false, capture = true } = {}) {
  const tb = tabs[i]
  if (!tb) return
  if (i === activeTab && !force) return
  if (tabSwitchBusy) { tabSwitchPending = () => activateTab(i, { force, capture }); return }
  tabSwitchBusy = true
  try {
    // ⚠ 入力モードの未保存を飛ばさない。取り消されたら切り替えごと中止する。
    //    見た目を先に動かしていないので、ここで戻すのは念のため（描き直せば activeTab が正）。
    if (!await leaveEditMode()) { renderTabs(); return }
    // 撤収済みレーンや消したフォルダを指すタブがありうる。⚠ を付けて残すだけにする＝
    // 勝手に消さない（WSLが一瞬途切れただけでタブが消えると、二度と戻せない）。
    let r = null
    try { r = await api.resolveTarget(tb.path) } catch (err) { r = null }
    if (!r || !r.ok || !r.isDir) {
      tb.bad = true
      renderTabs()
      showToast(t('tab.gone', { path: tb.path }), 2600)
      return
    }
    // 正規化後のパスで持ち直す。WSL形式（/home/...）のまま持つと readDir が届かない
    tb.path = r.path
    tb.bad = false
    if (capture) captureTab()
    activeTab = i
    saveTabs()
    await openTab(tb)
  } finally {
    tabSwitchBusy = false
    const next = tabSwitchPending
    tabSwitchPending = null
    if (next) await next()
  }
}

// ⌂ は「1枚目＝ワークスペース」へ戻る道。1枚目がパス欄ナビで外へ出ていても、
// ここで必ず CONFIG.root に引き戻す（⌂で戻れる、という約束を守っている唯一の場所）。
async function goHome() {
  if (!CONFIG.rootOk) return
  if (!await leaveEditMode()) return
  captureTab()
  const home = tabs[0]
  if (!samePath(home.path, CONFIG.root)) resetTabTo(home, CONFIG.root)
  home.bad = false
  activeTab = 0
  saveTabs()
  renderTabs()
  await activateTab(0, { force: true, capture: false })
}

function stepTab(d) {
  if (tabs.length < 2) return
  // ⚠ 走行中なら「隣へ」という意図のまま覚える。ここで行き先を先に計算して覚えると、
  //    連打の2回目が同じ行き先になって1枚ぶんしか進まない
  if (tabSwitchBusy) { tabSwitchPending = () => stepTab(d); return }
  activateTab((activeTab + d + tabs.length) % tabs.length)
}

// 既にあるタブへ移った時に、そのタブを一瞬光らせる。
// ⚠ 「押したのに何も起きない」に見えるのを防ぐためだけの合図。トーストのような
//    大げさなものは足さない（増えなかったことさえ伝われば用は足りる）。
function flashTab(i) {
  const el = $('#tabs').children[i]
  if (!el) return
  el.classList.remove('flash')
  void el.offsetWidth // 連続で押した時にアニメーションを頭から流し直すためのリフロー
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 700)
}

// 行き先を指して足す（レーン一覧・フォルダを選ぶ…・ツリーの「タブで開く」）。
// 既にあるものは重複させず、そのタブをアクティブにする（同じフォルダのタブが2枚並ばない）。
// 増えないぶん、光らせて「そこにある」ことを見せる。
async function addTab(p) {
  if (!p) return
  const i = tabs.findIndex(tb => samePath(tb.path, p))
  if (i >= 0) { await activateTab(i); flashTab(i); return }
  await createTab(p)
}

// 必ず1枚増やす。
// ⚠ 未保存の確認はタブを足す「前」。後回しにすると、取り消した時にタブだけ増えて
//    アクティブにならず、押した結果と画面が食い違う（閉じる時と同じ轍）。
//    ここを通った後の activateTab 側の確認は素通りする（もう入力モードを抜けている）。
async function createTab(p) {
  if (!await leaveEditMode()) return
  tabs.push(newTab(p))
  saveTabs()
  renderTabs()
  await activateTab(tabs.length - 1)
}

// ＋ボタン（と📌今のフォルダをタブに追加）＝「今いる場所をタブとして残す」。
// ⚠ ここで addTab の重複判定をそのまま使うと、＋を押しても永久に1枚も増えない。
//    パス欄で移動するとアクティブタブのパスが書き換わる仕様＝browseRoot は常に
//    アクティブタブのパスと一致していて、必ず自分自身に当たるため（実装を素直に
//    繋ぐと「押しても何も起きないボタン」が出来上がる。テストで気づいた）。
//    なので一致を見るのは「今のタブ以外」だけ。他所に同じ場所のタブがあればそこへ移り、
//    無ければ今の場所を新しい1枚として残す。
async function pinCurrentTab() {
  if (!browseRoot) return
  const i = tabs.findIndex((tb, k) => k !== activeTab && samePath(tb.path, browseRoot))
  if (i >= 0) { await activateTab(i); flashTab(i); return }
  await createTab(browseRoot)
}

async function closeTab(i) {
  if (i <= 0 || i >= tabs.length) return // 1枚目（ワークスペース）は閉じられない
  // 切替の走行中は閉じない。走行中に配列をいじると、進行中の切替が別のタブを開き終えた後に
  // 添字だけズレた状態で残る（ツリーとタブバーが食い違う）
  if (tabSwitchBusy) return
  const wasActive = activeTab === i
  // ⚠ 破棄確認は splice の「前」。順序を逆にすると〈いいえ〉で取り消しても
  //    タブは減ったまま・保存も済んでいて、復旧する手立てが無い（実機で踏んだ）。
  //    状態を壊してから確認する順序そのものが誤りで、return を足しても直らない。
  if (wasActive && !await leaveEditMode()) return
  tabs.splice(i, 1)
  if (wasActive) {
    activeTab = Math.max(0, i - 1)
    saveTabs()
    renderTabs()
    // ⚠ capture: false。ここで退避すると、閉じたタブのツリー状態を移動先のタブに
    //    上書きしてしまう（移動先の「続きから」が消える）
    await activateTab(activeTab, { force: true, capture: false })
    return
  }
  // ⚠ 自分より前のタブが消えた＝アクティブの添字が1つ手前へずれる。ここを落とすと
  //    タブバーの反転位置とツリーの中身が食い違ったまま保存される
  if (activeTab > i) activeTab--
  saveTabs()
  renderTabs()
}

// 名前の変更はタブの上で直接行う。
// ⚠ prompt() は使えない（Electron の renderer は window.prompt を実装していない＝
//    押しても何も起きないメニュー項目になる）。
function startRenameTab(i) {
  const el = $('#tabs').children[i]
  const tb = tabs[i]
  if (!el || !tb) return
  el.textContent = ''
  const input = document.createElement('input')
  input.className = 'tab-rename'
  input.value = tabLabel(tb, i)
  el.appendChild(input)
  input.focus()
  input.select()
  let done = false
  const commit = (save) => {
    if (done) return // blur と Enter が二重に走る
    done = true
    if (save) {
      const v = input.value.trim()
      // 空にしたら既定（フォルダ名）へ戻す＝消せない名前を作らない
      tb.name = (!v || v === baseName(tb.path)) ? '' : v
      saveTabs()
    }
    renderTabs()
  }
  // ⚠ キー入力をタブの外へ漏らさない。漏らすと Ctrl+1〜9 / Ctrl+Tab のタブ切替や
  //    Escape のメニュー閉じに、名前を打っている最中の入力を奪われる
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') commit(true)
    if (e.key === 'Escape') commit(false)
  })
  input.addEventListener('blur', () => commit(true))
  input.addEventListener('click', (e) => e.stopPropagation()) // タブ本体のクリック（切替）を止める
}

function showTabMenu(e, i) {
  const tb = tabs[i]
  if (!tb) return
  const locked = i === 0
  showMenu(e, [
    [t('tab.rename'), () => startRenameTab(i), { disabled: locked, title: locked ? t('tab.renameLocked') : '' }],
    [t('tab.copyPath'), () => navigator.clipboard.writeText(tb.path)],
    [t('tab.close'), () => closeTab(i), { disabled: locked, title: locked ? t('tab.closeLocked') : '' }],
  ])
}

let tabMenuBusy = false // レーン実測（await）中の二度押しで二重に開かないための鍵

async function showTabAddMenu(e) {
  if (!CONFIG || !CONFIG.rootOk || tabMenuBusy) return
  tabMenuBusy = true
  // worktree レーンは押すたびに実測する＝撤収済みレーンは自然に消え、新しいレーンは次に出る。
  // ⚠ 検出に失敗しても他の項目は必ず出す（レーンはおまけ・旧 togglePathHist と同じ堅牢性）
  let lanes = []
  try { lanes = await api.listWorktrees() } catch (err) { /* 他の項目だけ出す */ }
  tabMenuBusy = false
  const items = []
  if (lanes.length) {
    items.push([t('tab.lanes'), null, { head: true }])
    for (const ln of lanes) items.push([`🌿 ${ln.name}`, () => addTab(ln.path), { title: ln.path }])
    items.push(['', null, { sep: true }])
  }
  items.push([t('tab.addCurrent'), () => pinCurrentTab(), { title: browseRoot }])
  items.push([t('tab.addFolder'), chooseFolderTab])
  showMenu(e, items)
}

async function chooseFolderTab() {
  // ⚠ api.chooseRoot は絶対に流用しない。あれは config.root（＝_inbox の置き場）ごと
  //    書き換える＝「タブを足しただけで投入先が動く」という一番やってはいけない事故になる。
  let p = null
  try { p = await api.chooseFolder(browseRoot || CONFIG.root) } catch (err) { return }
  if (p) await addTab(p)
}

function setupTabs() {
  const btn = $('#btn-tab-add')
  // ⚠ 左クリックはメニューを開かず「今見ているフォルダをタブにする」を即実行する。
  //    メニューを開く作りにしていたら、本田さんは実機で増やし方を見つけられなかった＝
  //    ＋が「選ばせるボタン」に見え、「増やすボタン」に見えていなかった。
  btn.addEventListener('click', (e) => {
    e.stopPropagation() // 直後の window クリック（メニューを閉じる）に巻き込まれないように
    pinCurrentTab()
  })
  // 他の足し方（レーン一覧・フォルダを選ぶ…）は消さずに右クリックへ退避
  btn.addEventListener('contextmenu', (e) => {
    e.stopPropagation()
    showTabAddMenu(e)
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

  row.addEventListener('click', async (e) => {
    // ⚠ ダブルクリックの2発目では開閉を動かさない。フォルダのダブルクリックは「タブで開く」で、
    //    素通しにすると「開く→閉じる」が一瞬走ってちらつく（e.detail はその click が
    //    連打の何発目かを教えてくれる。プログラムからの .click() は 0 なので素通りする）。
    if (en.isDir) { if (e && e.detail > 1) return; toggleDir() }
    // 入力モードの確認で開くのを取り消した時は選択も動かさない（表示中のファイルと選択をずらさない）
    else if (await openPreview(en.path)) selectRow(row)
  })
  // フォルダは「タブで開く」、ファイルは既定のアプリで開く。
  // ⚠ フォルダ側は右クリックメニューの「タブで開く」と同じ addTab を通す（別実装を書かない＝
  //    重複タブの扱いも編集中のガードも自動で揃う）。以前ここでエクスプローラーを開いていたのは
  //    本田さんが不要と明示し、ダブルクリック＝タブで開く、が直感的だと決まった。
  row.addEventListener('dblclick', () => {
    if (en.isDir) addTab(en.path)
    else api.openPath(en.path)
  })
  row.addEventListener('dragstart', (e) => {
    e.preventDefault()
    internalDragPath = en.path
    api.dragStart(en.path)
    setTimeout(() => { if (internalDragPath === en.path) internalDragPath = null }, 5000)
  })
  row.addEventListener('contextmenu', (e) => showCtxMenu(e, en))

  if (en.isDir && openDirs.has(en.path)) {
    const p = toggleDir(true)
    // タブの復元中だけ「読み終わるのを待てる形」で集める（openWaiters が null の間は集めない＝
    // 2秒ごとのポーリングで作られたノードのぶんを溜め込まない）
    if (openWaiters) openWaiters.push(p)
  }
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
  // ⚠ 差分の基準を取り直すのはここだけ。refreshPreview（＝レナードの書き換えを検知して
  //    読み直す経路）では絶対に動かさない。動かすと「1回ぶんの書き換え」しか見えなくなり、
  //    5回書き換えられた記事の「開いた時 → 今」がまとめて見えるという機能の肝が消える。
  // ⚠ そして openPreview は「もう開いているファイルをもう一度開く」時にも走る
  //    （ツリーの同じ行を再クリック／ダブルクリックで外部エディタ＝click が先に2発飛ぶ／
  //      ← で離れて戻る／受領フィードの行）。ここで無条件に取り直すと、その瞬間に
  //    「まだ見ていない書き換え」が復元不能で消える。同じパスの基準を既に持っているなら据え置く。
  // ⚠ 据え置く時も「最近見た」印だけは更新する（中身は動かさない）。ここを通さないと、
  //    追いかけている本命ほど並びが古いままになり、上限に達した時に真っ先に捨てられる。
  if (shouldKeepDiffBase(res)) touchDiffBase(res)
  else setDiffBase(res)
  diffMode = false // 別のファイルに移ったら差分ビューは畳む（前のファイルの基準で開いたままにしない）
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
  // ⚠ 差分は editable なファイルだけの道具。差分ビューを開いたまま 4MB を超えて育つと
  //    isEditable が false になり差分ボタンごと消えるが、diffMode を true のまま残すと
  //    ファイルが縮んで editable に戻った瞬間に「押していない差分ビュー」が復活する。
  if (!isEditable(res)) diffMode = false
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
  // 差分ビュー中はレンダ/ソースの切替を出さない。押しても差分の見た目は変わらない＝
  // 「押しても何も起きないボタン」になるので、その間は引っ込める。
  if (res.kind === 'markdown' && !editMode && !diffMode) {
    const btn = document.createElement('button')
    btn.textContent = mdMode === 'rendered' ? t('btn.source') : t('btn.rendered')
    btn.onclick = () => { mdMode = mdMode === 'rendered' ? 'source' : 'rendered'; renderPreview(res) }
    actions.appendChild(btn)
  }
  if (isEditable(res)) {
    // 差分は「読んでいる時」だけの道具。入力モード中は出さない＝編集中バッファと外部変更の
    // 衝突は refreshPreview 側で慎重に扱っている領域で、そこに差分を持ち込まない。
    if (!editMode) {
      const changed = hasDiff(res)
      const btnDiff = document.createElement('button')
      // 押さなくても「何か変わった」と分かるように印を出す（ツリーの未読 ● と同じ作法）
      btnDiff.textContent = t('btn.diff') + (changed ? ' ●' : '')
      btnDiff.classList.toggle('changed', changed)
      if (diffMode) btnDiff.classList.add('toggled')
      btnDiff.title = diffMode ? t('tip.diffOff') : t('tip.diffOn')
      btnDiff.onclick = () => { diffMode = !diffMode; renderPreview(res) }
      actions.appendChild(btnDiff)
    }
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
  // ⚠ 入力モードの分岐を先に置く。順序を入れ替えると差分ビューが編集欄を押しのけ、
  //    書きかけの内容が画面から消える（入力中は差分を出さない、が仕様）
  if (editMode && isEditable(res)) { renderEditor(res); return }
  if (diffMode && isEditable(res)) {
    if (renderDiff(res)) return
    // 見るものが無い（レナードが編集を巻き戻した等）＝差分ビューに取り残さず本文へ戻す。
    // ⚠ 無言で戻すと「押したのに何も起きない」に見えるので、トーストで1回だけ知らせる。
    diffMode = false
    showToast(t('diff.none'), 2000)
    renderPreview(res) // ボタン列も差分ビュー前提で組んであるので組み直す（diffMode が false なので再帰しない）
    return
  }
  switch (res.kind) {
    case 'markdown':
      // ⚠ 図（renderMermaid）は最後。描画は非同期なので await せず投げっぱなしにする＝
      //    図が重くても本文は先に出る（描けなくてもその図がコードブロックに戻るだけ）
      if (mdMode === 'rendered') { body.innerHTML = `<div class="md-body">${res.html}</div>`; addCopyButtons(body); enhanceTables(body); renderMermaid(body) }
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
  // ⚠ ● が点いている＝まだ見ていないレナードの書き換えがある。このまま入力モードに入って
  //    保存すると saveEdit の setDiffBase が「見ていない変更」ごと基準を進め、二度と差分として
  //    見られなくなる。仕様（自分の保存は基準を進める）は変えず、入口で1回だけ訊く。
  if (hasDiff(currentFile) && !confirm(t('confirm.editWithDiff'))) return
  editMode = true
  editDirty = false
  diffMode = false // 差分ビューから入力モードに入ったら差分は閉じる（入力中は出さない）
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
  // 自分が入力モードで書いた変更は「自分がやった変更」＝基準を保存後の内容へ進める。
  // 混ざると「レナードがどこを直したか」を見たいという差分の目的が濁る（本田さん明示）
  setDiffBase(currentFile)
  refreshDirty() // 保存中に打ち続けていた場合は ● が残る
  updatePreviewTitle()
  const btn = $('#btn-save')
  if (btn) {
    btn.textContent = t('btn.saved')
    btn.classList.add('saved')
    setTimeout(() => { if ($('#btn-save') === btn) { btn.textContent = t('btn.save'); btn.classList.remove('saved') } }, 1600)
  }
}

// ---------- 差分（開いた時点 → 今） ----------
// レナードがファイルを書き換えると refreshPreview が黙って読み直す。読み直した後に
// 「どこが変わったのか」を、記事を頭から読み直さずに確かめるための機能。
// ⚠ 基準（ベースライン）は「開いた時点」で固定する。自動更新では動かさない＝
//    5回書き換えられても「開いた時 → 今」がまとめて1画面で見える（ここが機能の肝）。

// 変更行の前後に残す無変更行の数。「変更点だけ確認する」時に使う数字で、
// 3行あれば「どの段落の話か」は分かる。全文表示（下の DIFF_FULL_MAX_ROWS）では使わない。
const DIFF_CONTEXT = 3

// 全文表示で描く行数の上限。全文表示は無変更行を1行も畳まないので、行数がそのまま
// DOM の要素数になる（畳んでいる時は変更の周りしか作らないので効かない天井）。
// 20,000行 ＝ 日本語の記事なら桁違いに余裕があり、巨大なログやJSONを開いた時だけ当たる。
// 超えたら畳んだ側へ落として理由を出す（黙って固まるのが一番困る＝打ち切りと同じ考え方）。
const DIFF_FULL_MAX_ROWS = 20000

// LCS の計算量ガード。素朴なLCSは O(N×M)＝行数の積ぶんのセルを持つので、
// 全面書き換えのような入力でメモリと時間が一気に膨らむ（＝Deskが固まる）。
// 4,000,000セル ＝ Int32Array で約16MB・二重ループ400万回で、遅いPCでも
// 「一瞬待つ」で収まる上限として置いた。日本語Markdownの記事は数百〜2000行、
// しかも下の前後トリムで「本当に違う範囲」まで縮んでから測るので、通常運用では届かない。
// 超えたら計算せずに打ち切って「大きすぎる」と出す（黙って固まるのが一番困る）。
const DIFF_MAX_CELLS = 4000000

// 差分の基準は「ファイルごと」に持つ。
// ⚠ v0.10 までは基準を1つのスロットに持っていた（別ファイルを開いた瞬間に前のファイルの
//    基準が消え、戻ってきた時に「今」で取り直していた）。これが実測で踏んだ事故の正体:
//    「確認済み」を押す → ついでに別のファイルを覗く → その留守の間にレナードが書き換える →
//    戻ると基準が今に貼り直され、● も差分も出ない（留守中の書き換えが復元不能で消える）。
//    確認済みは「以後はここから見る」という宣言なので、別のファイルを見た程度で捨ててはいけない。
//    ＝基準はパス単位で保持し、離れて戻っても続きから見える形にする。
// ⚠ 際限なく溜めない。件数と合計文字数の両方で上限を置き、古い順に落とす（LRU）。
//    片方だけだと 4MB のファイルを20本掴んで太る／小さいファイルを何百本も溜める、のどちらかで破れる。
const DIFF_BASE_MAX = 20
const DIFF_BASE_MAX_CHARS = 4000000
const diffBases = new Map() // pathKey → 基準テキスト（Mapの挿入順＝古い順に並ぶ）
let diffMode = false  // 差分ビューを出しているか

// 基準は「アプリを閉じるまで」ではなく「次に開いた時も」効かないと意味がない。
// ⚠ v0.10 までは基準がメモリ上の Map だけだった＝Desk を閉じる／`Ctrl+R` でリロードする／
//    設定で言語を切り替える（location.reload が走る）だけで、追いかけていた基準が
//    **1つ残らず**消えていた。しかも消えたことは画面に出ない——次に開いた時に「今の内容」で
//    基準を取り直すので、● も差分も出ない完全に静かな状態に戻る（実測で確認）。
//    Desk は常駐して使う道具で、「夜に確認済みを押して閉じる → 留守の間に書き換えられる →
//    翌朝また開く」が一番よくある形なので、ユーザーは**クリックを1つも挟まずに**ここを踏む。
// ⚠ 置き場は localStorage。中身は「開いた時点のファイルの写し」なので、repo にも
//    config.json にも絶対に書き出さない（このPCのローカル領域だけに置く。タブの保存と
//    同じ線引きで、理由はもう一段強い＝あちらはパス、こちらは本文そのもの）。
// ⚠ メモリ側の上限（400万文字）をそのまま書こうとすると必ず溢れる。localStorage の枠は
//    概ね5〜10MB・しかもUTF-16勘定で、400万文字＝それだけで約8MB。永続化側は**別の小さい枠**を
//    持ち、入るぶんだけ新しい順に入れる。溢れても描画は止めない（下の try/catch）。
// ⚠ 既知の劣化（未修正・将来直す時の優先度メモ）: pathKey は大小文字を潰すので、同じフォルダに
//    同居する a.md と A.md は1つの基準を共有する＝嘘の差分を出す。永続化を入れる前は Desk を
//    閉じれば消えていたが、今は再起動をまたいで残る（逃げ道は「確認済み」だけ）。実害は今のところ
//    無い（claude-work 全体で衝突するペアは0件）ので直していないが、悪化はしている。
const DIFF_BASE_STORE_KEY = 'diffBases'
const DIFF_BASE_STORE_MAX_CHARS = 500000

// ⚠ 読み戻す前に保存させない。読む前に1本でも書き出すと、その時点の（ほぼ空の）中身で
//    保存データを上書きし、前回ぶんが復旧不能で消える。歯止めは呼び出し側ではなく
//    保存処理の中に置く（saveTabs の tabsLoaded と同じ作法・入口は今後も増える）。
let diffBasesLoaded = false

// ⚠ 詰めるのは**新しい順**（Mapの末尾から）。枠に入らない大物は飛ばして次を見る＝
//    4MB級の1本に枠を丸ごと持っていかれて、追いかけている記事が1本も残らない、を防ぐ。
// ⚠ 書き出しは try/catch で囲い、失敗したら本数を半分に落として繰り返す。localStorage の
//    実際の枠は環境で違う＝計算で当てにいかず「書いてみて、駄目なら縮める」。
//    どう転んでも例外を外に出さない（ここで throw すると差分の描画ごと止まる）。
function saveDiffBases() {
  if (!diffBasesLoaded) return
  const all = [...diffBases]
  const items = []
  let chars = 0
  for (let i = all.length - 1; i >= 0; i--) {
    const [k, v] = all[i]
    if (typeof k !== 'string' || !k || typeof v !== 'string') continue
    if (chars + v.length > DIFF_BASE_STORE_MAX_CHARS) continue
    chars += v.length
    items.push({ k, v })
  }
  items.reverse() // 保存は古い順＝読み戻した Map の並びが LRU の並びのまま復元される
  for (let n = items.length; n > 0; n = Math.floor(n / 2)) {
    try {
      localStorage[DIFF_BASE_STORE_KEY] = JSON.stringify({ v: 1, items: items.slice(items.length - n) })
      return
    } catch (err) { /* 枠に入らなかった＝次の周でもっと減らす */ }
  }
  // 1本も置けない（枠が埋まっている等）。古い保存値を残すと嘘の基準で差分を出すので消す。
  try { localStorage.removeItem(DIFF_BASE_STORE_KEY) } catch (err) { /* ここまで来たら諦める */ }
}

// ⚠ 壊れた／手で書き換えられた保存値を読んでも描画側を落とさない。型は1つずつ確かめる
//    （loadTabs と同じ作法）。ここで throw すると起動そのものが死ぬ＝Desk が開かなくなる。
// ⚠ 読んだ中身も diffNormalize を通す。保存値に CRLF が紛れていると ● が点きっぱなしになる
//    （差分本体は両側を正規化してから比べるので、● だけが嘘をつく形になる）。
function loadDiffBases() {
  diffBases.clear()
  let saved = null
  try { saved = JSON.parse(localStorage[DIFF_BASE_STORE_KEY] || 'null') } catch (err) { saved = null }
  const items = saved && Array.isArray(saved.items) ? saved.items : []
  for (const raw of items) {
    if (!raw || typeof raw.k !== 'string' || !raw.k || typeof raw.v !== 'string') continue
    diffBases.delete(raw.k) // 保存値に同じキーが2度出てきても、後の1本だけを新しい側に残す
    diffBases.set(raw.k, diffNormalize(raw.v))
  }
  trimDiffBases() // 上限を後から絞った時に、古い保存値がそのまま生き残らないように
  diffBasesLoaded = true // ここを通って初めて保存を許す（上の diffBasesLoaded のコメント参照）
}

// ⚠ 改行コードは揃えてから比べる。CRLF↔LF の違いだけで全行が「変わった」と出ると、
//    変更点だけ見るという目的が丸ごと壊れる（Windows側で編集したファイルで実際に踏む）
// ⚠ 末尾の空行（＝末尾改行と、その後ろの空白だけの行）も落としてから比べる。整形ツールや
//    エディタが末尾改行を足し引きしただけで ● が点き、開くと「文字が1つも無い赤い行」が
//    1本出る（'a\nb\n' → 'a\nb' が -1 になる）。日本語記事の運用で普通に踏むノイズ。
//    落とすのは末尾だけ＝本文中の空行の増減（段落を割った／繋いだ）は今までどおり差分に出る。
function diffNormalize(text) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n')
  // ⚠ 末尾を落とすのは正規表現でなく後ろからの走査でやる。`(\n[ \t]*)+$` は、途中に空行が
  //    延々と続くファイルでバックトラックが二乗に膨らむ（＝Deskが固まる。差分にサイズガードを
  //    置いたのと同じ理由で、入力の形で固まる経路は残さない）。ここは常に1回なめるだけ。
  let end = s.length
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]
    if (c === '\n') { end = i; continue }   // 改行の手前まで戻す
    if (c === ' ' || c === '\t') continue   // 空白だけの行も「空行」として飛ばす
    break                                   // 中身のある行に当たった＝ここまでは残す
  }
  return s.slice(0, end)
}

// 空ファイルは「空行が1行ある」ではなく「0行」として扱う。'' を split すると [''] になり、
// 空 → 内容あり が「空行の削除」から始まって読みにくくなる。
function diffLines(text) {
  const s = diffNormalize(text)
  return s === '' ? [] : s.split('\n')
}

// ⚠ editable でない res（画像・PDF・4MB超）が来ても、他のファイルの基準は消さない。
//    以前はここで丸ごと null にしていたので、非対象のファイルを1枚挟むだけで
//    追いかけていた基準が飛んだ。「記録しない」であって「捨てる」ではない。
function setDiffBase(res) {
  if (!isEditable(res)) return
  const key = pathKey(res.path)
  diffBases.delete(key) // 入れ直して並びの末尾（＝一番新しい）へ移す
  diffBases.set(key, diffNormalize(res.source))
  trimDiffBases()
  // ⚠ 基準の中身が動くのはここだけ＝保存もここに掛ける。touchDiffBase（並びだけ動かす）からは
  //    呼ばない。あれは openPreview のたびに走るので、ファイルを1枚開くたびに数十万文字の
  //    JSON.stringify が走ることになる。並びのズレは次に基準を取った時か終了時に直る。
  // ⚠ 終了時（beforeunload）の保存だけに頼らない。強制終了・WSLごと落ちる・電源断では
  //    beforeunload は走らないので、そこで基準が丸ごと消える。
  //    ただし localStorage のディスクへの書き出しは Chromium 側が数秒遅らせる。しかも下の
  //    saveDiffBases は1キーに全体を丸ごと上書きする＝未コミットのまま落ちると、失われるのは
  //    「直前の1本」ではなく**最後に書き出された時点より後に取った基準ぜんぶ**（実測: 0.5秒後の
  //    SIGKILL で消え、10秒後なら残る／直前の数秒で2枚開けば2本ともまとめて巻き戻る）。
  //    ここで呼んで守れるのは、最後にディスクへ乗った時点までの基準。
  saveDiffBases()
}

// 既に持っている基準を「最近見た」側（Mapの末尾）へ寄せる。
// ⚠ 動かすのは並びだけ。中身（基準テキスト）は絶対に書き換えない——ここで書き換えると、
//    今回直したバグ（開き直した瞬間に未確認の書き換えが消える）がそのまま戻る。
// ⚠ これが無いと退避順が「最後に見た順」ではなく「最初に基準を取った順」になり、
//    追いかけている本命ほど先に捨てられる（本命は据え置き判定で setDiffBase を通らないため、
//    何度開き直しても並びが動かない）。上限の向こう側で、しかも意図と逆の順序で
//    「基準を黙って失わない」が破れる＝この機能の存在理由そのものが壊れる。
function touchDiffBase(res) {
  const key = pathKey(res && res.path)
  if (!diffBases.has(key)) return
  const text = diffBases.get(key)
  diffBases.delete(key)
  diffBases.set(key, text)
}

// しばらく見ていないものから落として上限に収める。⚠ 最後の1本は必ず残す＝1本で文字数の
// 上限を超える巨大ファイルを開いた時に、入れた直後の基準を自分で捨てて「差分が一生出ない」にしない。
function trimDiffBases() {
  let chars = 0
  for (const text of diffBases.values()) chars += text.length
  while (diffBases.size > 1 && (diffBases.size > DIFF_BASE_MAX || chars > DIFF_BASE_MAX_CHARS)) {
    const oldest = diffBases.keys().next().value
    chars -= diffBases.get(oldest).length
    diffBases.delete(oldest)
  }
}

// そのファイルの基準（無ければ undefined）。'' を持つファイルと区別したいので null は返さない。
function diffBaseOf(res) {
  return isEditable(res) ? diffBases.get(pathKey(res.path)) : undefined
}

// 「そのパスの基準を既に持っている」＝取り直してはいけない。openPreview は同じファイルに
// 対して何度でも走る（再クリック・ダブルクリック・← で戻る・受領フィード）ので、その全部を
// 呼び出し側で見張るのは無理＝ここ1箇所で塞ぐ。
// ⚠ 別のファイルを見に行っても、そのファイルの基準は残る（上の LRU から溢れるまで）。
//    戻ってきた時に取り直すと、留守の間の書き換えが黙って消える（実測で踏んだ事故）。
function shouldKeepDiffBase(res) {
  return !!res && diffBases.has(pathKey(res.path))
}

// 今の版が基準から動いているか。文字列の比較1回で済む＝ポーリングのたびに差分を
// 組み直す必要はない（●を出すかどうかの判定だけならこれで足りる）。
// ⚠ ここは文章／コードのモードに関係なく「生の中身」で見る。文章モードの絞り込み
//    （frontmatter・コードブロック・画像・空行を落とす）を ● にまで効かせると、
//    frontmatter だけ書き換わった時に ● すら出ず、本田さんは書き換えられたことに
//    一生気づけない。● は「何か動いた」の合図、絞り込みは「開いた後の読みやすさ」の話。
function hasDiff(res) {
  const base = diffBaseOf(res)
  return base !== undefined && base !== diffNormalize(res.source)
}

// 行単位の LCS。依存パッケージを増やさない方針なので自前で持つ。
// 返り値は { kind: 'same'|'del'|'add', text } の並び。
function lcsOps(a, b) {
  const n = a.length
  const m = b.length
  // L[i][j] = a[i..] と b[j..] の最長共通部分列の長さ。(n+1)×(m+1) を1本の配列に畳んで持つ
  // （二次元配列だと行ごとのオブジェクトが増えてGCが効き、同じ計算量でも体感が落ちる）
  const w = m + 1
  const L = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = a[i] === b[j]
        ? L[(i + 1) * w + j + 1] + 1
        : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ kind: 'same', text: a[i] }); i++; j++ }
    // ⚠ 同点の時は削除を先に出す。追加を先に出すと箇所ごとに「赤→緑」「緑→赤」が
    //    入り混じり、「消えた行の下に書き直された行がある」という読み方が崩れる
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { ops.push({ kind: 'del', text: a[i] }); i++ }
    else { ops.push({ kind: 'add', text: b[j] }); j++ }
  }
  while (i < n) { ops.push({ kind: 'del', text: a[i] }); i++ }
  while (j < m) { ops.push({ kind: 'add', text: b[j] }); j++ }
  return ops
}

// 無変更行の連なりを前後 ctx 行だけ残して畳む。畳んだぶんは { kind:'gap', count } にする。
// ⚠ 隠す行が1行だけなら畳まない。「… 1行省略 …」の行で1行使う＝表示行数が減らないうえ、
//    読み手は隠された1行が何かを確かめられない（損しかしない畳み方）。
function collapseSame(ops, ctx) {
  const rows = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].kind !== 'same') { rows.push(ops[i]); i++; continue }
    let j = i
    while (j < ops.length && ops[j].kind === 'same') j++
    const run = ops.slice(i, j)
    // 先頭・末尾の無変更（＝変更の外側）は、変更に面していない側のコンテキストを残さない
    const keepBefore = i === 0 ? 0 : ctx
    const keepAfter = j === ops.length ? 0 : ctx
    const hidden = run.length - keepBefore - keepAfter
    if (hidden <= 1) {
      for (const op of run) rows.push(op)
    } else {
      for (let k = 0; k < keepBefore; k++) rows.push(run[k])
      rows.push({ kind: 'gap', count: hidden })
      for (let k = run.length - keepAfter; k < run.length; k++) rows.push(run[k])
    }
    i = j
  }
  return rows
}

// 基準 → 今 の差分を組む。
// context に Infinity を渡すと無変更行を1行も畳まない＝全文表示。
// 返り値: { ok: true, rows, added, removed, fellBack? } / { ok: false, reason: 'toobig' }
function buildDiff(oldText, newText, context) {
  const ctx = context == null ? DIFF_CONTEXT : context
  const a = diffLines(oldText)
  const b = diffLines(newText)

  // 先頭・末尾の一致部分は LCS に渡す前に落とす。記事の一部だけ直された時に、
  // 実際に比べる行数が「違う範囲」まで縮む＝サイズガードに当たらずに済む一番効く前処理。
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head &&
         a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  if (!midA.length && !midB.length) return { ok: true, rows: [], added: 0, removed: 0 }
  // ⚠ ガードは前後トリムの「後」で測る。ここが本当に計算するセル数で、
  //    先に測ると「1行だけ直した10万行のファイル」まで断ってしまう
  if ((midA.length + 1) * (midB.length + 1) > DIFF_MAX_CELLS) return { ok: false, reason: 'toobig' }

  const ops = []
  for (let i = 0; i < head; i++) ops.push({ kind: 'same', text: a[i] })
  for (const op of lcsOps(midA, midB)) ops.push(op)
  for (let i = a.length - tail; i < a.length; i++) ops.push({ kind: 'same', text: a[i] })

  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.kind === 'add') added++
    else if (op.kind === 'del') removed++
  }
  // 全文表示は畳まない。上から通して読んで、赤だけ拾えば「直す前」・緑だけ拾えば「直した後」が
  // 頭から終わりまで読める（＝どちらが良いかを読み比べて決めるための表示。変更箇所だけ出すと
  // 前後が切れて、その判断ができない）。
  // ⚠ 行数の天井だけは置く。畳まない＝行数がそのまま DOM の要素数になるので、巨大なファイルで
  //    青天井にすると描画で固まる。当たったら畳んだ側へ落とし、落としたことを呼び出し側に返す
  //    （黙って畳むと「全文と書いてあるのに全文ではない」＝表示そのものが信用されなくなる）。
  if (ctx === Infinity) {
    if (ops.length > DIFF_FULL_MAX_ROWS) {
      return { ok: true, rows: collapseSame(ops, DIFF_CONTEXT), added, removed, fellBack: true }
    }
    return { ok: true, rows: ops, added, removed }
  }
  return { ok: true, rows: collapseSame(ops, ctx), added, removed }
}

// ---------- 文章モード / コードモード ----------
// 読む用途（記事）とコードで、差分に出したいものが違う（本田さんの決定）。
//   文章モード: frontmatter・コードブロック・生HTML・画像リンク・空行を落として本文だけ見る
//   コードモード: 何も落とさない（従来どおり）
// 既定は拡張子で自動判定。差分画面の上のトグルでその場で行き来できる。

const DIFF_PROSE_EXT = ['.md', '.markdown', '.txt']

// 手動トグルはファイル単位で覚える（別のファイルに移ったら、そのファイルの拡張子で
// 自動判定に戻る）。全体に効かせると、記事で文章モードにした設定がコードにも付いて回る。
let diffProseKey = null      // 手動で切り替えたファイル（pathKey）
let diffProseChoice = null   // 'prose' | 'code'

function diffViewMode(res) {
  if (res && diffProseChoice && diffProseKey === pathKey(res.path)) return diffProseChoice
  const p = String((res && res.path) || '').toLowerCase()
  return DIFF_PROSE_EXT.some((ext) => p.endsWith(ext)) ? 'prose' : 'code'
}

// ---------- 全文 / 変更箇所 ----------
// 差分に「どこまで出すか」の切り替え（本田さんの決定）。
//   全文     : 無変更行も全部出す。上から通して読み、赤だけ拾えば直す前・緑だけ拾えば直した後が
//              読める＝直した方が良くなったかを読み比べて判断するための表示
//   変更箇所 : 変更の前後 DIFF_CONTEXT 行だけ（従来）。何を触ったかを素早く確かめる表示
// 既定は文章モードなら全文、コードモードなら変更箇所。記事は通して読むもの・ソースは
// 頭から全部出しても読まない、という使い方の違いをそのまま既定にしている。
// ⚠ 手動の選択はファイル単位で覚える（diffProseChoice と同じ理由＝全体に効かせると、
//    記事で全文にした設定がコードのファイルにも付いて回る）。
let diffRangeKey = null      // 手動で切り替えたファイル（pathKey）
let diffRangeChoice = null   // 'full' | 'changed'

function diffRange(res) {
  if (res && diffRangeChoice && diffRangeKey === pathKey(res.path)) return diffRangeChoice
  return diffViewMode(res) === 'prose' ? 'full' : 'changed'
}

// 画像リンクと生HTMLタグ。
// ⚠ タグは「< の次が英字か / ! ?」だけを見る。`<[^>]*>` で刈ると、本文の「a < b > c」
//    のような比較記号まで飲み込んで日本語の本文が黙って消える。
const DIFF_IMG_RE = /!\[[^\]]*\]\([^)]*\)/g
const DIFF_TAG_RE = /<!--[\s\S]*?-->|<[!/?]?[a-zA-Z][^<>]*>/g
// コードブロックのフェンス（``` か ~~~ が3つ以上）。
// ⚠ 関数の中に置かない。test-diff.js の grabFn は正規表現リテラルの中の { } とバッククォートを
//    見分けられないので、この定数を splitProse の中に書いた瞬間にテストが関数を切り出せなくなる。
const DIFF_FENCE_RE = /^\s*(`{3,}|~{3,})/

// 文章モード用に「本文」と「本文以外」へ割る。
// ⚠ 割った2つで元の中身を覆う（落とした側にも変更があれば、件数として知らせるため）。
//    唯一の例外が空行で、こちらは両方に入れない＝空行の増減は文章モードでは無かったことにする
//    （段落の割り方が変わっただけで「本文以外に変更があります」と出ると、その表示自体が
//      信用されなくなる。空行を見たい時はコードモードに切り替えれば従来どおり出る）。
function splitProse(text) {
  const src = diffLines(text) // 改行コードと末尾の空行はここで既に揃っている
  const body = []
  const other = []
  let i = 0
  // 1) frontmatter: 先頭行が --- で、次の --- までを丸ごと落とす（閉じが無ければ本文扱い）
  if (src[0] === '---') {
    let j = 1
    while (j < src.length && src[j] !== '---') j++
    if (j < src.length) { for (let k = 0; k <= j; k++) other.push(src[k]); i = j + 1 }
  }
  // 2) コードブロック（``` / ~~~ のフェンス）は中身ごと落とす
  let fence = null
  for (; i < src.length; i++) {
    const line = src[i]
    const m = line.match(DIFF_FENCE_RE)
    if (fence) {
      other.push(line)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
      continue
    }
    if (m) { fence = m[1]; other.push(line); continue }
    // 3) 画像リンクと生HTMLタグを抜く。抜いた後に文字が残れば、それが本文。
    const picked = []
    const rest = line
      .replace(DIFF_IMG_RE, (s) => { picked.push(s); return '' })
      .replace(DIFF_TAG_RE, (s) => { picked.push(s); return '' })
    if (rest.trim() === '') {
      // 空行（4）は捨てる。画像だけ・タグだけの行は「本文以外」として残す
      if (line.trim() !== '') other.push(line)
      continue
    }
    body.push(rest)
    if (picked.length) other.push(picked.join(''))
  }
  return { body: body.join('\n'), other: other.join('\n') }
}

// 「確認済み」＝ここまでは見た。基準を今の内容に進めて通常プレビューへ戻す。
// 以後は「確認済みを押した時点 → 今」の差分になる。
// ⚠ 進める相手は「今その差分ビューに出しているファイル」＝renderDiff が受け取った res。
//    グローバルの currentFile を直に見ると、それが editable でない版に入れ替わっていた時に
//    基準を丸ごと捨ててしまう（= 以後 ● も差分も出ない）経路が残る。
function ackDiff(res) {
  const f = res || currentFile
  setDiffBase(f)
  diffMode = false
  renderPreview(f)
}

// 差分ビューを描く。描いたら true、見るものが無くて描かなかったら false を返す
// （false の時に本文へ戻すのは呼び出し側＝renderPreview の仕事。ここで renderPreview を
//   呼び返すと、描画の入口が2つになって追えなくなる）。
function renderDiff(res) {
  const body = $('#preview-body')
  // 基準が無い（まだ一度も記録していない等）ときは自分自身と比べる＝「変更なし」扱い。
  // ここで落ちると差分ボタンが無反応に見えるので、必ず判断してから返す。
  const stored = diffBaseOf(res)
  const base = stored === undefined ? res.source : stored
  const mode = diffViewMode(res)
  const range = diffRange(res)
  const ctx = range === 'full' ? Infinity : DIFF_CONTEXT

  let d
  let otherNote = '' // 文章モードで落とした範囲に変更があった時の告知（無言で消さないための一行）
  // ⚠ 全文表示では文章モードの絞り込みを掛けない＝ファイルそのものを全部出す。
  //    splitProse は frontmatter・コードブロック・画像リンク・行内の生HTMLタグ・空行を落とすので、
  //    これを通したまま「全文」と名乗ると、緑だけ拾って読んでも「直した後」の全文にならない
  //    （落とした側は、変わっていなければ告知すら出ない＝画面に痕跡が残らない）。
  //    絞り込みは「変更箇所だけを素早く確かめる」ための道具なので、変更箇所モードにだけ効かせる。
  if (mode === 'prose' && range !== 'full') {
    const a = splitProse(base)
    const b = splitProse(res.source)
    d = buildDiff(a.body, b.body, ctx)
    // ⚠ 落とした側は「変わったかどうか」を先に文字列比較で見る。いきなり buildDiff に
    //    渡すと、巨大なコードブロックで打ち切られた時に「変わったのかどうか」すら言えない。
    if (a.other !== b.other) {
      const od = buildDiff(a.other, b.other)
      otherNote = od.ok
        ? t('diff.otherChanges', { n: od.added + od.removed })
        : t('diff.otherChangesSome') // 件数は数えられなかったが「ある」ことは言う
    } else if (a.body === b.body && diffNormalize(base) !== diffNormalize(res.source)) {
      // ⚠ 本文にも本文以外にも差が無いのに生では違う＝落ちたのは空行だけ（本文と本文以外で
      //    空行以外は覆っているため）。ここを黙って畳むと、● が点いているのに開くと
      //    「変更はありません」に飛ばされる＝一番「壊れた?」に見える経路になる。
      otherNote = t('diff.blankOnly')
    }
  } else {
    d = buildDiff(base, res.source, ctx)
  }
  // 変更が無い＝「変更はありません」の画面に取り残さない。差分表示中にレナードが編集を
  // 巻き戻すとここに来る（本文に戻るのにもう一度ボタンを押させるのは「壊れた?」に見える）。
  // ⚠ 本文に変更が無くても、落とした範囲に変更があるなら畳まない。畳むと
  //    「● が点いていたのに開いたら何も無い」＝壊れたようにしか見えない。
  // ⚠ 判定は行数ではなく add/del の件数で見る。全文表示は無変更行も行として持つので、
  //    rows.length で見ると「変更が無いのに全文が出て、本文へ戻れない」に化ける。
  if (d.ok && !d.added && !d.removed && !otherNote) return false

  let stat = ''
  let inner
  if (!d.ok) {
    // ⚠ ここから抜ける唯一の道は「確認済み」で基準を今に進めること。だから打ち切った時も
    //    差分ビューは畳まず、確認済みボタンを出したまま理由を出す。
    // ⚠ 全文表示は絞り込みを掛けない＝文章モードのファイルでは、変更箇所に切り替えると
    //    通ることがある（コードブロックの全書き換えなどは絞り込みで比べる範囲が縮む）。
    //    ここを案内しないと、画面に出ている脱出路が「確認済み」しか見えず、
    //    押した人は基準を今に進めてしまう＝読まないまま変更内容を失う
    const hint = (range === 'full' && mode === 'prose')
      ? `<div class="diff-note-sub">${escapeHtml(t('diff.toobigTryChanged'))}</div>`
      : ''
    inner = `<div class="diff-note">${escapeHtml(t('diff.toobig'))}${hint}</div>`
  } else {
    stat = t('diff.stat', { add: d.added, del: d.removed })
    const parts = []
    for (const row of d.rows) {
      if (row.kind === 'gap') {
        parts.push(`<div class="dline gap">${escapeHtml(t('diff.gap', { n: row.count }))}</div>`)
        continue
      }
      const sign = row.kind === 'add' ? '+' : (row.kind === 'del' ? '−' : ' ')
      // 空行の増減は「赤／緑の無地の帯が1本出る」だけになり、何が起きたのか読めない。
      // 文字を置いて「空行が消えた／増えた」と分かる形にする（本文中の空行は意味のある変更）
      // ⚠ プレースホルダを置くのは増減した空行だけ。無変更の空行に置くと、全文表示で
      //    段落の切れ目のたびに「（空行）」が並び、記事として読めなくなる（無変更の空行は
      //    そのまま空けておくのが正しい＝段落の区切りとして働く）
      const blank = row.text === '' && row.kind !== 'same'
      const text = blank ? t('diff.blank') : row.text
      // ⚠ ファイル本文は必ず escapeHtml を通す。素通しにすると Markdown 中のHTMLが
      //    そのまま描画され、差分の見た目が崩れる（＋任意のタグを差し込める経路になる）
      parts.push(`<div class="dline ${row.kind}${blank ? ' blank' : ''}"><span class="dsign">${sign}</span><span class="dtext">${escapeHtml(text)}</span></div>`)
    }
    inner = parts.join('')
    // 落とした範囲にしか変更が無い時に、本文側が空のままだと「押したのに真っ白」になる
    if (!parts.length) inner = `<div class="diff-note">${escapeHtml(t('diff.proseNone'))}</div>`
  }

  // ⚠ 本文側にも「今どの出し方で見ているか」をクラスで残す。全文表示は無変更行が主役に
  //    なる（読み物として通して読む）ので、無変更行を薄いままにすると本文が読めない＝
  //    色の当て方が変わる。CSS 側で .diff-body.full / .prose を見ている。
  const bodyClass = `diff-body ${range === 'full' ? 'full' : 'changed'} ${mode === 'prose' ? 'prose' : 'code'}`
  body.innerHTML = `<div class="diffwrap">
      <div class="diff-head">
        <span class="diff-stat">${escapeHtml(stat)}</span>
        <span class="diff-head-btns">
          <button class="diff-range"></button>
          ${range === 'full' ? '' : '<button class="diff-viewmode"></button>'}
          <button class="diff-ack"></button>
        </span>
      </div>
      ${otherNote ? `<div class="diff-other">${escapeHtml(otherNote)}</div>` : ''}
      ${d.fellBack ? `<div class="diff-other">${escapeHtml(t('diff.fullFellBack'))}</div>` : ''}
      <div class="${bodyClass}">${inner}</div>
    </div>`
  // ⚠ ボタンの文言と title は属性に埋め込まず、要素に対して入れる。escapeHtml は
  //    引用符を潰さないので、翻訳に " が混ざった言語を足した瞬間に属性が壊れる
  const ack = body.querySelector('.diff-ack')
  ack.textContent = t('btn.diffAck')
  ack.title = t('tip.diffAck')
  ack.addEventListener('click', () => ackDiff(res))
  // 文章 ⇄ コードのトグル。今どちらで見ているかをボタン自身に出す（押す前に分かる）
  // ⚠ 全文表示のときは出さない。全文はファイルをそのまま出す＝絞り込みが効かないので、
  //    置いても何も起きないボタンになる（押しても変わらないボタンは「壊れている」に見える）
  const vm = body.querySelector('.diff-viewmode')
  if (vm) {
    // ⚠ キーは呼び出しの直後に文字列を置く形で書く。check-i18n.js は t( の直後の文字列しか
    //    拾えないので、条件式でキーを選ぶ書き方にすると「使われていないキー」に見えて
    //    未翻訳検知が空振りする（ここで検知の網から漏れると、翻訳漏れが画面まで出る）
    vm.textContent = mode === 'prose' ? t('btn.diffProse') : t('btn.diffCode')
    vm.title = mode === 'prose' ? t('tip.diffProse') : t('tip.diffCode')
    vm.classList.toggle('prose', mode === 'prose')
    vm.addEventListener('click', () => {
      diffProseKey = pathKey(res.path)
      diffProseChoice = mode === 'prose' ? 'code' : 'prose'
      renderPreview(res)
    })
  }
  // 全文 ⇄ 変更箇所のトグル。文言の作法は上のトグルと同じ（今どちらで見ているかを出す・
  // キーは t( の直後に文字列を置く＝未翻訳検知が空振りしないように）
  const rg = body.querySelector('.diff-range')
  rg.textContent = range === 'full' ? t('btn.diffFull') : t('btn.diffChanged')
  rg.title = range === 'full' ? t('tip.diffFull') : t('tip.diffChanged', { n: DIFF_CONTEXT })
  rg.classList.toggle('full', range === 'full')
  rg.addEventListener('click', () => {
    diffRangeKey = pathKey(res.path)
    diffRangeChoice = range === 'full' ? 'changed' : 'full'
    renderPreview(res)
  })
  return true
}

// レンダリング表示のコードブロックにホバーで出る「コピー」ボタンを付ける
// ⚠ pre.mermaid は中身が図（SVG）に差し替わるので、ここでは付けない。付けても
//    描画時に丸ごと消えるうえ、コピーされるのは図の文字だけになって意味がない。
//    描けなかった図には mermaidFallback() が同じボタンを付け直す（ソースはコピーできる）。
function addCopyButtons(scope) {
  for (const pre of scope.querySelectorAll('.md-body pre:not(.mermaid)')) addCopyButton(pre)
}

function addCopyButton(pre) {
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

// ---------- Mermaid（```mermaid の図） ----------
//
// main 側（wikilink.js）は ```mermaid を <pre class="mermaid">生ソース</pre> にして渡すだけで、
// 図にするのはここ。プレビューは innerHTML の差し替えで組み直すので startOnLoad は使わず、
// 差し替えるたびに自分で描く（startOnLoad は最初の1回しか走らない＝2枚目以降が出なくなる）。
//
// 壊れ方の線引き: 図が描けないのは「そのブロックだけの事故」で、プレビュー全体を巻き添えに
// しない。描けなかった図は消さずに元のコードブロックへ戻す（直すにはソースが要る）。
let mermaidReady = null // null=未初期化 / true=使える / false=使えない（同梱物が読めていない）
let mermaidSeq = 0      // SVG の id。ページ内で重複すると別の図を上書きする
let mermaidGen = 0      // 世代。描いている途中に別のファイルを開かれたら、その回のぶんは捨てる

// 配色が暗いか（--bg の明るさで見る）。読めない書式は「暗い」に倒す＝既定の配色が暗いため
function isDarkColor(color) {
  let r, g, b
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(String(color).trim())
  if (hex) {
    const h = hex[1].length < 6 ? hex[1][0] + hex[1][0] + hex[1][1] + hex[1][1] + hex[1][2] + hex[1][2] : hex[1]
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  } else {
    const nums = String(color).match(/[\d.]+/g)
    if (!nums || nums.length < 3) return true
    r = +nums[0]; g = +nums[1]; b = +nums[2]
  }
  if ([r, g, b].some(n => !isFinite(n))) return true
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128
}

// 図の配色を画面の配色に合わせる。このアプリにテーマ切替は無く :root の1枚だけなので、
// 切替イベントを待つのではなく **その :root の実際の値** から dark / default を選ぶ。
// ⚠ フォントだけは CSS変数の文字列（var(--font-ui)）をそのまま渡す。SVG は文書の中に置かれる＝
//    変数が効くので、設定でフォントを変えた時に描き直さなくても図の文字が追随する。
function initMermaid() {
  if (mermaidReady !== null) return mermaidReady
  if (!window.mermaid) { mermaidReady = false; return false }
  try {
    const css = getComputedStyle(document.documentElement)
    const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback)
    const bg = v('--bg', '#1e2227')
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict', // 図のソースからスクリプトを実行させない（ワークスペースの md は外から来る）
      theme: isDarkColor(bg) ? 'dark' : 'default',
      themeVariables: {
        background: bg,
        primaryColor: v('--bg-panel', '#262b33'),
        primaryTextColor: v('--fg', '#d5dae2'),
        primaryBorderColor: v('--accent', '#4da3ff'),
        secondaryColor: v('--bg-side', '#23272e'),
        lineColor: v('--muted', '#8a93a2'),
        textColor: v('--fg', '#d5dae2'),
        fontFamily: 'var(--font-ui)',
      },
    })
    mermaidReady = true
  } catch (e) {
    mermaidReady = false
  }
  return mermaidReady
}

// 描けなかった図は元のコードブロックとして出す（消さない＝直すためにソースが要る）
function mermaidFallback(pre, src) {
  const text = src != null ? src : pre.textContent
  pre.classList.remove('mermaid', 'pending')
  pre.classList.add('mermaid-failed')
  pre.textContent = ''
  const code = document.createElement('code')
  code.textContent = text
  pre.appendChild(code)
  addCopyButton(pre)
}

async function renderMermaid(scope) {
  const nodes = [...scope.querySelectorAll('.md-body pre.mermaid')]
  if (!nodes.length) return
  const gen = ++mermaidGen
  // 描き上がるまで生のソースを見せない。⚠ 隠すのは CSS ではなく **ここで付けるクラス**で行う
  //    ＝この関数が走らなかった時（例外・呼び忘れ）に、図が丸ごと不可視のまま残るのを防ぐ
  for (const pre of nodes) pre.classList.add('pending')
  if (!initMermaid()) { for (const pre of nodes) mermaidFallback(pre); return }
  for (const pre of nodes) {
    const src = pre.textContent
    const id = `mermaid-svg-${++mermaidSeq}`
    try {
      const out = await window.mermaid.render(id, src)
      if (gen !== mermaidGen || !pre.isConnected) return // 別のファイルに移った＝この回のぶんは捨てる
      pre.innerHTML = out.svg
      pre.classList.remove('pending')
      pre.classList.add('done')
      if (typeof out.bindFunctions === 'function') out.bindFunctions(pre)
    } catch (e) {
      if (gen !== mermaidGen || !pre.isConnected) return
      mermaidFallback(pre, src)
    } finally {
      // mermaid は採寸用の一時要素を <body> 直下に作る。成功時は自分で片付けるが
      // 失敗時は残ることがある＝開くたびに増えていくので必ず消す
      const tmp = document.getElementById('d' + id)
      if (tmp) tmp.remove()
    }
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
    // ⚠ フォルダをタブにしたくなる瞬間は、たいていツリーでそのフォルダを見ている時。
    //    ここに入口が無かったのが「タブの増やし方が分からない」の最大の原因（本田さん実機指摘）。
    //    先頭に置くのは、フォルダ行では「開く」より Desk の中での行き先変更が主役だから。
    ...(en.isDir ? [[t('ctx.openInTab'), () => addTab(en.path)]] : []),
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
    // 見出し（🌿レーン 等）と区切り線。押しても何も起きない飾りなので、クリックを
    // 外へ通さない＝見出しを踏んだだけでメニューが閉じない（無効項目と同じ扱い）
    if (opt && (opt.head || opt.sep)) {
      const deco = document.createElement('div')
      deco.className = opt.sep ? 'ctxsep' : 'ctxhead'
      if (!opt.sep) deco.textContent = labelText
      deco.addEventListener('click', (ev) => ev.stopPropagation())
      m.appendChild(deco)
      continue
    }
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

// _inbox 受領フィードの高さ。上端のスプリッターを縦ドラッグで変える（横のと同じ流儀）。
function setupInboxSplitter() {
  const inbox = $('#inbox')
  const splitter = $('#inbox-splitter')
  // 復元にもクランプを掛ける。大画面で高く保存→小さい窓で起動、のときに
  // ツリー（flex:1・最小0）が潰れた状態で立ち上がるのを防ぐ（QA指摘）。
  const saved = parseInt(localStorage.inboxHeight, 10)
  if (saved) {
    const maxH = Math.max(60, $('#sidebar').getBoundingClientRect().height - 160)
    inbox.style.height = Math.min(maxH, Math.max(60, saved)) + 'px'
  }
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault()
    splitter.classList.add('dragging')
    document.body.classList.add('resizing', 'row')
    // ドラッグ中の基準は「掴んだ瞬間の下端」に固定する。毎moveで測り直すと
    // 自分の高さ変更で下端がわずかに動き、カーソルと境界がズレていく。
    const bottom = inbox.getBoundingClientRect().bottom
    // 上限はツリーを最低限残す位置まで（サイドバー全体 − ヘッダやツリー数行ぶん）
    const maxH = Math.max(60, $('#sidebar').getBoundingClientRect().height - 160)
    const onMove = (ev) => {
      const h = Math.min(maxH, Math.max(60, bottom - ev.clientY))
      inbox.style.height = h + 'px'
    }
    const onUp = () => {
      splitter.classList.remove('dragging')
      document.body.classList.remove('resizing', 'row')
      localStorage.inboxHeight = inbox.style.height
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
  showToast(pct + '%')
}

// 右上に一瞬出す通知。ズーム倍率の表示に使っていた仕掛けを、文字を出すだけの汎用に広げた
// （要素は使い回す＝同時に2つ出す用途は無い。後から出したものが前のを上書きする）
function showToast(msg, ms) {
  const toast = $('#zoom-toast')
  toast.textContent = msg
  toast.classList.add('show')
  clearTimeout(zoomToastTimer)
  zoomToastTimer = setTimeout(() => toast.classList.remove('show'), ms || 900)
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
  setupInboxSplitter()
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
    // タブ切替。ズームは Ctrl+0 / Ctrl+± なので 1〜9 とはぶつからない（既存の分岐と共存する）。
    // 文字入力中でも譲らない＝ブラウザのタブ切替と同じ感覚で押せる（名前変更中の入力欄だけは
    // 自分で stopPropagation してここに届かないようにしてある）。
    if (mod && e.key === 'Tab') { e.preventDefault(); stepTab(e.shiftKey ? -1 : 1) }
    if (mod && !e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= tabs.length) {
      e.preventDefault()
      activateTab(Number(e.key) - 1)
    }
  })
  window.addEventListener('click', () => { hideCtxMenu(); hidePathHist() })
  // 入力モードで未保存のまま閉じるのを止める
  window.addEventListener('beforeunload', (e) => {
    // ⚠ 閉じる直前にタブの「続きから」を書き出す。切替やナビの時にしか保存しないと、
    //    最後に見ていたタブの展開・選択・スクロールだけが毎回失われる
    captureTab()
    saveTabs()
    // ⚠ 差分の基準も書き出す。中身は setDiffBase の時点で保存済みなので、ここで拾うのは
    //    「最後にどれを見ていたか」の並び（touchDiffBase ぶん）＝次に開いた時の退避順が
    //    実際の使用順とズレないようにする。
    saveDiffBases()
    if (editMode && editDirty) { e.preventDefault(); e.returnValue = '' }
  })
}
