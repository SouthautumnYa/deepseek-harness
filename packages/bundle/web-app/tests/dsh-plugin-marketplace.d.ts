declare module 'dsh-plugin-marketplace' {
  type MarketplaceFetchResponse = {
    ok: boolean
    status: number
    arrayBuffer(): Promise<ArrayBuffer>
  }

  type MarketplaceInstallOptions = {
    platform?: string
    fetchImpl?: (input: string, init?: RequestInit) => Promise<MarketplaceFetchResponse>
    execFileImpl?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  }

  export function __testInstallGitHubRepository(
    repository: string,
    cacheDir: string,
    log: (line: string) => void,
    locale: string,
    options?: MarketplaceInstallOptions,
  ): Promise<string>
}
