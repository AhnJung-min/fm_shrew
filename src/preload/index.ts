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
  }
}

contextBridge.exposeInMainWorld('api', api)
