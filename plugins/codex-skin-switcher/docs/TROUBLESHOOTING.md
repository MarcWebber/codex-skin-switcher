# Troubleshooting

这里只保留当前版本仍可能遇到的问题。正常情况下，顶部菜单选择“原生”即可撤销主题；入口不可用时，可以在 Codex 中发送：

```text
恢复 Codex 原生界面
```

## 首次切换没有变化

安装或升级不会重启当前 Codex。当前未开放本机调试端口时，选择主题只保存偏好。正常退出后手动点击原 App；Watcher 会检查这次新启动，必要时带本机 `9335` 参数重开一次，再恢复主题。主动退出后不会自动打开，也不需要创建新任务来唤起皮肤。

Codex 安装在默认位置以外时，设置 `CODEX_APP_PATH`。升级插件后仍看到旧行为时，新建一个 Codex 任务，让当前版本的 Skill 与本地服务进入会话。

如果启动时出现退出确认框，确认后请等待应用完成保存与退出。Watcher 最多等待 30 秒，确认退出后才带参数重开。取消或等待超时后，本次启动不再尝试恢复。

如果整个皮肤入口仍不可用，先正常完全退出 Codex，再在终端带本机端口启动（macOS 默认安装路径）：

```bash
open -n /Applications/ChatGPT.app --args --remote-debugging-port=9335 --remote-debugging-address=127.0.0.1
```

皮肤入口需要通过该端口载入。端口尚未开启时，本地主题降级也无法运行。

## 本地切换降级

后台服务暂时不可用时，顶部菜单显示“本地皮肤”，已载入的本地主题仍可切换或恢复原生。降级选择在本次会话生效；服务恢复后重新选择，即可保存下次启动的偏好。

## 皮肤市场加载失败

市场只在打开时读取 `MarcWebber/codex-skins` 的 `main` 分支。先确认网络可以访问 GitHub，再点击“重试”。加载失败不会修改已经安装的主题，也不会影响本地切换和原生恢复。

## 背景没有显示

确认主题目录至少包含三个核心文件：

```text
theme.json
extra.css
art.png
```

如果只有菜单、设置页或文件预览等局部区域在 Codex 升级后失效，请附上应用版本、页面截图和复现步骤提交 Issue。这通常需要更新当前页面结构对应的公共样式，不需要修改每套主题。

## 投稿市场失败

先运行：

```bash
gh auth status
```

确认 GitHub CLI 已登录并且可以访问 `MarcWebber/codex-skins`。如果主题校验、Manifest 生成或 Pull Request 创建失败，命令会保留第一个错误；已经推送的功能分支也会保留，修复登录或权限后可以继续创建 Pull Request。

## 完全重新初始化

先恢复原生，按下方步骤停用 Watcher，再把本地状态目录改名保留：

```bash
mv "$HOME/Library/Application Support/CodexSkinSwitcher" \
  "$HOME/Library/Application Support/CodexSkinSwitcher.backup"
```

重新加载插件后会创建新的运行时和内置主题。自定义主题可以从备份目录逐个复制回来。

## Watcher

macOS only。Watcher 由 LaunchAgent 独立运行，安装时跳过当前会话，只处理以后新启动的主进程。每次手动启动最多补一次重启；带有调试端口参数、运行超过 30 秒或选用原生主题的进程不重启。退出被取消、启动失败或注入失败都不会重试。日志位于 `~/Library/Application Support/CodexSkinSwitcher/watcher.log`。

检查服务状态：

```bash
launchctl print "gui/$(id -u)/com.codex-skin-switcher"
```

临时停用（不退出 Codex，也不删除皮肤）：

```bash
launchctl bootout "gui/$(id -u)/com.codex-skin-switcher"
```

彻底停用时，卸载插件并删除 `~/Library/LaunchAgents/com.codex-skin-switcher.plist`。否则下次插件初始化或登录时还会注册服务。
