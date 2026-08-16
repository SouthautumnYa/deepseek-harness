/** Settings page exposing the registry-global archived-session set. */

import { useEffect, useMemo, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconFolderOpenOutline16, IconListPenOutline16, IconSearchOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ArchivedConversationsSection.module.css'

const UNGROUPED_PROJECT_ID = '__ungrouped__'

type ChatScope = 'all' | 'direct' | 'subagent'

/** Restore action supplied by the WorkspaceRuntime. */
export interface ArchivedConversationsSectionActions {
  restoreSession?: (sessionId: SessionId) => Promise<void> | void
  deleteSession?: (sessionId: SessionId) => Promise<void> | void
}

export type ArchivedConversationsSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'> & Partial<ArchivedConversationsSectionActions>

interface ProjectInfo {
  id: string
  title: string
  path: string
}

interface ArchivedRow {
  id: SessionId
  title: string
  updatedAt: number
  cwd?: string
  project: ProjectInfo | undefined
  isSubagent: boolean
  archiveIndex: number
}

interface ArchivedGroup {
  id: string
  title: string
  rows: ArchivedRow[]
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

/**
 * Render the archived-session catalog. The archive set is Host-authoritative;
 * session.list supplies titles and timestamps, while workspace.list supplies
 * project grouping without a second content query.
 */
export function ArchivedConversationsSection({
  useSessions,
  useWorkspaces,
  restoreSession,
  deleteSession,
  t,
}: ArchivedConversationsSectionProps) {
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const workspaces = useWorkspaces(state => state.items)
  const sessions = useSessions(state => state.byId)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ChatScope>('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [pendingRestore, setPendingRestore] = useState<SessionId | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SessionId | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SessionId | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [optimisticallyDeleted, setOptimisticallyDeleted] = useState<ReadonlySet<SessionId>>(new Set())

  // Keep a successful delete visible as removed while the Host refreshes its
  // workspace snapshot. Once the snapshot drops the ID, discard the marker so
  // a later re-archive of the same session can be displayed normally.
  useEffect(() => {
    setOptimisticallyDeleted((current) => {
      const next = new Set([...current].filter(sessionId => archivedSessionIds.includes(sessionId)))
      if (next.size === current.size && [...next].every(sessionId => current.has(sessionId))) return current
      return next
    })
  }, [archivedSessionIds])

  const visibleArchivedSessionIds = useMemo(
    () => archivedSessionIds.filter(sessionId => !optimisticallyDeleted.has(sessionId)),
    [archivedSessionIds, optimisticallyDeleted],
  )

  const projectBySessionId = useMemo(() => {
    const result = new Map<string, ProjectInfo>()
    for (const workspace of workspaces) {
      const project = {
        id: String(workspace.workspaceId),
        title: workspace.title,
        path: workspace.path,
      }
      for (const sessionId of workspace.sessionIds) result.set(String(sessionId), project)
    }
    return result
  }, [workspaces])

  const rows = useMemo<ArchivedRow[]>(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return visibleArchivedSessionIds
      .map((sessionId, archiveIndex) => {
        const session = sessions[sessionId]
        const project = projectBySessionId.get(String(sessionId))
        return {
          id: sessionId,
          title: session?.displayTitle ?? t('archived.unknown'),
          updatedAt: session?.updatedAt ?? 0,
          project,
          isSubagent: session?.origin === 'subagent' || session?.parentId !== undefined,
          archiveIndex,
          ...(session?.cwd === undefined ? {} : { cwd: session.cwd }),
        }
      })
      .filter((row) => {
        if (scope === 'direct' && row.isSubagent) return false
        if (scope === 'subagent' && !row.isSubagent) return false
        const rowProjectId = row.project?.id ?? UNGROUPED_PROJECT_ID
        if (projectFilter !== 'all' && rowProjectId !== projectFilter) return false
        if (normalizedQuery === '') return true
        const searchable = [
          row.title,
          String(row.id),
          row.cwd,
          row.project?.title,
          row.project?.path,
        ].filter((value): value is string => value !== undefined).join(' ').toLowerCase()
        return searchable.includes(normalizedQuery)
      })
      .sort((left, right) => right.updatedAt - left.updatedAt || left.archiveIndex - right.archiveIndex)
  }, [projectBySessionId, projectFilter, query, scope, sessions, t, visibleArchivedSessionIds])

  const projectOptions = useMemo(() => {
    const options = workspaces.map(workspace => ({
      id: String(workspace.workspaceId),
      title: workspace.title,
    }))
    if (visibleArchivedSessionIds.some(sessionId => !projectBySessionId.has(String(sessionId)))) {
      options.push({ id: UNGROUPED_PROJECT_ID, title: t('archived.noProject') })
    }
    return options
  }, [projectBySessionId, t, visibleArchivedSessionIds, workspaces])

  const groups = useMemo<ArchivedGroup[]>(() => {
    const grouped = new Map<string, ArchivedGroup>()
    for (const row of rows) {
      const id = row.project?.id ?? UNGROUPED_PROJECT_ID
      const existing = grouped.get(id)
      if (existing !== undefined) existing.rows.push(row)
      else grouped.set(id, {
        id,
        title: row.project?.title ?? t('archived.noProject'),
        rows: [row],
      })
    }
    const workspaceRank = new Map(workspaces.map((workspace, index) => [String(workspace.workspaceId), index]))
    return [...grouped.values()].sort((left, right) => {
      if (left.id === UNGROUPED_PROJECT_ID) return -1
      if (right.id === UNGROUPED_PROJECT_ID) return 1
      return (workspaceRank.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (workspaceRank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    })
  }, [rows, t, workspaces])

  const restore = async (sessionId: SessionId) => {
    if (restoreSession === undefined) return
    setPendingRestore(sessionId)
    setActionError(null)
    try {
      await restoreSession(sessionId)
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingRestore(null)
    }
  }

  const remove = async (sessionId: SessionId) => {
    if (deleteSession === undefined) return
    setPendingDelete(sessionId)
    setActionError(null)
    try {
      await deleteSession(sessionId)
      setOptimisticallyDeleted(current => new Set(current).add(sessionId))
      setConfirmDelete(null)
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <section className={css.section}>
      <header className={css.header}>
        <div className={css.heading}>
          <h2 className={css.title}>{t('archived.title')}</h2>
          <p className={css.subtitle}>{t('archived.subtitle')}</p>
        </div>
      </header>

      <div className={css.toolbar}>
        <label className={css.searchField}>
          <IconSearchOutline16 className={css.controlIcon} size={16} aria-hidden="true" />
          <span className={css.visuallyHidden}>{t('archived.searchLabel')}</span>
          <input
            className={css.searchInput}
            type="search"
            value={query}
            aria-label={t('archived.searchLabel')}
            placeholder={t('archived.searchPlaceholder')}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </label>

        <label className={css.selectField}>
          <IconListPenOutline16 className={css.controlIcon} size={16} aria-hidden="true" />
          <span className={css.visuallyHidden}>{t('archived.scopeLabel')}</span>
          <select
            className={css.select}
            value={scope}
            aria-label={t('archived.scopeLabel')}
            onChange={(event) => { setScope(event.target.value as ChatScope) }}
          >
            <option value="all">{t('archived.scopeAll')}</option>
            <option value="direct">{t('archived.scopeDirect')}</option>
            <option value="subagent">{t('archived.scopeSubagent')}</option>
          </select>
        </label>

        <label className={css.selectField}>
          <IconFolderOpenOutline16 className={css.controlIcon} size={16} aria-hidden="true" />
          <span className={css.visuallyHidden}>{t('archived.projectLabel')}</span>
          <select
            className={css.select}
            value={projectFilter}
            aria-label={t('archived.projectLabel')}
            onChange={(event) => { setProjectFilter(event.target.value) }}
          >
            <option value="all">{t('archived.projectAll')}</option>
            {projectOptions.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </label>
      </div>

      {actionError === null ? null : <p className={css.error} role="alert">{actionError}</p>}

      {visibleArchivedSessionIds.length === 0
        ? <div className={css.empty}>{t('archived.empty')}</div>
        : groups.length === 0
          ? <div className={css.empty}>{t('archived.noResults')}</div>
          : (
            <div className={css.groups}>
              {groups.map(group => (
                <section className={css.group} key={group.id}>
                  <header className={css.groupHeader}>
                    <div className={css.groupTitleWrap}>
                      <IconFolderOpenOutline16 className={css.groupIcon} size={16} aria-hidden="true" />
                      <h3 className={css.groupTitle}>{group.title}</h3>
                    </div>
                    <span className={css.groupCount}>{t('archived.count', { count: group.rows.length })}</span>
                  </header>
                  <div className={css.list} role="list">
                    {group.rows.map((row) => {
                      const canRestore = restoreSession !== undefined
                      const canDelete = deleteSession !== undefined
                      const restoring = pendingRestore === row.id
                      const deleting = pendingDelete === row.id
                      return (
                        <article className={css.row} role="listitem" data-session-id={row.id} key={row.id}>
                          <div className={css.rowBody}>
                            <h4 className={css.rowTitle}>{row.title}</h4>
                            <p className={css.meta}>
                              {row.updatedAt === 0 ? t('archived.unknownDate') : formatUpdatedAt(row.updatedAt)}
                              {row.isSubagent ? <span className={css.badge}>{t('archived.scopeSubagent')}</span> : null}
                            </p>
                            <code className={css.sessionId}>{row.id}</code>
                          </div>
                          <div className={css.rowActions}>
                            {confirmDelete === row.id
                              ? (
                                <div className={css.deleteConfirm} role="group" aria-label={t('archived.deleteConfirm')}>
                                  <span className={css.confirmText}>{t('archived.deleteConfirm')}</span>
                                  <button
                                    type="button"
                                    className={css.deleteButton}
                                    disabled={deleting || pendingRestore !== null}
                                    onClick={() => { void remove(row.id) }}
                                  >
                                    {deleting ? t('archived.deleting') : t('archived.confirmDelete')}
                                  </button>
                                  <button
                                    type="button"
                                    className={css.cancelButton}
                                    disabled={deleting}
                                    onClick={() => { setConfirmDelete(null) }}
                                  >
                                    {t('archived.cancelDelete')}
                                  </button>
                                </div>
                              )
                              : (
                                <button
                                  type="button"
                                  className={css.deleteButton}
                                  disabled={!canDelete || pendingRestore !== null || pendingDelete !== null}
                                  aria-label={`${t('archived.delete')}: ${row.title}`}
                                  title={canDelete ? t('archived.delete') : t('archived.deleteUnavailable')}
                                  onClick={() => { setConfirmDelete(row.id); setActionError(null) }}
                                >
                                  <IconTrashOutline16 size={16} aria-hidden="true" />
                                  <span>{t('archived.delete')}</span>
                                </button>
                              )}
                            <button
                              type="button"
                              className={css.restoreButton}
                              disabled={!canRestore || pendingRestore !== null || pendingDelete !== null}
                              aria-label={`${t('archived.restore')}: ${row.title}`}
                              title={canRestore ? t('archived.restore') : t('archived.restoreUnavailable')}
                              onClick={() => { void restore(row.id) }}
                            >
                              {restoring ? t('archived.restoring') : t('archived.restore')}
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
    </section>
  )
}
