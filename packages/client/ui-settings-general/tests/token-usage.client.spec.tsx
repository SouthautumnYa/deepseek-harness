// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TokenUsageSectionProps } from '../src/client/TokenUsageSection.tsx'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'
import {
  dateKeyFromTime, dateKeysBetween, summarizeTokenUsage, usageSamplesOf,
  type TokenUsageHistory,
} from '../src/client/token-usage.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: TokenUsageSectionProps['t'] = (key, values) => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, String(value))
  return text
}

function event(
  time: number,
  turn: number,
  step: number,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  kind: 'assistant/message' | 'assistant/chunk' = 'assistant/message',
) {
  return {
    event: {
      type: kind,
      seq: turn * 10 + step,
      time,
      data: kind === 'assistant/message'
        ? { turn, step, usage }
        : { turn, step, chunk: { type: 'usage', usage } },
    },
  } as never
}

const day = (value: string): number => new Date(`${value}T12:00:00`).getTime()

describe('token usage fold', () => {
  it('replaces a usage chunk with the final sample for the same step', () => {
    const samples = usageSamplesOf([
      event(day('2026-08-14'), 1, 1, { inputTokens: 10, outputTokens: 2 }, 'assistant/chunk'),
      event(day('2026-08-14') + 1, 1, 1, { inputTokens: 12, outputTokens: 4 }),
    ])
    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({ uncachedInputTokens: 12, outputTokens: 4 })
  })

  it('filters by local date and counts sessions and daily totals', () => {
    const history: TokenUsageHistory = {
      sessions: new Map([
        ['one', usageSamplesOf([event(day('2026-08-13'), 1, 1, { inputTokens: 10, outputTokens: 2 })])],
        ['two', usageSamplesOf([event(day('2026-08-14'), 1, 1, { inputTokens: 20, outputTokens: 3, cacheReadTokens: 5 })])],
      ]),
      failedSessions: 0,
    }
    expect(summarizeTokenUsage(history, '2026-08-14', '2026-08-14')).toMatchObject({
      totalTokens: 28,
      requests: 1,
      sessions: 1,
    })
  })

  it('builds inclusive local date keys', () => {
    expect(dateKeyFromTime(day('2026-08-14'))).toBe('2026-08-14')
    expect(dateKeysBetween('2026-08-12', '2026-08-14')).toEqual([
      '2026-08-12', '2026-08-13', '2026-08-14',
    ])
  })
})

describe('TokenUsageSection', () => {
  it('loads history, renders totals, and exposes custom date inputs', async () => {
    const today = dateKeyFromTime(Date.now())
    const api = {
      sessions: {
        list: vi.fn(() => Promise.resolve({
          rpcId: 'list' as never,
          result: { ok: true as const, value: { items: [{ sessionId: 's1', updatedAt: day(today), running: false, blank: false }] } },
        })),
        history: vi.fn(() => Promise.resolve({
          rpcId: 'history' as never,
          result: { ok: true as const, value: { events: [event(day(today), 1, 1, { inputTokens: 20, outputTokens: 5 })], hasMore: false } },
        })),
      },
    }
    const props = {
      t,
      close: vi.fn(),
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
      connection: { api } as never,
    } as TokenUsageSectionProps
    render(<TokenUsageSection {...props} />)
    expect(await screen.findByText('Tokens')).toBeTruthy()
    expect(screen.getAllByText('25')).toHaveLength(2)
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }))
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(2)
    expect(api.sessions.history).toHaveBeenCalledOnce()
  })
})
