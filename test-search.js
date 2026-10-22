// 実ファイルと本物の Worker を使い、NFKC / 抽出順 / 中止 / キャッシュの境界を検証する。
const assert = require('assert/strict')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
const { Worker } = require('worker_threads')
const vm = require('vm')
const core = require('./renderer/search-core')
const { search, pdfPages } = require('./search-engine')
const XLSX = require('xlsx')

function query(text) { return core.normalizeWithMap(text).norm }
function pdfFixture() {
  const stream = 'BT /F1 12 Tf 20 80 Td (Order order) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, '0') + ' 00000 n \n'
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
// GUI を起動できないので、実際の renderer 関数に最小DOMを渡し、Range の端点まで検証する。
async function testDomPositions() {
  class Element {
    constructor(tag, children = [], classes = [], cell = false) {
      this.nodeType = 1
      this.tagName = tag.toUpperCase()
      this.childNodes = children
      this.classes = classes
      this.cell = cell
      for (const child of children) child.parentElement = this
    }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim()
        if (part.startsWith('.')) return this.classes.includes(part.slice(1))
        if (part === '[data-sheet-cell]') return this.cell
        return this.tagName === part.toUpperCase()
      })
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null }
    querySelectorAll(selector) {
      return this.childNodes.flatMap(child => child.nodeType === 1 ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : [])
    }
    querySelector(selector) {
      if (selector === '.codewrap pre.code code') return this.querySelectorAll('code').find(code => code.parentElement.classes.includes('code') && code.closest('.codewrap')) || null
      return this.querySelectorAll(selector)[0] || null
    }
    getBoundingClientRect() { return { top: 0, left: 0, right: 800, height: 600 } }
    scrollBy() {}
  }
  function text(data) { return { nodeType: 3, data, length: data.length } }
  const highlights = new Map()
  class FakeRange {
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset }
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset }
    getBoundingClientRect() { return { top: 20, left: 20, right: 40, width: 20, height: 12 } }
  }
  const elements = { '#find-bar': { hidden: false }, '#find-input': { value: '注文' }, '#find-count': {} }
  let body
  const context = {
    DeskSearch: core, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }, Range: FakeRange,
    Highlight: Set, CSS: { highlights }, currentFile: { kind: 'code' }, diffMode: false, editMode: false,
    $: selector => selector === '#preview-body' ? body : elements[selector],
    clearTimeout, setTimeout, getComputedStyle: () => ({ overflowX: 'auto', overflowY: 'auto' }),
    document: { createTreeWalker(root, _filter, options) {
      const nodes = []
      function walk(node) {
        if (node.nodeType === 3) { if (options.acceptNode(node) === 1) nodes.push(node) }
        else for (const child of node.childNodes) walk(child)
      }
      walk(root)
      let index = 0
      return { nextNode: () => nodes[index++] || null }
    } },
  }
  const appSource = await fs.readFile(path.join(__dirname, 'renderer/app.js'), 'utf8')
  const section = appSource.slice(appSource.indexOf('// ---------- 全文検索 / ファイル内検索'), appSource.indexOf('// ---------- グローバル ----------'))
  vm.runInNewContext(section + '\nglobalThis.findHarness = { updateFind, closeFind, setIndex: index => { findIndex = index }, setPdf: value => { pdfState = value }, getPdf: () => pdfState, scheduleFind, isFindShortcut, setupSearch, paintSearchResults, receiveSearchEvent, renderPdf, setPdfModules: value => { pdfImports = Promise.resolve(value) }, setResults: value => { workspaceResults = value; resultsVisible = !!value } }', context)
  const h = context.findHarness
  const first = text('🙂注')
  const last = text('⽂\n注\n文\nＡＢＣ')
  body = new Element('div', [new Element('div', [new Element('pre', [text('1\n2\n3\n')], ['gutter']), new Element('pre', [new Element('code', [new Element('span', [first]), last])], ['code'])], ['codewrap'])])
  h.updateFind()
  assert.equal(elements['#find-count'].textContent, '1 / 1')
  let range = [...highlights.get('desk-find-current')][0]
  assert.equal(range.startContainer, first)
  assert.equal(range.startOffset, 2)
  assert.equal(range.endContainer, last)
  assert.equal(range.endOffset, 1)
  elements['#find-input'].value = 'abc'
  h.updateFind()
  range = [...highlights.get('desk-find-current')][0]
  assert.equal(last.data.slice(range.startOffset, range.endOffset), 'ＡＢＣ')

  context.currentFile = { kind: 'sheet' }
  elements['#find-input'].value = '注文'
  const cell1 = text('注⽂')
  const cell2 = text('注文 注文')
  body = new Element('div', [new Element('h2', [text('注文')]), new Element('table', [new Element('tr', [new Element('th', [text('注文')]), new Element('td', [cell1], [], true), new Element('td', [cell2], [], true)])])])
  h.setIndex(2)
  h.updateFind()
  assert.equal(elements['#find-count'].textContent, '3 / 3')
  range = [...highlights.get('desk-find-current')][0]
  assert.equal(range.startContainer, cell2)
  assert.equal(range.startOffset, 3)

  context.currentFile = { kind: 'markdown' }
  body = new Element('div', [new Element('p', [text('注')]), new Element('p', [text('文')]), new Element('p', [text('注'), new Element('em', [text('⽂')])]), new Element('pre', [text('注\n文')])], ['md-body'])
  h.updateFind()
  assert.equal(elements['#find-count'].textContent, '1 / 1')
  context.diffMode = true
  body = new Element('div', [new Element('span', [text('注')], ['dtext']), new Element('span', [text('文')], ['dtext']), new Element('span', [text('注⽂')], ['dtext'])])
  h.updateFind()
  assert.equal(elements['#find-count'].textContent, '1 / 1')
  context.diffMode = false

  context.currentFile = { kind: 'pdf' }
  h.setIndex(1)
  const page1 = new Element('div', [new Element('span', [text('注')]), new Element('br'), new Element('span', [text('⽂')])], ['textLayer'])
  const page2Text = text('注⽂')
  const page2 = new Element('div', [new Element('span', [page2Text])], ['textLayer'])
  const layers = { 1: page1 }
  const jumps = []
  h.setPdf({ pages: ['注⽂', '注⽂'], viewer: { scrollPageIntoView: value => jumps.push(value.pageNumber) }, container: { querySelector: selector => layers[Number(/data-page-number="(\d+)"/.exec(selector)[1])], getBoundingClientRect: () => ({ top: 0, height: 600 }), scrollTop: 0 } })
  h.updateFind(true)
  assert.equal(elements['#find-count'].textContent, '2 / 2')
  assert.equal(jumps[0], 2)
  assert.equal(highlights.get('desk-find-current').size, 0, '未描画ページも件数と ordinal に含める')
  layers[2] = page2
  h.updateFind(false)
  range = [...highlights.get('desk-find-current')][0]
  assert.equal(range.startContainer, page2Text)
  assert.equal(range.startOffset, 0)
  assert.equal(range.endOffset, 2)
  h.updateFind(true)
  assert.equal(h.getPdf().pendingPage, null, '描画済みページへ移動したら予約を消す')
  h.setPdf(null)
  context.currentFile = { kind: 'code' }
  elements['#find-input'].value = 'a'
  body = new Element('div', [new Element('div', [new Element('pre', [new Element('code', [text('a'.repeat(4 * 1024 * 1024))])], ['code'])], ['codewrap'])])
  const started = Date.now()
  h.setIndex(0)
  h.updateFind()
  assert.equal(highlights.get('desk-find').size, 10000)
  assert.equal(elements['#find-count'].textContent, '1 / 10,000+')
  assert.ok(Date.now() - started < 3000, '4MBの1文字検索で全一致を処理しない')
  let scrolls = 0
  body.childNodes[0].childNodes[0].childNodes[0].scrollHeight = 1000
  body.childNodes[0].childNodes[0].childNodes[0].clientHeight = 100
  body.childNodes[0].childNodes[0].childNodes[0].scrollBy = () => { scrolls++ }
  h.scheduleFind(true)
  h.scheduleFind()
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(scrolls > 0, 'MutationObserverが入力の移動要求を消さない')
  for (const [ctrlKey, metaKey, expected] of [[true, false, true], [false, true, true], [true, true, false], [false, false, false]]) {
    assert.equal(h.isFindShortcut({ key: 'f', ctrlKey, metaKey }), expected)
  }
  // 実際に登録する入力ハンドラへ、IME確定Enterを渡す。
  const handlers = {}
  for (const id of ['#workspace-search', '#find-input', '#preview-body']) {
    const el = id === '#preview-body' ? body : (elements[id] ||= {})
    el.addEventListener = (type, fn) => { handlers[id + type] = fn }
  }
  for (const id of ['#find-prev', '#find-next', '#find-close']) elements[id] = {}
  context.api = { onSearchEvent: () => {} }
  context.MutationObserver = class { observe() {} }
  h.setupSearch()
  for (const id of ['#workspace-search', '#find-input']) {
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      handlers[id + 'keydown']({ key: 'Enter', ...flags, preventDefault: () => assert.fail('IME確定で検索を実行した') })
    }
  }
  // 横スクロールを内側から解消し、プレビューより上の祖先は動かさない。
  const nestedText = text('a')
  const inner = new Element('div', [nestedText])
  body = new Element('div', [inner])
  const outer = new Element('div', [body])
  const moved = []
  for (const [name, el] of [['inner', inner], ['body', body], ['outer', outer]]) {
    Object.assign(el, { scrollWidth: 2000, clientWidth: 300, scrollHeight: 2000, clientHeight: 300 })
    el.scrollBy = delta => moved.push({ name, ...delta })
  }
  h.updateFind(true)
  assert.deepEqual(moved.map(item => item.name), ['inner', 'body'])
  assert.ok(moved.every(item => item.left !== 0 && item.top !== 0))

  // PDFの本文抽出だけが失敗しても、作成済みのビューをiframeに交換しない。
  const pdfBody = { firstElementChild: { firstElementChild: {}, querySelector: () => null } }
  let pdfHtml = ''
  Object.defineProperty(pdfBody, 'innerHTML', { set(value) { pdfHtml = value } })
  body = pdfBody
  context.currentFile = { kind: 'pdf' }
  context.t = key => key
  context.showToast = () => {}
  context.AbortController = AbortController
  context.ResizeObserver = class { observe() {} }
  context.URL = URL
  context.location = { href: 'file:///desk/renderer/index.html' }
  h.setPdfModules({
    pdfjs: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => { throw new Error('text failed') } }) }) },
    EventBus: class { on() {} },
    PDFLinkService: class { setViewer() {} setDocument() {} },
    PDFViewer: class { setDocument() {} },
  })
  await h.renderPdf({ path: '/test.pdf', url: 'file:///test.pdf' }, 0)
  assert.equal(h.getPdf().searchFailed, true)
  assert.ok(pdfHtml.includes('pdfViewer'))
  assert.ok(!pdfHtml.includes('iframe'))
  assert.equal(elements['#find-count'].textContent, 'search.pdfUnavailable')
  h.setPdf(null)
  // 進捗通知で、押しかけの中止ボタンや既存のヒットを交換しない。
  elements['#preview-title'] = { classList: { remove() {} } }
  elements['#preview-actions'] = { append(node) { this.button = node } }
  const resultNodes = {}
  for (const key of ['progress', 'error', 'failed', 'limit']) resultNodes['[data-search-' + key + ']'] = {}
  const appended = []
  resultNodes['[data-search-groups]'] = { insertAdjacentHTML(_where, html) { if (html) appended.push({ html }) } }
  const resultBody = { querySelector: selector => resultNodes[selector] }
  let resets = 0
  Object.defineProperty(resultBody, 'innerHTML', { set() { resets++ } })
  body = resultBody
  context.t = key => key
  context.escapeHtml = value => String(value)
  context.fileIcon = () => ''
  context.document.createElement = () => ({})
  const group = name => ({ relative: name, hits: [{ ordinal: 0, line: 1, snippet: { before: '', match: 'a', after: '' } }] })
  h.setResults({ id: 42, root: '/test', query: 'a', groups: [group('a.txt')], expanded: new Set(), running: true })
  h.paintSearchResults()
  const cancelButton = elements['#preview-actions'].button
  const firstGroup = appended[0]
  h.receiveSearchEvent({ id: 42, type: 'batch', scanned: 2, results: [group('b.txt')] })
  h.receiveSearchEvent({ id: 42, type: 'batch', scanned: 3 })
  assert.equal(resets, 1)
  assert.equal(elements['#preview-actions'].button, cancelButton)
  assert.equal(appended.length, 2)
  assert.equal(appended[0], firstGroup)
  h.receiveSearchEvent({ id: 42, type: 'done', scanned: 3 })
  assert.equal(cancelButton.hidden, true)
  h.closeFind()
  assert.equal(highlights.size, 0)
  assert.equal(elements['#find-bar'].hidden, true)
  console.log('  renderer: DOM位置・PDF抽出失敗/予約消去・内側縦横スクロール・10,000件上限・入力予約・IME/ショートカット・結果DOM保持 OK')
}

async function testMainIpc(root) {
  const Module = require('module')
  const user = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-search-user-'))
  const folder = path.join(root, 'ipc')
  await fs.mkdir(folder)
  await fs.writeFile(path.join(folder, 'note.txt'), '注⽂ 注文')
  await fs.copyFile(path.join(root, 'book.xlsx'), path.join(folder, 'book.xlsm'))
  await fs.writeFile(path.join(user, 'user-config.json'), JSON.stringify({ root }))
  const handlers = {}
  const lifecycle = {}
  const stub = {
    app: { getPath: () => user, getVersion: () => 'test', getLocale: () => 'en',
      whenReady: () => Promise.resolve(), on: (name, fn) => { lifecycle[name] = fn }, quit: () => {} },
    BrowserWindow: function () { return { loadFile: () => {}, webContents: { on: () => {}, setWindowOpenHandler: () => {} } } },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn }, on: () => {} },
    nativeImage: { createFromDataURL: () => ({}) }, shell: {}, clipboard: {}, dialog: {},
  }
  const originalLoad = Module._load
  Module._load = function (request) { return request === 'electron' ? stub : originalLoad.apply(this, arguments) }
  try { require('./main') } finally { Module._load = originalLoad }
  try {
    await new Promise(resolve => setImmediate(resolve))
    const received = []
    const event = { sender: { isDestroyed: () => false, send: (channel, payload) => {
      assert.equal(channel, 'search-event')
      received.push(payload)
    } } }
    for (const broad of ['', os.homedir(), path.parse(root).root, path.dirname(root)]) {
      assert.equal(handlers['search-start'](event, { root: broad, query: '注文' }).error, 'broad')
    }
    // root 自身はウォッチと違って検索可能。中止は id が一致する検索にだけ作用する。
    const first = handlers['search-start'](event, { root, query: '注文', kinds: ['text'] })
    assert.ok(first.id)
    handlers['search-cancel'](event, first.id)
    const second = handlers['search-start'](event, { root: folder, query: '注文', kinds: ['text'] })
    handlers['search-cancel'](event, first.id)
    assert.notEqual(first.id, second.id)
    const start = Date.now()
    while (!received.some(payload => payload.id === second.id && payload.type === 'done')) {
      if (Date.now() - start > 10000) throw new Error('main IPC search timeout')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const done = received.find(payload => payload.id === second.id && payload.type === 'done')
    assert.equal(done.total, 2)
    assert.equal(done.cancelled, false)
    assert.ok(received.every(payload => payload.id === second.id), '旧検索のイベントを新検索へ流さない')
    const preview = await handlers['read-file'](event, path.join(folder, 'book.xlsm'))
    assert.equal(preview.kind, 'sheet')
    assert.equal(preview.sheets[0].rows[0][0], '注⽂')
    const huge = path.join(folder, 'huge.xlsx')
    const handle = await fs.open(huge, 'w')
    await handle.truncate(30 * 1024 * 1024 + 1)
    await handle.close()
    const tooLarge = await handlers['read-file'](event, huge)
    assert.equal(tooLarge.kind, 'toolarge')
    assert.equal(tooLarge.maxMB, 30)
    console.log('  main IPC: 広範囲ガード・root検索許可・検索世代/中止・Worker経由Excelプレビュー OK')
  } finally {
    lifecycle['before-quit']?.()
    await fs.rm(user, { recursive: true, force: true })
  }
}

async function run() {
  await testDomPositions()
  assert.deepEqual(core.findInSegment('注⽂', query('注文')), [[0, 2]])
  assert.deepEqual(core.findInSegment('ＡbＣ abc', query('aBc')), [[0, 3], [4, 7]])
  for (const [text, input, expected] of [
    ['🙂注⽂🙂', '注文', '注⽂'], ['😀ﬃx', 'ffi', 'ﬃ'], ['ＡＢＣ', 'abc', 'ＡＢＣ'],
    ['x㍿y', '株式会社', '㍿'], ['𝔄B', 'ab', '𝔄B'], ['İ', 'i', 'İ'],
  ]) {
    const hits = core.findInSegment(text, query(input))
    assert.equal(hits.length, 1)
    assert.equal(text.slice(...hits[0]), expected)
  }
  assert.deepEqual(core.findInSegment('aaaa', query('aa')), [[0, 2], [2, 4]])
  assert.deepEqual(core.findInSegment('aaaa', query('a'), 2), [[0, 1], [1, 2]])
  assert.deepEqual(core.findInSegment('ﬃ', query('f')), [[0, 1]])
  assert.deepEqual(core.findInSegment('x', ''), [])
  assert.equal(['注', '文'].flatMap(text => core.findInSegment(text, query('注文'))).length, 0)
  assert.deepEqual(core.makeSnippet('abcdefghi', 3, 5, 2), { before: '…bc', match: 'de', after: 'fg…' })
  assert.equal(core.pageText({ items: [{ str: '注', hasEOL: true }, { type: 'beginMarkedContent' }, { str: '⽂' }] }), '注⽂')
  // UMD の browser 側も同じ公開面を持つ。
  const sandbox = { self: {} }
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'renderer/search-core.js'), 'utf8'), sandbox)
  assert.equal(sandbox.self.DeskSearch.normalizeWithMap('Ａ').norm, 'a')

  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['注⽂', 'abc abc'], [null, 1234]])
  sheet.B2.z = '#,##0'
  sheet.B2.w = '1,234'
  XLSX.utils.book_append_sheet(book, sheet, '表1')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['注文']]), '表2')
  const sheets = core.sheetRows(book)
  assert.deepEqual(sheets[0].rows, [['注⽂', 'abc abc'], ['', '1,234']])
  const segments = core.sheetSegments(sheets)
  assert.deepEqual(segments.map(item => [item.sheet, item.cell, item.text]), [
    ['表1', 'A1', '注⽂'], ['表1', 'B1', 'abc abc'], ['表1', 'B2', '1,234'], ['表2', 'A1', '注文'],
  ])
  assert.deepEqual(segments.flatMap(item => core.findInSegment(item.text, query('注文')).map(() => item.cell)), ['A1', 'A1'])
  const limited = core.sheetRows({ SheetNames: ['big'], Sheets: { big: { '!ref': 'A1:GS5001', A1: { v: 'x' }, GS5001: { v: 'edge' } } } })[0]
  assert.equal(limited.rows.length, 5000)
  assert.equal(limited.rows[0].length, 200)
  assert.equal(limited.truncated, true)
  const sparse = core.sheetRows({ SheetNames: ['sparse'], Sheets: { sparse: {
    '!ref': 'A1:XFD1048576', A1: { v: '注文' }, B2: { v: '注文' }, XFD1048576: { s: {} },
  } } })[0]
  assert.deepEqual(sparse.rows, [['注文', ''], ['', '注文']])
  assert.equal(sparse.truncated, false)
  assert.deepEqual(core.sheetSegments([sparse]).map(item => item.cell), ['A1', 'B2'])
  console.log('  search-core: NFKC・UTF-16位置マップ・非重複・セグメント・Excel順 OK')

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-search-'))
  let worker
  try {
    await fs.writeFile(path.join(root, 'a.md'), '注文\n注⽂\n注\n文\n')
    await fs.writeFile(path.join(root, 'b.txt'), 'ＡＢＣ abc\n注文 注文')
    await fs.writeFile(path.join(root, 'nul.txt'), '\0注文')
    await fs.writeFile(path.join(root, 'huge.txt'), '注文' + 'x'.repeat(4 * 1024 * 1024))
    await fs.writeFile(path.join(root, 'bad.pdf'), 'not a pdf')
    await fs.writeFile(path.join(root, 'bad.docx'), 'not a docx')
    await fs.writeFile(path.join(root, 'bad.xlsx'), Buffer.from([0, 255, 0, 255]))
    await fs.writeFile(path.join(root, 'book.xlsx'), XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
    for (const name of ['.git', 'node_modules', '.obsidian', 'dist', '.venv', 'venv', '__pycache__', '.next', '.cache', '.claude']) {
      await fs.mkdir(path.join(root, name))
      await fs.writeFile(path.join(root, name, 'skip.txt'), '注文')
    }
    try { await fs.symlink(path.join(root, 'a.md'), path.join(root, 'link.txt')) }
    catch (err) { if (!['EPERM', 'EACCES'].includes(err.code)) throw err; console.log('  symlink 作成権限なし: リンク検証をスキップ') }
    let pdfSupported = true
    try {
      const extracted = await pdfPages(pdfFixture())
      assert.equal(extracted.segments[0].text, 'Order order')
      assert.equal(extracted.segments[0].page, 1)
    } catch (err) {
      // Node 20 のビルドによって Canvas polyfill が無い場合は、理由を隠さず出す。
      if (err instanceof assert.AssertionError) throw err
      pdfSupported = false
      console.log('  PDF 抽出スキップ: ' + err.message)
    }
    if (pdfSupported) await fs.writeFile(path.join(root, 'minimal.pdf'), pdfFixture())
    // インストーラ版は @napi-rs/canvas を同梱しない（build.files で除外）。その状態でも PDF の
    // テキスト抽出が通ることを、@napi-rs の解決を塞いだ別プロセスで確かめる。
    // ⚠ ここが落ちたままだとインストーラ版だけ PDF が全部「読めなかった」になる（v0.15.0 実測）。
    {
      const { execFileSync } = require('child_process')
      const side = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-no-canvas-'))
      const block = path.join(side, 'block-napi.js')
      await fs.writeFile(block, "const M = require('module'); const r = M._resolveFilename; M._resolveFilename = function (req, ...a) { if (String(req).startsWith('@napi-rs/')) { const e = new Error('blocked ' + req); e.code = 'MODULE_NOT_FOUND'; throw e } return r.call(this, req, ...a) }")
      const fixture = path.join(side, 'no-canvas.pdf')
      await fs.writeFile(fixture, pdfFixture())
      const script = `require(${JSON.stringify(path.join(__dirname, 'search-engine.js'))}).pdfPages(require('fs').readFileSync(${JSON.stringify(fixture)})).then(r => process.stdout.write(r.segments[0].text), e => { process.stdout.write('FAIL ' + e.message); process.exitCode = 1 })`
      const out = execFileSync(process.execPath, ['-r', block, '-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      assert.equal(out, 'Order order', '@napi-rs/canvas 無しで PDF 抽出が落ちる: ' + out)
      console.log('  PDF: @napi-rs/canvas 無し（インストーラ版相当）でも抽出 OK')
    }

    worker = new Worker(path.join(__dirname, 'search-worker.js'))
    let sequence = 0
    function workerSearch(request, onBatch) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const flag = new Int32Array(new SharedArrayBuffer(4))
        const events = []
        const timeout = setTimeout(() => finish(new Error('Worker search timeout')), 30000)
        function finish(error, result) {
          clearTimeout(timeout)
          worker.off('message', listener)
          worker.off('error', onError)
          if (error) reject(error)
          else resolve(result)
        }
        const onError = error => finish(error)
        const listener = event => {
          if (event.id !== id) return
          events.push(event)
          if (onBatch && event.type === 'batch') onBatch(event, flag)
          if (event.type === 'done') finish(null, { state: event, groups: events.flatMap(item => item.results || []) })
        }
        worker.on('message', listener)
        worker.once('error', onError)
        worker.postMessage({ type: 'search', id, flag: flag.buffer, root, query: ' 注文 ', ...request })
      })
    }
    const found = await workerSearch({ kinds: ['text'] })
    assert.equal(found.state.total, 4)
    assert.equal(found.state.files, 2)
    assert.deepEqual(found.groups.find(group => group.relative === 'a.md').hits.map(hit => [hit.line, hit.ordinal]), [[1, 0], [2, 1]])
    const excel = await workerSearch({ kinds: ['sheet'] })
    const group = excel.groups.find(item => item.relative === 'book.xlsx')
    assert.deepEqual(group.hits.map(hit => [hit.sheet, hit.cell, hit.ordinal]), [['表1', 'A1', 0], ['表2', 'A1', 1]])
    const all = await workerSearch({ kinds: [] })
    assert.equal(all.state.total, 6)
    assert.ok(all.state.failed >= 2, '解析失敗でも後続ファイルを検索する')
    const capped = await workerSearch({ kinds: ['text'], maxFile: 1 })
    assert.equal(capped.state.total, 2)
    assert.equal(capped.state.limited, true)
    assert.ok(capped.groups.every(item => item.limited))
    const totalCap = await workerSearch({ kinds: ['text'], maxTotal: 2 })
    assert.equal(totalCap.state.total, 2)
    assert.equal(totalCap.state.limited, true)
    const folded = await workerSearch({ query: 'abc', kinds: ['text'] })
    assert.equal(folded.state.total, 2)
    await fs.writeFile(path.join(root, 'a.md'), '注文 注文 注文\n')
    const changed = await workerSearch({ kinds: ['text'] })
    assert.equal(changed.state.total, 5, 'size/mtime が変わればキャッシュを破棄')
    if (pdfSupported) {
      const pdf = await workerSearch({ kinds: ['pdf'], query: 'ORDER' })
      assert.equal(pdf.state.total, 2)
      assert.deepEqual(pdf.groups[0].hits.map(hit => [hit.page, hit.ordinal]), [[1, 0], [1, 1]])
      console.log('  PDF: メモリ生成→legacy抽出→Worker検索 OK')
    }
    const flag = new Int32Array(new SharedArrayBuffer(4))
    Atomics.store(flag, 0, 1)
    const cancelled = await new Promise((resolve, reject) => {
      const id = ++sequence
      const listener = event => { if (event.id === id && event.type === 'done') { worker.off('message', listener); resolve(event) } }
      worker.on('message', listener)
      worker.once('error', reject)
      worker.postMessage({ type: 'search', id, root, query: '注文', flag: flag.buffer })
    })
    assert.equal(cancelled.cancelled, true)
    assert.equal(cancelled.scanned, 0)
    // 実際の走査途中の中止。進捗イベントを受けて停止できることも確認する。
    await fs.mkdir(path.join(root, 'many'))
    for (let index = 0; index < 70; index++) await fs.writeFile(path.join(root, 'many', index + '.txt'), 'x'.repeat(100000) + 'needle')
    const midway = await workerSearch({ query: 'needle', kinds: ['text'] }, (event, shared) => {
      if (event.scanned > 0) Atomics.store(shared, 0, 1)
    })
    assert.equal(midway.state.cancelled, true)
    assert.ok(midway.state.scanned < 80)
    const stalled = path.join(root, 'heartbeat.txt')
    await fs.writeFile(stalled, 'heartbeat')
    const originalRead = fs.readFile
    const progress = []
    fs.readFile = async function (file, ...args) {
      if (file === stalled) await new Promise(resolve => setTimeout(resolve, 650))
      return originalRead.call(this, file, ...args)
    }
    try {
      await search({ root, query: 'never-found-heartbeat', kinds: ['text'] }, event => progress.push(event))
    } finally { fs.readFile = originalRead }
    const batches = progress.filter(event => event.type === 'batch')
    for (let index = 1; index < batches.length; index++) {
      const previous = batches[index - 1]
      const current = batches[index]
      assert.ok(current.results.length || ['scanned', 'total', 'files', 'failed', 'limited', 'cancelled'].some(key => current[key] !== previous[key]), '数値も結果も変わらない定期送信はしない')
    }
    const events = []
    const noCross = await search({ root, query: '注文注文', kinds: ['text'] }, event => events.push(event))
    assert.equal(noCross.total, 0)
    console.log('  Worker: 走査・除外・NUL/サイズ上限・フィルタ・件数上限・キャッシュ更新・進捗/中止 OK')
    await testMainIpc(root)
  } finally {
    if (worker) await worker.terminate()
    await fs.rm(root, { recursive: true, force: true })
  }
  console.log('test-search.js: PASS')
}
run().catch(err => { console.error(err); process.exitCode = 1 })
