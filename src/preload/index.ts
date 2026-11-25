import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, ImportResult } from '@shared/types'

const api: Api = {
  getStatus: () => ipcRenderer.invoke('status:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  listSnapshots: () => ipcRenderer.invoke('snapshots:list'),
  getSnapshot: (id) => ipcRenderer.invoke('snapshots:get', id),
  setSnapshotKind: (id, kind) => ipcRenderer.invoke('snapshots:setKind', id, kind),
  deleteSnapshot: (id) => ipcRenderer.invoke('snapshots:delete', id),
  pickAndImport: () => ipcRenderer.invoke('import:pick'),
  importPaths: (paths) => ipcRenderer.invoke('import:paths', paths),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onImported: (cb) => {
    const listener = (_event: unknown, result: ImportResult): void => cb(result)
    ipcRenderer.on('import:done', listener)
    return () => ipcRenderer.removeListener('import:done', listener)
  },

  talkStatus: () => ipcRenderer.invoke('talk:status'),
  talkSetKey: (key) => ipcRenderer.invoke('talk:setKey', key),
  talkClearKey: () => ipcRenderer.invoke('talk:clearKey'),
  talkCapture: () => ipcRenderer.invoke('talk:capture'),
  talkAsk: (captureId, intent) => ipcRenderer.invoke('talk:ask', captureId, intent),
  onTalkCaptured: (cb) => {
    const listener = (_event: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
    ipcRenderer.on('talk:captured', listener)
    return () => ipcRenderer.removeListener('talk:captured', listener)
  },
  hideWindow: () => ipcRenderer.invoke('window:hide')
}

contextBridge.exposeInMainWorld('api', api)
