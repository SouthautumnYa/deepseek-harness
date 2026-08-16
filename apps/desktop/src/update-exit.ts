/** Private installer handshake used to shut down the tray app before upgrade. */

export const QUIT_FOR_UPDATE_ARG = '--quit-for-update'

/** Return true only for the exact installer shutdown switch. */
export function requestsQuitForUpdate(argv: readonly string[]): boolean {
  return argv.includes(QUIT_FOR_UPDATE_ARG)
}
