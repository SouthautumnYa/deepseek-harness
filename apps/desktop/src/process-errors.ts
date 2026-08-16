type StreamWriteError = NodeJS.ErrnoException & {
  syscall?: string
}

/** Identify the harmless Windows error raised when a process output stream disconnects. */
export function isDetachedWriteError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as StreamWriteError
  const message = String(candidate.message ?? '')
  return candidate.code === 'EOF'
    || candidate.code === 'EPIPE'
    || /\bwrite\s+(?:EOF|EPIPE)\b/i.test(message)
}

/** Keep a detached console/IPC stream from taking down the Electron main process. */
export function installDetachedWriteGuard(): void {
  const handle = (error: unknown): void => {
    if (isDetachedWriteError(error)) return
    process.removeListener('uncaughtException', handle)
    throw error
  }

  process.on('uncaughtException', handle)
  process.stdout.on('error', handle)
  process.stderr.on('error', handle)
}
