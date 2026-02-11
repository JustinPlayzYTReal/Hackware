# Hackware Safe Desktop (Electron + Vite + React + TypeScript)

Desktop app scaffold with:
- Explicit consent gate (stored in app `userData`)
- User-selected root folder only (file ops are blocked outside it)
- Reversible deletes via OS Trash/Recycle Bin
- Visible audit log (also persisted as `audit.jsonl` under `userData`)
- No background tasks, no hidden network calls, no credential access/keylogging

## Dev

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## Package (Windows installer via NSIS)

```powershell
npm run dist
```

## Project Layout

- `electron/main.ts`: Electron main process (window + IPC handlers)
- `electron/preload.ts`: secure `contextBridge` API (`window.desktop`)
- `electron/shared.ts`: IPC types shared with the renderer (type-only)
- `src/App.tsx`: consent UI, folder picker, file browser, audit viewer
- `scripts/dev-electron.mjs`: esbuild watch + Electron restart
- `scripts/build-electron.mjs`: production Electron bundle

