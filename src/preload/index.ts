import { contextBridge, ipcRenderer } from 'electron'
import type { LinkStatus } from '@shared/game'
import type { Api } from '@shared/types'

const api: Api = {
  getStatus: () => ipcRenderer.invoke('status:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),

  linkStatus: () => ipcRenderer.invoke('link:status'),
  listSaves: () => ipcRenderer.invoke('link:saves'),
  applySave: (path) => ipcRenderer.invoke('link:apply', path),
  refreshLive: (rescan) => ipcRenderer.invoke('link:refresh', rescan),
  onLinkChanged: (cb) => {
    const listener = (_event: unknown, status: LinkStatus): void => cb(status)
    ipcRenderer.on('link:changed', listener)
    return () => ipcRenderer.removeListener('link:changed', listener)
  },
  worldSquad: () => ipcRenderer.invoke('world:squad'),
  worldSeason: () => ipcRenderer.invoke('world:season'),
  worldDashboard: () => ipcRenderer.invoke('world:dashboard'),
  worldClub: (force) => ipcRenderer.invoke('world:club', force === true),

  talkStatus: () => ipcRenderer.invoke('talk:status'),
  talkSetKey: (key) => ipcRenderer.invoke('talk:setKey', key),
  talkClearKey: () => ipcRenderer.invoke('talk:clearKey'),

  worldCandidates: (query) => ipcRenderer.invoke('world:candidates', query),
  worldMarket: (uids) => ipcRenderer.invoke('world:market', uids),
  worldProfile: (uid) => ipcRenderer.invoke('world:profile', uid),
  faceUrl: (uid) => `fmface://face/${Math.trunc(Number(uid))}`,
  clubLogoUrl: (uid) => `fmface://club/${Math.trunc(Number(uid))}`,
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
