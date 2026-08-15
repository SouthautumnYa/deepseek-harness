/** Shared skin chrome must keep the hero and readable content in separate layers. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CHROME = fileURLToPath(new URL('../src/styles/skins/_chrome.css', import.meta.url))
const css = readFileSync(CHROME, 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)
  if (match?.[1] === undefined) throw new Error(`missing skin chrome rule: ${selector}`)
  return match[1]
}

describe('shared skin chrome layers', () => {
  it('keeps the hero on an isolated frame background layer', () => {
    const frame = rule('body[data-skin-chrome] [data-app-frame]')
    const hero = rule('body[data-skin-chrome] [data-app-frame]::before')

    expect(frame).toContain('position: relative;')
    expect(frame).toContain('isolation: isolate;')
    expect(frame).toContain('background: transparent;')
    expect(hero).toContain('position: absolute;')
    expect(hero).toContain('inset: 0;')
    expect(hero).toContain('pointer-events: none;')
    expect(hero).toContain('background-image: linear-gradient(')
    expect(hero).toContain('var(--skin-hero)')
  })

  it('uses local glass surfaces instead of opacity on the content subtree', () => {
    const shell = rule('body[data-skin-chrome] [data-app-frame] > :not([data-frame-titlebar])')
    const conversation = rule('body[data-skin-chrome] [data-conversation-panel]')

    expect(shell).toContain('background: color-mix(')
    expect(shell).toContain('backdrop-filter: var(--skin-blur);')
    expect(conversation).toContain('background-color: color-mix(')
    expect(conversation).toContain('88%, transparent)')
    expect(conversation).toContain('background-image: none;')
    expect(conversation).toContain('backdrop-filter: var(--skin-blur);')
    expect(conversation).not.toMatch(/\bopacity\s*:/)
    expect(conversation).not.toMatch(/(?<!backdrop-)\bfilter\s*:/)
  })
})
