# 实现说明

## 当前结构

```text
server.mjs
runtime/
├── base.css
├── skin.mjs
├── watch.sh
└── themes/<id>/{theme.json,extra.css,art.png[,可选子图.png]}
skills/skin-creator/
├── SKILL.md
└── scripts/publish.mjs
```

`server.mjs` 提供 `get_skin_status`、`set_skin` 和仅绑定 `127.0.0.1:9336` 的界面接口，负责复制运行时、发现主题、保存偏好、下载主题并调用 `skin.mjs`。顶部菜单、Skill 与市场安装都通过 `setSkin` 进入同一条切换链路。`skin.mjs` 通过本机 CDP 连接 Codex 的 `app://-/index.html`，写入一个主题 `<style>`、`data-codex-skin` 和顶部切换器。`base.css` 集中维护当前 Codex 宿主页面的共享映射。

项目没有 FPS 侦测、Spotlight 搜索、bundle id 校验或旧版选择器。应用路径只有两项：默认 `/Applications/ChatGPT.app`，以及可选的 `CODEX_APP_PATH`。

Codex 需要在本机 `127.0.0.1:9335` 开启 CDP。插件先启动本机界面接口，再注册最小 LaunchAgent。只有用户在端口未就绪时明确选择非原生主题，`server.mjs` 才写入一次性 `pending-relaunch`；`watch.sh` 等待当前 Codex 正常退出，通过 `/usr/bin/open` 补充本机参数，并在成功拉起后立即消费该标记。没有标记时 Watcher 正常退出，因此用户之后主动关闭 Codex 不会再次被拉起。它只按主可执行文件识别窗口，不会把 tmux、CLI 或小助手的 Node 进程当作 Codex。原生模式会取消尚未消费的启动请求。Watcher 不强制退出进程、不扫描安装位置、不采集性能数据；启动或注入失败时发送一次 macOS 通知、删除自己的 plist 并退出。

## 主题注入

首次应用时，运行时创建一个 `<style>` 和一个 Shadow DOM 顶部工具。顶部工具显式使用 `no-drag` 点击区，避免 macOS 标题栏截获鼠标。它不使用 MutationObserver、ResizeObserver 或页面轮询。

主题 CSS 预先放进切换菜单。点击本地主题、确认应用已下载主题和调用 `set_skin` 都先更新 `preference.json`，再由同一个 `apply` 入口替换 `<style>` 内容和根属性；顶部操作在替换前后使用一个约 370 毫秒的轻量遮罩过渡，不增加动画循环。重复应用时比较 CSS 指纹并复用当前顶部工具。选择“原生”只清空主题样式，切换入口和 Watcher 都继续保留。

“创建皮肤”只在空输入框中插入 Codex 原生的 `codex-skin-switcher:skin-creator` Skill mention 和可编辑的“风格：”，不会覆盖已有输入，也不会自动发送。

“皮肤市场”与本地列表复用同一个 Shadow DOM 弹层。顶部工具通过 Codex 已开启的本机 CDP binding 发送固定的读取、安装和切换动作，由占用 `127.0.0.1:9336` 的插件进程处理，再用 `postMessage` 返回结果；绑定尚未完成时，本地菜单显示“正在连接…”并在 30 秒内自动等待。页面自身不发起网络请求，也不需要放宽 CSP。本地列表最多显示五项并在超出后滚动，只保留名称、当前状态与非内置主题的删除入口；预览图只在市场使用。打开市场时才从 GitHub Raw 的明确分支引用 `refs/heads/main` 读取远端 `manifest.json`，然后按固定目录规则读取每套皮肤的 `theme.json`、`meta.json` 和 `preview.png`。Manifest 只包含主题目录 ID，不重复保存路径或文件清单。搜索只过滤已经加载到内存的数据。

下载时 `server.mjs` 只读取固定名称的核心文件和可选插图，先写入临时目录，通过 `skin.mjs validate --folder` 校验后再改名安装。成功后显示“下载成功”，等待用户选择应用或稍后；失败只删除临时目录并显示错误，不影响现有主题。市场卡片与本地列表都可删除非内置主题，两个入口复用同一个确认弹窗和删除动作；删除当前主题时先恢复原生界面，内置 Demo 始终保留。

## 三文件主题

普通主题只需编辑：

```text
theme.json   # 名称、顺序、颜色、字体、背景位置与透明度
extra.css    # 当前主题独有的补充样式
art.png      # 本地背景图
```

`theme.json` 的主题变量必须以 `--skin-*` 开头。`extra.css` 的每个选择器必须以 `html[data-codex-skin="<id>"]` 开头，并禁止远程资源、`@import` 与其他 `@` 规则。背景通过 Codex 本地 `app://fs/@fs` 地址读取，不会把图片编码进 CSS，也不会发起远程请求。

主体插图由 `body::before` 固定铺在整个窗口底层。主内容、左右侧栏、环境信息、弹窗遮罩、文件与终端面板只使用不同透明度的玻璃表面，因此全部复用同一个 `art.png` 和同一套窗口坐标，不需要为子面板复制背景图，也不会在打开浮层时重新平铺或发生错位。

角色主题可以额外提供 `profile-art.png`、`help-art.png` 和 `home-card-a.png` 到 `home-card-d.png`。四张主页卡片是一对一关系，不循环复用；缺失的可选图片会回退到主背景。个人与帮助菜单由 `base.css` 根据侧栏底栏结构、菜单角色和触发器内容类型区分，不依赖中英文文案、用户名或动态 Radix ID。头像保持 Codex 原生内容，字体只使用本机已安装字体。

## 文件职责

- `server.mjs`：MCP、市场下载、主题发现、偏好、Watcher 注册与 CDP 调用。
- `skin.mjs`：主题校验、CSS 生成、CDP 注入、单弹层切换器与市场 UI。
- `watch.sh`：消费一次启动请求，补充本机 CDP 参数并恢复主题。
- `base.css`：当前 Codex 版本的按钮、消息、输入区、菜单、终端、文件、Diff 与设置页映射。
- 主题三个核心文件：用户修改配色、字体、背景和局部风格的集中入口。
- `skills/skin-creator/SKILL.md`：把提示词和参考图转成主题文件与可选插图。
- `skills/skin-creator/scripts/publish.mjs`：在用户明确投稿后校验主题、准备固定市场文件、运行市场回归并通过 `gh` 创建功能分支与 Pull Request；不直接写入或合并 `main`。

宿主选择器只对应当前 Codex 页面结构。升级 Codex 后如果 DOM 变化，应直接更新 `base.css` 的当前映射，不新增旧版兼容分支。

历史故障和恢复方式见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
