import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  cleanupRuntime,
  cleanupWinUnpacked,
  getRuntimePath,
  getWinUnpackedPath,
} from './cleanup-package-output.mjs'

const desktopRoot = resolve(import.meta.dirname, '..')

test('Windows packaging keeps only the required Electron locales and cleans its intermediate output', () => {
  const desktopPackage = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
  const installerInclude = readFileSync(join(desktopRoot, 'build', 'installer.nsh'), 'utf8')

  assert.deepEqual(desktopPackage.build.electronLanguages, ['zh-CN', 'en-US'])
  assert.equal(desktopPackage.build.nsis.include, 'build/installer.nsh')
  assert.match(installerInclude, /--quit-for-update/)
  assert.match(installerInclude, /!ifndef BUILD_UNINSTALLER/)
  assert.match(installerInclude, /FIND_PROCESS/)
  assert.match(installerInclude, /Sleep 250/)
  assert.match(installerInclude, /KILL_PROCESS.*1/)
  assert.match(installerInclude, /_CHECK_APP_RUNNING/)
  assert.match(desktopPackage.scripts['package:win'], /electron-builder --win nsis && node scripts\/cleanup-package-output\.mjs --apply --include-runtime/)
})

test('removes only generated win-unpacked output and preserves user data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-package-cleanup-'))

  try {
    const target = getWinUnpackedPath(root)
    const userData = join(root, 'user-data')
    await mkdir(join(target, 'resources'), { recursive: true })
    await mkdir(userData, { recursive: true })
    await writeFile(join(target, 'resources', 'marker.txt'), 'generated')
    await writeFile(join(userData, 'session.json'), '{"session":"keep"}')

    const result = await cleanupWinUnpacked({ root, apply: true })

    assert.equal(result.removed, true)
    assert.equal(existsSync(target), false)
    assert.equal(existsSync(join(userData, 'session.json')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dry run does not remove generated output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-package-cleanup-dry-run-'))

  try {
    const target = getWinUnpackedPath(root)
    await mkdir(target, { recursive: true })

    const result = await cleanupWinUnpacked({ root })

    assert.equal(result.reason, 'dry-run')
    assert.equal(existsSync(target), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cleans the generated runtime without touching neighboring user data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-package-cleanup-runtime-'))

  try {
    const target = getRuntimePath(root)
    const userData = join(root, 'user-data')
    await mkdir(target, { recursive: true })
    await mkdir(userData, { recursive: true })
    await writeFile(join(target, 'package.json'), '{}')
    await writeFile(join(userData, 'session.json'), '{"session":"keep"}')

    const result = await cleanupRuntime({ root, apply: true })

    assert.equal(result.removed, true)
    assert.equal(existsSync(target), false)
    assert.equal(existsSync(join(userData, 'session.json')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
