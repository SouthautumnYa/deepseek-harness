# Agent Note：桌面端市场与进程生命周期修复

Status: implemented

## Problem

Windows 桌面端在托盘退出或覆盖安装时可能残留 DSH 运行时进程树。插件市场仍依赖旧版本，Git 传输被重置时安装失败，分类和标签字段也可能以不一致的格式进入界面。

## Decision

将插件市场固定到远程提交 'd73d0d74bbb60cf18305b597b62f90292b69595b'，并让补丁与实际包版本 '1.3.13' 匹配。市场安装先使用普通 Git clone，再用 HTTP/1.1 重试，最后下载 GitHub codeload 归档；Windows 优先使用 tar.exe，失败后使用 PowerShell 解压 zip。registry 的分类和标签在进入客户端前统一归一化。

桌面端只跟踪已知 DSH 根 PID，不按进程名全局杀进程。Windows 退出使用 taskkill /T /F、后代进程扫描和有界轮询；NSIS 安装器只在正常退出握手超时后调用进程树强制终止宏。发布脚本在 Windows 上通过 cmd.exe 调用 pnpm，第三方声明生成器则为两个 git 子目录 IM 包补充仓库元数据。

## Alternatives considered

- 未采用按进程名杀掉所有实例，避免误杀用户启动的其他 DSH 实例。
- 未将归档下载设为首选，因为浅克隆仍需保留现有安装流程依赖的子模块和仓库元数据。
- 未使用浮动分支，确保打包版本的依赖可复现。

## Consequences

插件市场安装能够容忍常见的 Windows Git 传输失败，桌面端和安装器拥有有界且限定根 PID 的退出路径。Windows 发布版本现在可以直接完成仓库自带的版本 bump，第三方声明校验也能通过。补丁增加了少量平台相关的进程与归档处理，并已用专项测试覆盖。
