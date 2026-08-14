/** The shipped Web bundle carries the community marketplace as a client plugin. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('web-app marketplace integration', () => {
  it('pins the marketplace package and mounts its Web plugin row', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const source = manifest.dependencies?.['dsh-plugin-marketplace']
    expect(source).toBe(
      'git+https://github.com/bradeGithub/DSH-Plugins-Marketplace.git#6d6fd7e0f2eab242b061afc7a38ddbe54f35a28a',
    )

    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('web-app patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    expect(rows).toContainEqual({ id: 'plugin-marketplace', name: 'dsh-plugin-marketplace' })
  })
})
