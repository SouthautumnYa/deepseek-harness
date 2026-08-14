import { readdir, rm, stat } from 'node:fs/promises'
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

await rm(runtimeRoot, { recursive: true, force: true })
execFileSync(pnpm, [
  'deploy',
  '--filter',
  '@deepseek-ai/dsh',
  '--prod',
  '--config.inject-workspace-packages=true',
  '--config.node-linker=hoisted',
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
