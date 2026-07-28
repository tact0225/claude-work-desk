const { app, BrowserWindow, ipcMain, shell, nativeImage, clipboard, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const { pathToFileURL } = require('url')
const i18n = require('./renderer/i18n')
const t = (key, vars) => i18n.t(key, vars)

const DEFAULTS = {
  root: '',
  inbox: '_inbox',
  // '' = OSのロケールに合わせる。設定パネルで選ぶと user-config.json に固定される
  lang: '',
  hidden: ['.git', 'node_modules', '__pycache__', '.obsidian', '.venv', 'venv', '.claude'],
  fontUi: '',
  fontMono: '',
  // [[ページ名]] を探すディレクトリ（root 相対・先頭から順に評価）。'' は root 直下。
  // 常に「そのmdと同じフォルダ」が最優先で、その後にこのリストを見る。
  wikilinkDirs: ['', 'wiki', 'wiki/sources', 'wiki/concepts', 'memory', 'plans', 'skills'],
}
let config = { ...DEFAULTS }

function userConfigPath() { return path.join(app.getPath('userData'), 'user-config.json') }

// 読み込み順: アプリ同梱 config.json（既定値）→ userData/user-config.json（ユーザー設定・上書き）
function loadConfig() {
  config = { ...DEFAULTS }
  for (const p of [path.join(__dirname, 'config.json'), userConfigPath()]) {
    try { Object.assign(config, JSON.parse(fs.readFileSync(p, 'utf8'))) } catch (e) { /* 無ければ既定のまま */ }
  }
}

function saveUserConfig(patch) {
  let uc = {}
  try { uc = JSON.parse(fs.readFileSync(userConfigPath(), 'utf8')) } catch (e) { /* 初回 */ }
  Object.assign(uc, patch)
  fs.writeFileSync(userConfigPath(), JSON.stringify(uc, null, 2))
}

// 明示設定があればそれ、無ければ OS のロケールから。どちらも対応外なら英語。
function applyLang() {
  return i18n.setLang(config.lang || i18n.detect(app.getLocale()))
}

const rootDir = () => config.root
const inboxDir = () => path.join(config.root, config.inbox)
const logFile = () => path.join(app.getPath('userData'), 'drop-log.json')

// startDrag は icon 必須のため 1x1 透明PNGを渡す
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)

const LANG_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.gs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
  '.py': 'python', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml',
  '.css': 'css', '.scss': 'scss', '.sql': 'sql',
  '.bat': 'dos', '.cmd': 'dos', '.ps1': 'powershell',
  '.toml': 'ini', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.diff': 'diff', '.patch': 'diff',
  '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.java': 'java', '.php': 'php', '.md': 'markdown',
}
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif']

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(source, ext) {
  const lang = LANG_BY_EXT[ext]
  if (lang) {
    try {
      const hljs = require('highlight.js')
      return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value
    } catch (e) { /* fallthrough */ }
  }
  return escapeHtml(source)
}

// md 内の相対パス画像を file:// URL に書き換え（wikiノートの画像を表示するため）
function resolveMdImages(html, mdDir) {
  return html.replace(/(<img[^>]+src=")([^"]+)(")/g, (m, pre, src, post) => {
    if (/^(https?:|data:|file:)/.test(src)) return m
    try {
      return pre + pathToFileURL(path.resolve(mdDir, decodeURIComponent(src))).href + post
    } catch (e) { return m }
  })
}

ipcMain.handle('get-config', () => ({
  root: rootDir(),
  rootOk: !!rootDir() && fs.existsSync(rootDir()),
  rootName: rootDir() ? path.basename(rootDir()) : '',
  lang: i18n.getLang(),
  inbox: rootDir() ? inboxDir() : '',
  inboxName: config.inbox,
  hidden: config.hidden,
  fontUi: config.fontUi || '',
  fontMono: config.fontMono || '',
  version: app.getVersion(),
}))

ipcMain.handle('set-lang', (_e, lang) => {
  config.lang = i18n.LANGS.includes(lang) ? lang : ''
  saveUserConfig({ lang: config.lang })
  return applyLang()
})

// ---------- パス欄（アドレスバー）----------

// ワークスペースのルートが UNC なら、そこからディストロ名を借りる
// （\\wsl.localhost\Ubuntu\home\me\claude-work → \\wsl.localhost\Ubuntu）
function wslUncPrefix() {
  const m = String(rootDir()).replace(/\//g, '\\').match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)/)
  return m ? `\\\\wsl.localhost\\${m[1]}` : null
}

// 貼り付けられた文字列を、このプロセスから見えるパスに直す。
// Claude Code が吐く WSL パス（/home/... ・/mnt/c/...）をそのまま貼れるようにするのが主目的。
function normalizeInputPath(input) {
  let s = String(input || '').trim().replace(/^["']|["']$/g, '').trim()
  if (!s) return ''
  if (process.platform !== 'win32') return s // WSLg 等で直接動かす場合はそのまま
  if (/^[a-zA-Z]:[\\/]/.test(s)) return s.replace(/\//g, '\\')
  if (/^[\\/]{2}/.test(s)) return s.replace(/\//g, '\\')
  const mnt = s.match(/^\/mnt\/([a-zA-Z])(\/.*)?$/)
  if (mnt) return `${mnt[1].toUpperCase()}:` + (mnt[2] || '/').replace(/\//g, '\\')
  if (s.startsWith('/')) {
    const pre = wslUncPrefix()
    if (pre) return pre + s.replace(/\//g, '\\')
  }
  return s
}

// フォルダなら「そこを表示」、ファイルなら「親を表示してその1枚をプレビュー」
ipcMain.handle('resolve-target', async (_e, input) => {
  const p = normalizeInputPath(input)
  if (!p) return { ok: false, error: t('main.emptyPath') }
  try {
    const st = await fsp.stat(p)
    if (st.isDirectory()) return { ok: true, path: p, isDir: true, filePath: null }
    return { ok: true, path: path.dirname(p), isDir: false, filePath: p }
  } catch (e) {
    return { ok: false, path: p, error: t('main.cannotOpen', { path: p }) }
  }
})

ipcMain.handle('choose-root', async () => {
  const r = await dialog.showOpenDialog({
    title: t('main.chooseTitle'),
    properties: ['openDirectory'],
    defaultPath: rootDir() || undefined,
  })
  if (r.canceled || !r.filePaths[0]) return null
  config.root = r.filePaths[0]
  saveUserConfig({ root: config.root })
  return config.root
})

ipcMain.handle('read-dir', async (_e, dirPath) => {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true })
  const out = entries.map(en => ({
    name: en.name,
    isDir: en.isDirectory(),
    path: path.join(dirPath, en.name),
  }))
  out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, i18n.getLang()))
  return out
})

ipcMain.handle('read-file', async (_e, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const stat = await fsp.stat(filePath)
  const base = { name: path.basename(filePath), path: filePath, size: stat.size }

  if (IMG_EXT.includes(ext)) return { ...base, kind: 'image', url: pathToFileURL(filePath).href }
  if (ext === '.pdf') return { ...base, kind: 'pdf', url: pathToFileURL(filePath).href }
  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth')
      const result = await mammoth.convertToHtml({ path: filePath })
      return { ...base, kind: 'docx', html: result.value }
    } catch (err) { return { ...base, kind: 'error', message: t('main.docxFail', { msg: err.message }) } }
  }
  if (['.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.zip', '.exe'].includes(ext)) return { ...base, kind: 'binary' }
  if (stat.size > 4 * 1024 * 1024) return { ...base, kind: 'toolarge' }

  const buf = await fsp.readFile(filePath)
  if (buf.subarray(0, 8192).includes(0)) return { ...base, kind: 'binary' }
  const source = buf.toString('utf8')
  const lineCount = source.split('\n').length

  if (ext === '.md' || ext === '.markdown') {
    const { renderMarkdown } = require('./wikilink')
    const mdDir = path.dirname(filePath)
    let html = renderMarkdown(source, mdDir, { root: rootDir(), dirs: config.wikilinkDirs })
    html = resolveMdImages(html, mdDir)
    return { ...base, kind: 'markdown', html, sourceHtml: highlight(source, '.md'), source, lineCount }
  }
  return { ...base, kind: 'code', html: highlight(source, ext), source, lineCount }
})

// 入力モードの保存。テキスト系（markdown / code）だけが対象で、改行は LF のまま書く。
ipcMain.handle('write-file', async (_e, filePath, content) => {
  try {
    await fsp.writeFile(filePath, content, 'utf8')
    const st = await fsp.stat(filePath)
    return { ok: true, size: st.size }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

async function appendDropLog(entries) {
  let log = []
  try { log = JSON.parse(await fsp.readFile(logFile(), 'utf8')) } catch (e) { /* 初回 */ }
  log.push(...entries)
  if (log.length > 200) log = log.slice(-200)
  await fsp.writeFile(logFile(), JSON.stringify(log))
}

ipcMain.handle('get-drop-log', async () => {
  try { return JSON.parse(await fsp.readFile(logFile(), 'utf8')).slice(-30) } catch (e) { return [] }
})

async function copyIntoInbox(src) {
  const ts = new Date()
  const baseName = path.basename(src)
  let dest = path.join(inboxDir(), baseName)
  if (fs.existsSync(dest)) {
    const ext = path.extname(baseName)
    const stem = baseName.slice(0, baseName.length - ext.length)
    const stamp = ts.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    dest = path.join(inboxDir(), `${stem}_${stamp}${ext}`)
  }
  const st = await fsp.stat(src)
  if (st.isDirectory()) await fsp.cp(src, dest, { recursive: true })
  else await fsp.copyFile(src, dest)
  return { ok: true, name: path.basename(dest), path: dest, ts: ts.toISOString() }
}

ipcMain.handle('drop-files', async (_e, paths) => {
  await fsp.mkdir(inboxDir(), { recursive: true })
  const results = []
  for (const src of paths) {
    try {
      results.push(await copyIntoInbox(src))
    } catch (err) {
      results.push({ ok: false, name: path.basename(src), error: err.message, ts: new Date().toISOString() })
    }
  }
  await appendDropLog(results)
  return results
})

// クリップボード貼り付け → _inbox（ファイル > 画像 > テキスト の優先順で判定）
function clipStamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

ipcMain.handle('paste-clipboard', async () => {
  await fsp.mkdir(inboxDir(), { recursive: true })
  const now = new Date()
  const results = []

  // 1) Explorerでコピーしたファイル (CF_HDROP: UTF-16のNUL区切りパス)
  try {
    const buf = clipboard.readBuffer('FileNameW')
    if (buf && buf.length) {
      const paths = buf.toString('ucs2').split('\0').filter(Boolean)
      for (const src of paths) {
        try { results.push(await copyIntoInbox(src)) }
        catch (err) { results.push({ ok: false, name: path.basename(src), error: err.message, ts: now.toISOString() }) }
      }
    }
  } catch (e) { /* ファイル形式が無ければ次へ */ }

  if (!results.length) {
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      // 2) 画像（スクリーンショット等）
      const dest = path.join(inboxDir(), `clip_${clipStamp(now)}.png`)
      await fsp.writeFile(dest, img.toPNG())
      results.push({ ok: true, name: path.basename(dest), path: dest, ts: now.toISOString() })
    } else {
      // 3) テキスト
      const text = clipboard.readText()
      if (text.trim()) {
        const dest = path.join(inboxDir(), `clip_${clipStamp(now)}.md`)
        await fsp.writeFile(dest, text)
        results.push({ ok: true, name: path.basename(dest), path: dest, ts: now.toISOString() })
      } else {
        results.push({ ok: false, name: t('main.clipEmptyName'), error: t('main.clipEmptyErr'), ts: now.toISOString() })
      }
    }
  }
  await appendDropLog(results)
  return results
})

ipcMain.on('drag-start', (event, filePath) => {
  event.sender.startDrag({ file: filePath, icon: DRAG_ICON })
})

// 入力モードの Undo/Redo。自前で履歴を持たず Chromium の編集履歴をそのまま叩く
// ＝ボタンと Ctrl+Z が同じ1本の履歴を共有し、日本語IMEの変換も1操作として扱われる。
ipcMain.on('editor-undo', (event) => event.sender.undo())
ipcMain.on('editor-redo', (event) => event.sender.redo())

ipcMain.handle('open-path', (_e, p) => shell.openPath(p))
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p))

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    backgroundColor: '#1e2227',
    autoHideMenuBar: true,
    title: 'claude-work Desk',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(() => {
  loadConfig()
  applyLang()
  i18n.checkMissing((m) => console.warn(m)) // 腐り検知: 翻訳漏れは起動ログに出す
  createWindow()
})
app.on('window-all-closed', () => app.quit())
