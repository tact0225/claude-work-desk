// main / Worker / DOM で照合規則を共有し、クリックした一致の位置がずれないようにする。
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.DeskSearch = api
})(typeof self !== 'undefined' ? self : this, function () {
  function normalizeWithMap(str) {
    let norm = ''
    const map = []
    let offset = 0
    for (const ch of String(str)) {
      const part = ch.normalize('NFKC').toLowerCase()
      for (let i = 0; i < part.length; i++) map.push({ start: offset, end: offset + ch.length })
      norm += part
      offset += ch.length
    }
    return { norm, map }
  }

  // normalizeWithMap の norm だけを作る（対応表を持たない＝軽い）。1文字ずつ正規化する規則は
  // 同じなので、ファイル全体の正規化文字列に語が無ければどのセグメントにも一致は無い
  // （セグメントの区切りは改行で、改行は検索語に入らない）＝横断検索の足切りに使う。
  function normalize(str) {
    // 英小文字・数字・記号（ASCII の A-Z 以外）は NFKC でも小文字化でも変わらないので触らない
    return String(str).replace(/[^\x00-\x40\x5b-\x7f]/gu, ch => ch.normalize('NFKC').toLowerCase())
  }

  function findInSegment(text, normQuery, maxMatches = Infinity) {
    if (!normQuery) return []
    // ⚠ 巨大な1行でも全文字の対応表を抱えず、一致位置まで元文字を順に辿る。
    const norm = normalize(text)
    const chars = String(text)[Symbol.iterator]()
    let normEnd = 0
    let sourceEnd = 0
    let sourceStart = 0
    function advance(position) {
      while (normEnd <= position) {
        const { value, done } = chars.next()
        if (done) break
        sourceStart = sourceEnd
        sourceEnd += value.length
        normEnd += value.normalize('NFKC').toLowerCase().length
      }
    }
    const matches = []
    let pos = 0
    let previousEnd = -1
    while ((pos = norm.indexOf(normQuery, pos)) !== -1) {
      advance(pos)
      const start = sourceStart
      advance(pos + normQuery.length - 1)
      const end = sourceEnd
      // ⚠ ㍿ 等の展開文字の内部で複数回当たっても、同じ元文字を重複して数えない。
      if (start >= previousEnd) {
        matches.push([start, end])
        previousEnd = end
        if (matches.length >= maxMatches) break
      }
      pos += normQuery.length
    }
    return matches
  }

  function makeSnippet(text, start, end, radius = 40) {
    const left = Math.max(0, start - radius)
    const right = Math.min(text.length, end + radius)
    return { before: (left ? '…' : '') + text.slice(left, start), match: text.slice(start, end), after: text.slice(end, right) + (right < text.length ? '…' : '') }
  }

  function columnName(index) {
    let name = ''
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
    return name
  }

  function sheetRows(workbook) {
    return workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name]
      // ⚠ !ref は書式だけでも全シートに広がるため、実際に値を持つセルで範囲を決める。
      let height = 0
      let cols = 0
      for (const key of Object.keys(sheet)) {
        const cell = sheet[key]
        const parsed = /^([A-Z]+)(\d+)$/i.exec(key)
        if (!parsed || !cell || ((cell.v == null || cell.v === '') && (cell.w == null || cell.w === ''))) continue
        let col = 0
        for (const ch of parsed[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64
        cols = Math.max(cols, col)
        height = Math.max(height, Number(parsed[2]))
      }
      const width = Math.min(cols, 200)
      const rows = []
      for (let row = 0; row < Math.min(height, 5000); row++) {
        const cells = []
        for (let col = 0; col < width; col++) {
          const cell = sheet[columnName(col) + (row + 1)]
          cells.push(cell ? String(cell.w != null ? cell.w : cell.v != null ? cell.v : '') : '')
        }
        rows.push(cells)
      }
      return { name, rows, truncated: height > 5000 || cols > 200 }
    })
  }

  // ⚠ hasEOL や span 間の空白を補うと、PDF textLayer と ordinal が変わる。
  // PDFViewer の TextLayerBuilder と同じ取得オプションにする。標準の正規化は長さを変える。
  const PDF_TEXT_OPTIONS = { includeMarkedContent: true, disableNormalization: true }
  function pageText(content) { return content.items.filter(item => typeof item.str === 'string').map(item => item.str).join('') }
  function sheetSegments(sheets) {
    const segments = []
    for (const sheet of sheets) sheet.rows.forEach((row, r) => row.forEach((text, c) => {
      if (text) segments.push({ text, sheet: sheet.name, cell: columnName(c) + (r + 1) })
    }))
    return segments
  }
  return { normalizeWithMap, normalize, findInSegment, makeSnippet, columnName, sheetRows, sheetSegments, pageText, PDF_TEXT_OPTIONS }
})
