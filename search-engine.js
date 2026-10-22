const fs = require('fs').promises
const path = require('path')
const { pathToFileURL } = require('url')
const core = require('./renderer/search-core')
const EXCLUDED = new Set(['.git', 'node_modules', '.obsidian', 'dist', '.venv', 'venv', '__pycache__', '.next', '.cache', '.claude'])
const LIMITS = { text: 4, pdf: 50, sheet: 30, word: 30 }
const cache = new Map()
let cacheBytes = 0
let pdfModule
function kindOf(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (['.xlsx', '.xlsm', '.xls'].includes(ext)) return 'sheet'
  if (ext === '.docx') return 'word'
  // read-file も拡張子を限定せず、NUL とサイズでテキストを判定している。
  if (/^\.(png|jpe?g|gif|webp|bmp|ico|avif|pptx?|doc|zip|exe)$/.test(ext)) return null
  return 'text'
}
// pdf.js の legacy build は読み込んだ瞬間に描画用の定数を `new DOMMatrix()` で作る。Node には
// DOMMatrix が無く、pdf.js は optional 依存の @napi-rs/canvas から借りてくる。
// ⚠ インストーラ版は @napi-rs を同梱しない（package.json build.files の除外。mac universal の結合が
//    単一アーキの .node で失敗するため）。借り先が無いと import 自体が ReferenceError で落ち、
//    PDF が全部「読めなかった」になる（v0.15.0 の app.asar 実測で 46件全滅）。
//    横断検索はテキスト抽出しかしない＝描画用の行列は使わないので、借り先が無い時だけ
//    2次元アフィンの最小実装を置いてから読む。借り先がある環境（開発・sync_to_windows）では触らない。
function ensureDomMatrix() {
  if (globalThis.DOMMatrix) return
  try { require.resolve('@napi-rs/canvas'); return } catch (err) { /* 無い＝下の最小実装を使う */ }
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      const [a, b, c, d, e, f] = Array.isArray(init) || ArrayBuffer.isView(init) ? init : [1, 0, 0, 1, 0, 0]
      Object.assign(this, { a, b, c, d, e, f })
    }
    multiplySelf(m) {
      const { a, b, c, d, e, f } = this
      this.a = a * m.a + c * m.b; this.b = b * m.a + d * m.b
      this.c = a * m.c + c * m.d; this.d = b * m.c + d * m.d
      this.e = a * m.e + c * m.f + e; this.f = b * m.e + d * m.f + f
      return this
    }
    preMultiplySelf(m) { const r = new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]).multiplySelf(this); Object.assign(this, r); return this }
    translateSelf(x = 0, y = 0) { return this.multiplySelf(new DOMMatrix([1, 0, 0, 1, x, y])) }
    scaleSelf(x = 1, y = x) { return this.multiplySelf(new DOMMatrix([x, 0, 0, y, 0, 0])) }
    invertSelf() {
      const { a, b, c, d, e, f } = this
      const det = a * d - b * c
      Object.assign(this, { a: d / det, b: -b / det, c: -c / det, d: a / det, e: (c * f - d * e) / det, f: (b * e - a * f) / det })
      return this
    }
    translate(x, y) { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).translateSelf(x, y) }
    scale(x, y) { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).scaleSelf(x, y) }
  }
}
async function pdfPages(data, cancelled = () => false) {
  if (!pdfModule) {
    ensureDomMatrix()
    pdfModule = import(pathToFileURL(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)
  }
  const pdfjs = await pdfModule
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true,
    cMapUrl: path.join(__dirname, 'node_modules/pdfjs-dist/cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(__dirname, 'node_modules/pdfjs-dist/standard_fonts') + path.sep,
    wasmUrl: path.join(__dirname, 'node_modules/pdfjs-dist/wasm') + path.sep,
  })
  const doc = await task.promise
  const segments = []
  try {
    for (let page = 1; page <= Math.min(doc.numPages, 1000); page++) {
      if (cancelled()) break
      const item = await doc.getPage(page)
      segments.push({ text: core.pageText(await item.getTextContent(core.PDF_TEXT_OPTIONS)), page })
      item.cleanup()
    }
    return { segments, truncated: doc.numPages > 1000 }
  } finally { await doc.destroy() }
}
async function extract(file, kind, cancelled) {
  if (kind === 'sheet') {
    const sheets = core.sheetRows(require('xlsx').readFile(file))
    return { segments: core.sheetSegments(sheets), truncated: sheets.some(sheet => sheet.truncated) }
  }
  if (kind === 'pdf') return pdfPages(await fs.readFile(file), cancelled)
  if (kind === 'word') {
    const result = await require('mammoth').extractRawText({ path: file })
    return { segments: result.value.split(/\n\s*\n/).map((text, index) => ({ text, paragraph: index + 1 })) }
  }
  const data = await fs.readFile(file)
  if (data.subarray(0, 8192).includes(0)) return { segments: [] }
  return { segments: data.toString('utf8').split('\n').map((text, index) => ({ text, line: index + 1 })) }
}
function remember(key, value) {
  const bytes = (value.segments || []).reduce((sum, segment) => sum + segment.text.length * 2 + 100, 0) + (value.norm || '').length * 2
  if (bytes > 200 * 1024 * 1024) return
  cache.set(key, { value, bytes })
  cacheBytes += bytes
  // ⚠ 件数の上限は走査するファイル数より十分大きく取る。小さいと（旧 5,000件）頭から順に読む
  //    走査で古い方から追い出され、6,000ファイル級のワークスペースでは2回目もキャッシュが
  //    1件も当たらない＝毎回全部解析し直す（実測 16秒が2回目も16秒）。容量は 200MB で縛る。
  while (cache.size > 100000 || cacheBytes > 200 * 1024 * 1024) {
    const oldest = cache.keys().next().value
    cacheBytes -= cache.get(oldest).bytes
    cache.delete(oldest)
  }
}
async function search({ root, query, kinds = [], maxTotal = 2000, maxFile = 200 }, emit, cancelled = () => false) {
  const normQuery = core.normalizeWithMap(String(query).trim()).norm
  const state = { scanned: 0, total: 0, files: 0, failed: 0, limited: false, cancelled: false }
  if (!normQuery) { emit({ type: 'done', ...state }); return state }
  const pending = []
  let lastSent = Date.now()
  let lastProgress = JSON.stringify(state)
  function flush(force = false) {
    if (!force && Date.now() - lastSent < 200) return
    const progress = JSON.stringify(state)
    if (!pending.length && progress === lastProgress) return
    lastProgress = progress
    emit({ type: 'batch', results: pending.splice(0), ...state })
    lastSent = Date.now()
  }
  async function walk(dir) {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch (err) { state.failed++; return }
    for (const entry of entries) {
      if (cancelled() || state.total >= maxTotal) return
      const file = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!EXCLUDED.has(entry.name)) await walk(file)
        flush()
        continue
      }
      if (!entry.isFile()) continue
      state.scanned++
      try {
        const kind = kindOf(file)
        if (!kind || (kinds.length && !kinds.includes(kind))) { flush(); continue }
        const stat = await fs.lstat(file)
        if (!stat.isFile() || stat.size > LIMITS[kind] * 1024 * 1024) { flush(); continue }
        const key = file + '\0' + stat.size + '\0' + stat.mtimeMs
        let value = cache.get(key)?.value
        if (!value) {
          value = await extract(file, kind, cancelled)
          if (cancelled()) return
          // ⚠ 正規化済みの全文も一緒に覚え、語を含むファイルだけ行ごとに見る。位置対応つきの
          //    正規化（findInSegment）を全ファイル・全行で毎回やり直すと、キャッシュがあっても
          //    全体検索が十数秒かかる（claude-work 約6,000ファイルで実測 16秒）。
          value.norm = core.normalize(value.segments.map(segment => segment.text).join('\n'))
          // ⚠ テキストは norm だけ覚える。行に割った配列まで抱えるとワークスペースのテキスト
          //    （claude-work で約200MB）が 200MB 枠を溢れ、走査のたびに全部追い出されて
          //    2回目も読み直しになる。テキストは読み直しが安いので、当たったファイルだけ読み直す。
          //    PDF / Excel / Word は解析が重いので行（ページ・セル）ごと覚える。
          remember(key, kind === 'text' ? { norm: value.norm } : value)
        }
        if (cancelled()) return
        if (!value.norm.includes(normQuery)) { flush(); continue }
        if (!value.segments) value = await extract(file, kind, cancelled)
        if (cancelled()) return
        const hits = []
        let limited = !!value.truncated
        outer: for (const segment of value.segments) {
          if (cancelled()) break outer
          for (const [start, end] of core.findInSegment(segment.text, normQuery, Math.min(maxFile - hits.length, maxTotal - state.total) + 1)) {
            if (hits.length >= maxFile || state.total >= maxTotal) { limited = true; break outer }
            hits.push({ ...segment, text: undefined, start, end, ordinal: hits.length, snippet: core.makeSnippet(segment.text, start, end) })
            state.total++
          }
        }
        if (hits.length) {
          state.files++
          pending.push({ path: file, relative: path.relative(root, file), kind, hits, limited })
        }
        state.limited ||= limited || state.total >= maxTotal
      } catch (err) { state.failed++ }
      flush()
      // キャッシュ済みの多数のファイルでも Worker のメッセージ処理に制御を返す。
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  // PDF のページ取得などの待ち時間にも進捗を送る。同期パーサの間は main 側が応答を続ける。
  const heartbeat = setInterval(() => flush(true), 200)
  try { await walk(root) } catch (err) { state.failed++ }
  finally { clearInterval(heartbeat) }
  state.cancelled = cancelled()
  flush(true)
  emit({ type: 'done', ...state })
  return state
}
module.exports = { search, pdfPages, kindOf }
