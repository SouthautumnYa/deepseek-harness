/** Settings page for provider-reported token usage over persisted sessions. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  dateKeyFromTime, dateKeysBetween, loadTokenUsageHistory, summarizeTokenUsage,
  type TokenUsageHistory,
} from './token-usage.ts'
import css from './TokenUsageSection.module.css'

type RangeMode = 'today' | 'week' | 'month' | 'custom'

interface Range {
  startKey: string
  endKey: string
}

interface TokenUsageSectionInjected {
  connection: ConnectionHandle
}

export type TokenUsageSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'> & TokenUsageSectionInjected

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; history: TokenUsageHistory }
  | { status: 'error'; message: string }

const todayKey = dateKeyFromTime(Date.now())

function dateFromKey(key: string): Date {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function rangeFor(mode: RangeMode, customStart: string, customEnd: string): Range {
  if (mode === 'custom') return { startKey: customStart, endKey: customEnd }
  const today = dateFromKey(todayKey)
  if (mode === 'today') return { startKey: todayKey, endKey: todayKey }
  if (mode === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    return { startKey: dateKeyFromTime(start.getTime()), endKey: todayKey }
  }
  const start = new Date(today)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return { startKey: dateKeyFromTime(start.getTime()), endKey: todayKey }
}

function formatTokens(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(value % 100_000_000 === 0 ? 0 : 1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(value % 10_000 === 0 ? 0 : 1)}万`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`
  return String(value)
}

function formatDate(key: string): string {
  const date = dateFromKey(key)
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

function dateLabel(range: Range): string {
  return range.startKey === range.endKey
    ? formatDate(range.startKey)
    : `${formatDate(range.startKey)}–${formatDate(range.endKey)}`
}

function levelFor(value: number, maximum: number): number {
  if (value === 0 || maximum === 0) return 0
  if (value <= maximum * 0.25) return 1
  if (value <= maximum * 0.5) return 2
  if (value <= maximum * 0.75) return 3
  return 4
}

function Card({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={css.card}>
      <div className={css.cardLabel}>{label}</div>
      <div className={css.cardValue}>{value}</div>
      {detail === undefined ? null : <div className={css.cardDetail}>{detail}</div>}
    </div>
  )
}

/** Render the token-usage page and its today/week/month/custom range controls. */
export function TokenUsageSection({ connection, t }: TokenUsageSectionProps) {
  const [mode, setMode] = useState<RangeMode>('today')
  const [customStart, setCustomStart] = useState(todayKey)
  const [customEnd, setCustomEnd] = useState(todayKey)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void loadTokenUsageHistory(connection).then((history) => {
      if (alive) setState({ status: 'ready', history })
    }).catch((error: unknown) => {
      if (!alive) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { alive = false }
  }, [connection, reload])

  const range = useMemo(() => rangeFor(mode, customStart, customEnd), [mode, customStart, customEnd])
  const validRange = range.startKey <= range.endKey
  const summary = useMemo(
    () => state.status === 'ready' && validRange
      ? summarizeTokenUsage(state.history, range.startKey, range.endKey)
      : undefined,
    [range.endKey, range.startKey, state, validRange],
  )
  const days = useMemo(
    () => validRange ? dateKeysBetween(range.startKey, range.endKey) : [],
    [range.endKey, range.startKey, validRange],
  )
  const maximumDay = Math.max(...days.map(day => summary?.daily.get(day) ?? 0), 0)
  const cells = useMemo(() => {
    const first = dateFromKey(range.startKey)
    const leading = first.getDay()
    const body = days.map(day => ({ day, tokens: summary?.daily.get(day) ?? 0 }))
    const trailing = (7 - ((leading + body.length) % 7)) % 7
    return [
      ...Array.from({ length: leading }, () => undefined),
      ...body,
      ...Array.from({ length: trailing }, () => undefined),
    ]
  }, [days, range.startKey, summary])
  const refresh = useCallback(() => { setReload(value => value + 1) }, [])

  return (
    <section className={css.section}>
      <div className={css.heading}>
        <div>
          <h2 className={css.title}>{t('tokenUsage.title')}</h2>
          <p className={css.subtitle}>{t('tokenUsage.range', { range: dateLabel(range) })}</p>
        </div>
        <button type="button" className={css.refresh} onClick={refresh} disabled={state.status === 'loading'}>
          {t('tokenUsage.refresh')}
        </button>
      </div>

      <div className={css.rangeBar} role="tablist" aria-label={t('tokenUsage.rangeLabel')}>
        {(['today', 'week', 'month', 'custom'] as const).map(item => (
          <button
            key={item}
            type="button"
            className={css.rangeButton}
            data-active={mode === item}
            role="tab"
            aria-selected={mode === item}
            onClick={() => { setMode(item) }}
          >
            {t(`tokenUsage.${item}`)}
          </button>
        ))}
      </div>

      {mode === 'custom' && (
        <div className={css.customRange}>
          <label>{t('tokenUsage.start')} <input type="date" value={customStart} onChange={(event) => { setCustomStart(event.target.value) }} /></label>
          <span>–</span>
          <label>{t('tokenUsage.end')} <input type="date" value={customEnd} onChange={(event) => { setCustomEnd(event.target.value) }} /></label>
        </div>
      )}

      {!validRange && <p className={css.error} role="alert">{t('tokenUsage.invalidRange')}</p>}
      {state.status === 'loading' && <p className={css.status}>{t('tokenUsage.loading')}</p>}
      {state.status === 'error' && (
        <div className={css.errorRow} role="alert">
          <span>{t('tokenUsage.error')}</span>
          <button type="button" className={css.refresh} onClick={refresh}>{t('tokenUsage.retry')}</button>
        </div>
      )}

      {summary !== undefined && (
        <>
          <div className={css.cards}>
            <Card label={t('tokenUsage.tokens')} value={formatTokens(summary.totalTokens)} detail={summary.totalTokens.toLocaleString('zh-CN')} />
            <Card label={t('tokenUsage.requests')} value={summary.requests.toLocaleString('zh-CN')} />
            <Card label={t('tokenUsage.sessions')} value={summary.sessions.toLocaleString('zh-CN')} />
            <Card label={t('tokenUsage.input')} value={formatTokens(summary.uncachedInputTokens)} detail={summary.uncachedInputTokens.toLocaleString('zh-CN')} />
            <Card label={t('tokenUsage.output')} value={formatTokens(summary.outputTokens)} detail={summary.outputTokens.toLocaleString('zh-CN')} />
            <Card label={t('tokenUsage.cache')} value={formatTokens(summary.cacheReadTokens + summary.cacheWriteTokens)} detail={`${summary.cacheReadTokens.toLocaleString('zh-CN')} / ${summary.cacheWriteTokens.toLocaleString('zh-CN')}`} />
          </div>
          <div className={css.chartHeading}>
            <h3>{t('tokenUsage.daily')}</h3>
            <span>{t('tokenUsage.less')} <i data-level="0" /> <i data-level="1" /> <i data-level="2" /> <i data-level="3" /> <i data-level="4" /> {t('tokenUsage.more')}</span>
          </div>
          <div className={css.heatmap} aria-label={t('tokenUsage.daily')}>
            {cells.map((cell, index) => cell === undefined
              ? <i key={`empty-${String(index)}`} className={css.cell} aria-hidden="true" />
              : <i key={cell.day} className={css.cell} data-level={levelFor(cell.tokens, maximumDay)} title={`${formatDate(cell.day)}：${cell.tokens.toLocaleString('zh-CN')} Tokens`} aria-label={`${formatDate(cell.day)}：${cell.tokens.toLocaleString('zh-CN')} Tokens`} />)}
          </div>
          {state.status === 'ready' && state.history.failedSessions > 0 && (
            <p className={css.notice}>{t('tokenUsage.partial', { count: state.history.failedSessions })}</p>
          )}
        </>
      )}
    </section>
  )
}
