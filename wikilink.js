// Wikilink（[[ページ名]]）を解決して Markdown に混ぜ込む。
//
// CommonMark に [[ ]] は無いので marked は素通しする＝プレビューではただの文字列になる。
// Obsidian をやめると誰も解決しなくなるため、その意味論（パスでなく「名前」で引く）を
// このアプリ側で再現する。探索ディレクトリは config の wikilinkDirs で外から差せる。
//
// 対応記法: [[target]] / [[target|表示名]] / [[target.md]] / [[sub/dir/target]]
// 解決できないリンクは <span class="wikilink missing"> にする（消さずに残す）＝
// 「まだ書いてない知識の印」という運用をそのまま活かすため。

const fs = require('fs')
const path = require('path')

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// target → 絶対パス（見つからなければ null）。1レンダリング内はメモ化する。
function makeResolver(root, dirs, mdDir) {
  const cache = new Map()
  const bases = [mdDir, ...(dirs || []).map(d => path.resolve(root, d))]

  return function resolve(target) {
    if (cache.has(target)) return cache.get(target)

    // 見出しアンカー・末尾の .md は落として名前だけにする
    const name = target.trim().replace(/#.*$/, '').replace(/\.md$/i, '')
    let hit = null

    if (name) {
      search:
      for (const base of bases) {
        if (!base) continue
        // skills/<名前>/SKILL.md のように「ディレクトリ名がページ名」になる置き方も拾う
        for (const cand of [`${name}.md`, name, path.join(name, 'SKILL.md'), path.join(name, 'README.md'), path.join(name, 'index.md')]) {
          let p
          try { p = path.resolve(base, cand) } catch (e) { continue }
          // root の外に出るリンクは辿らない（../ の暴走よけ）
          if (root && !p.startsWith(path.resolve(root) + path.sep)) continue
          try {
            if (fs.statSync(p).isFile()) { hit = p; break search }
          } catch (e) { /* 無ければ次の候補 */ }
        }
      }
    }

    cache.set(target, hit)
    return hit
  }
}

function wikilinkExtension(resolve) {
  return {
    name: 'wikilink',
    level: 'inline',
    start(src) { return src.indexOf('[[') },
    tokenizer(src) {
      const m = /^\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/.exec(src)
      if (!m) return
      return {
        type: 'wikilink',
        raw: m[0],
        target: m[1].trim(),
        label: (m[2] || m[1]).trim(),
      }
    },
    renderer(token) {
      const label = escapeHtml(token.label)
      const hit = resolve(token.target)
      if (!hit) {
        return `<span class="wikilink missing" title="未作成: ${escapeHtml(token.target)}">${label}</span>`
      }
      return `<a class="wikilink" href="#" data-wiki="${escapeHtml(hit)}" title="${escapeHtml(hit)}">${label}</a>`
    },
  }
}

// ```mermaid のフェンスだけは <pre class="mermaid"> にして、中身を「生の Mermaid ソース」の
// ままレンダラへ渡す（描画するのは renderer 側の mermaid.js＝main は図を知らない）。
// ⚠ <code> で包まない。mermaid.run() が拾うのは要素の textContent なので包んでも描けはするが、
//    描けなかった時に「元のコードブロックへ戻す」判定を renderer 側の1箇所に閉じておきたい。
// ⚠ エスケープは必須。`A --> B` の `>` や `<br/>` を素通しすると、そこで HTML が始まってしまい
//    図のソースが壊れる（textContent で読み戻すので、エスケープしてもソースは元に戻る）。
function mermaidRenderer() {
  return {
    code(code, infostring) {
      const lang = String(infostring || '').trim().split(/\s+/)[0].toLowerCase()
      if (lang !== 'mermaid') return false // false = 既定のコードブロックに任せる（他の言語は今までどおり）
      return `<pre class="mermaid">${escapeHtml(code)}</pre>\n`
    },
  }
}

// marked は use() がグローバルに積み上がるので、レンダリングごとに独立インスタンスを作る
function renderMarkdown(source, mdDir, opts = {}) {
  const { Marked } = require('marked')
  const md = new Marked()
  md.use({
    extensions: [wikilinkExtension(makeResolver(opts.root || '', opts.dirs || [], mdDir))],
    renderer: mermaidRenderer(),
  })
  return md.parse(source, { async: false })
}

module.exports = { renderMarkdown, makeResolver, escapeHtml }
