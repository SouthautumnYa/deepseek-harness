import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = resolve(import.meta.dirname, '..')

function manifestDependencies() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  return manifest.dependencies ?? {}
}

function patchRows() {
  const parsed = yaml.load(
    readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('web-app patch must parse to a patch list')
  return parsed.flatMap((patch): Record<string, unknown>[] =>
    typeof patch === 'object' && patch !== null
      ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
      : [],
  )
}

describe('community integrations', () => {
  it('pins the latest remote commits for the IM bot and plugin marketplace', () => {
    expect(manifestDependencies()).toMatchObject({
      '@dsh-extra/im-channel': 'git+https://github.com/ivorytower1026/dsh-im-bot.git#9d80f73df2ecb16a6ec2702542ac59ce6a22ecae&path:/im-channel',
      '@dsh-extra/dsh-client-ui-settings-im': 'git+https://github.com/ivorytower1026/dsh-im-bot.git#9d80f73df2ecb16a6ec2702542ac59ce6a22ecae&path:/ui-settings-im',
      'dsh-plugin-marketplace': 'git+https://github.com/bradeGithub/DSH-Plugins-Marketplace.git#568cb84132425c0d5361b0c6c6f9ce8ee5e5f35e',
    })
  })

  it('mounts one runtime row and one browser/settings row for each community integration', () => {
    const rows = patchRows()
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'im-channel', name: '@dsh-extra/im-channel' }),
      expect.objectContaining({ id: 'ui-settings-im', name: '@dsh-extra/dsh-client-ui-settings-im' }),
      expect.objectContaining({ id: 'plugin-marketplace', name: 'dsh-plugin-marketplace' }),
    ]))

    const imRow = rows.find(row => row.id === 'im-channel')
    expect(imRow?.inject).toEqual(['agents'])
    expect(imRow?.config).toEqual({ channels: {}, commandPrefix: '/' })
  })
})
