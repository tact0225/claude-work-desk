// 保存キーは純粋関数で、永続化は test-inbox.js と同じ Electron 差し替えで本物の IPC を叩く。
const assert = require('assert/strict')
const { storeFolderDir, resolveFolderDir } = require('./folder-color')
const Module = require('module')
const fs = require('fs')
const path = require('path')
const os = require('os')

for (const [root, dir, stored] of [
  ['/work', '/work/todo', 'todo'],
  ['/work/', '/WORK/Company/Docs', 'Company/Docs'],
  ['/work', '/work', '.'],
  ['/', '/todo', 'todo'],
  ['/work', '/outside', '/outside'],
  ['/work', '/work2/todo', '/work2/todo'],
  ['/work', '/work/../outside', '/outside'],
  ['/work', '/work/..todo', '..todo'],
  ['', '/outside', '/outside'],
  ['C:\\Work', 'c:/WORK/Todo/Sub', 'Todo/Sub'],
  ['C:/Work', 'D:\\Other', 'D:/Other'],
  ['C:/', 'c:/Todo', 'Todo'],
  ['\\\\wsl.localhost\\Ubuntu\\home\\me', '//WSL.LOCALHOST/Ubuntu/home/ME/todo', 'todo'],
]) assert.equal(storeFolderDir(root, dir), stored, `保存: ${dir}`)

for (const [root, stored, abs] of [
  ['/moved', 'todo/docs', '/moved/todo/docs'],
  ['/moved', 'todo\\docs', '/moved/todo/docs'],
  ['/moved', '.', '/moved'],
  ['/moved', '/outside', '/outside'],
  ['/work', '../outside', null],
  ['/work', 'a/../../outside', null],
  ['/work', '..\\outside', null],
  ['/work', '..todo', '/work/..todo'],
  ['/work', 'a/../todo', '/work/todo'],
  ['', 'todo', null],
  ['/work', 'C:relative', null],
  ['C:/Moved', 'Todo\\Sub', 'C:/Moved/Todo/Sub'],
  ['C:/Work', '../outside', null],
  ['C:/Work', 'D:\\Other', 'D:/Other'],
  ['//wsl.localhost/Ubuntu/home/me', 'todo', '//wsl.localhost/Ubuntu/home/me/todo'],
]) assert.equal(resolveFolderDir(root, stored), abs, `解決: ${stored}`)
assert.equal(storeFolderDir('/work', 'relative'), null)

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-color-test-'))
const WS = path.join(TEMP, 'workspace')
const USER = path.join(TEMP, 'user')
const MOVED = path.join(TEMP, 'moved')
for (const dir of [WS, USER, MOVED, path.join(WS, 'todo')]) fs.mkdirSync(dir)
const configFile = path.join(USER, 'user-config.json')
fs.writeFileSync(configFile, JSON.stringify({ root: WS, folderColors: { TODO: 'blue' } }))
fs.writeFileSync(path.join(WS, 'file.txt'), 'test')
const handlers = {}
const stub = {
  app: { getPath: () => USER, getVersion: () => 'test', getLocale: () => 'en',
    whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: function () { return { loadFile: () => {}, webContents: { on: () => {}, setWindowOpenHandler: () => {} } } },
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn }, on: () => {} },
  dialog: { showOpenDialog: async () => ({ filePaths: [MOVED] }) },
  shell: {}, clipboard: {}, nativeImage: { createFromDataURL: () => ({}) },
}
const origLoad = Module._load
Module._load = function (req, parent, isMain) {
  return req === 'electron' ? stub : origLoad.apply(this, arguments)
}
try { require('./main') } finally { Module._load = origLoad }

;(async () => {
  try {
    await new Promise(resolve => setImmediate(resolve))
    const dir = path.join(WS, 'todo')
    const saved = () => JSON.parse(fs.readFileSync(configFile, 'utf8')).folderColors
    const setColor = (target, color) => handlers['set-folder-color'](null, target, color)
    assert.equal((await setColor(dir, 'red')).ok, true)
    assert.deepEqual(saved(), { todo: 'red' }) // 大小文字違いの旧キーを重複させない
    assert.equal(handlers['get-config']().folderColors[dir.replace(/\\/g, '/')], 'red')
    assert.equal((await setColor(dir, 'invalid')).ok, false) // パレット外は弾く＝付いている色を消さない
    assert.deepEqual(saved(), { todo: 'red' })
    await setColor(dir, null)
    assert.deepEqual(saved(), {})
    await setColor(dir, 'green')
    await setColor(dir, null)
    assert.deepEqual(saved(), {})
    assert.equal((await setColor(path.join(WS, 'file.txt'), 'red')).ok, false)
    assert.equal((await setColor('relative', 'red')).ok, false)
    const special = path.join(WS, '__proto__')
    fs.mkdirSync(special)
    await setColor(special, 'yellow')
    assert.equal(saved().__proto__, 'yellow') // 普通のフォルダ名をオブジェクトの特殊キー扱いしない
    await setColor(special, null)
    assert.deepEqual(saved(), {})
    await setColor(USER, 'gray') // ルート外は絶対パス
    await setColor(dir, 'purple')
    assert.equal(saved()[USER.replace(/\\/g, '/')], 'gray')
    await handlers['choose-root']()
    assert.equal(handlers['get-config']().folderColors[path.join(MOVED, 'todo').replace(/\\/g, '/')], 'purple')
    assert.equal(handlers['get-config']().folderColors[USER.replace(/\\/g, '/')], 'gray')
    assert.equal(handlers['get-config']().folderColors[dir.replace(/\\/g, '/')], undefined)
    console.log('  フォルダ色テスト OK (保存・解決29ケース＋IPC永続化・解除・ルート切り替え)')
  } finally { fs.rmSync(TEMP, { recursive: true, force: true }) }
})().catch(err => { console.error(err); process.exitCode = 1 })
