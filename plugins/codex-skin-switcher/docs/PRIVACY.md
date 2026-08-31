# Privacy

Codex Skin Switcher 是本地 macOS 插件。

## 本地数据

插件在下面的目录保存主题、当前选择和运行时副本：

```text
~/Library/Application Support/CodexSkinSwitcher/
```

启用非原生主题时，插件还会创建本机 LaunchAgent 文件：

```text
~/Library/LaunchAgents/com.codex-skin-switcher.plist
```

选择原生主题或主题恢复失败时会删除该文件。

这些文件不会由插件上传。插件不读取或发送 Codex 对话、登录态、项目文件与账号信息，也不包含分析统计、遥测或广告代码。

## 本机调试端口

为了把本地 CSS 注入 Codex 渲染页面，插件使用：

```text
127.0.0.1:9335
```

端口只绑定回环地址。不要将 `--remote-debugging-address` 改为 `0.0.0.0`、局域网地址或公网地址。本机其他进程理论上可以访问该端口，因此不要在不受信任的共享 macOS 账户中启用皮肤。

Codex 自带的页面 CSP 默认禁止直接访问回环市场接口。顶部工具只调用插件注册的本机 CDP binding，由插件进程执行市场请求并返回结果，不关闭或放宽 Codex 页面的 CSP。

## 外部资源

主题运行时不使用远程 CSS 或远程字体，已安装主题的图片全部从本地文件读取。只有用户主动打开皮肤市场时，插件才会读取公开的 `MarcWebber/codex-skins` Manifest、元信息和预览图；点击下载后才会读取所选主题文件。插件不会后台轮询市场。

界面接口只绑定 `127.0.0.1:9336`，仅接受切换本地主题、读取市场、安装公开主题和删除已下载主题的固定路径请求，不提供任意 URL 或任意文件写入能力。内置 Demo 目录不能通过该接口删除。

## 删除数据

市场卡片上的“删除”只移除对应的已下载主题；删除正在使用的主题时会先恢复原生界面。若要清除全部插件状态，先恢复原生界面，然后删除或备份 `~/Library/Application Support/CodexSkinSwitcher/`。卸载插件不会自动删除用户创建的主题。
