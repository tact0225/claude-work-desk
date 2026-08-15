// ドロップ先フォルダの検証テスト。electron を差し替えて main.js を素の node で読み込み、
// 実際に登録される 'set-inbox' ハンドラをそのまま叩く（ロジックのコピーではなく本物を試す）。
// ここが緩むとワークスペース外にファイルを書ける＝「投入先は動かない」という保証が崩れる。
const Module = require('module')
const path = require('path')
const fs = require('fs')
const os = require('os')

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-inbox-test-'))
const USER = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-inbox-user-'))
fs.writeFileSync(path.join(USER, 'user-config.json'), JSON.stringify({ root: WS }))

const handlers = {}
const stub = {
  app: {
    getPath: () => USER,
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en-US',
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  // webContents は createWindow がナビゲーションガードを付ける相手。省くと main.js の読み込みで落ちる
  BrowserWindow: function () { return { loadFile: () => {}, webContents: { on: () => {}, setWindowOpenHandler: () => {} } } },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn }, on: () => {} },
  shell: {}, clipboard: {}, dialog: {},
  nativeImage: { createFromDataURL: () => ({}) },
}

const origLoad = Module._load
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return stub
  return origLoad.apply(this, arguments)
}
require('./main.js')
Module._load = origLoad

let failed = 0
const check = async (input, wantOk, why) => {
  const r = await handlers['set-inbox'](null, input)
  const got = !!r.ok
  if (got !== wantOk) {
    console.error(`    NG  ${JSON.stringify(input)} → ok=${got} (期待 ${wantOk}) — ${why}`)
    failed++
  }
}

;(async () => {
  // whenReady().then(loadConfig) がマイクロタスクなので、設定が入るまで1周待つ
  await new Promise((r) => setImmediate(r))

  // 通るべきもの
  await check('_inbox', true, '既定値')
  await check('inbox', true, '普通の名前')
  await check('drop/here', true, 'ネストも可')
  await check('sub\\dir', true, 'Windows区切りは正規化される')
  await check('  _inbox  ', true, '前後の空白は落とす')
  await check('/_inbox', true, '先頭スラッシュはワークスペース基準として扱う')

  // 弾くべきもの（ワークスペース外への脱出）
  await check('', false, '空')
  await check('   ', false, '空白のみ')
  await check('..', false, '親へ脱出')
  await check('../outside', false, '親へ脱出')
  await check('a/../../b', false, '途中で脱出')
  await check('C:/Windows/Temp', false, '絶対パス（ドライブレター）')
  await check('C:\\Windows\\Temp', false, '絶対パス（バックスラッシュ）')
  await check('//server/share', false, 'UNC')
  await check('a/./b', false, 'カレント参照は許さない')

  // --- QA指摘ぶん（いずれも一度は素通りしていた） ---
  await check('/C:foo', false, '先頭スラッシュを剥がすとドライブ相対に化ける')
  await check('/C:/Windows/Temp', false, '同上・絶対パス版')
  await check('a/.. /.. /x', false, 'Windowsは末尾空白を捨てるので「.. 」は「..」として効く')
  await check('a/../x', false, '通常の遡上')
  await check('a/...  /x', false, '末尾のピリオドと空白の混在')
  await check('CON', false, 'Windows予約デバイス名')
  await check('nul.txt', false, '予約名＋拡張子')
  await check('a/COM1/b', false, '途中の予約名')
  await check('a/CON /b', false, '末尾空白で予約名判定を抜けられないか')
  await check('a/nul /b', false, '同上')
  // 「..」で始まるだけの正当なフォルダ名は通す（区切りまで見ないと誤爆する）
  fs.mkdirSync(path.join(WS, '..foo'), { recursive: true })
  await check('..foo', true, '..で始まる正当な名前（既存）')
  await check('..bar/baz', true, '..で始まる正当な名前（未作成）')

  // symlink / ジャンクション経由の脱出（文字列演算だけでは絶対に防げない）
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-inbox-outside-'))
  fs.symlinkSync(OUT, path.join(WS, 'escape'), 'dir')
  await check('escape', false, 'symlinkそのもの')
  await check('escape/deep', false, 'symlinkの先')
  fs.mkdirSync(path.join(WS, 'sub'), { recursive: true })
  fs.symlinkSync(OUT, path.join(WS, 'sub', 'via'), 'dir')
  await check('sub/via/x', false, '途中のセグメントがsymlink')
  // 壊れた（リンク先が存在しない）symlink: existsSync が false なので
  // 「実在する祖先まで遡る」方式だと中と誤判定され、mkdir が外に実体を作ってしまう
  const GHOST = path.join(OUT, 'ghost-target')
  fs.symlinkSync(GHOST, path.join(WS, 'ghost'), 'dir')
  await check('ghost', false, '壊れたsymlink')
  await check('ghost/deep', false, '壊れたsymlinkの先')
  if (fs.existsSync(GHOST)) {
    console.error('    NG  壊れたsymlinkの先に実体が作られた'); failed++
  }
  if (fs.existsSync(path.join(OUT, 'deep')) || fs.existsSync(path.join(OUT, 'x'))) {
    console.error('    NG  ワークスペース外にフォルダが作られた（symlink脱出）'); failed++
  }

  // 使用時ガード: 設定した「後で」投入先が symlink にすり替わっても書かせない。
  // 設定時にしか検査していないと、ここで外に流出する（設定は正しく通っている＝止めるものが無い）。
  {
    const r2 = await handlers['set-inbox'](null, 'later')
    if (!r2.ok) { console.error('    NG  正常な名前が通らない'); failed++ }
    fs.rmSync(path.join(WS, 'later'), { recursive: true, force: true })
    fs.symlinkSync(OUT, path.join(WS, 'later'), 'dir') // 設定後にすり替え
    fs.writeFileSync(path.join(WS, 'payload.txt'), 'x')
    const before = fs.readdirSync(OUT).length
    let threw = false
    try { await handlers['drop-files'](null, [path.join(WS, 'payload.txt')]) } catch (e) { threw = true }
    if (!threw) { console.error('    NG  すり替え後もドロップが通った（使用時ガードが無い）'); failed++ }
    if (fs.readdirSync(OUT).length !== before) {
      console.error('    NG  ワークスペース外にファイルが書かれた'); failed++
    }
    await handlers['set-inbox'](null, '_inbox') // 後続テストのため戻す
  }

  // 失敗した設定が保存されてしまわないか（保存 → UIは古い名前 → ドロップ全滅、の元凶）
  fs.writeFileSync(path.join(WS, 'busy.txt'), 'x')
  const before = (await handlers['get-config']()).inboxName
  const r = await handlers['set-inbox'](null, 'busy.txt')
  const after = (await handlers['get-config']()).inboxName
  if (r.ok) { console.error('    NG  既存ファイルと同名を受け入れた'); failed++ }
  if (after !== before) {
    console.error(`    NG  失敗したのに設定が書き換わった (${before} → ${after})`); failed++
  }
  if (!r.error) { console.error('    NG  失敗理由が返っていない（画面に出せない）'); failed++ }

  // 実際に作られた先がワークスペース内に収まっているか（副作用の確認）
  if (!fs.existsSync(path.join(WS, 'drop', 'here'))) {
    console.error('    NG  許可した相対パスのフォルダが作られていない'); failed++
  }

  fs.rmSync(OUT, { recursive: true, force: true })
  if (failed) { console.error(`  ドロップ先の検証テスト: ${failed}件 失敗`); process.exit(1) }
  console.log("  ドロップ先の検証テスト OK (35ケース＋保存ロールバック＋使用時ガード)")
  fs.rmSync(WS, { recursive: true, force: true })
  fs.rmSync(USER, { recursive: true, force: true })
})()
