// i18n の静的検査。check.sh から呼ばれる。
//   1. 辞書の穴（全キー x 全言語）
//   2. 使用キーと辞書の突合（辞書に無い＝画面にキー名が出る／未使用＝消し忘れ）
// ※「t() がそのスコープで本当に関数か」は静的には見えないので check.sh 側で
//   識別子 t のシャドウイングを禁止して担保している（2026-07-28 の実バグ対策）。
const fs = require('fs')
const path = require('path')
const i18n = require('./renderer/i18n')

const here = (p) => path.join(__dirname, p)
let failed = false
const bad = (msg) => { console.error('    ' + msg); failed = true }

// 1) 辞書の穴
const missing = i18n.checkMissing(null)
if (missing.length) {
  bad(`未翻訳 ${missing.length}件: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`)
} else {
  console.log(`  辞書 OK (${Object.keys(i18n.STRINGS).length}キー x ${i18n.LANGS.length}言語)`)
}

// 2) 使用キーの収集
const used = new Set()

const html = fs.readFileSync(here('renderer/index.html'), 'utf8')
for (const m of html.matchAll(/data-i18n(?:-title|-ph)?="([^"]+)"/g)) {
  if (m[1]) used.add(m[1])
}

// t('key') / t("key") のみ拾う（引用符を必須にしないと t(el.dataset...) まで拾ってしまう）
const CALL = /\bt\(\s*(['"])([^'"]+)\1/g
for (const f of ['renderer/app.js', 'main.js']) {
  for (const m of fs.readFileSync(here(f), 'utf8').matchAll(CALL)) used.add(m[2])
}

const unknown = [...used].filter((k) => !i18n.STRINGS[k])
const unused = Object.keys(i18n.STRINGS).filter((k) => !used.has(k))

if (unknown.length) bad(`辞書に無いキー（画面にキー名が出る）: ${unknown.join(', ')}`)
if (unused.length) bad(`どこからも使われていないキー: ${unused.join(', ')}`)
if (!unknown.length && !unused.length) console.log(`  キー突合 OK (${used.size}件・過不足なし)`)

process.exit(failed ? 1 : 0)
