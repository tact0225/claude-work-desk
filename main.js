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
  // ⚠ ここも config.json も「汎用の初期値」に留める。自分のフォルダ構成を焼き込むと
  //    他人の環境で意味不明な既定になる。個人の追加は userData/user-config.json 側へ。
  wikilinkDirs: ['', 'notes', 'docs', 'wiki', 'wiki/sources', 'wiki/concepts'],
  // 「新着を表示」でウォッチするフォルダ。相対はワークスペース基準で解決する
  // ＝既定の '_outbox' が他人の環境でもその人の _outbox を指す。
  watchDirs: ['_outbox'],
  // 未読ファイルの集合（設定ではなく状態だが、再起動をまたいで残す仕様なので同じ入れ物に置く）
  unread: [],
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

// ドロップ先フォルダ（既定 _inbox）はワークスペース内の相対パスに限定する。
// 外を許すと「レーンを覗いていても投入先は動かない」という不変条件が意味を失うため、
// 絶対パス・UNC・`..` での脱出を弾いてから resolve 後に再度 root 配下かを確かめる（2段構え）。
// Windows が予約している装置名。mkdir が謎のエラーを返す前に弾く。
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function sanitizeInbox(raw) {
  let s = String(raw || '').trim().replace(/\\/g, '/')
  if (!s) return null
  // ⚠ UNC 判定は「先頭スラッシュを落とす前」に置く。
  //    逆順だと //server/share が server/share に化けて素通りする（テストで検出）。
  if (s.startsWith('//')) return null
  s = s.replace(/^\/+|\/+$/g, '')
  if (!s) return null
  // ⚠ ドライブ判定は「落とした後」にも必要。/C:foo が C:foo として通り抜けるため（QA指摘）。
  if (/^[a-zA-Z]:/.test(s)) return null

  for (const seg of s.split('/')) {
    if (!seg) return null
    // Windows はパス解決時に末尾の空白・ピリオドを捨てる＝「.. 」は「..」、「CON 」は「CON」として効く。
    // なので判定は必ず「捨てた後の姿」に対して行う（捨てる前に見ると末尾に空白を足すだけで抜けられる）。
    const bare = seg.replace(/[ .]+$/, '')
    if (bare === '') return null
    if (RESERVED.test(bare)) return null
  }
  if (!config.root) return s // ワークスペース未設定なら文字列として保持するだけ

  // 文字列演算だけでは symlink / ジャンクション経由の脱出を防げない（QA指摘・実証済み）。
  // 1セグメントずつ降りて、途中に symlink があればその実体で判定し直す。
  // ⚠ 「実在する最も近い祖先を realpath」方式では**壊れた symlink** を防げない
  //    （リンク先が無い＝existsSync が false → 祖先まで遡って「中」と判定 → mkdir が外に実体を作る）。
  let realRoot
  try { realRoot = fs.realpathSync(config.root) } catch (e) { return null }
  // ⚠ 区切りまで見ないと「..foo」という正当なフォルダ名を親への遡上と誤判定する（QA指摘）
  const inside = (p) => {
    const rel = path.relative(realRoot, p)
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
  }
  let cur = realRoot
  for (const seg of s.split('/')) {
    cur = path.join(cur, seg)
    let st
    try { st = fs.lstatSync(cur) } catch (e) { break } // ここから先は未作成＝親まで安全なら可
    if (st.isSymbolicLink()) {
      let real
      try { real = fs.realpathSync(cur) } catch (e) { return null } // 壊れたリンクは拒否
      if (!inside(real)) return null
      cur = real
    }
    if (!inside(cur)) return null
  }
  return s
}

// 使う直前に毎回確かめる版。設定時の検査だけでは、
//   ①ワークスペース未設定のまま投入先を決める → 後からルートを選ぶ
//   ②投入先を決めた後でワークスペースを変える
// の順序で containment を素通りできる（QA指摘・実証済み）ため、書き込み経路は必ずこちらを通す。
function inboxDirSafe() {
  const s = config.root ? sanitizeInbox(config.inbox) : null
  if (!s) {
    const err = new Error(`unsafe inbox folder: ${config.inbox}`)
    err.code = 'UNSAFE_INBOX'
    throw err
  }
  return path.join(config.root, s)
}

// ⚠ 設定を確定するのは「フォルダを作れると確かめた後」。順序を逆にすると、
//    既存ファイル名や予約名を打った瞬間に不正な投入先が保存され、UI は古い名前を出したまま
//    ドロップが黙って全部失敗する状態が再起動後も残る（QA指摘・実証済み）。
ipcMain.handle('set-inbox', async (_e, raw) => {
  const s = sanitizeInbox(raw)
  if (!s) return { ok: false, reason: 'invalid' }
  if (config.root) {
    const target = path.join(config.root, s)
    try {
      await fsp.mkdir(target, { recursive: true })
      if (!(await fsp.stat(target)).isDirectory()) return { ok: false, reason: 'notdir' }
    } catch (err) {
      return { ok: false, reason: 'mkdir', error: err.message }
    }
  }
  // ⚠ 保存も失敗しうる（ディスク・権限）。先に書いてから確定しないと、
  //    「メモリ上は新しい投入先・ファイルには古い値・画面は古い名前」の三重ズレになる（QA指摘）
  try {
    saveUserConfig({ inbox: s })
  } catch (err) {
    return { ok: false, reason: 'save', error: err.message }
  }
  config.inbox = s
  return { ok: true, inbox: s }
})

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
  // 新しいワークスペースでは今の投入先が危険になっていることがある（同名の symlink がある等）。
  // 危ないまま使わせず既定へ戻す。ワークスペース未設定のうちに投入先だけ決めた場合もここで効く。
  if (!sanitizeInbox(config.inbox)) {
    config.inbox = DEFAULTS.inbox
    saveUserConfig({ inbox: config.inbox })
  }
  return config.root
})

async function readDirEntries(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true })
  const out = entries.map(en => ({
    name: en.name,
    isDir: en.isDirectory(),
    path: path.join(dirPath, en.name),
  }))
  out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, i18n.getLang()))
  return out
}

ipcMain.handle('read-dir', (_e, dirPath) => readDirEntries(dirPath))

ipcMain.handle('read-file', async (_e, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const stat = await fsp.stat(filePath)
  // mtimeMs はプレビューの自動更新用。ここで返しておかないと renderer が
  // 「今出している版はいつのものか」を持てず、外部更新の検知が1周ぶん遅れる。
  const base = { name: path.basename(filePath), path: filePath, size: stat.size, mtimeMs: stat.mtimeMs }

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

// ---------- 自動更新（ポーリング）と新着ウォッチ ----------
//
// ⚠ WSL越し（\\wsl.localhost\...）では fs.watch が EISDIR で即死ぬ＝OSの変更通知は使えない。
//    ポーリングが唯一の生命線なので、失敗を握り潰さず renderer に返して画面に出す（腐り検知）。
// fs を触るのは全部こちら側。renderer は「どこを見るか」と「次はいつ見るか」だけを持つ。

const WATCH_MAX_ENTRIES = 1000 // 直下のファイル数の上限。非再帰なので実際にはまず発火しない保険

// パス比較用の正規化。Windows 前提（大小同一・区切りは \ に寄せる）。
function pathKey(p) {
  const s = String(p || '')
  if (!s) return ''
  return path.resolve(s).replace(/[\\/]+$/, '').toLowerCase()
}

// 相対指定はワークスペース基準（既定の '_outbox' がその人の _outbox を指すように）
function resolveWatchDir(s) {
  const raw = String(s || '').trim()
  if (!raw) return null
  if (path.isAbsolute(raw)) return raw
  return config.root ? path.join(config.root, raw) : null
}

// ワークスペース全体は新着ウォッチに指定させない（本田さん明示）。
// 全部が光ると未読という印そのものが意味を失うため。設定ファイルに手で書かれていても無視する。
function isTooBroad(dir) {
  if (!dir) return true
  // ⚠ ワークスペース未設定なら全部断る。ここを false で通すと root 未設定の局面だけ
  //    C:\ でもウォッチに入る（QA指摘）。画面はルートピッカーで止まっていて踏みにくいが、
  //    「root が無い間は判定材料も無い＝許可しない」が安全側で筋も通る
  if (!config.root) return true
  const d = pathKey(dir)
  const r = pathKey(config.root)
  return d === r || r.startsWith(d + path.sep) // root 自身と、root を含む祖先
}

// user-config.json へ書く形。root 配下なら相対に戻す。
// ⚠ 解決後の絶対パスをそのまま焼くと、どこか1つトグルしただけで config.json の既定
//    "watchDirs": ["_outbox"]（＝他人の環境でもその人の _outbox を指す設計）が絶対パスに
//    置き換わり、ワークスペースを引っ越した時に既定のウォッチが黙って外れる（QA指摘）。
function storeWatchDir(abs) {
  if (!config.root) return abs
  const rel = path.relative(config.root, abs)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return abs
  return rel.split(path.sep).join('/')
}

function watchDirList() {
  const out = []
  for (const s of (Array.isArray(config.watchDirs) ? config.watchDirs : [])) {
    const abs = resolveWatchDir(s)
    if (!abs || isTooBroad(abs)) continue
    if (!out.some(p => pathKey(p) === pathKey(abs))) out.push(abs)
  }
  return out
}

// 直下のファイルだけ（非再帰・本田さん明示）。todo/ は見たいが todo/done/ は見たくない、
// という使い分けが実際にあるため、サブフォルダの中は絶対に辿らない。
// 見たくなったらそのサブフォルダを個別にウォッチONにする運用。
function filesDirectlyIn(entries) {
  const out = new Set()
  for (const en of entries) {
    if (en.isDir) continue
    if (config.hidden.includes(en.name)) continue
    out.add(en.path)
  }
  return out
}

// baseline = 直近のスキャンで見えていた直下ファイル集合（ウォッチフォルダごと）。
// 1回目は baseline を埋めるだけで未読にしない＝起動直後・ウォッチON直後に全画面が光らない。
const watchBaseline = new Map()
let unread = new Set()
let unreadSaveTimer = null

function isDirectlyUnder(file, dir) {
  return pathKey(path.dirname(file)) === pathKey(dir)
}

// 「読めない」と「本当に消えた」を区別する。親フォルダが読めて自分だけ居ないなら削除確定。
// ⚠ 読めない＝消えた、で処理してはいけない。WSLが落ちている朝は全ウォッチフォルダが
//    読めなくなり、未読（クリックするまで残す約束のもの）が丸ごと飛ぶ。親も読めない時は
//    マウントごと落ちていると見て何も触らない。追加の readdir はエラー時だけ走る。
async function isReallyGone(dir) {
  const parent = path.dirname(dir)
  if (!parent || pathKey(parent) === pathKey(dir)) return false
  try {
    const entries = await readDirEntries(parent)
    return !entries.some(en => pathKey(en.path) === pathKey(dir))
  } catch (err) { return false }
}

// 未読集合が永久に太らないための掃除。ウォッチを外したフォルダのぶんは捨てる
// （消えたファイルのぶんはスキャン時に落とす）。
function pruneUnread(dirs) {
  let changed = false
  for (const p of [...unread]) {
    if (!dirs.some(d => isDirectlyUnder(p, d))) { unread.delete(p); changed = true }
  }
  return changed
}

// 毎tick書くと user-config.json を叩き続けるので、変化した時だけ・少し遅らせて書く
// ⚠ ただの debounce にしない。1.2秒より短い間隔で新着が出続けると書き込みが後ろへ
//    ずれ続けて一度も書かれず、強制終了でその間の未読が丸ごと消える（QA指摘）。
//    最初に汚れてから UNREAD_SAVE_MAX_MS 経ったら、debounce を待たずに必ず書く。
const UNREAD_SAVE_MAX_MS = 5000
let unreadDirtySince = 0

function persistUnread() {
  const now = Date.now()
  if (!unreadDirtySince) unreadDirtySince = now
  if (now - unreadDirtySince >= UNREAD_SAVE_MAX_MS) { flushUnread(); return }
  clearTimeout(unreadSaveTimer)
  unreadSaveTimer = setTimeout(flushUnread, 1200)
}

function flushUnread() {
  clearTimeout(unreadSaveTimer)
  unreadSaveTimer = null
  unreadDirtySince = 0
  try { saveUserConfig({ unread: [...unread] }) } catch (err) { console.warn('[watch] 未読の保存に失敗:', err.message) }
}

// ⚠ キー名を dirs にしない。poll-fs の返り値（ツリー用の readdir 結果 = dirs）に
//    Object.assign で混ぜるので、同じ名前だとツリーの中身を丸ごと潰す（テストで検出）。
function watchPayload(dirs) {
  const counts = {}
  for (const d of dirs) counts[d] = [...unread].filter(p => isDirectlyUnder(p, d)).length
  return { watchDirs: dirs, unread: [...unread], counts }
}

// renderer から2秒ごとに1回だけ呼ばれる入口。
// (a) 展開中フォルダの readdir（ツリーの差分適用用）と (b) ウォッチフォルダの readdir（新着判定）を
// まとめて済ませる。同じフォルダが両方に出てきても readdir は1回にする。
ipcMain.handle('poll-fs', async (_e, req) => {
  const startedAt = Date.now()
  const treeDirs = (req && Array.isArray(req.dirs)) ? req.dirs : []
  const wDirs = watchDirList()
  const results = new Map() // pathKey → { entries } | { error }

  for (const d of [...treeDirs, ...wDirs]) {
    const key = pathKey(d)
    if (results.has(key)) continue
    try { results.set(key, { entries: await readDirEntries(d) }) }
    catch (err) { results.set(key, { error: err.code || err.message }) }
  }

  const out = { dirs: {}, unread: [], counts: {}, preview: null, ms: 0 }
  // ⚠ renderer が渡してきた文字列そのものをキーに返す。こちらで正規化した形で返すと
  //    renderer 側のフォルダ対応表と突き合わなくなる（差分が当たらず無言で止まって見える）。
  for (const d of treeDirs) out.dirs[d] = results.get(pathKey(d))

  let changed = pruneUnread(wDirs)
  for (const d of wDirs) {
    const r = results.get(pathKey(d))
    // ⚠ 読めなかった tick は baseline も未読も触らない。WSLが一瞬落ちた時に
    //    「全部消えた → 全部新規」と誤認して全画面が光るのを防ぐ（実際に起こりうる）。
    //    例外はフォルダごと本当に消えた時だけ。放っておくと配下の未読が二度と落ちず
    //    user-config.json に溜まり続ける（仕様: 集合が永久に太らないように）。
    if (!r || r.error) {
      if (await isReallyGone(d)) {
        watchBaseline.delete(pathKey(d))
        for (const p of [...unread]) if (isDirectlyUnder(p, d)) { unread.delete(p); changed = true }
      }
      continue
    }
    const seen = filesDirectlyIn(r.entries)
    const base = watchBaseline.get(pathKey(d))
    if (!base) {
      watchBaseline.set(pathKey(d), seen) // 1回目は既読として飲み込む
    } else {
      for (const p of seen) if (!base.has(p) && !unread.has(p)) { unread.add(p); changed = true }
      watchBaseline.set(pathKey(d), seen)
    }
    for (const p of [...unread]) {
      if (isDirectlyUnder(p, d) && !seen.has(p)) { unread.delete(p); changed = true }
    }
  }
  if (changed) persistUnread()
  Object.assign(out, watchPayload(wDirs))

  if (req && req.previewPath) {
    try {
      const st = await fsp.stat(req.previewPath)
      out.preview = { mtimeMs: st.mtimeMs, size: st.size }
    } catch (err) { out.preview = { gone: true } }
  }
  out.ms = Date.now() - startedAt
  return out
})

ipcMain.handle('get-watch', () => watchPayload(watchDirList()))

// 指定していいフォルダかを実測で確かめる。名前でなく中身で弾く。
ipcMain.handle('probe-watch', async (_e, dir, browseRoot) => {
  if (!dir || isTooBroad(dir)) return { ok: false, reason: 'root' }
  if (browseRoot && pathKey(dir) === pathKey(browseRoot)) return { ok: false, reason: 'root' }
  const startedAt = Date.now()
  let entries
  try { entries = await readDirEntries(dir) } catch (err) { return { ok: false, reason: 'read', error: err.message } }
  const files = filesDirectlyIn(entries).size
  const ms = Date.now() - startedAt
  if (files > WATCH_MAX_ENTRIES) return { ok: false, reason: 'big', files, ms }
  return { ok: true, files, ms }
})

ipcMain.handle('set-watch', async (_e, dir, on) => {
  const next = watchDirList().filter(p => pathKey(p) !== pathKey(dir))
  let allow = !!(on && dir && !isTooBroad(dir))
  // ⚠ 直下1000超の上限を probe-watch 側だけに置かない。UIは必ず probe → set の順に呼ぶので
  //    画面からは踏めないが、set-watch を直に叩けば上限を素通りできる＝ルート指定
  //    （isTooBroad）だけが二重に守られている非対称な状態になる（QA指摘）。歯止めは入口の
  //    数だけ要る。読めないフォルダはここでは弾かない（次のtickが baseline を張る）。
  if (allow) {
    try { if (filesDirectlyIn(await readDirEntries(dir)).size > WATCH_MAX_ENTRIES) allow = false }
    catch (err) { /* 読めないだけなら通す */ }
  }
  if (allow) next.push(dir)
  // 保存は相対に戻した形で（storeWatchDir のコメント参照）。解決に使う config.watchDirs も
  // 同じ形にして、メモリ上と user-config.json が食い違わないようにする
  const stored = next.map(storeWatchDir)
  config.watchDirs = stored
  try { saveUserConfig({ watchDirs: stored }) } catch (err) { console.warn('[watch] 設定の保存に失敗:', err.message) }

  if (allow) {
    // ONにした瞬間に既存ファイルを既読として記録する。やらないと初回のポーリングで
    // 中身が丸ごと新着になり、全画面が光る。
    try { watchBaseline.set(pathKey(dir), filesDirectlyIn(await readDirEntries(dir))) } catch (err) { /* 次のtickが baseline を張る */ }
  } else {
    watchBaseline.delete(pathKey(dir))
  }
  if (pruneUnread(next)) persistUnread() // 外したフォルダの未読は残さない（消しても光り続ける、を防ぐ）
  return watchPayload(next)
})

// プレビューに出した＝読んだ、とみなして未読を落とす
ipcMain.handle('mark-read', (_e, filePath) => {
  let changed = false
  for (const p of [...unread]) if (pathKey(p) === pathKey(filePath)) { unread.delete(p); changed = true }
  if (changed) persistUnread()
  return watchPayload(watchDirList())
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
  let dest = path.join(inboxDirSafe(), baseName)
  if (fs.existsSync(dest)) {
    const ext = path.extname(baseName)
    const stem = baseName.slice(0, baseName.length - ext.length)
    const stamp = ts.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    dest = path.join(inboxDirSafe(), `${stem}_${stamp}${ext}`)
  }
  const st = await fsp.stat(src)
  if (st.isDirectory()) await fsp.cp(src, dest, { recursive: true })
  else await fsp.copyFile(src, dest)
  return { ok: true, name: path.basename(dest), path: dest, ts: ts.toISOString() }
}

ipcMain.handle('drop-files', async (_e, paths) => {
  await fsp.mkdir(inboxDirSafe(), { recursive: true })
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
  await fsp.mkdir(inboxDirSafe(), { recursive: true })
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
      const dest = path.join(inboxDirSafe(), `clip_${clipStamp(now)}.png`)
      await fsp.writeFile(dest, img.toPNG())
      results.push({ ok: true, name: path.basename(dest), path: dest, ts: now.toISOString() })
    } else {
      // 3) テキスト
      const text = clipboard.readText()
      if (text.trim()) {
        const dest = path.join(inboxDirSafe(), `clip_${clipStamp(now)}.md`)
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
  // 未読は再起動をまたいで残す（本田さん選択）。ウォッチしていないフォルダのぶんは
  // ここで捨てる＝設定を変えた後も古い未読が居座らない。
  unread = new Set((Array.isArray(config.unread) ? config.unread : []).filter(p => typeof p === 'string'))
  pruneUnread(watchDirList())
  applyLang()
  i18n.checkMissing((m) => console.warn(m)) // 腐り検知: 翻訳漏れは起動ログに出す
  createWindow()
})
app.on('window-all-closed', () => {
  flushUnread() // 遅延書き込みの取りこぼしを防ぐ（直前にクリックした既読が消える）
  app.quit()
})
