// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ArchivedConversationsSectionProps } from '../src/client/ArchivedConversationsSection.tsx'
import { ArchivedConversationsSection } from '../src/client/ArchivedConversationsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ArchivedConversationsSectionProps['t'] = (key, params) => {
  let value = (en as Record<string, string>)[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}

function props(archivedSessionIds: SessionId[]): ArchivedConversationsSectionProps {
  const byId = archivedSessionIds.length === 0
    ? {}
    : {
      [archivedSessionIds[0]!]: {
        id: archivedSessionIds[0]!,
        displayTitle: 'Archived design review',
        running: false,
        blank: false,
        updatedAt: Date.UTC(2026, 7, 15, 3, 0),
      },
    }
  return {
    close: vi.fn(),
    t,
    useWorkspaces: selector => selector({ archivedSessionIds } as never),
    useSessions: selector => selector({ byId } as never),
  }
}

describe('ArchivedConversationsSection', () => {
  it('renders a friendly empty state', () => {
    render(<ArchivedConversationsSection {...props([])} />)
    expect(screen.getByRole('heading', { name: 'Archived chats' })).toBeTruthy()
    expect(screen.getByText('No archived chats')).toBeTruthy()
  })

  it('lists archived session titles and ids from the standard stores', () => {
    const id = 'session-archived' as SessionId
    render(<ArchivedConversationsSection {...props([id])} />)
    expect(screen.getByText('Archived design review')).toBeTruthy()
    expect(screen.getByText(id)).toBeTruthy()
    expect(screen.getByRole('listitem')).toBeTruthy()
  })
})
