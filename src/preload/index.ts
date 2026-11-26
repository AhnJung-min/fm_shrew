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
  worldCandidates: (query) => ipcRenderer.invoke('world:candidates', query),
  editorList: (search) => ipcRenderer.invoke('editor:list', search),
  editorPlayer: (uid) => ipcRenderer.invoke('editor:player', uid),
  editorApply: (edits) => ipcRenderer.invoke('editor:apply', edits),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupRestore: (id) => ipcRenderer.invoke('backup:restore', id),
  backupDelete: (id) => ipcRenderer.invoke('backup:delete', id),
  onBackupChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('backup:changed', listener)
    return () => ipcRenderer.removeListener('backup:changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
