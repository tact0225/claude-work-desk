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

init()

// ---------- 多言語（i18n.js の辞書を画面に流し込む） ----------

const t = (key, vars) => I18N.t(key, vars)

// data-i18n=本文 / data-i18n-html=HTMLを含む本文 / data-i18n-title=ツールチップ / data-i18n-ph=プレースホルダ
function applyI18n(scope = document) {
  for (const el of scope.querySelectorAll('[data-i18n]')) {
    if (el.dataset.i18nHtml !== undefined) el.innerHTML = t(el.dataset.i18n)
    else el.textContent = t(el.dataset.i18n)
  }
  for (const el of scope.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle)
  for (const el of scope.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh)
  document.documentElement.lang = I18N.getLang()
}

async function init() {
  CONFIG = await api.getConfig()
  I18N.setLang(CONFIG.lang)
  I18N.checkMissing((m) => console.warn(m)) // 腐り検知: 翻訳漏れは起動ログに出す
  applyI18n()
  applyFonts()
  setupDrop()
  setupGlobal()
  setupPathBar()
  if (!CONFIG.rootOk) { showRootPicker(); return }
  await setBrowseRoot(await startingRoot())
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
  if (!CONFIG.rootOk) { showRootPicker(); return }
  localStorage.removeItem('browseRoot')
  await setBrowseRoot(CONFIG.root)
}

// ---------- パス欄（アドレスバー） ----------

function baseName(p) {
  const s = String(p).replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || s
}

function samePath(a, b) {
  const n = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
  return n(a) === n(b)
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
  $('#root-name').title = away ? t('tip.awayRoot', { path: dir, inbox: CONFIG.inbox }) : dir
  $('#root-name').classList.toggle('away', away)
  $('#inbox-header').title = t('tip.inboxTarget', { inbox: CONFIG.inbox })
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

function togglePathHist() {
  const box = $('#path-hist')
  if (box.classList.contains('show')) { hidePathHist(); return }
  const list = pathHistory()
  box.innerHTML = ''
  if (!list.length) {
    box.innerHTML = `<div class="hist-empty">${escapeHtml(t('hist.empty'))}</div>`
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
  const tree = $('#tree')
  tree.innerHTML = `<div class="loading">${escapeHtml(t('loading'))}</div>`
  const box = document.createElement('div')
  await loadChildren(browseRoot || CONFIG.root, box, 0)
  tree.innerHTML = ''
  tree.appendChild(box)
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

  row.append(arrow, icon, label)
  wrap.appendChild(row)

  let childBox = null
  let loaded = false
  let open = false

  async function toggleDir(forceOpen) {
    if (!childBox) { childBox = document.createElement('div'); wrap.appendChild(childBox) }
    open = forceOpen === undefined ? !open : forceOpen
    arrow.textContent = open ? '▾' : '▸'
    icon.textContent = open ? '📂' : '📁'
    childBox.style.display = open ? '' : 'none'
    if (open) openDirs.add(en.path); else openDirs.delete(en.path)
    if (open && !loaded) {
      childBox.innerHTML = '<div class="loading">…</div>'
      await loadChildren(en.path, childBox, depth + 1)
      loaded = true
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
  renderPreview(res)
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
  $('#preview-title').textContent = `${mark}${f.name}  (${fmtSize(f.size)})`
  $('#preview-title').classList.toggle('editing', editMode)
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
  const wasDirty = editDirty
  editMode = false
  editDirty = false
  editorEl = null
  if (wasDirty && currentFile) {
    try { currentFile = await api.readFile(currentFile.path) } catch (e) { /* 消えていたら現状のまま */ }
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
    const results = await api.dropFiles(paths)
    for (const r of results) addFeedEntry(r)
  })
}

// 受領確認灯: 1分表示して自動で消える（記録は userData/drop-log.json に残る）
const FEED_TTL_MS = 60 * 1000

function addFeedEntry(r) {
  const feed = $('#inbox-feed')
  const el = document.createElement('div')
  el.className = 'feed-entry fresh' + (r.ok ? '' : ' failed')
  const t = new Date(r.ts)
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  const dateStr = `${t.getMonth() + 1}/${t.getDate()} ${hh}:${mm}`
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

function showCtxMenu(e, en) {
  showMenu(e, [
    [t('ctx.open'), () => api.openPath(en.path)],
    [t('ctx.explorer'), () => api.showInFolder(en.path)],
    [t('ctx.copyWin'), () => navigator.clipboard.writeText(en.path)],
    [t('ctx.copyWsl'), () => navigator.clipboard.writeText(toWslPath(en.path))],
  ])
}

function showMenu(e, items) {
  e.preventDefault()
  const m = $('#ctxmenu')
  m.innerHTML = ''
  for (const [labelText, fn] of items) {
    const it = document.createElement('div')
    it.className = 'ctxitem'
    it.textContent = labelText
    it.addEventListener('click', () => { hideCtxMenu(); fn() })
    m.appendChild(it)
  }
  m.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px'
  m.style.top = Math.min(e.clientY, window.innerHeight - 140) + 'px'
  m.classList.add('show')
}

function hideCtxMenu() { $('#ctxmenu').classList.remove('show') }

// WSL UNCパス → /home/... 形式（Claude Codeのチャットに貼る用）
function toWslPath(p) {
  const m = p.replace(/\\/g, '/').match(/^\/\/wsl(\.localhost|\$)\/[^/]+(\/.*)$/)
  return m ? m[2] : p
}

// ---------- グローバル ----------

async function pasteToInbox() {
  const results = await api.pasteClipboard()
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
    if (!e.ctrlKey) return
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
  const t = $('#zoom-toast')
  t.textContent = pct + '%'
  t.classList.add('show')
  clearTimeout(zoomToastTimer)
  zoomToastTimer = setTimeout(() => t.classList.remove('show'), 900)
}

// ---------- フォント設定（localStorage優先、config.jsonが下地） ----------

const FALLBACK_UI = '"Segoe UI", "Yu Gothic UI", Meiryo, sans-serif'
const FALLBACK_MONO = 'Consolas, "Cascadia Mono", "BIZ UDGothic", monospace'

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

function isTypingTarget(t) {
  return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
}

function setupGlobal() {
  $('#btn-refresh').addEventListener('click', loadTreeRoot)
  $('#btn-paste').addEventListener('click', pasteToInbox)
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
    if (e.ctrlKey && (e.key === '+' || e.key === '=' || e.key === ';')) { e.preventDefault(); changeZoom(0.1) }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); changeZoom(-0.1) }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); changeZoom(0) }
  })
  window.addEventListener('click', () => { hideCtxMenu(); hidePathHist() })
  // 入力モードで未保存のまま閉じるのを止める
  window.addEventListener('beforeunload', (e) => {
    if (editMode && editDirty) { e.preventDefault(); e.returnValue = '' }
  })
}
