# deepseek-harness-skin

[English](README.md) | 中文

DSH Web GUI 的视觉皮肤层。皮肤由数据源生成，不手写 CSS：每份
`themes/<id>.json` 声明四个种子色和少量元数据，`scripts/build-skins.mjs`
会把它编译为 `generated/<id>.css`，并生成一条清单记录。

## 目录

| 路径 | 作用 |
| --- | --- |
| `themes/*.json` | 唯一真相源，一种皮肤一份，格式见 `themes/_schema.json` |
| `assets/*.webp` | 背景大图，建议宽度至少 1536px |
| `_chrome.css` | 所有皮肤共用的组件骨架，提供 `flat` / `glass` / `neon` 三种预设 |
| `generated/` | 生成产物，**不要手动修改** |
| `scripts/build-skins.mjs` | 生成器和可读性检查器 |

## 添加新皮肤

1. 可选：把背景图放入 `assets/`。
2. 复制一份 `themes/*.json`，改名为 `themes/<id>.json`，填写四个种子色。
3. 运行生成器：

   ```bash
   pnpm --filter @deepseek-ai/dsh-client-ui-theme build:skins
   ```

4. 重新构建包：`pnpm --filter @deepseek-ai/dsh-client-ui-theme bundle`

`theme-settings.ts` 的皮肤列表、`locales.ts` 的显示名、`web/src/base.css`
的样式引入和设置页缩略图都会从生成清单读取，不需要逐处登记。

## 生成器计算内容

上游 `design-platform.css` 由绝对色阶和语义 token 两层组成。皮肤只需重述
色阶，语义层会自动跟随，因此浅色和深色配色都能保持一致。

中性色阶按对比度而不是单纯明度重建；每一阶在皮肤背景上的对比度会复现上游
背景的对应值。强调色则以种子色为中心重新计算并保持阶梯顺序。

生成器每次运行都会输出可读性检查表。当前共有 21 个皮肤，每个皮肤检查 8
项对比度契约；任何一项不达标都会返回退出码 1。CI 使用 `check:skins`
校验工作区和生成结果是否一致。

## 背景图只绘制一次

背景图挂在 `[data-app-frame]` 上，它代表整个窗口，尺寸只随窗口变化。会话
面板和详情栏叠加遮罩，不重复绘制背景。不要在可滚动容器上再使用 `cover`
背景，否则聊天记录变长时背景定位区域也会被撑大。

遮罩使用 `--skin-veil-over`，它已经按 `--skin-veil-soft` 预合成，因此底色
与直接叠加一层 `--skin-veil` 一致，可读性检查仍然有效。

## 皮肤可用的 DOM 钩子

组件只为皮肤提供稳定的 data 属性，皮肤不能按 hash 类名选择元素：

- `[data-frame-titlebar]`：AppFrame 顶栏。
- `[data-frame-titlebar-brand]` / `[data-frame-titlebar-title]` /
  `[data-frame-titlebar-id]` / `[data-frame-titlebar-controls]` /
  `[data-frame-titlebar-button]`：顶栏内容。
- `[data-composer-card]`：会话输入卡片。
- `[data-message-bubble]`：用户消息气泡。
- `[data-app-frame]`：绘制整窗背景图的容器。
- `[data-conversation-panel]`：会话面板遮罩。
- `[data-qq-show]`：右侧详情栏背景。
- `[data-skin-primary-button]` / `[data-skin-tab]`：主按钮和视图页签。

这些钩子只在 `_chrome.css` 中使用。皮肤自己的 CSS 只提供变量，不选择具体
组件。

## 作用域

- `body[data-dsh-skin="<id>"]`：当前皮肤的色板。
- `body[data-skin-chrome="<preset>"]`：共用组件骨架。
- `[data-skin-preview="<id>"]`：设置页缩略图，只带 `--skin-*` 变量，
  不激活皮肤也能预览。

皮肤选择会持久化到 `ui-theme` settings 的 `skin` 字段，可在设置 → 外观 →
皮肤中切换；Host 端 bootstrap 会在首屏渲染前注入这两个属性。

## 深浅配色

皮肤在 `appearance` 字段中声明自己是 `light` 还是 `dark`，生成器会按对应
配色推导色阶，`ThemeRuntime` 也会据此解析最终配色方案，因此标记为 `dark`
的皮肤使用的是真正的深色语义层。`none` 是原厂外观，也是唯一跟随
`light` / `dark` / `system` 偏好的选项。
