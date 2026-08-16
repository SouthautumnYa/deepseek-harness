import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(desktopRoot, '../..')
const runtimeRoot = resolve(desktopRoot, 'runtime')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

// These files are useful in a source checkout but are never loaded by the
// shipped Node runtime. Removing them before electron-builder scans the tree
// keeps both staging and packaging fast without changing module resolution.
const PRUNE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx',
  '.d.ts', '.d.cts', '.d.mts',
  '.h', '.hh', '.hpp',
  '.map', '.mts', '.cts', '.pdb', '.ts', '.tsbuildinfo',
])
const PRUNE_NAME_PREFIXES = [
  'readme', 'changelog', 'contributing', 'history', 'licence', 'license',
  'notice', 'releases', 'security', 'threat_model',
]

const REQUIRED_RUNTIME_PACKAGES = [
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-command-compact',
]

const FRONTEND_ASSET_URL = /url\(\s*(['"]?)(\/assets\/[^\s'"\)]+)\1\s*\)/g

execFileSync(process.execPath, [resolve(workspaceRoot, 'scripts', 'sync-routing-suite-preset.mjs')], {
  cwd: workspaceRoot,
  stdio: 'inherit',
})

// Desktop packaging can be invoked without the repository-wide build. Refresh
// the static server first so a source-side MIME/resource fix cannot be hidden
// by an older lib copied into the staged runtime.
execFileSync(pnpm, ['exec', 'tsc', '-b', 'packages/host/frontend-static/tsconfig.json'], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
execFileSync(pnpm, [
  'exec', 'tsdown', '--workspace', '--filter', '@deepseek-ai/dsh-host-frontend-static',
  '--env.DSH_BUILD_FACE', 'host',
], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

async function pruneRuntime(root) {
  let removedFiles = 0
  let removedBytes = 0

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile()) continue

      const lowerName = entry.name.toLowerCase()
      const shouldRemove = PRUNE_EXTENSIONS.has(extname(lowerName))
        || PRUNE_NAME_PREFIXES.some(prefix => lowerName.startsWith(prefix))
      if (!shouldRemove) continue

      removedBytes += await stat(path).then(result => result.size).catch(() => 0)
      await rm(path, { force: true })
      removedFiles += 1
    }
  }

  await visit(root)
  return { removedFiles, removedBytes }
}

/**
 * Verify the production frontend still contains every skin image emitted by
 * Vite. The skin CSS is bundled into dist/assets and references hashed files
 * in that same directory; staging must fail before packaging if one side is
 * missing, otherwise the UI quietly falls back to the palette-only skin.
 */
async function verifyFrontendSkinAssets(root) {
  const frontendDist = join(root, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')
  const assetRoot = join(frontendDist, 'assets')
  const entries = await readdir(assetRoot, { withFileTypes: true })
  const cssFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.css'))
    .map(entry => join(assetRoot, entry.name))
  const references = new Set()
  for (const cssFile of cssFiles) {
    const css = await readFile(cssFile, 'utf8')
    for (const match of css.matchAll(FRONTEND_ASSET_URL)) {
      const url = match[2]
      if (url !== undefined && /\.(?:avif|gif|jpe?g|png|webp)(?:\?.*)?$/i.test(url)) references.add(url)
    }
  }
  if (references.size === 0) {
    throw new Error('Desktop runtime staging failed: frontend skin CSS contains no image assets')
  }
  const missing = [...references].filter(url => {
    const name = decodeURIComponent(url.slice('/assets/'.length))
    return !existsSync(join(assetRoot, name))
  })
  if (missing.length > 0) {
    throw new Error(`Desktop runtime staging failed: missing frontend skin assets: ${missing.join(', ')}`)
  }
  console.log(`Desktop skin assets verified: ${String(references.size)} image references`)
}

await rm(runtimeRoot, { recursive: true, force: true })
execFileSync(pnpm, [
  'deploy',
  '--filter',
  '@deepseek-ai/dsh',
  '--prod',
  '--config.inject-workspace-packages=true',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--ignore-scripts',
  runtimeRoot,
], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  // pnpm is exposed as a .cmd shim on Windows. Node cannot spawn that shim
  // directly in the packaged runtime, so let cmd.exe resolve it there.
  shell: process.platform === 'win32',
})

const pruned = await pruneRuntime(runtimeRoot)
console.log(`Desktop runtime pruned: ${String(pruned.removedFiles)} files, ${(pruned.removedBytes / 1024 / 1024).toFixed(1)} MB`)
await verifyFrontendSkinAssets(runtimeRoot)

for (const packageName of REQUIRED_RUNTIME_PACKAGES) {
  const packagePath = join(runtimeRoot, 'node_modules', ...packageName.split('/'))
  if (!existsSync(packagePath)) {
    throw new Error(`Desktop runtime staging failed: missing required package ${packageName}`)
  }
}

const cliEntry = resolve(runtimeRoot, 'lib', 'bin.js')
if (!existsSync(cliEntry)) {
  throw new Error(`Desktop runtime staging failed: missing ${cliEntry}`)
}
