# Troubleshooting

本文记录真实遇到过的问题。当前版本只有一个负责启动参数与主题恢复的最小 Watcher，没有 FPS 侦测或安装位置扫描。

## 先恢复原生界面

优先在顶部皮肤菜单选择“原生”，或在对话中输入：

```text
恢复 Codex 原生界面
```

如果插件入口不可用，可以正常退出 Codex，再停用 Watcher，并把相关文件改名留作备份：

```bash
launchctl bootout "gui/$(id -u)/com.codex-skin-switcher" 2>/dev/null || true
mv "$HOME/Library/LaunchAgents/com.codex-skin-switcher.plist" \
  "$HOME/Library/LaunchAgents/com.codex-skin-switcher.plist.disabled" 2>/dev/null || true
mv "$HOME/Library/Application Support/CodexSkinSwitcher/preference.json" \
  "$HOME/Library/Application Support/CodexSkinSwitcher/preference.json.disabled" 2>/dev/null || true
```

然后从 Dock 或 Applications 正常打开 Codex。

## Watcher 做了什么

选择非原生皮肤后，`com.codex-skin-switcher` 等待当前 Codex 正常退出，再执行：

```bash
open -n "/Applications/ChatGPT.app" --args \
  --remote-debugging-port=9335 \
  --remote-debugging-address=127.0.0.1
```

随后它恢复当前主题，并继续等待下一次正常退出。启动或注入失败时，Watcher 会发送一次 macOS 通知、删除自己的 plist 并正常退出。此后从 Dock 正常打开 Codex，不再携带调试参数，也不会循环重试或写 `recovery.json`。选择“原生”同样会卸载它。

Watcher 只识别 `Contents/MacOS/ChatGPT` 主可执行文件。tmux、CLI、小助手或 Codex 自己启动的 Node/Helper 进程即使位于应用包内，也不会阻止 Watcher 在主窗口退出后恢复皮肤。

## 皮肤已选择，但没有变化

先查看状态。如果 `cdpReady` 为 `false`，说明当前 Codex 没有开启本机调试端口。正常退出一次，Watcher 会带参数重开并恢复主题。它不会强制退出正在使用的 Codex。使用自定义安装位置时，设置一个 `CODEX_APP_PATH` 即可；不会再扫描其他目录。

如果 CDP 已开启但主题仍未变化，常见原因是 MCP 使用旧缓存，或本机同名主题目录保留了旧内容。升级插件后新建一个 Codex 任务；未修改过的 demo 主题可以先改名备份，再让插件重新复制预制版本。

## 打开皮肤后固定在 10 FPS

历史问题来自旧版本直接运行应用包内可执行文件，而不是背景图或 CSS 性能。当前 Watcher 只通过 `/usr/bin/open` 启动，不执行 `Contents/MacOS/ChatGPT`。如果问题重现，先恢复原生并确认没有其他旧脚本直接运行应用包内二进制。

## 顶部皮肤按钮不能点击

当前顶部工具使用独立 Shadow DOM 和 `no-drag` 点击区。先在对话中读取状态；若 CDP 未开启，按上文重新启动一次。如果状态正常，重新选择当前主题以重建顶部按钮。仍不可用时先恢复原生，再重新安装当前插件版本。

## 背景图没有显示或仍是旧图

确认主题目录至少包含：

```text
theme.json
extra.css
art.png
```

角色菜单和主页卡片需要对应的可选图片。同名预制主题不会覆盖用户已有目录；未手工修改时可以先把旧目录改名，再重新加载插件。

## 皮肤市场加载失败

市场只在点击小店铺图标时读取 `MarcWebber/codex-skins`。确认网络可以访问 GitHub，然后点击“重试”。如果 `127.0.0.1:9336/market` 正常但 Codex 控制台提示顶部工具直接请求该地址违反 `connect-src`，说明正在运行旧版注入代码；更新插件并重新应用当前皮肤。插件不会后台重试，也不会因为市场不可用而修改或移除本地主题。

## 背景太深、文字看不清

优先在 `theme.json` 中把 `--skin-art-opacity` 调整到 `.20` 至 `.25`。正文、输入框、菜单和终端表面应保持接近不透明，不要为了展示人物继续降低内容卡片透明度。

## 白色按钮白色字，或界面变成纯黑

恢复原生，确认主题包含全部必填 `--skin-*` 变量，并只在主题作用域内补充按钮样式。不要写无作用域的全局 CSS，也不要混用旧版 `base.css`。

## 终端、文件查看器或设置页没有跟随主题

如果升级 Codex 后只有子页面失配，记录应用版本、页面和截图，然后更新 `runtime/base.css` 的当前宿主选择器；不要把宿主兼容规则散落到每套主题中。

## 四个主页按钮重复或风格过重

角色主题应分别提供 `home-card-a.png` 到 `home-card-d.png`，并使用不同的背景、强调色和道具 SVG，不能使用 A/B/A/B 循环。风格过重时降低强调色饱和度、背景透明度和装饰密度；保留 Codex 原生头像。

## 完全重新初始化

先恢复原生，再把状态目录改名：

```bash
mv "$HOME/Library/Application Support/CodexSkinSwitcher" \
  "$HOME/Library/Application Support/CodexSkinSwitcher.backup"
```

重新加载插件后会创建新的运行时和预制主题。自定义主题可以从备份中逐个复制回来。
