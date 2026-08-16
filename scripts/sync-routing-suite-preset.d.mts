export interface RoutingSuiteSyncResult {
  changed: boolean
  root: string
}

export declare const ROUTING_SUITE_SOURCE: Readonly<{
  suite: string
  suiteCommit: string
  injectorRelease: string
  injectorPackage: string
  preset: string
  presetCommit: string
}>

export declare function syncRoutingSuitePreset(options?: { force?: boolean }): Promise<RoutingSuiteSyncResult>
