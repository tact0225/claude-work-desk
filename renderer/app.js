const $ = (s) => document.querySelector(s)

let CONFIG = null
let selectedRow = null
let currentFile = null
let mdMode = 'rendered' // 'rendered' | 'source'
let internalDragPath = null // ツリーからの持ち出し中は自ウィンドウへのドロップを無視する
let navHistory = [] // wikilink を辿った履歴（戻る用）
const openDirs = new Set() // F5リロード後に展開状態を復元する

init()

async function init() {
  CONFIG = await api.getConfig()
  applyFonts()
  setupDrop()
  setupGlobal()
  if (!CONFIG.rootOk) { showRootPicker(); return }
  $('#root-name').textContent = CONFIG.rootName
  $('#root-name').title = CONFIG.root
  await loadTreeRoot()
}

// ルート変更（初回設定・設定パネルからの変更 共通）
async function reloadRoot() {
  CONFIG = await api.getConfig()
  if (!CONFIG.rootOk) { showRootPicker(); return }
  $('#root-name').textContent = CONFIG.rootName
  $('#root-name').title = CONFIG.root
  openDirs.clear()
  await loadTreeRoot()
}

function showRootPicker() {
  const isUnset = !CONFIG.root
  $('#preview-body').innerHTML = `
    <div class="welcome ${isUnset ? '' : 'error'}">
      <h2>${isUnset ? 'ようこそ。まずワークスペースフォルダを選んでください' : 'ワークスペースにアクセスできません'}</h2>
      ${isUnset ? '' : `<p>パス: <code>${escapeHtml(CONFIG.root)}</code>（WSL停止中や名前変更の可能性）</p>`}
      <p>Claude Code で使っているフォルダを指定します。WSL内のフォルダは<br>
      ダイアログ左側の「Linux」から辿るか、パス欄に <code>\\\\wsl.localhost\\...</code> を貼り付けてください。</p>
      <p><button id="btn-choose-root" class="big-btn">📁 フォルダを選ぶ…</button></p>
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
  tree.innerHTML = '<div class="loading">読み込み中…</div>'
  const box = document.createElement('div')
  await loadChildren(CONFIG.root, box, 0)
  tree.innerHTML = ''
  tree.appendChild(box)
}

async function loadChildren(dirPath, container, depth) {
  let entries
  try { entries = await api.readDir(dirPath) } catch (e) {
    container.innerHTML = `<div class="loading">読めません: ${escapeHtml(e.message)}</div>`
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

  row.addEventListener('click', () => {
    if (en.isDir) { toggleDir() } else { selectRow(row); openPreview(en.path) }
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
  const body = $('#preview-body')
  body.innerHTML = '<div class="loading">読み込み中…</div>'
  let res
  try { res = await api.readFile(p) } catch (e) {
    body.innerHTML = `<div class="welcome error"><p>読めません: ${escapeHtml(e.message)}</p></div>`
    return
  }
  currentFile = res
  renderPreview(res)
}

function goBack() {
  const prev = navHistory.pop()
  if (prev) openPreview(prev)
}

function renderPreview(res) {
  $('#preview-title').textContent = `${res.name}  (${fmtSize(res.size)})`
  const actions = $('#preview-actions')
  actions.innerHTML = ''
  if (navHistory.length) {
    const btnBack = document.createElement('button')
    btnBack.textContent = '←'
    btnBack.title = '直前のノートに戻る (Alt+←)'
    btnBack.onclick = goBack
    actions.appendChild(btnBack)
  }
  if (res.kind === 'markdown') {
    const btn = document.createElement('button')
    btn.textContent = mdMode === 'rendered' ? 'ソース表示' : 'プレビュー表示'
    btn.onclick = () => { mdMode = mdMode === 'rendered' ? 'source' : 'rendered'; renderPreview(res) }
    actions.appendChild(btn)
  }
  const btnExp = document.createElement('button')
  btnExp.textContent = 'Explorer'
  btnExp.title = 'Explorerで表示'
  btnExp.onclick = () => api.showInFolder(res.path)
  const btnOpen = document.createElement('button')
  btnOpen.textContent = '開く'
  btnOpen.title = '既定のアプリで開く'
  btnOpen.onclick = () => api.openPath(res.path)
  actions.append(btnExp, btnOpen)

  const body = $('#preview-body')
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
      body.innerHTML = `<div class="welcome"><p>4MB超のためプレビュー省略。「開く」で既定アプリへ。</p></div>`
      break
    case 'binary':
      body.innerHTML = `<div class="welcome"><p>プレビュー非対応の形式です。「開く」で既定アプリへ。</p></div>`
      break
    default:
      body.innerHTML = `<div class="welcome error"><p>${escapeHtml(res.message || '表示できません')}</p></div>`
  }
}

// レンダリング表示のコードブロックにホバーで出る「コピー」ボタンを付ける
function addCopyButtons(scope) {
  for (const pre of scope.querySelectorAll('.md-body pre')) {
    const text = pre.textContent
    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.textContent = 'コピー'
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await navigator.clipboard.writeText(text)
      btn.textContent = '✓ コピーした'
      setTimeout(() => { btn.textContent = 'コピー' }, 1500)
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
      grip.title = 'ドラッグで列幅調整'
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
    el.title = 'クリックでプレビュー'
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
    ['既定のアプリで開く', () => api.openPath(en.path)],
    ['Explorerで表示', () => api.showInFolder(en.path)],
    ['Windowsパスをコピー', () => navigator.clipboard.writeText(en.path)],
    ['WSLパスをコピー', () => navigator.clipboard.writeText(toWslPath(en.path))],
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
  $('#set-root-path').textContent = CONFIG.root || '(未設定)'
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
    showMenu(e, [['選択をコピー', () => navigator.clipboard.writeText(sel)]])
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
    if (e.key === 'F5') { e.preventDefault(); loadTreeRoot() }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack() }
    if (e.key === 'Escape') { hideCtxMenu(); $('#settings-overlay').classList.remove('show') }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteToInbox() }
    if (e.ctrlKey && (e.key === '+' || e.key === '=' || e.key === ';')) { e.preventDefault(); changeZoom(0.1) }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); changeZoom(-0.1) }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); changeZoom(0) }
  })
  window.addEventListener('click', hideCtxMenu)
}
