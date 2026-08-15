# Agent Note: Desktop marketplace and process lifecycle fixes

Status: implemented

## Problem

The Windows desktop build could leave the DSH runtime process tree alive during tray exit or an in-place install. The plugin marketplace also depended on an outdated pinned package, could fail when Git transport reset, and exposed inconsistent category and tag metadata to the UI.

## Decision

Pin the marketplace to the fixed upstream commit 'd73d0d74bbb60cf18305b597b62f90292b69595b', and keep the patch keyed to its actual package version '1.3.13'. Marketplace installation retries Git with HTTP/1.1, then downloads a GitHub codeload archive; Windows uses tar.exe first and PowerShell archive extraction as a fallback. Registry metadata is normalized before it reaches the client.

The desktop process lifecycle tracks the known DSH root PID only. Windows shutdown uses taskkill /T /F, a descendant scan, and bounded polling; the NSIS installer invokes the process-tree kill macro only after the normal shutdown handshake times out. The release process routes pnpm through cmd.exe on Windows, and third-party notice overrides document the repository metadata for the two git-subdirectory IM packages.

## Alternatives considered

- Killing every process with the same executable name was rejected because it could terminate an unrelated DSH instance.
- Making archive download the primary path was rejected because a shallow Git clone preserves submodules and repository metadata needed by existing installation logic.
- Leaving the marketplace on a moving branch was rejected because packaged builds need reproducible dependency resolution.

## Consequences

Marketplace installs remain reproducible and tolerate common Windows Git transport failures. The application and installer have a bounded, root-PID-scoped shutdown path. Windows release bumps now complete through the repository's own command, and the resulting package metadata passes the notice generator. The patch adds a small amount of platform-specific process and archive handling that is covered by focused tests.
