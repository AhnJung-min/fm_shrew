import { contextBridge, ipcRenderer } from 'electron'
import type { LinkStatus } from '@shared/game'
import type { ExtraApi } from '@shared/connect'
import type { Api, Settings } from '@shared/types'

const api: Api & ExtraApi = {
  getStatus: () => ipcRenderer.invoke('status:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),

  linkStatus: () => ipcRenderer.invoke('link:status'),
  listSaves: () => ipcRenderer.invoke('link:saves'),
  applySave: (path, options) => ipcRenderer.invoke('link:apply', path, options),
  refreshLive: (rescan) => ipcRenderer.invoke('link:refresh', rescan),
  onLinkChanged: (cb) => {
    const listener = (_event: unknown, status: LinkStatus): void => cb(status)
    ipcRenderer.on('link:changed', listener)
    return () => ipcRenderer.removeListener('link:changed', listener)
  },
  worldClubs: () => ipcRenderer.invoke('world:clubs'),
  chooseTeam: (teamId) => ipcRenderer.invoke('link:chooseTeam', teamId),
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
  editorApplyReport: (edits) => ipcRenderer.invoke('editor:apply', edits),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupRestore: (id) => ipcRenderer.invoke('backup:restore', id),
  backupDelete: (id) => ipcRenderer.invoke('backup:delete', id),
  recordsList: () => ipcRenderer.invoke('records:list'),
  recordsRemove: (id) => ipcRenderer.invoke('records:remove', id),

  // 2단계 새 창구. 채널 이름은 shared/tacticApi.ts의 TACTIC_CHANNELS와 같아야 한다(tests/phase2Contract.test.ts가 본다)
  tacticsSave: (saveKey, set) => ipcRenderer.invoke('tactics:save', saveKey, set),
  worldNorms: (profiles) => ipcRenderer.invoke('world:norms', profiles),
  tacticImport: (options) => ipcRenderer.invoke('tactics:import', options),
  tacticRecommend: (tactic) => ipcRenderer.invoke('tactics:recommend', tactic),
  customRolesSave: (roles) => ipcRenderer.invoke('roles:saveCustom', roles),
  roleBundleExport: () => ipcRenderer.invoke('roles:export'),
  roleBundlePreview: () => ipcRenderer.invoke('roles:preview'),
  roleBundleApply: (token, mode) => ipcRenderer.invoke('roles:apply', token, mode),
  roleStarCheck: () => ipcRenderer.invoke('roles:stars'),
  migrationAck: () => ipcRenderer.invoke('settings:ackMigration'),
  onBackupChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('backup:changed', listener)
    return () => ipcRenderer.removeListener('backup:changed', listener)
  },
  onSettingsChanged: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: Settings): void => cb(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
