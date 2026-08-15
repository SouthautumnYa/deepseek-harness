import { describe, expect, it } from 'vitest'
import { normalizeRepo } from 'dsh-plugin-marketplace'
import './dsh-plugin-marketplace.d.ts'

describe('marketplace metadata normalization', () => {
  it('preserves category and normalizes string, array, and object tags', () => {
    const direct = normalizeRepo({
      full_name: 'demo/vision-kit',
      name: 'vision-kit',
      html_url: 'https://github.com/demo/vision-kit',
      category: ' VISION ',
      topics: '["image", "multimodal"]',
    })
    expect(direct.category).toBe('vision')
    expect(direct.topics).toEqual(['image', 'multimodal'])

    const aliases = normalizeRepo({
      full_name: 'demo/theme-kit',
      name: 'theme-kit',
      html_url: 'https://github.com/demo/theme-kit',
      categories: [{ slug: 'web_ui' }],
      topics: [],
      tags: ['skin', { name: 'theme' }],
    })
    expect(aliases.category).toBe('web-ui')
    expect(aliases.topics).toEqual(['skin', 'theme'])
  })
})
