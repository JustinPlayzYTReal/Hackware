export type AuditLevel = 'info' | 'warn' | 'error'

export type AuditEvent =
  | {
      ts: number
      level: AuditLevel
      action: 'app_start' | 'consent_set' | 'root_set'
      details?: Record<string, unknown>
    }
  | {
      ts: number
      level: AuditLevel
      action:
        | 'list_dir'
        | 'read_text'
        | 'trash_item'
        | 'rename_item'
        | 'copy_item'
      details: Record<string, unknown>
    }

export type Settings = {
  consentAccepted: boolean
  rootDir: string | null
}

export type DirEntry = {
  name: string
  kind: 'file' | 'dir'
  size?: number
}

export type DesktopApi = {
  getSettings(): Promise<Settings>
  setConsentAccepted(accepted: boolean): Promise<Settings>
  pickRootDir(): Promise<Settings>
  clearAppData(): Promise<void>

  listDir(relPath?: string): Promise<{ relPath: string; entries: DirEntry[] }>
  readTextFile(relPath: string): Promise<{ relPath: string; text: string }>
  trashItem(relPath: string): Promise<void>
  renameItem(oldRelPath: string, newName: string): Promise<void>
  copyItem(srcRelPath: string, destRelPath: string): Promise<void>

  getRecentAudit(limit?: number): Promise<AuditEvent[]>
  onAuditEvent(cb: (evt: AuditEvent) => void): () => void
}

