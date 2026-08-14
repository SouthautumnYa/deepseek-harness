# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This package wraps the existing `dsh web` profile in an Electron Windows app.
The main process starts the local Web server on an OS-assigned loopback port,
loads it in a hardened `BrowserWindow`, and stops the child process on exit.

## Development

From the repository root:

```powershell
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

## Windows installer

Build the Web UI and host runtime first, then create an NSIS installer:

```powershell
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop package:win
```

The installer is written to `apps/desktop/release/`.
User settings and credentials are kept under Electron's per-user data folder,
separate from the source checkout.
