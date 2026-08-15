/**
 * Recover visible content from compatible gateways that return a complete
 * completion in an SSE frame, or return JSON despite stream=true.
 *
 * pi-ai's OpenAI parser consumes delta fields and its Anthropic parser consumes
 * content-block events. This scoped fetch adapter translates only requests
 * created by this package, leaving unrelated application fetches untouched.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

type SupportedApi = 'openai-completions' | 'anthropic-messages'

interface FetchScope {
  api: SupportedApi
  baseURL?: string
}

interface Parts {
  text: string
  reasoning: string
}

interface AnthropicBlock {
  type: 'text' | 'thinking' | 'redacted_thinking' | 'tool_use'
  text?: string
  thinking?: string
  data?: string
  id?: string
  name?: string
  input?: unknown
}

const scopes = new AsyncLocalStorage<FetchScope>()
let installed = false

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function splitThinking(value: string): Parts {
  let reasoning = ''
  const text = value.replace(/<(?:think|thinking|analysis)>([\s\S]*?)<\/(?:think|thinking|analysis)>/gi, (_match, inner: string) => {
    reasoning += inner
    return ''
  })
  return { text, reasoning }
}

function contentParts(value: unknown): Parts {
  if (typeof value === 'string') return splitThinking(value)
  if (!Array.isArray(value)) return { text: '', reasoning: '' }
  let text = ''
  let reasoning = ''
  for (const item of value) {
    if (typeof item === 'string') {
      const parts = splitThinking(item)
      text += parts.text
      reasoning += parts.reasoning
      continue
    }
    if (!record(item)) continue
    const type = stringValue(item.type)
    const itemText = stringValue(item.text ?? item.value ?? item.content ?? item.thinking)
    if (type === 'thinking' || type === 'reasoning' || type === 'reasoning_content' || type === 'redacted_thinking') reasoning += itemText
    else text += splitThinking(itemText).text
  }
  return { text, reasoning }
}

function reasoningValue(value: Record<string, unknown> | undefined): string {
  if (value === undefined) return ''
  for (const key of ['reasoning_content', 'reasoning', 'reasoning_text', 'thinking']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return ''
}

function hasReasoning(value: Record<string, unknown>): boolean {
  return ['reasoning_content', 'reasoning', 'reasoning_text', 'thinking'].some((key) => {
    const candidate = value[key]
    return typeof candidate === 'string' && candidate.length > 0
  })
}

function hasText(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0
  return Array.isArray(value) && contentParts(value).text.length > 0
}

function normalizeOpenAi(payload: Record<string, unknown>, forceFinish: boolean): Record<string, unknown> | undefined {
  if (!Array.isArray(payload.choices)) return undefined
  const rawChoices: unknown[] = payload.choices
  const choices = rawChoices.map((value) => {
    if (!record(value)) return { value, changed: false }
    const choice = { ...value }
    const message = record(choice.message) ? choice.message : undefined
    const delta = record(choice.delta) ? { ...choice.delta } : {}
    let changed = !record(choice.delta)
    const source = message?.content ?? choice.text
    const parts = contentParts(source)
    const reasoning = parts.reasoning || reasoningValue(message)

    if (Array.isArray(delta.content)) {
      const deltaParts = contentParts(delta.content)
      delta.content = deltaParts.text.length > 0 ? deltaParts.text : null
      if (!hasReasoning(delta) && deltaParts.reasoning.length > 0) delta.reasoning_content = deltaParts.reasoning
      changed = true
    }
    if (!hasText(delta.content) && parts.text.length > 0) {
      delta.content = parts.text
      changed = true
    }
    if (!hasReasoning(delta) && reasoning.length > 0) {
      delta.reasoning_content = reasoning
      changed = true
    }
    if (delta.tool_calls === undefined && Array.isArray(message?.tool_calls)) {
      delta.tool_calls = message.tool_calls
      changed = true
    }
    if (forceFinish && (message !== undefined || choice.text !== undefined) && choice.finish_reason == null) {
      choice.finish_reason = 'stop'
      changed = true
    }
    if (changed) choice.delta = delta
    return { value: choice, changed }
  })
  if (!choices.some(choice => choice.changed)) return undefined
  return { ...payload, choices: choices.map(choice => choice.value) }
}

function anthropicBlocks(value: unknown): AnthropicBlock[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  if (!Array.isArray(value)) return []
  const blocks: AnthropicBlock[] = []
  for (const item of value) {
    if (typeof item === 'string') blocks.push({ type: 'text', text: item })
    else if (record(item) && item.type === 'text') blocks.push({ type: 'text', text: stringValue(item.text ?? item.content) })
    else if (record(item) && (item.type === 'thinking' || item.type === 'reasoning')) blocks.push({ type: 'thinking', thinking: stringValue(item.thinking ?? item.text ?? item.content) })
    else if (record(item) && item.type === 'redacted_thinking') blocks.push({ type: 'redacted_thinking', data: stringValue(item.data ?? item.text) })
    else if (record(item) && item.type === 'tool_use') blocks.push({ type: 'tool_use', id: stringValue(item.id), name: stringValue(item.name), input: item.input ?? {} })
  }
  return blocks
}

function sse(event: string | undefined, value: unknown): string {
  return (event === undefined ? '' : 'event: ' + event + '\n') + 'data: ' + JSON.stringify(value) + '\n\n'
}

function anthropicFrames(payload: Record<string, unknown>): string[] | undefined {
  const message = record(payload.message) ? payload.message : payload
  const content = message.content ?? payload.content ?? payload.completion
  const blocks = anthropicBlocks(content)
  if (blocks.length === 0 && typeof content !== 'string') return undefined
  const usage = record(message.usage) ? message.usage : record(payload.usage) ? payload.usage : {}
  const frames = [sse('message_start', {
    type: 'message_start',
    message: {
      id: stringValue(message.id) || 'compat-message',
      type: 'message',
      role: 'assistant',
      model: stringValue(message.model),
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
  })]
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      frames.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }))
      if (block.text) frames.push(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }))
    } else if (block.type === 'thinking') {
      frames.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } }))
      if (block.thinking) frames.push(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } }))
    } else if (block.type === 'redacted_thinking') {
      frames.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'redacted_thinking', data: block.data ?? '' } }))
    } else {
      frames.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id ?? '', name: block.name ?? '', input: {} } }))
      const input = JSON.stringify(block.input ?? {})
      if (input !== '{}') frames.push(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: input } }))
    }
    frames.push(sse('content_block_stop', { type: 'content_block_stop', index }))
  })
  const stopReason = message.stop_reason === 'tool_use' || message.stop_reason === 'toolUse'
    ? 'tool_use'
    : message.stop_reason === 'max_tokens' || message.stop_reason === 'length'
      ? 'max_tokens'
      : message.stop_reason === 'stop_sequence' ? 'stop_sequence' : 'end_turn'
  frames.push(sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0 } }))
  frames.push(sse('message_stop', { type: 'message_stop' }))
  return frames
}

function frameData(frame: string): { event?: string; data?: string } {
  const lines = frame.split(/\r?\n/)
  const event = lines.find(line => line.startsWith('event:'))
  const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
  return {
    ...(event === undefined ? {} : { event: event.slice(6).trim() }),
    ...(data.length === 0 ? {} : { data }),
  }
}

function normalizeFrame(frame: string, api: SupportedApi): string {
  const parsed = frameData(frame)
  if (parsed.data === undefined) return frame + '\n\n'
  if (parsed.data === '[DONE]') return 'data: [DONE]\n\n'
  let payload: unknown
  try { payload = JSON.parse(parsed.data) } catch { return frame + '\n\n' }
  if (!record(payload)) return frame + '\n\n'
  if (api === 'openai-completions') {
    const normalized = normalizeOpenAi(payload, false)
    return normalized === undefined ? frame + '\n\n' : sse(undefined, normalized)
  }
  const known = ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop', 'ping', 'error']
  if (known.includes(stringValue(payload.type)) || (parsed.event !== undefined && parsed.event !== 'message')) return frame + '\n\n'
  return anthropicFrames(payload)?.join('') ?? frame + '\n\n'
}

function normalizeDocument(document: string, api: SupportedApi): string {
  const text = document.trim()
  if (text.length === 0) return ''
  if (text.includes('data:')) return normalizeFrame(text, api)
  try {
    const payload: unknown = JSON.parse(text)
    if (!record(payload)) return document
    if (api === 'openai-completions') {
      const normalized = normalizeOpenAi(payload, true) ?? payload
      return sse(undefined, normalized) + 'data: [DONE]\n\n'
    }
    return anthropicFrames(payload)?.join('') ?? document
  } catch {
    return document
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return typeof input.url === 'string' ? input.url : ''
}

function matchesBase(input: RequestInfo | URL, baseURL: string | undefined): boolean {
  if (baseURL === undefined || baseURL.length === 0) return true
  const raw = requestUrl(input)
  try {
    const target = new URL(raw)
    const base = new URL(baseURL)
    const prefix = base.pathname.replace(/\/+$/, '')
    return target.origin === base.origin && (prefix.length === 0 || target.pathname === prefix || target.pathname.startsWith(prefix + '/'))
  } catch {
    return raw.startsWith(baseURL)
  }
}

function normalizeResponse(response: Response, scope: FetchScope): Response {
  if (!response.ok || response.body === null) return response
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      while (true) {
        const match = /\r?\n\r?\n/.exec(pending)
        if (match === null) break
        const frame = pending.slice(0, match.index)
        pending = pending.slice(match.index + match[0].length)
        if (frame.trim().length > 0) controller.enqueue(encoder.encode(normalizeFrame(frame, scope.api)))
      }
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending.trim().length > 0) controller.enqueue(encoder.encode(normalizeDocument(pending, scope.api)))
    },
  }))
  const headers = new Headers(response.headers)
  headers.set('content-type', 'text/event-stream')
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

function install(): void {
  if (installed || typeof globalThis.fetch !== 'function') return
  const fetch = globalThis.fetch.bind(globalThis)
  const compatibleFetch: typeof globalThis.fetch = (input, init) => {
    const scope = scopes.getStore()
    const request = fetch(input, init)
    if (scope === undefined || !matchesBase(input, scope.baseURL)) return request
    return request.then(response => normalizeResponse(response, scope))
  }
  globalThis.fetch = compatibleFetch
  installed = true
}

export function withResponseCompatibility<T>(api: string, baseURL: string | undefined, run: () => T): T {
  if ((api !== 'openai-completions' && api !== 'anthropic-messages') || typeof globalThis.fetch !== 'function') return run()
  install()
  const scope: FetchScope = { api, ...(baseURL === undefined ? {} : { baseURL }) }
  return scopes.run(scope, run)
}
