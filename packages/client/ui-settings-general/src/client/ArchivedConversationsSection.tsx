/** Settings page exposing the registry-global archived-session set. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ArchivedConversationsSection.module.css'

export type ArchivedConversationsSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'>

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

/**
 * Render archived sessions without duplicating the Workspace browser's live
 * grouping logic. The workspace archive set is authoritative; session.list
 * supplies the retained title and timestamp when that row is available.
 */
export function ArchivedConversationsSection({
  useSessions,
  useWorkspaces,
  t,
}: ArchivedConversationsSectionProps) {
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const sessions = useSessions(state => state.byId)

  return (
    <section className={css.section}>
      <header className={css.header}>
        <h2 className={css.title}>{t('archived.title')}</h2>
        <p className={css.subtitle}>{t('archived.subtitle')}</p>
      </header>

      {archivedSessionIds.length === 0
        ? <div className={css.empty}>{t('archived.empty')}</div>
        : (
          <div className={css.list} role="list">
            {archivedSessionIds.map((sessionId) => {
              const session = sessions[sessionId]
              return (
                <article className={css.row} role="listitem" key={sessionId}>
                  <div className={css.rowBody}>
                    <h3 className={css.rowTitle}>{session?.displayTitle ?? t('archived.unknown')}</h3>
                    <p className={css.meta}>
                      {session === undefined
                        ? t('archived.id', { id: sessionId })
                        : t('archived.updated', { time: formatUpdatedAt(session.updatedAt) })}
                    </p>
                  </div>
                  <code className={css.sessionId} title={sessionId}>{sessionId}</code>
                </article>
              )
            })}
          </div>
        )}
    </section>
  )
}
