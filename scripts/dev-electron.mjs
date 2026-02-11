import { spawn } from 'node:child_process'
import esbuild from 'esbuild'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

let electronProc = null

function startElectron() {
  const electronBin = process.platform === 'win32' ? 'node_modules/.bin/electron.cmd' : 'node_modules/.bin/electron'
  electronProc = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_SERVER_URL },
  })
  electronProc.on('exit', () => {
    electronProc = null
  })
}

function restartElectron() {
  if (!electronProc) return startElectron()
  electronProc.removeAllListeners('exit')
  electronProc.kill()
  electronProc = null
  startElectron()
}

const ctx = await esbuild.context({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  outdir: 'dist-electron',
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  sourcemap: 'inline',
  external: ['electron'],
  outExtension: { '.js': '.cjs' },
  logLevel: 'silent',
})

let first = true
await ctx.watch({
  onRebuild(error) {
    if (error) {
      console.error('[electron] rebuild failed', error)
      return
    }
    if (first) {
      first = false
      startElectron()
      return
    }
    restartElectron()
  },
})

// Initial build triggers noRebuild callback; force it once.
await ctx.rebuild()
first = false
startElectron()

