# Antigravity

macOS only。当前适配 Antigravity 桌面版，已在本机 `2.22.0`、`2.23.0` 检查连接和主题显示；不适用于 VS Code 分支的 Antigravity IDE。

## 1. 安装

需要 Node.js 22+，先正常打开 Antigravity。在仓库根目录运行：

```bash
node plugins/codex-skin-switcher/runtime/antigravity.mjs install
```

右上角出现皮肤下拉菜单。首次没有记录时保持原生，可直接在菜单选择“莱依拉星梦”，或运行：

```bash
node plugins/codex-skin-switcher/runtime/antigravity.mjs apply layla-starlight
```

之后仍用原来的 Antigravity App 启动，后台服务会恢复上次选择。它只连接应用自带的本机动态调试端口；不会打开、退出或重启应用，也不修改应用包。

## 2. 主题

复用 Codex Skin Switcher 的本地主题：

```text
~/Library/Application Support/CodexSkinSwitcher/themes/<theme-id>/
```

首次安装会补齐内置莱依拉示例，不覆盖已经存在的主题。Codex 市场下载的主题也会出现在 Antigravity 的列表中；新增主题后，正常重新打开 Antigravity 或再次执行安装命令刷新列表。

这版读取 `theme.json` 的配色、字体与背景变量，以及 `art.png`。样式映射在 `runtime/antigravity.css`；不会把 Codex 专用的 `extra.css`、主页卡片与菜单插图选择器套进 Antigravity。

## 3. 恢复与停用

菜单选择“原生”，或运行：

```bash
node plugins/codex-skin-switcher/runtime/antigravity.mjs apply native
```

停用自动恢复并移除菜单：

```bash
node plugins/codex-skin-switcher/runtime/antigravity.mjs uninstall
```

停用只移除本适配的 LaunchAgent，保留主题和运行文件；重新运行安装命令可以恢复。Antigravity 偏好与运行文件独立保存在：

```text
~/Library/Application Support/AntigravitySkinSwitcher/
```

## 4. 实现

`antigravity.mjs` 读取 `Antigravity/DevToolsActivePort`，复用 `cdp.mjs` 连接主窗口。选中主题时才读取背景图片，并以内嵌图片加载，不增加图片服务器。

皮肤只通过样式表、根节点标记和一个独立菜单生效。选择“原生”会移除样式表与标记，不改原生主题设置。后台监听窗口加载和菜单选择，应用关闭后等待下次启动。

这是本地最小适配：覆盖主背景、侧栏、输入框、原生按钮配色及弹层。没有在 Antigravity 内另建市场或创建工作流；隔离在 iframe / Shadow DOM 内的页面尚不属于本版覆盖范围。
