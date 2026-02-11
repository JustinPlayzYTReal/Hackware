import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AuditEvent, DirEntry, Settings } from './shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL
const IS_DEV = Boolean(DEV_SERVER_URL)

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json')
const AUDIT_PATH = () => path.join(app.getPath('userData'), 'audit.jsonl')

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      consentAccepted: Boolean(parsed.consentAccepted),
      rootDir: typeof parsed.rootDir === 'string' ? parsed.rootDir : null,
    }
  } catch {
    return { consentAccepted: false, rootDir: null }
  }
}

async function writeSettings(s: Settings): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_PATH()), { recursive: true })
  await fs.writeFile(SETTINGS_PATH(), JSON.stringify(s, null, 2), 'utf8')
}

function isPathWithinRoot(rootDir: string, fullPath: string): boolean {
  const root = path.resolve(rootDir)
  const candidate = path.resolve(fullPath)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep

  // Windows filesystem is case-insensitive by default.
  if (process.platform === 'win32') {
    return candidate.toLowerCase().startsWith(rootWithSep.toLowerCase())
  }
  return candidate.startsWith(rootWithSep)
}

function resolveUnderRoot(rootDir: string, relPath: string): string {
  const safeRel = relPath.replaceAll('\\', '/')
  const full = path.resolve(rootDir, safeRel)
  if (!isPathWithinRoot(rootDir, full)) {
    throw new Error('Path is outside selected root directory.')
  }
  return full
}

async function appendAudit(win: BrowserWindow | null, evt: AuditEvent): Promise<void> {
  try {
    await fs.mkdir(path.dirname(AUDIT_PATH()), { recursive: true })
    await fs.appendFile(AUDIT_PATH(), JSON.stringify(evt) + '\n', 'utf8')
  } catch {
    // Best-effort audit logging; don't crash the app.
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('audit:event', evt)
  }
}

async function getRecentAudit(limit: number): Promise<AuditEvent[]> {
  try {
    const raw = await fs.readFile(AUDIT_PATH(), 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    const last = lines.slice(Math.max(0, lines.length - limit))
    return last
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEvent
        } catch {
          return null
        }
      })
      .filter((x): x is AuditEvent => Boolean(x))
  } catch {
    return []
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.cjs')

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (IS_DEV && DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html')
    void mainWindow.loadFile(indexHtml)
  }
}

function requireConsent(s: Settings): void {
  if (!s.consentAccepted) {
    throw new Error('Consent is required before performing this action.')
  }
  if (!s.rootDir) {
    throw new Error('Select a root folder first.')
  }
}

app.whenReady().then(async () => {
  createWindow()
  await appendAudit(mainWindow, { ts: Date.now(), level: 'info', action: 'app_start' })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('settings:get', async () => readSettings())

ipcMain.handle('settings:consentSet', async (_evt, accepted: boolean) => {
  const s = await readSettings()
  const next = { ...s, consentAccepted: Boolean(accepted) }
  await writeSettings(next)
  await appendAudit(mainWindow, {
    ts: Date.now(),
    level: 'info',
    action: 'consent_set',
    details: { accepted: next.consentAccepted },
  })
  return next
})

ipcMain.handle('settings:pickRootDir', async () => {
  const s = await readSettings()
  requireConsent({ ...s, rootDir: s.rootDir ?? '' })

  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Root Folder',
    properties: ['openDirectory'],
  })

  if (res.canceled || res.filePaths.length === 0) return s

  const next: Settings = { ...s, rootDir: res.filePaths[0] }
  await writeSettings(next)
  await appendAudit(mainWindow, {
    ts: Date.now(),
    level: 'info',
    action: 'root_set',
    details: { rootDir: next.rootDir },
  })
  return next
})

ipcMain.handle('settings:clearAppData', async () => {
  const userData = app.getPath('userData')
  try {
    await fs.rm(userData, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

ipcMain.handle('fs:listDir', async (_evt, relPath?: string) => {
  const s = await readSettings()
  requireConsent(s)

  const rp = typeof relPath === 'string' && relPath.length > 0 ? relPath : '.'
  const full = resolveUnderRoot(s.rootDir!, rp)

  const items = await fs.readdir(full, { withFileTypes: true })
  const entries: DirEntry[] = []
  for (const it of items) {
    if (it.isDirectory()) {
      entries.push({ name: it.name, kind: 'dir' })
    } else if (it.isFile()) {
      try {
        const st = await fs.stat(path.join(full, it.name))
        entries.push({ name: it.name, kind: 'file', size: st.size })
      } catch {
        entries.push({ name: it.name, kind: 'file' })
      }
    }
  }

  await appendAudit(mainWindow, {
    ts: Date.now(),
    level: 'info',
    action: 'list_dir',
    details: { relPath: rp, count: entries.length },
  })

  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  return { relPath: rp, entries }
})

ipcMain.handle('fs:readText', async (_evt, relPath: string) => {
  const s = await readSettings()
  requireConsent(s)

  const full = resolveUnderRoot(s.rootDir!, relPath)
  const st = await fs.stat(full)
  const MAX = 1024 * 1024
  if (st.size > MAX) throw new Error('File too large to read in-app (max 1 MiB).')
  const text = await fs.readFile(full, 'utf8')

  await appendAudit(mainWindow, {
    ts: Date.now(),
    level: 'info',
    action: 'read_text',
    details: { relPath, bytes: st.size },
  })

  return { relPath, text }
})

ipcMain.handle('fs:trashItem', async (_evt, relPath: string) => {
  const s = await readSettings()
  requireConsent(s)

  const full = resolveUnderRoot(s.rootDir!, relPath)
  await shell.trashItem(full)
  await appendAudit(mainWindow, {
    ts: Date.now(),
    level: 'warn',
    action: 'trash_item',
    details: { relPath },
  })
})

ipcMain.handle('fs:renameItem', async (_evt, oldRelPath: string, newName: string) => {
  const s = await readSettings()
  requireConsent(s)

  const oldFull = resolveUnderRoot(s.rootDir!, oldRelPath)
  const dir = path.dirname(oldFull)
  const newFull = path.join(dir, newName)
  if (!isPathWithinRoot(s.rootDir!, newFull)) {
    throw new Error('Rename target escapes root directory.')
  }
  await fs.rename(oldFull, newFull)
  await appendAudit(mainWindow, {
    ts: Date.now(),
    level: 'warn',
    action: 'rename_item',
    details: { oldRelPath, newName },
  })
})

ipcMain.handle('fs:copyItem', async (_evt, srcRelPath: string, destRelPath: string) => {
  const s = await readSettings()
  requireConsent(s)

  const src = resolveUnderRoot(s.rootDir!, srcRelPath)
  const dest = resolveUnderRoot(s.rootDir!, destRelPath)
  await fs.cp(src, dest, { recursive: true, force: false, errorOnExist: true })
  await appendAudit(mainWindow, {
    ts: Date.now(),
    level: 'warn',
    action: 'copy_item',
    details: { srcRelPath, destRelPath },
  })
})

ipcMain.handle('audit:getRecent', async (_evt, limit?: number) => {
  const s = await readSettings()
  // Audit visibility doesn't require consent, but file ops do.
  const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100
  void s
  return getRecentAudit(lim)
})

