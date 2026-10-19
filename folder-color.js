// 色ラベルの保存キー。fs に依存させず、Windows / WSL の表記差も node だけで検証する。
const path = require('path')
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']

function pathApi(p) {
  return /^(?:[a-z]:|\/\/)/i.test(p) ? path.win32 : path.posix
}

function normalized(p) { return String(p || '').replace(/\\/g, '/') }
function key(p) { return normalized(p).replace(/\/+$/, '').toLowerCase() }
function inside(root, dir) { return key(dir) === key(root) || key(dir).startsWith(key(root) + '/') }

function storeFolderDir(root, dir) {
  const raw = normalized(dir)
  if (!raw || !pathApi(raw).isAbsolute(raw)) return null
  const abs = normalized(pathApi(raw).normalize(raw))
  const base = normalized(root)
  if (!base) return abs
  const resolvedRoot = normalized(pathApi(base).normalize(base))
  // ⚠ path.relative は POSIX で大小文字を区別する。比較は pathKey と同じ大小同一・区切り統一で
  //    行い、境界の / まで確かめる（root2 を root 配下と誤認しない）。
  if (!inside(resolvedRoot, abs)) return abs
  return abs.slice(resolvedRoot.replace(/\/+$/, '').length).replace(/^\/+/, '') || '.'
}

function resolveFolderDir(root, stored) {
  const raw = normalized(stored)
  if (!raw) return null
  if (pathApi(raw).isAbsolute(raw)) return normalized(pathApi(raw).normalize(raw))
  const base = normalized(root)
  if (!base || !pathApi(base).isAbsolute(base) || /^[a-z]:/i.test(raw)) return null
  const abs = normalized(pathApi(base).resolve(base, raw))
  // ⚠ 手編集の ../outside をルート外の絶対キーに化けさせない。外は明示的な絶対パスだけ。
  return inside(normalized(pathApi(base).normalize(base)), abs) ? abs : null
}

module.exports = { COLORS, storeFolderDir, resolveFolderDir }
