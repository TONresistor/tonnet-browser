import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = await mkdtemp(join(tmpdir(), 'ton-browser-runtime-'))
const require = createRequire(import.meta.url)
try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const entry = join(scratch, 'runtime.cjs')
  await build({
    entryPoints: [join(root, 'src/main/windows/__tests__/fixtures/browser-runtime.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    define: {
      __dirname: JSON.stringify(join(root, 'out/main')),
      __APP_VERSION__: JSON.stringify(pkg.version),
      __LOTTIE_PLAYER_JS__: '""',
      __LOADING_ANIMATION_JSON__: '"{}"',
    },
    logLevel: 'warning',
  })
  const env = { ...process.env, TONNET_RUNTIME_PROFILE: join(scratch, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(require('electron'), [entry], { cwd: root, env, stdio: 'inherit' })
    const timeout = setTimeout(() => {
      console.error('Electron runtime fixture exceeded 45 seconds')
      child.kill('SIGKILL')
    }, 45_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (exitCode) => {
      clearTimeout(timeout)
      resolveExit(exitCode ?? 1)
    })
  })
  process.exitCode = code
} finally {
  await rm(scratch, { recursive: true, force: true })
}
