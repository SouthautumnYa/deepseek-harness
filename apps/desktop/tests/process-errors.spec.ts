import { describe, expect, it } from 'vitest'
import { isDetachedWriteError } from '../src/process-errors.ts'

describe('desktop detached stream errors', () => {
  it('recognizes EOF and EPIPE write failures', () => {
    expect(isDetachedWriteError(Object.assign(new Error('write EOF'), { code: 'EOF' }))).toBe(true)
    expect(isDetachedWriteError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true)
    expect(isDetachedWriteError(new Error('write EOF'))).toBe(true)
  })

  it('does not hide unrelated failures', () => {
    expect(isDetachedWriteError(new Error('connection refused'))).toBe(false)
    expect(isDetachedWriteError(new TypeError('invalid response'))).toBe(false)
  })
})
