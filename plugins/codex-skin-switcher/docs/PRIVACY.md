# Privacy

Codex Skin Switcher 是本地 macOS 插件。

## 本地数据

插件在下面的目录保存主题、当前选择和运行时副本：

```text
~/Library/Application Support/CodexSkinSwitcher/
```

插件启动时还会创建本机 LaunchAgent 文件，让顶部皮肤入口在后续启动中保持可用：

```text
~/Library/LaunchAgents/com.codex-skin-switcher.plist
```

选择原生主题不会删除该文件。主题恢复失败时 Watcher 会自行停用；也可以按 Troubleshooting 中的恢复步骤手动停用。

这些文件不会由插件上传。插件不读取或发送 Codex 对话、登录态、项目文件与账号信息，也不包含分析统计、遥测或广告代码。

## 本机调试端口

为了把本地 CSS 注入 Codex 渲染页面，插件使用：

```text
127.0.0.1:9335
```

端口只绑定回环地址。不要将 `--remote-debugging-address` 改为 `0.0.0.0`、局域网地址或公网地址。本机其他进程理论上可以访问该端口，因此不要在不受信任的共享 macOS 账户中启用皮肤。

顶部工具不开放额外的本机 HTTP 端口，只调用插件注册的本机 CDP binding，由插件进程执行市场请求并返回结果，不关闭或放宽 Codex 页面的 CSP。

## 外部资源

主题运行时不使用远程 CSS 或远程字体，已安装主题的图片全部从本地文件读取。只有用户主动打开皮肤市场时，插件才会读取公开的 `MarcWebber/codex-skins` Manifest、元信息和预览图；点击下载后才会读取所选主题文件。插件不会后台轮询市场。

只有用户明确要求“投稿”或“发布”主题时，Skin Creator 才会调用已经登录的 GitHub CLI。发布脚本会把所选主题的固定文件、生成的 `meta.json` 和 `preview.png` 推送到用户的市场功能分支或 fork，并向 `MarcWebber/codex-skins` 发起 Pull Request。脚本不读取、保存或显示 GitHub Token，不直接写入 `main`，也不会自动合并 PR。

## 删除数据

市场卡片或本地切换列表上的“删除”会先显示确认弹窗，只移除对应的非内置主题；删除正在使用的主题时会先恢复原生界面。若要清除全部插件状态，先恢复原生界面，然后删除或备份 `~/Library/Application Support/CodexSkinSwitcher/`。卸载插件不会自动删除用户创建的主题。
