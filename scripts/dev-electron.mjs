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

let firstSuccessfulBuild = true
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
  plugins: [
    {
      name: 'restart-electron-on-build',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error('[electron] build failed')
            return
          }
          if (firstSuccessfulBuild) {
            firstSuccessfulBuild = false
            startElectron()
            return
          }
          restartElectron()
        })
      },
    },
  ],
})

await ctx.watch()
