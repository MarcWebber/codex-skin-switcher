# Troubleshooting

本文记录 Codex Skin Switcher 已遇到的真实问题，以及当前版本采用的恢复方式。先使用无损恢复，再处理主题文件。

## 先恢复到原生界面

优先在顶部皮肤菜单选择“原生”，或在对话中输入：

```text
恢复 Codex 原生界面
```

如果插件入口与 MCP 都不可用，可以执行下面的手动恢复。它不删除主题，只停用 LaunchAgent，并把偏好文件改名留作备份：

```bash
launchctl bootout "gui/$(id -u)/com.codex-skin-switcher" 2>/dev/null || true
mv "$HOME/Library/LaunchAgents/com.codex-skin-switcher.plist" \
  "$HOME/Library/LaunchAgents/com.codex-skin-switcher.plist.disabled" 2>/dev/null || true
mv "$HOME/Library/Application Support/CodexSkinSwitcher/preference.json" \
  "$HOME/Library/Application Support/CodexSkinSwitcher/preference.json.disabled" 2>/dev/null || true
```

然后正常退出并重新打开 Codex。不要直接执行应用包中的 `Contents/MacOS/ChatGPT`。

## 打开皮肤后固定在 10 FPS

历史现象是：恢复原生后正常，启用皮肤后前台固定在约 10 FPS。这个问题最终不是背景图复杂度本身，而是旧运行方式直接启动应用包内可执行文件，绕过了正常的 LaunchServices 启动链路。

当前版本只使用：

```bash
/usr/bin/open -n /Applications/ChatGPT.app --args \
  --remote-debugging-port=9335 \
  --remote-debugging-address=127.0.0.1
```

如果再次出现：

1. 先恢复原生。
2. 检查是否仍有旧版 skin/injector LaunchAgent，并停用旧项。
3. 确认没有脚本直接运行 `Contents/MacOS/ChatGPT`。
4. 从当前插件重新选择皮肤，然后正常退出 Codex；watcher 会通过 LaunchServices 安全重开一次。

当前 watcher 不会强制退出正在使用的 Codex，也不会在失败后循环重启。

## 皮肤已选择，但没有变化

通常有三种情况：

- 当前 Codex 没有开启本机 CDP。状态会显示需要重启；正常退出 Codex 即可。
- MCP 使用了旧缓存。升级插件后新建一个 Codex 任务，再尝试切换。
- 本机主题目录保留了旧版同名主题。预制主题默认不覆盖用户已有目录，避免覆盖手工修改。

可以查看：

```text
~/Library/Application Support/CodexSkinSwitcher/recovery.json
```

如果存在该文件，顶部入口或状态工具会返回同一条降级原因。重新选择皮肤会清除旧恢复信息并重试。

## 找不到 Codex 应用

插件按以下顺序发现应用：

1. `CODEX_APP_PATH`。
2. `/Applications/ChatGPT.app`。
3. Spotlight 中 bundle id 为 `com.openai.codex` 的应用。

找不到时不会启动 watcher，也不会退出 Codex。将官方应用移回常规 Applications 目录，或为插件进程提供 `CODEX_APP_PATH` 后重试。

## 顶部皮肤按钮不能点击

旧版入口曾落在 macOS 窗口拖拽区域，视觉上存在但点击事件被标题栏截获。当前顶部工具使用独立 Shadow DOM，并显式设置 `no-drag` 点击区域。

先在对话中读取状态：

```text
查看当前皮肤状态
```

如果状态正常，重新选择当前主题会重建顶部按钮；如果状态异常，按返回的恢复信息处理。仍不可用时先恢复原生，再重新安装当前插件版本。插件不再附带第二套网页控制卡。

## 背景图没有显示或仍是旧图

确认主题目录至少有：

```text
theme.json
extra.css
art.png
```

角色菜单和主页卡片还需要对应的可选图片。图片变更会进入主题指纹，但同名预制主题目录不会在插件升级时自动覆盖。如果这是未修改过的 demo 主题，可以先把旧目录改名备份，再让插件重新写入预制主题。

## 背景太深、文字看不清

莱依拉主题曾经历背景人物过深、内容区透明度过高的问题。优先调整 `theme.json`：

```json
{
  "vars": {
    "--skin-art-opacity": ".20"
  }
}
```

建议范围是 `.20` 到 `.25`。不要通过继续降低正文卡片透明度来展示人物；正文、输入框、菜单和终端表面应保持接近不透明。

## 白色按钮配白色文字，或界面变成纯黑

这通常来自旧 `base.css` 与新主题变量混用，或者控件、正文和强调色没有同时定义。处理顺序：

1. 恢复原生。
2. 升级插件并新建任务。
3. 确认主题包含全部必填 `--skin-*` 变量。
4. 只在主题作用域内补充按钮样式，不写无作用域的全局 CSS。

## 终端、文件查看器、设置页没有跟随主题

这些页面依赖 Codex 内部 DOM 与内联变量。当前唯一目标版本是 Codex macOS `26.820.60940`。升级 Codex 后，如果主页面正常但子页面失配，通常是宿主选择器发生变化。

先恢复原生，确认问题只在皮肤开启时出现。然后记录 Codex 版本、失配页面和截图，再更新 `runtime/base.css` 的共享选择器；不要把宿主兼容规则散落到每套主题中。

## 个人菜单或帮助菜单没有背景

角色主题需要：

```text
profile-art.png
help-art.png
```

缺失时会回退到主背景。图片存在但仍不可见，通常是 Codex 的菜单触发器或 Radix menu 结构发生变化，需要更新当前主题的作用域选择器。

## 四个主页按钮看起来重复

角色主题应分别提供 `home-card-a.png` 到 `home-card-d.png`，并为四个按钮使用不同的背景、强调色和道具 SVG。不要使用 A/B/A/B 循环，也不要用同一张图只改色。

## 设计太花、饱和度过高或出现无关头像

这是主题内容问题，不是运行时问题：

- 降低强调色饱和度和背景透明度。
- 删除装饰边框、霓虹光晕和密集粒子。
- 保留 Codex 原生账号头像与对话头像。
- 角色元素集中在背景、菜单子图、主页按钮插图和小型道具图标。

## 完全清理但保留可恢复备份

如果需要重新初始化，可以先恢复原生，再把整个状态目录改名：

```bash
mv "$HOME/Library/Application Support/CodexSkinSwitcher" \
  "$HOME/Library/Application Support/CodexSkinSwitcher.backup"
```

重新打开插件后会创建新的运行时和预制主题。自定义主题可以从备份目录逐个复制回来。
