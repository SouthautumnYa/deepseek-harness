// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ArchivedConversationsSectionProps,
} from '../src/client/ArchivedConversationsSection.tsx'
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

function session(
  id: SessionId,
  title: string,
  updatedAt: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    displayTitle: title,
    running: false,
    blank: false,
    updatedAt,
    ...extra,
  }
}

function workspace(id: string, title: string, sessionIds: SessionId[]) {
  return {
    workspaceId: id,
    title,
    path: `C:/projects/${id}`,
    sessionIds,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
}

function props({
  archivedSessionIds,
  byId = {},
  items = [],
  restoreSession,
  deleteSession,
}: {
  archivedSessionIds: SessionId[]
  byId?: Record<string, unknown>
  items?: unknown[]
  restoreSession?: (sessionId: SessionId) => Promise<void> | void
  deleteSession?: (sessionId: SessionId) => Promise<void> | void
}): ArchivedConversationsSectionProps {
  return {
    close: vi.fn(),
    t,
    useWorkspaces: selector => selector({ archivedSessionIds, items } as never),
    useSessions: selector => selector({ byId } as never),
    ...(restoreSession === undefined ? {} : { restoreSession }),
    ...(deleteSession === undefined ? {} : { deleteSession }),
  }
}

describe('ArchivedConversationsSection', () => {
  it('renders a friendly empty state', () => {
    render(<ArchivedConversationsSection {...props({ archivedSessionIds: [] })} />)
    expect(screen.getByRole('heading', { name: 'Archived chats' })).toBeTruthy()
    expect(screen.getByText('No archived chats')).toBeTruthy()
  })

  it('groups archived sessions by project and keeps restore disabled without a Host action', () => {
    const id = 'session-archived' as SessionId
    render(<ArchivedConversationsSection {...props({
      archivedSessionIds: [id],
      byId: { [id]: session(id, 'Archived design review', Date.UTC(2026, 7, 15, 3, 0)) },
    })} />)
    expect(screen.getByText('Archived design review')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'No project' })).toBeTruthy()
    expect(screen.getByText(id)).toBeTruthy()
    expect(screen.getByRole('listitem').getAttribute('data-session-id')).toBe(id)
    const restore = screen.getByRole('button', { name: 'Restore: Archived design review' }) as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    expect(restore.title).toBe('The current backend does not provide an unarchive API')
  })

  it('filters by search, chat scope, and project', () => {
    const alpha = 'session-alpha' as SessionId
    const beta = 'session-beta' as SessionId
    const gamma = 'session-gamma' as SessionId
    render(<ArchivedConversationsSection {...props({
      archivedSessionIds: [alpha, beta, gamma],
      byId: {
        [alpha]: session(alpha, 'Alpha notes', 1),
        [beta]: session(beta, 'Beta child task', 3, { origin: 'subagent', parentId: alpha }),
        [gamma]: session(gamma, 'Gamma planning', 2),
      },
      items: [workspace('project-a', 'Project A', [beta]), workspace('project-b', 'Project B', [gamma])],
    })} />)

    const search = screen.getByRole('searchbox', { name: 'Search archived chats' })
    fireEvent.change(search, { target: { value: 'beta' } })
    expect(screen.getByText('Beta child task')).toBeTruthy()
    expect(screen.queryByText('Alpha notes')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Project A' })).toBeTruthy()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Chat scope' }), { target: { value: 'subagent' } })
    expect(screen.getByText('Beta child task')).toBeTruthy()
    expect(screen.queryByText('Alpha notes')).toBeNull()
    expect(screen.queryByText('Gamma planning')).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: 'Chat scope' }), { target: { value: 'all' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'project-b' } })
    expect(screen.getByText('Gamma planning')).toBeTruthy()
    expect(screen.queryByText('Alpha notes')).toBeNull()
    expect(screen.queryByText('Beta child task')).toBeNull()
  })

  it('calls an injected restore action and reports its pending state', async () => {
    const id = 'session-restorable' as SessionId
    const restoreSession = vi.fn(() => Promise.resolve())
    render(<ArchivedConversationsSection {...props({
      archivedSessionIds: [id],
      byId: { [id]: session(id, 'Restorable chat', 1) },
      restoreSession,
    })} />)

    const button = screen.getByRole('button', { name: 'Restore: Restorable chat' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => { expect(restoreSession).toHaveBeenCalledWith(id) })
  })

  it('confirms a permanent delete, reports pending state, and removes the row after success', async () => {
    const id = 'session-deletable' as SessionId
    let resolveDelete: (() => void) | undefined
    const deleteSession = vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve }))
    render(<ArchivedConversationsSection {...props({
      archivedSessionIds: [id],
      byId: { [id]: session(id, 'Deletable chat', 1) },
      deleteSession,
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete chat: Deletable chat' }))
    expect(screen.getByRole('group', { name: 'Permanently delete this chat?' })).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Delete permanently' }) as HTMLButtonElement
    fireEvent.click(confirm)
    expect(deleteSession).toHaveBeenCalledWith(id)
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeTruthy()
    resolveDelete?.()

    await waitFor(() => {
      expect(screen.queryByRole('listitem')).toBeNull()
      expect(screen.getByText('No archived chats')).toBeTruthy()
    })
  })

  it('cancels a delete without calling the Host action', () => {
    const id = 'session-delete-cancelled' as SessionId
    const deleteSession = vi.fn(() => Promise.resolve())
    render(<ArchivedConversationsSection {...props({
      archivedSessionIds: [id],
      byId: { [id]: session(id, 'Keep this chat', 1) },
      deleteSession,
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete chat: Keep this chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteSession).not.toHaveBeenCalled()
    expect(screen.getByRole('listitem')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete chat: Keep this chat' })).toBeTruthy()
  })

  it('keeps the row and reports an error when permanent delete fails', async () => {
    const id = 'session-delete-failed' as SessionId
    const deleteSession = vi.fn(() => Promise.reject(new Error('delete failed')))
    render(<ArchivedConversationsSection {...props({
      archivedSessionIds: [id],
      byId: { [id]: session(id, 'Failed delete chat', 1) },
      deleteSession,
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete chat: Failed delete chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('delete failed') })
    expect(screen.getByRole('listitem')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeTruthy()
  })
})
