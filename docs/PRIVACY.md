# Privacy

Codex Skin Switcher 是本地 macOS 插件。

## 本地数据

插件在下面的目录保存主题、当前选择和故障恢复信息：

```text
~/Library/Application Support/CodexSkinSwitcher/
```

这些文件不会由插件上传。插件不读取或发送 Codex 对话、登录态、项目文件与账号信息，也不包含分析统计、遥测或广告代码。

## 本机调试端口

为了把本地 CSS 注入 Codex 渲染页面，插件使用：

```text
127.0.0.1:9335
```

端口只绑定回环地址。不要将 `--remote-debugging-address` 改为 `0.0.0.0`、局域网地址或公网地址。本机其他进程理论上可以访问该端口，因此不要在不受信任的共享 macOS 账户中启用皮肤。

## 外部资源

主题运行时不使用远程 CSS、远程字体或远程图片。所有主题图片从本地文件读取。README 中的普通 Markdown 链接不会被运行时加载。

## 删除数据

先恢复原生界面，然后删除或备份 `~/Library/Application Support/CodexSkinSwitcher/` 即可清除插件状态。卸载插件不会自动删除用户创建的主题。
