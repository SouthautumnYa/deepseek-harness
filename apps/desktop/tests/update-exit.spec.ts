import { describe, expect, it } from 'vitest'
import {
  QUIT_FOR_UPDATE_ARG,
  requestsQuitForUpdate,
} from '../src/update-exit.ts'

describe('desktop update exit handshake', () => {
  it('recognizes the exact private installer switch', () => {
    expect(requestsQuitForUpdate(['DeepSeek Harness.exe', QUIT_FOR_UPDATE_ARG])).toBe(true)
    expect(requestsQuitForUpdate(['DeepSeek Harness.exe', '--quit-for-updates'])).toBe(false)
    expect(requestsQuitForUpdate(['DeepSeek Harness.exe'])).toBe(false)
  })
})
