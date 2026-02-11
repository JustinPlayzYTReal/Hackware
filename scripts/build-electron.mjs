import esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  outdir: 'dist-electron',
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  outExtension: { '.js': '.cjs' },
  logLevel: 'info',
})

