const { parentPort } = require('worker_threads')
const { search } = require('./search-engine')
const { sheetRows } = require('./renderer/search-core')

parentPort.on('message', async message => {
  if (message.type === 'sheet') {
    try {
      const sheets = sheetRows(require('xlsx').readFile(message.path))
      parentPort.postMessage({ type: 'sheet', id: message.id, sheets })
    } catch (err) { parentPort.postMessage({ type: 'sheet', id: message.id, error: err.message }) }
    return
  }
  const flag = new Int32Array(message.flag)
  // ⚠ 解析中はメッセージを読めない場合がある。中止は共有メモリでも受ける。
  try {
    await search(message, event => parentPort.postMessage({ ...event, id: message.id }), () => Atomics.load(flag, 0) !== 0)
  } catch (err) { parentPort.postMessage({ type: 'done', id: message.id, failed: 1, error: err.message }) }
})
