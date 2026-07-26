const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  chooseRoot: () => ipcRenderer.invoke('choose-root'),
  readDir: (p) => ipcRenderer.invoke('read-dir', p),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  writeFile: (p, content) => ipcRenderer.invoke('write-file', p, content),
  resolveTarget: (input) => ipcRenderer.invoke('resolve-target', input),
  dropFiles: (paths) => ipcRenderer.invoke('drop-files', paths),
  pasteClipboard: () => ipcRenderer.invoke('paste-clipboard'),
  getDropLog: () => ipcRenderer.invoke('get-drop-log'),
  dragStart: (p) => ipcRenderer.send('drag-start', p),
  editorUndo: () => ipcRenderer.send('editor-undo'),
  editorRedo: () => ipcRenderer.send('editor-redo'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setZoom: (factor) => webFrame.setZoomFactor(factor),
})
