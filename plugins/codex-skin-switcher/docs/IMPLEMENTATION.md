# 实现说明

## 当前结构

```text
server.mjs
runtime/
├── base.css
├── skin.mjs
├── watch.sh
└── themes/<id>/{theme.json,extra.css,art.png[,可选子图.png]}
scripts/
├── start-codex-with-skin.ps1
└── start-codex-with-skin.cmd
```

`server.mjs` 提供 `get_skin_status`、`set_skin` 和仅绑定 `127.0.0.1:9336` 的皮肤市场接口，负责复制运行时、发现主题、保存偏好、下载主题并调用 `skin.mjs`。`skin.mjs` 通过本机 CDP 连接 Codex 的 `app://-/index.html`，写入一个主题 `<style>`、`data-codex-skin` 和顶部切换器。`base.css` 集中维护当前 Codex 宿主页面的共享映射。

项目没有 FPS 侦测、Spotlight 搜索、bundle id 校验或旧版选择器。应用路径只有两项：默认 `/Applications/ChatGPT.app`，以及可选的 `CODEX_APP_PATH`。

Codex 需要在本机 `127.0.0.1:9335` 开启 CDP。选择非原生主题时，`server.mjs` 注册一个最小 LaunchAgent。`watch.sh` 只按主可执行文件判断 Codex 是否仍在运行，不会把应用包内由 tmux、CLI 或小助手启动的 Node/辅助进程误认为主窗口。它等待用户正常退出 Codex，再通过 `/usr/bin/open` 带上本机 CDP 参数启动，并恢复 `preference.json` 中的主题。它不强制退出进程、不扫描安装位置、不采集性能数据。启动或注入失败时，它发送一次 macOS 通知、删除自己的 plist 并正常退出；后续 Codex 按原生方式启动，不会再次携带 CDP 参数。选择原生主题也会卸载 Watcher。

Windows 不运行常驻 Watcher。`scripts/start-codex-with-skin.ps1` 在 `%LOCALAPPDATA%\CodexSkinSwitcher` 准备运行时，以回环 CDP 参数启动 Codex，等待页面就绪后注入主题并退出。它不创建服务、计划任务或其他后台进程。

## 主题注入

首次应用时，运行时创建一个 `<style>` 和一个 Shadow DOM 顶部工具。顶部工具显式使用 `no-drag` 点击区，避免 macOS 标题栏截获鼠标。它不使用 MutationObserver、ResizeObserver 或页面轮询。

主题 CSS 预先放进切换菜单；点击主题只替换 `<style>` 内容和根属性。重复应用同一主题时比较 CSS 指纹，相同内容直接返回。菜单里的“原生”清空主题样式但保留切换入口；调用 `set_skin("native")` 才会删除样式、顶部工具和根属性。

“创建皮肤”只在空输入框中插入 Codex 原生的 `codex-skin-switcher:skin-creator` Skill mention 和可编辑的“风格：”，不会覆盖已有输入，也不会自动发送。

“皮肤市场”与本地列表复用同一个 Shadow DOM 弹层。打开市场时才读取远端 `manifest.json`，然后按固定目录规则读取每套皮肤的 `theme.json`、`meta.json` 和 `preview.png`。Manifest 只包含主题目录 ID，不重复保存路径或文件清单。搜索只过滤已经加载到内存的数据。

下载时 `server.mjs` 只读取固定名称的核心文件和可选插图，先写入临时目录，通过 `skin.mjs validate --folder` 校验后再改名安装。成功后直接应用新主题；失败只删除临时目录并显示错误，不影响现有主题。

## 三文件主题

普通主题只需编辑：

```text
theme.json   # 名称、顺序、颜色、字体、背景位置与透明度
extra.css    # 当前主题独有的补充样式
art.png      # 本地背景图
```

`theme.json` 的主题变量必须以 `--skin-*` 开头。`extra.css` 的每个选择器必须以 `html[data-codex-skin="<id>"]` 开头，并禁止远程资源、`@import` 与其他 `@` 规则。背景通过 Codex 本地 `app://fs/@fs` 地址读取，不会把图片编码进 CSS，也不会发起远程请求。

主体插图由 `body::before` 固定铺在整个窗口底层。主内容、左右侧栏、环境信息、弹窗遮罩、文件与终端面板只使用不同透明度的玻璃表面，因此全部复用同一个 `art.png` 和同一套窗口坐标，不需要为子面板复制背景图，也不会在打开浮层时重新平铺或发生错位。

角色主题可以额外提供 `profile-art.png`、`help-art.png` 和 `home-card-a.png` 到 `home-card-d.png`。四张主页卡片是一对一关系，不循环复用；缺失的可选图片会回退到主背景。头像保持 Codex 原生内容，字体只使用本机已安装字体。

## 文件职责

- `server.mjs`：MCP、市场下载、主题发现、偏好、Watcher 注册与 CDP 调用。
- `skin.mjs`：主题校验、CSS 生成、CDP 注入、单弹层切换器与市场 UI。
- `watch.sh`：等待下一次正常启动，补充本机 CDP 参数并恢复主题。
- `scripts/start-codex-with-skin.ps1`：Windows 运行时准备、Codex 定位与一次性注入入口。
- `base.css`：当前 Codex 版本的按钮、消息、输入区、菜单、终端、文件、Diff 与设置页映射。
- 主题三个核心文件：用户修改配色、字体、背景和局部风格的集中入口。
- `skills/skin-creator/SKILL.md`：把提示词和参考图转成主题文件与可选插图。

宿主选择器只对应当前 Codex 页面结构。升级 Codex 后如果 DOM 变化，应直接更新 `base.css` 的当前映射，不新增旧版兼容分支。

## 校验边界

`skin.mjs validate` 是创建或下载皮肤时的一次性格式检查：读取主题并检查核心文件、必填变量、变量值与 CSS 作用域。它不连接 Codex。项目不包含截图工具、FPS 检测或常驻诊断进程；Watcher 只负责启动与主题恢复。

历史故障和恢复方式见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
