# Troubleshooting

这里只保留当前版本仍可能遇到的问题。正常情况下，顶部菜单选择“原生”即可撤销主题；入口不可用时，可以在 Codex 中发送：

```text
恢复 Codex 原生界面
```

## 首次切换没有变化

当前 Codex 如果没有开启本机调试端口，第一次选择主题只会保存偏好。正常退出 Codex 一次，Watcher 会带本机 `9335` 参数重新打开并恢复主题；这次启动请求只消费一次，此后主动退出会保持关闭。

Codex 安装在默认位置以外时，设置 `CODEX_APP_PATH`。升级插件后仍看到旧行为时，新建一个 Codex 任务，让当前版本的 Skill 与本地服务进入会话。

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

先恢复原生，再把本地状态目录改名保留：

```bash
mv "$HOME/Library/Application Support/CodexSkinSwitcher" \
  "$HOME/Library/Application Support/CodexSkinSwitcher.backup"
```

重新加载插件后会创建新的运行时和内置主题。自定义主题可以从备份目录逐个复制回来。

## Watcher

Watcher 只在存在一次性启动请求时补充本机参数并恢复主题。请求在成功拉起 Codex 后立即清除，因此普通退出不会再次打开应用。启动或注入失败时，它会提示一次后停止，让 Codex 继续按原生方式启动；不会监控 FPS，也不会扫描一组安装路径或循环重试。
