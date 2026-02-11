import { contextBridge, ipcRenderer } from 'electron'
import type { AuditEvent, DesktopApi, Settings } from './shared'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const api: DesktopApi = {
  getSettings: () => invoke<Settings>('settings:get'),
  setConsentAccepted: (accepted) => invoke<Settings>('settings:consentSet', accepted),
  pickRootDir: () => invoke<Settings>('settings:pickRootDir'),
  clearAppData: () => invoke<void>('settings:clearAppData'),

  listDir: (relPath) => invoke('fs:listDir', relPath),
  readTextFile: (relPath) => invoke('fs:readText', relPath),
  trashItem: (relPath) => invoke<void>('fs:trashItem', relPath),
  renameItem: (oldRelPath, newName) => invoke<void>('fs:renameItem', oldRelPath, newName),
  copyItem: (srcRelPath, destRelPath) => invoke<void>('fs:copyItem', srcRelPath, destRelPath),

  getRecentAudit: (limit) => invoke<AuditEvent[]>('audit:getRecent', limit),
  onAuditEvent: (cb) => {
    const handler = (_evt: unknown, payload: AuditEvent) => cb(payload)
    ipcRenderer.on('audit:event', handler)
    return () => ipcRenderer.off('audit:event', handler)
  },
}

contextBridge.exposeInMainWorld('desktop', api)

