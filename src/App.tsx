import { useEffect, useMemo, useState } from 'react'
import type { AuditEvent, DirEntry, Settings } from '../electron/shared'
import './App.css'

function joinRel(base: string, name: string): string {
  const b = base === '.' ? '' : base.replace(/\/+$/, '')
  return (b ? `${b}/${name}` : name).replace(/^\/+/, '')
}

function parentRel(relPath: string): string {
  const p = relPath === '.' ? '' : relPath
  if (!p) return '.'
  const parts = p.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? parts.join('/') : '.'
}

function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [consentChecks, setConsentChecks] = useState({
    transparent: false,
    folderOnly: false,
    noStealth: false,
  })
  const [cwd, setCwd] = useState<string>('.')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [viewer, setViewer] = useState<{ relPath: string; text: string } | null>(null)

  const consentReady = useMemo(
    () => consentChecks.transparent && consentChecks.folderOnly && consentChecks.noStealth,
    [consentChecks],
  )

  async function refreshDir(nextCwd?: string) {
    if (!settings?.consentAccepted || !settings.rootDir) return
    const rp = typeof nextCwd === 'string' ? nextCwd : cwd
    const res = await window.desktop.listDir(rp)
    setCwd(res.relPath)
    setEntries(res.entries)
  }

  async function refreshAudit() {
    const items = await window.desktop.getRecentAudit(200)
    setAudit(items)
  }

  useEffect(() => {
    let unsub: null | (() => void) = null
    ;(async () => {
      const s = await window.desktop.getSettings()
      setSettings(s)
      await refreshAudit()
      unsub = window.desktop.onAuditEvent((evt) => {
        setAudit((prev) => [...prev.slice(-199), evt])
      })
      if (s.consentAccepted && s.rootDir) {
        await refreshDir('.')
      }
    })().catch((e) => setErr(e instanceof Error ? e.message : String(e)))

    return () => {
      if (unsub) unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | null> {
    setErr(null)
    setBusy(true)
    try {
      return await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function acceptConsent() {
    if (!consentReady) return
    const next = await withBusy(() => window.desktop.setConsentAccepted(true))
    if (next) setSettings(next)
  }

  async function pickRoot() {
    const next = await withBusy(() => window.desktop.pickRootDir())
    if (!next) return
    setSettings(next)
    if (next.rootDir) await withBusy(() => refreshDir('.'))
  }

  async function openFile(relPath: string) {
    const res = await withBusy(() => window.desktop.readTextFile(relPath))
    if (!res) return
    setViewer(res)
  }

  async function trash(relPath: string) {
    const ok = window.confirm(`Move to Recycle Bin?\n\n${relPath}`)
    if (!ok) return
    const res = await withBusy(() => window.desktop.trashItem(relPath))
    if (res === null) return
    await withBusy(() => refreshDir())
  }

  async function rename(relPath: string) {
    const current = relPath.split('/').pop() || relPath
    const nextName = window.prompt('New name:', current)
    if (!nextName || nextName.trim() === '' || nextName === current) return
    const res = await withBusy(() => window.desktop.renameItem(relPath, nextName.trim()))
    if (res === null) return
    await withBusy(() => refreshDir())
  }

  async function clearAppData() {
    const ok = window.confirm(
      'This clears this app’s local settings + audit log (under your user profile). Continue?',
    )
    if (!ok) return
    const res = await withBusy(() => window.desktop.clearAppData())
    if (res === null) return
    setSettings({ consentAccepted: false, rootDir: null })
    setEntries([])
    setCwd('.')
    setAudit([])
    setViewer(null)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div>
            <div className="title">Hackware Safe Desktop</div>
            <div className="subtitle">Transparent, consent-based local file utility (no stealth)</div>
          </div>
        </div>
        <div className="actions">
          <button className="btn subtle" disabled={busy} onClick={() => withBusy(refreshAudit)}>
            Refresh Audit
          </button>
          <button className="btn danger" disabled={busy} onClick={clearAppData}>
            Clear App Data
          </button>
        </div>
      </header>

      {err ? (
        <div className="banner">
          <div className="bannerTitle">Error</div>
          <div className="bannerBody">{err}</div>
        </div>
      ) : null}

      {!settings ? (
        <div className="panel">
          <div className="h">Loading…</div>
        </div>
      ) : !settings.consentAccepted ? (
        <div className="panel">
          <div className="h">Consent Required</div>
          <p className="p">
            This app is intentionally limited: it will only do visible, user-triggered actions, and only
            inside a folder you select.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={consentChecks.transparent}
              onChange={(e) => setConsentChecks((p) => ({ ...p, transparent: e.target.checked }))}
            />
            I understand all actions are logged in-app and on disk.
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={consentChecks.folderOnly}
              onChange={(e) => setConsentChecks((p) => ({ ...p, folderOnly: e.target.checked }))}
            />
            I will select a root folder; operations stay inside it.
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={consentChecks.noStealth}
              onChange={(e) => setConsentChecks((p) => ({ ...p, noStealth: e.target.checked }))}
            />
            No keylogging, credential access, stealth persistence, or hidden network calls.
          </label>
          <div className="row">
            <button className="btn primary" disabled={!consentReady || busy} onClick={acceptConsent}>
              Accept and Continue
            </button>
          </div>
        </div>
      ) : (
        <main className="grid">
          <section className="panel">
            <div className="h">Workspace</div>
            <div className="kv">
              <div className="k">Root folder</div>
              <div className="v mono">{settings.rootDir ?? 'Not selected'}</div>
            </div>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={pickRoot}>
                {settings.rootDir ? 'Change Root Folder' : 'Select Root Folder'}
              </button>
            </div>

            <div className="divider" />

            <div className="h2">File Browser</div>
            {!settings.rootDir ? (
              <p className="p">Select a root folder to enable browsing.</p>
            ) : (
              <>
                <div className="row between">
                  <div className="mono small">Path: {cwd}</div>
                  <div className="row">
                    <button
                      className="btn subtle"
                      disabled={busy || cwd === '.'}
                      onClick={() => withBusy(() => refreshDir(parentRel(cwd)))}
                    >
                      Up
                    </button>
                    <button className="btn subtle" disabled={busy} onClick={() => withBusy(() => refreshDir())}>
                      Refresh
                    </button>
                  </div>
                </div>
                <div className="table">
                  <div className="thead">
                    <div>Name</div>
                    <div>Type</div>
                    <div>Size</div>
                    <div>Actions</div>
                  </div>
                  {entries.map((e) => {
                    const rp = joinRel(cwd, e.name)
                    return (
                      <div className="trow" key={rp}>
                        <div className="mono">
                          {e.kind === 'dir' ? (
                            <button
                              className="link"
                              disabled={busy}
                              onClick={() => withBusy(() => refreshDir(rp))}
                              title="Open folder"
                            >
                              {e.name}/
                            </button>
                          ) : (
                            <span>{e.name}</span>
                          )}
                        </div>
                        <div className="pill">{e.kind}</div>
                        <div className="mono small">{e.kind === 'file' ? (e.size ?? '-') : '-'}</div>
                        <div className="row">
                          {e.kind === 'file' ? (
                            <button className="btn subtle" disabled={busy} onClick={() => openFile(rp)}>
                              View
                            </button>
                          ) : null}
                          <button className="btn subtle" disabled={busy} onClick={() => rename(rp)}>
                            Rename
                          </button>
                          <button className="btn danger" disabled={busy} onClick={() => trash(rp)}>
                            Trash
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="hint">
                  “Trash” uses the OS Recycle Bin/Trash for reversibility. No background actions run.
                </p>
              </>
            )}
          </section>

          <section className="panel">
            <div className="h">Audit Log</div>
            <div className="audit">
              {audit.length === 0 ? (
                <div className="muted">No events yet.</div>
              ) : (
                audit
                  .slice()
                  .reverse()
                  .map((a, idx) => (
                    <div className="auditRow" key={`${a.ts}-${idx}`}>
                      <div className="mono small">{new Date(a.ts).toLocaleString()}</div>
                      <div className={`lvl ${a.level}`}>{a.level}</div>
                      <div className="mono">{a.action}</div>
                      <div className="mono small">{a.details ? JSON.stringify(a.details) : ''}</div>
                    </div>
                  ))
              )}
            </div>
          </section>
        </main>
      )}

      {viewer ? (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modalCard">
            <div className="row between">
              <div className="mono">{viewer.relPath}</div>
              <button className="btn subtle" onClick={() => setViewer(null)}>
                Close
              </button>
            </div>
            <pre className="code">{viewer.text}</pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
