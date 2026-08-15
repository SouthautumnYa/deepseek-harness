import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  Tray,
} from 'electron'
import { buildEditContextMenuTemplate } from './context-menu.js'
import { installDetachedWriteGuard } from './process-errors.js'
import { requestsQuitForUpdate } from './update-exit.js'

const STARTUP_TIMEOUT_MS = 30_000
const READY_REQUEST_TIMEOUT_MS = 1_000
const READY_RETRY_INITIAL_MS = 20
const READY_RETRY_MAX_MS = 200
const SHUTDOWN_TIMEOUT_MS = 5_000
const SHUTDOWN_COMMAND_TIMEOUT_MS = 2_000
const SHUTDOWN_POLL_MS = 100

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(desktopRoot, '../..')

let mainWindow: BrowserWindow | null = null
let dshProcess: ChildProcess | undefined
let dshLogFd: number | undefined
let webUrl: string | undefined
let stopping: Promise<void> | undefined
let tray: Tray | null = null
let quitting = false
let allowQuit = false
let quitCleanup: Promise<void> | undefined
const startupStartedAt = process.hrtime.bigint()
const startupLogEnabled = process.env.DSH_STARTUP_LOG === '1' || !app.isPackaged

installDetachedWriteGuard()

function startupLog(message: string): void {
  if (!startupLogEnabled) return
  const elapsedMs = Number(process.hrtime.bigint() - startupStartedAt) / 1_000_000
  console.info(`[desktop-startup +${elapsedMs.toFixed(0)}ms] ${message}`)
}

/** Resolve the built CLI entry in development or the staged runtime in a package. */
function cliEntry(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'lib', 'bin.js')
    : join(workspaceRoot, 'apps', 'cli', 'lib', 'bin.js')
}

/** Reserve a loopback port for the local Web server. */
async function reservePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        rejectPort(new Error('无法分配本地 Web 端口'))
        return
      }
      server.close((error) => {
        if (error !== undefined) rejectPort(error)
        else resolvePort(address.port)
      })
    })
  })
}

/** Poll the loopback server instead of piping child stdout into Electron. */
function diagnostic(logPath: string): string {
  try {
    const detail = readFileSync(logPath, 'utf8').trim()
    return detail.length === 0 ? '' : `: ${detail.slice(-3000)}`
  } catch {
    return ''
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

function runCommand(command: string, args: readonly string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveCommand({ code, stdout })
    }
    child.once('error', () => finish(null))
    child.once('exit', code => finish(code))
  })
}

async function processExists(pid: number): Promise<boolean> {
  const result = await runCommand('tasklist', ['/FI', `PID eq ${String(pid)}`, '/FO', 'CSV', '/NH'], SHUTDOWN_COMMAND_TIMEOUT_MS)
  return result.code === 0 && result.stdout.includes(`"${String(pid)}"`)
}

async function stopWindowsDescendants(rootPid: number): Promise<void> {
  const script = [
    `$root = ${String(rootPid)}`,
    '$all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)',
    '$ids = New-Object "System.Collections.Generic.HashSet[int]"',
    '[void]$ids.Add($root)',
    'do { $changed = $false; foreach ($item in $all) { if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $changed = $true } } } while ($changed)',
    '$ids | Where-Object { $_ -ne $root } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }',
  ].join(';')
  await runCommand('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ], SHUTDOWN_COMMAND_TIMEOUT_MS)
}

async function stopWindowsProcessTree(rootPid: number): Promise<void> {
  const taskkill = async (): Promise<void> => {
    await runCommand('taskkill', ['/PID', String(rootPid), '/T', '/F'], SHUTDOWN_COMMAND_TIMEOUT_MS)
  }
  await taskkill()
  await stopWindowsDescendants(rootPid)
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS
  while (Date.now() < deadline && await processExists(rootPid)) {
    await taskkill()
    await delay(SHUTDOWN_POLL_MS)
  }
}

/** Stop every packaged Electron child that shares this installation's exe. */
async function stopWindowsProcessesByExecutable(executablePath: string, excludedPid: number): Promise<void> {
  const escapedPath = executablePath.replace(/'/g, "''")
  const script = [
    `$target = '${escapedPath}'`,
    `$excluded = ${String(excludedPid)}`,
    '$all = @(Get-CimInstance Win32_Process -Property ProcessId,ExecutablePath)',
    '$all | Where-Object { [int]$_.ProcessId -ne $excluded -and $_.ExecutablePath -and $_.ExecutablePath -ieq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(';')
  await runCommand('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ], SHUTDOWN_COMMAND_TIMEOUT_MS)
}

function waitForReady(child: ChildProcess, url: string, logPath: string): Promise<string> {
  return new Promise((resolveReady, rejectReady) => {
    const state = { settled: false }
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryDelayMs = READY_RETRY_INITIAL_MS
    const timer = setTimeout(() => {
      finish(new Error(`dsh web did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s${diagnostic(logPath)}`))
    }, STARTUP_TIMEOUT_MS)

    const finish = (error: Error | undefined, url?: string): void => {
      if (state.settled) return
      state.settled = true
      clearTimeout(timer)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      if (error === undefined && url !== undefined) resolveReady(url)
      else rejectReady(error ?? new Error('dsh web exited before becoming ready'))
    }

    child.once('error', (error) => { finish(error) })
    child.once('exit', (code, signal) => {
      finish(new Error(`dsh web exited before becoming ready (code=${String(code)}, signal=${String(signal)})${diagnostic(logPath)}`))
    })

    const probe = async (): Promise<void> => {
      if (state.settled) return
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(READY_REQUEST_TIMEOUT_MS) })
        const ready = response.status < 500
        if (response.body !== null) void response.body.cancel().catch(() => {})
        if (ready) {
          startupLog(`dsh web ready (HTTP ${response.status})`)
          finish(undefined, url)
          return
        }
      } catch {
        // The server is still booting; retry until the startup deadline.
      }
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        if (state.settled) return
        void probe()
      }, retryDelayMs)
      retryDelayMs = Math.min(retryDelayMs * 2, READY_RETRY_MAX_MS)
    }
    void probe()
  })
}

/** Start the existing Web profile and return its loopback URL. */
async function startDsh(): Promise<{ url: string; ready: Promise<string> }> {
  if (quitting) throw new Error('应用正在退出')
  const entry = cliEntry()
  if (!existsSync(entry)) {
    throw new Error(`找不到 dsh runtime：${entry}\n请先执行 pnpm run build。`)
  }

  const dshHome = join(app.getPath('userData'), 'dsh')
  const [port] = await Promise.all([
    reservePort(),
    mkdir(dshHome, { recursive: true }),
  ])
  const url = `http://127.0.0.1:${String(port)}`
  if (quitting) throw new Error('应用正在退出')
  const logPath = join(dshHome, 'dsh-web.log')
  const logFd = openSync(logPath, 'w')
  dshLogFd = logFd
  let child: ChildProcess
  try {
    child = spawn(process.execPath, [entry, 'web', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: app.isPackaged ? app.getPath('documents') : workspaceRoot,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
      },
      // Write to a regular log file instead of a pipe. This preserves startup
      // diagnostics without allowing a shutdown-time broken pipe to surface
      // as Electron's `write EOF` main-process dialog.
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    })
  } catch (error) {
    closeSync(logFd)
    dshLogFd = undefined
    throw error
  }
  startupLog(`dsh web process spawned on ${url}`)
  child.once('exit', () => {
    if (dshLogFd !== logFd) return
    closeSync(logFd)
    dshLogFd = undefined
  })
  dshProcess = child
  if (quitting) {
    await stopDsh()
    throw new Error('应用正在退出')
  }
  return { url, ready: waitForReady(child, url, logPath) }
}

/** Stop the local dsh process before Electron exits. */
async function stopDsh(): Promise<void> {
  if (stopping !== undefined) return stopping
  const child = dshProcess
  dshProcess = undefined
  if (child === undefined) return
  const rootPid = child.pid

  stopping = (async () => {
    const exited = new Promise<void>((resolveExited) => {
      if (child.exitCode !== null) {
        resolveExited()
        return
      }
      child.once('exit', () => resolveExited())
    })

    if (process.platform === 'win32' && rootPid !== undefined) {
      await stopWindowsProcessTree(rootPid)
    } else {
      if (child.exitCode === null) child.kill()
    }

    await Promise.race([
      exited,
      delay(SHUTDOWN_TIMEOUT_MS),
    ])
    if (child.exitCode === null) child.kill()
    if (process.platform === 'win32' && rootPid !== undefined) await stopWindowsDescendants(rootPid)
  })().finally(() => { stopping = undefined })
  await stopping
}

/** Request a quit and keep a bounded hard-exit fallback for installer handshakes. */
function requestApplicationQuit(): void {
  quitting = true
  app.quit()
  const fallback = setTimeout(() => {
    if (allowQuit) return
    allowQuit = true
    destroyTray()
    app.exit(0)
  }, SHUTDOWN_TIMEOUT_MS + SHUTDOWN_COMMAND_TIMEOUT_MS + 2_000)
  fallback.unref()
}

function showMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  if (tray !== null) return
  tray = new Tray(join(desktopRoot, 'assets', 'whale-icon.ico'))
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 DeepSeek Harness', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Create the single application window around the local Web UI. */
function createWindow(webUrl: string): BrowserWindow {
  const localUrl = webUrl
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DeepSeek Harness',
    icon: join(desktopRoot, 'assets', 'whale-icon.png'),
    backgroundColor: '#f7f7f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== localUrl && !url.startsWith(`${localUrl}/`)) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })
  window.webContents.on('context-menu', (event, params) => {
    const template = buildEditContextMenuTemplate(params)
    if (template.length === 0) return
    event.preventDefault()
    const menu = Menu.buildFromTemplate(template)
    void menu.popup({ window })
  })
  window.once('ready-to-show', () => {
    startupLog('BrowserWindow ready-to-show')
    window.show()
  })
  window.on('close', (event) => {
    if (quitting || allowQuit) return
    event.preventDefault()
    window.hide()
    startupLog('BrowserWindow hidden to tray')
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

/** Load the local Web UI after the server has passed its readiness probe. */
function loadWindow(window: BrowserWindow, localUrl: string): void {
  void window.loadURL(localUrl).catch((error: unknown) => {
    if (quitting) return
    dialog.showErrorBox('DeepSeek Harness 页面加载失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}

/** Boot the local server and then reveal the desktop window. */
async function boot(): Promise<void> {
  if (quitting) return
  startupLog('Electron app ready')
  const dsh = await startDsh()
  if (quitting) {
    await stopDsh()
    return
  }
  webUrl = dsh.url
  const window = createWindow(dsh.url)
  startupLog('BrowserWindow created while dsh web is warming up')
  await dsh.ready
  startupLog('loading local Web UI')
  loadWindow(window, dsh.url)
}

app.setAppUserModelId('ai.deepseek.harness')

const quitForUpdateRequested = requestsQuitForUpdate(process.argv)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else if (quitForUpdateRequested) {
  // An elevated installer can create a second Windows process with a
  // separate Electron single-instance lock. In that case there is no
  // second-instance event to receive, so clean same-install processes here.
  quitting = true
  if (process.platform === 'win32' && app.isPackaged) {
    void stopWindowsProcessesByExecutable(process.execPath, process.pid)
      .finally(() => { app.exit(0) })
  } else app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (requestsQuitForUpdate(commandLine)) {
      requestApplicationQuit()
      return
    }
    showMainWindow()
  })

  app.on('before-quit', (event) => {
    if (allowQuit) {
      destroyTray()
      return
    }
    event.preventDefault()
    quitting = true
    if (quitCleanup === undefined) {
      quitCleanup = stopDsh().catch(() => {}).then(async () => {
        if (process.platform === 'win32' && app.isPackaged) {
          await stopWindowsProcessesByExecutable(process.execPath, process.pid).catch(() => {})
        }
        allowQuit = true
        destroyTray()
        app.exit(0)
      })
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (mainWindow === null && dshProcess !== undefined && webUrl !== undefined) {
      const window = createWindow(webUrl)
      loadWindow(window, webUrl)
    } else showMainWindow()
  })

  void app.whenReady().then(() => {
    createTray()
    return boot()
  }).catch(async (error: unknown) => {
    await stopDsh()
    if (!quitting) {
      dialog.showErrorBox('DeepSeek Harness 启动失败', error instanceof Error ? error.message : String(error))
    }
    app.quit()
  })
}
