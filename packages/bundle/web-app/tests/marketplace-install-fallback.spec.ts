import './dsh-plugin-marketplace.d.ts'

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __testInstallGitHubRepository } from 'dsh-plugin-marketplace'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('marketplace GitHub installer fallback', () => {
  it('retries git over HTTP/1.1 and installs from codeload when clone is reset', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-marketplace-test-'))
    tempDirs.push(tempDir)
    const cacheDir = join(tempDir, 'cache')
    const logs: string[] = []
    let gitAttempts = 0
    let archiveDownloads = 0

    const source = await __testInstallGitHubRepository('DietrichGebert/ponytail', cacheDir, logs.push.bind(logs), 'zh', {
      platform: 'win32',
      fetchImpl: async () => {
        archiveDownloads += 1
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }
      },
      execFileImpl: async (file: string, args: string[]) => {
        if (file === 'git') {
          gitAttempts += 1
          throw Object.assign(new Error('clone failed'), {
            stderr: 'fatal: Recv failure: Connection was reset',
          })
        }
        if (file === 'tar.exe') {
          const destinationIndex = args.indexOf('-C')
          const destination = args[destinationIndex + 1]
          if (!destination) throw new Error('tar destination was not provided')
          const root = join(destination, 'ponytail-abc123')
          await mkdir(root, { recursive: true })
          await writeFile(join(root, 'package.json'), '{"name":"ponytail"}')
          return { stdout: '', stderr: '' }
        }
        throw new Error(`unexpected command: ${file}`)
      },
    })

    expect(source).toBe('archive')
    expect(gitAttempts).toBe(2)
    expect(archiveDownloads).toBe(1)
    expect(await readFile(join(cacheDir, 'package.json'), 'utf8')).toContain('ponytail')
    expect(logs.some(line => line.includes('Recv failure'))).toBe(true)
    expect(logs.some(line => line.includes('codeload'))).toBe(true)
  })

  it('returns a failure when both git and archive paths fail', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-marketplace-test-'))
    tempDirs.push(tempDir)
    const logs: string[] = []

    await expect(__testInstallGitHubRepository('owner/repo', join(tempDir, 'cache'), logs.push.bind(logs), 'en', {
      platform: 'win32',
      fetchImpl: async () => {
        throw new Error('archive connection reset')
      },
      execFileImpl: async (file: string) => {
        if (file === 'git') {
          throw Object.assign(new Error('clone failed'), { stderr: 'Recv failure: Connection was reset' })
        }
        throw new Error('archive extractor unavailable')
      },
    })).rejects.toThrow(/Git clone and the GitHub codeload fallback both failed/)

    expect(logs.some(line => line.includes('Recv failure'))).toBe(true)
  })
})
