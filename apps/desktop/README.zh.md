# DeepSeek Harness Desktop

[English](README.md) | 中文

这个包把现有的 `dsh web` profile 封装成 Windows Electron 桌面应用。
主进程会在操作系统分配的回环端口启动本地 Web 服务，在加固后的
`BrowserWindow` 中加载界面，并在退出时停止子进程。

## 开发

在仓库根目录执行：

```powershell
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

## Windows 安装程序

先构建 Web UI 和 Host runtime，再创建 NSIS 安装程序：

```powershell
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop package:win
```

安装程序会写入 `apps/desktop/release/`。用户设置和凭据保存在 Electron
的每用户数据目录中，与源码目录分离。
