import { lstat, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const desktopRoot = resolve(import.meta.dirname, '..')

export function getWinUnpackedPath(root = desktopRoot) {
  return resolve(root, 'release', 'win-unpacked')
}

export function getRuntimePath(root = desktopRoot) {
  return resolve(root, 'runtime')
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const apply = process.argv.includes('--apply')
  const includeRuntime = process.argv.includes('--include-runtime')
  const results = [await cleanupWinUnpacked({ apply })]
  if (includeRuntime) results.push(await cleanupRuntime({ apply }))

  for (const result of results) {
    if (result.reason === 'dry-run') {
      console.log(`Dry run: would clean ${result.target}. Re-run with --apply to remove generated output.`)
    } else if (result.reason === 'missing') {
      console.log(`No ${result.label} output found at ${result.target}.`)
    } else {
      console.log(`Removed generated ${result.label} output: ${result.target}`)
    }
  }
}
