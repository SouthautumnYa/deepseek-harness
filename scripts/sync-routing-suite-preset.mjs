import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Keep the routing-suite's small runtime preset remote and reproducible.
 * The suite repository contains source, probes, docs, and submodule history;
 * the desktop/runtime only needs the router-standard loader files plus metadata.
 */
export const ROUTING_SUITE_SOURCE = Object.freeze({
  suite: 'https://github.com/yjh051108/dsh-routing-suite',
  suiteCommit: 'a09eb0ade28e6ec3b8e5eb22985a14f6bfa1fbe5',
  injectorRelease: 'https://github.com/yjh051108/dsh-super-injector/releases/tag/v0.3.3',
  injectorPackage: 'https://github.com/yjh051108/dsh-super-injector/releases/download/v0.3.3/dsh-external-dsh-super-injector-0.3.3.tgz',
  preset: 'https://github.com/yjh051108/dsh-router-standard',
  presetCommit: 'eff787e95132d6c7104214542104a84d656b497e',
  presetPath: 'preset/router-standard',
})

export const ROUTING_SUITE_PRESET_FILES = Object.freeze([
  'agent.cordis.yml',
  'preset.yml',
  'router-bootstrap-v1.mjs',
  'router-bootstrap.mjs',
  'router-core.mjs',
])

const workspaceRoot = resolve(import.meta.dirname, '..')
const presetRoot = join(workspaceRoot, 'apps', 'cli', 'config', 'agent-presets', 'router-standard')
const sourceFile = join(presetRoot, 'routing-suite.source.json')

function fileSetExists(root = presetRoot) {
  return ROUTING_SUITE_PRESET_FILES.every(file => existsSync(join(root, file)))
}

async function isCurrent() {
  if (!existsSync(sourceFile) || !fileSetExists()) return false
  try {
    const current = JSON.parse(await readFile(sourceFile, 'utf8'))
    return current.suiteCommit === ROUTING_SUITE_SOURCE.suiteCommit
      && current.presetCommit === ROUTING_SUITE_SOURCE.presetCommit
      && current.presetPath === ROUTING_SUITE_SOURCE.presetPath
  } catch {
    return false
  }
}

export function routingSuitePresetUrl(file) {
  return `https://raw.githubusercontent.com/yjh051108/dsh-router-standard/${ROUTING_SUITE_SOURCE.presetCommit}/${ROUTING_SUITE_SOURCE.presetPath}/${file}`
}

async function download(file) {
  const url = routingSuitePresetUrl(file)
  const response = await fetch(url, { headers: { 'User-Agent': 'deepseek-harness-routing-suite-sync' } })
  if (!response.ok) throw new Error(`routing-suite: ${file} download failed (${response.status} ${response.statusText})`)
  return await response.text()
}

export async function syncRoutingSuitePreset({ force = false } = {}) {
  if (!force && await isCurrent()) {
    console.log(`routing-suite preset already synced at ${presetRoot}`)
    return { changed: false, root: presetRoot }
  }

  await mkdir(presetRoot, { recursive: true })
  try {
    const contents = await Promise.all(ROUTING_SUITE_PRESET_FILES.map(async file => [file, await download(file)]))
    for (const [file, content] of contents) {
      await writeFile(join(presetRoot, file), content, 'utf8')
    }
  } catch (error) {
    if (fileSetExists()) {
      console.warn(`routing-suite: remote sync failed; keeping the last pinned preset: ${String(error)}`)
      return { changed: false, root: presetRoot }
    }
    throw error
  }

  await writeFile(sourceFile, `${JSON.stringify(ROUTING_SUITE_SOURCE, null, 2)}\n`, 'utf8')
  console.log(`routing-suite preset synced from ${ROUTING_SUITE_SOURCE.preset}@${ROUTING_SUITE_SOURCE.presetCommit}`)
  return { changed: true, root: presetRoot }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await syncRoutingSuitePreset({ force: process.argv.includes('--force') })
}
