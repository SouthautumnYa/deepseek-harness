import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const desktopRoot = resolve(import.meta.dirname, '..')
const INSTALLER_NAME = /^DeepSeek-Harness-Setup-(.+)\.exe(?:\.blockmap)?$/

export function getWinUnpackedPath(root = desktopRoot) {
  return resolve(root, 'release', 'win-unpacked')
}

export function getRuntimePath(root = desktopRoot) {
  return resolve(root, 'runtime')
}

export function getReleasePath(root = desktopRoot) {
  return resolve(root, 'release')
}

function assertGeneratedOutputPath(target, expectedTarget, expectedParent) {
  if (target !== expectedTarget || dirname(target) !== expectedParent) {
    throw new Error(`Refusing to clean an unexpected packaging path: ${target}`)
  }
}

async function cleanupGeneratedDirectory({ target, parent, apply, label }) {
  let parentStats
  try {
    parentStats = await lstat(parent)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { target, removed: false, reason: 'missing', label }
    }
    throw error
  }

  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error(`Refusing to clean inside an unexpected parent path: ${parent}`)
  }

  let stats
  try {
    stats = await lstat(target)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { target, removed: false, reason: 'missing', label }
    }
    throw error
  }

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Refusing to clean a non-directory packaging output: ${target}`)
  }

  if (!apply) {
    return { target, removed: false, reason: 'dry-run', label }
  }

  await rm(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 })
  return { target, removed: true, label }
}

export async function cleanupWinUnpacked({ root = desktopRoot, apply = false } = {}) {
  const target = getWinUnpackedPath(root)
  const parent = resolve(root, 'release')
  assertGeneratedOutputPath(target, getWinUnpackedPath(root), parent)
  return cleanupGeneratedDirectory({ target, parent, apply, label: 'win-unpacked' })
}

export async function cleanupRuntime({ root = desktopRoot, apply = false } = {}) {
  const target = getRuntimePath(root)
  const parent = resolve(root)
  assertGeneratedOutputPath(target, getRuntimePath(root), parent)
  return cleanupGeneratedDirectory({ target, parent, apply, label: 'runtime' })
}

/**
 * Remove superseded installers while retaining the current version and any
 * unrelated release metadata. Installer outputs are reproducible; keeping
 * every historical copy locally only duplicates hundreds of megabytes.
 */
export async function cleanupOldInstallers({ root = desktopRoot, apply = false } = {}) {
  const release = getReleasePath(root)
  const parent = resolve(root)
  assertGeneratedOutputPath(release, getReleasePath(root), parent)

  let releaseStats
  try {
    releaseStats = await lstat(release)
  } catch (error) {
    if (error?.code === 'ENOENT') return { target: release, removed: false, reason: 'missing', label: 'old-installers', paths: [] }
    throw error
  }
  if (!releaseStats.isDirectory() || releaseStats.isSymbolicLink()) {
    throw new Error(`Refusing to inspect an unexpected release directory: ${release}`)
  }

  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`Desktop package manifest has no usable version: ${join(root, 'package.json')}`)
  }
  const keep = new Set([
    `DeepSeek-Harness-Setup-${manifest.version}.exe`,
    `DeepSeek-Harness-Setup-${manifest.version}.exe.blockmap`,
  ])
  const entries = await readdir(release, { withFileTypes: true })
  const paths = entries
    .filter(entry => entry.isFile() && INSTALLER_NAME.test(entry.name) && !keep.has(entry.name))
    .map(entry => join(release, entry.name))

  if (!apply) return { target: release, removed: false, reason: 'dry-run', label: 'old-installers', paths }
  for (const path of paths) await rm(path, { force: false })
  return { target: release, removed: paths.length > 0, label: 'old-installers', paths }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const apply = process.argv.includes('--apply')
  const includeRuntime = process.argv.includes('--include-runtime')
  const pruneOldInstallers = process.argv.includes('--prune-old-installers')
  const results = [await cleanupWinUnpacked({ apply })]
  if (includeRuntime) results.push(await cleanupRuntime({ apply }))
  if (pruneOldInstallers) results.push(await cleanupOldInstallers({ apply }))

  for (const result of results) {
    if (result.reason === 'dry-run') {
      console.log(`Dry run: would clean ${result.target}. Re-run with --apply to remove generated output.`)
    } else if (result.reason === 'missing') {
      console.log(`No ${result.label} output found at ${result.target}.`)
    } else if (result.label === 'old-installers') {
      console.log(`${result.removed ? 'Removed' : 'Would remove'} ${String(result.paths.length)} old installer artifact(s) in ${result.target}.`)
    } else {
      console.log(`Removed generated ${result.label} output: ${result.target}`)
    }
  }
}
