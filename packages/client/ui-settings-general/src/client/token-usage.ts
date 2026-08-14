/** Token-usage history loading and date-bucket aggregation for Settings. */

import type {
  ConnectionHandle, HistoryEntry, SessionSummary,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Token counts split by billing/cache category for one model step. */
export interface TokenUsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One usage observation associated with a session turn and step. */
export interface TokenUsageSample extends TokenUsageBuckets {
  time: number
  stepKey: string
}

/** Loaded usage samples grouped by session, including failed histories. */
export interface TokenUsageHistory {
  sessions: ReadonlyMap<string, readonly TokenUsageSample[]>
  failedSessions: number
}

/** Aggregated usage totals for a selected date range. */
export interface TokenUsageSummary extends TokenUsageBuckets {
  totalTokens: number
  requests: number
  sessions: number
  daily: ReadonlyMap<string, number>
}

const zeroBuckets = (): TokenUsageBuckets => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function bucketsOf(value: unknown): TokenUsageBuckets | undefined {
  const data = record(value)
  if (data === undefined) return undefined
  const input = nonNegativeInteger(data.inputTokens)
  const output = nonNegativeInteger(data.outputTokens)
  if (input === undefined || output === undefined) return undefined
  return {
    uncachedInputTokens: input,
    outputTokens: output,
    cacheReadTokens: nonNegativeInteger(data.cacheReadTokens) ?? 0,
    cacheWriteTokens: nonNegativeInteger(data.cacheWriteTokens) ?? 0,
  }
}

function usageSample(entry: HistoryEntry): TokenUsageSample | undefined {
  const event = entry.event
  const data = record(event.data)
  if (data === undefined) return undefined
  let usage: unknown
  let turn: unknown
  let step: unknown
  if (event.type === 'assistant/chunk') {
    const chunk = record(data.chunk)
    if (chunk?.type !== 'usage') return undefined
    usage = chunk.usage
    turn = data.turn
    step = data.step
  } else if (event.type === 'assistant/message') {
    usage = data.usage
    turn = data.turn
    step = data.step
  } else {
    return undefined
  }
  if (typeof turn !== 'number' || !Number.isSafeInteger(turn)
    || typeof step !== 'number' || !Number.isSafeInteger(step)) return undefined
  const buckets = bucketsOf(usage)
  return buckets === undefined
    ? undefined
    : { ...buckets, time: event.time, stepKey: `${String(turn)}:${String(step)}` }
}

/**
 * Fold one history into last-wins usage samples for each model step.
 * @param history - Session events to inspect.
 * @returns Usage samples ordered by event time.
 */
export function usageSamplesOf(history: readonly HistoryEntry[]): TokenUsageSample[] {
  const samples = new Map<string, TokenUsageSample>()
  for (const entry of history) {
    const sample = usageSample(entry)
    if (sample !== undefined) samples.set(sample.stepKey, sample)
  }
  return [...samples.values()].sort((left, right) => left.time - right.time)
}

async function readAllHistory(connection: ConnectionHandle, session: SessionSummary): Promise<TokenUsageSample[]> {
  const history: HistoryEntry[] = []
  let beforeSeq: number | undefined
  for (;;) {
    const response = await connection.api.sessions.history({
      sessionId: session.sessionId,
      ...beforeSeq === undefined ? {} : { beforeSeq },
      maxMessages: 200,
    })
    if (!response.result.ok) throw new Error(response.result.error.message)
    const page = response.result.value
    history.unshift(...page.events)
    if (!page.hasMore) return usageSamplesOf(history)
    const firstSeq = page.events[0]?.event.seq
    if (firstSeq === undefined || firstSeq === beforeSeq) return usageSamplesOf(history)
    beforeSeq = firstSeq
  }
}

/**
 * Load all non-blank session logs; one broken history does not hide healthy logs.
 * @param connection - API connection used to list sessions and read history.
 * @returns Loaded samples grouped by session and the number of failed histories.
 */
export async function loadTokenUsageHistory(connection: ConnectionHandle): Promise<TokenUsageHistory> {
  const listed = await connection.api.sessions.list({})
  if (!listed.result.ok) throw new Error(listed.result.error.message)
  const candidates = listed.result.value.items.filter(session => !session.blank)
  const settled = await Promise.allSettled(candidates.map(async session => ({
    id: session.sessionId,
    samples: await readAllHistory(connection, session),
  })))
  const sessions = new Map<string, readonly TokenUsageSample[]>()
  let failedSessions = 0
  for (const result of settled) {
    if (result.status === 'fulfilled') sessions.set(result.value.id, result.value.samples)
    else failedSessions++
  }
  return { sessions, failedSessions }
}

/**
 * Convert an epoch-millisecond event time to a local calendar key.
 * @param time - Event time in epoch milliseconds.
 * @returns Local date in `YYYY-MM-DD` form.
 */
export function dateKeyFromTime(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dateFromKey(key: string): Date {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Return every local date in an inclusive range.
 * @param startKey - Inclusive start date in `YYYY-MM-DD` form.
 * @param endKey - Inclusive end date in `YYYY-MM-DD` form.
 * @returns The date keys in ascending order.
 */
export function dateKeysBetween(startKey: string, endKey: string): string[] {
  const start = dateFromKey(startKey)
  const end = dateFromKey(endKey)
  const result: string[] = []
  for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    result.push(dateKeyFromTime(current.getTime()))
  }
  return result
}

/**
 * Aggregate the already loaded step samples into one selected date range.
 * @param history - Previously loaded session usage history.
 * @param startKey - Inclusive start date in `YYYY-MM-DD` form.
 * @param endKey - Inclusive end date in `YYYY-MM-DD` form.
 * @returns Totals, request/session counts, and daily totals for the range.
 */
export function summarizeTokenUsage(
  history: TokenUsageHistory,
  startKey: string,
  endKey: string,
): TokenUsageSummary {
  const totals = zeroBuckets()
  const daily = new Map<string, number>()
  let requests = 0
  let sessions = 0
  for (const samples of history.sessions.values()) {
    let active = false
    for (const sample of samples) {
      const day = dateKeyFromTime(sample.time)
      if (day < startKey || day > endKey) continue
      active = true
      requests++
      totals.uncachedInputTokens += sample.uncachedInputTokens
      totals.outputTokens += sample.outputTokens
      totals.cacheReadTokens += sample.cacheReadTokens
      totals.cacheWriteTokens += sample.cacheWriteTokens
      const total = sample.uncachedInputTokens + sample.outputTokens
        + sample.cacheReadTokens + sample.cacheWriteTokens
      daily.set(day, (daily.get(day) ?? 0) + total)
    }
    if (active) sessions++
  }
  return {
    ...totals,
    totalTokens: totals.uncachedInputTokens + totals.outputTokens
      + totals.cacheReadTokens + totals.cacheWriteTokens,
    requests,
    sessions,
    daily,
  }
}
