# 实现说明

## 当前结构

```text
server.mjs
runtime/
├── base.css
├── skin.mjs
└── themes/<id>/{theme.json,extra.css,art.png[,可选子图.png]}
```

`server.mjs` 只提供 `get_skin_status` 和 `set_skin`，负责复制运行时、发现主题、保存偏好并调用 `skin.mjs`。`skin.mjs` 通过本机 CDP 连接 Codex 的 `app://-/index.html`，写入一个主题 `<style>`、`data-codex-skin` 和顶部切换器。`base.css` 集中维护当前 Codex 宿主页面的共享映射。

项目没有 LaunchAgent、watcher、自动重启、FPS 侦测、Spotlight 搜索、bundle id 校验或旧版选择器。应用路径只有两项：默认 `/Applications/ChatGPT.app`，以及可选的 `CODEX_APP_PATH`。路径只用于生成启动提示，不用于监控或控制进程。

Codex 需要在本机 `127.0.0.1:9335` 开启 CDP。插件不接管启动；端口不可用时只保存用户选择并返回一次性启动命令。这样不会引入后台轮询，也不会改变 Codex 的正常进程生命周期。

## 主题注入

首次应用时，运行时创建一个 `<style>` 和一个 Shadow DOM 顶部工具。顶部工具显式使用 `no-drag` 点击区，避免 macOS 标题栏截获鼠标。它不使用 MutationObserver、ResizeObserver 或页面轮询。

主题 CSS 预先放进切换菜单；点击主题只替换 `<style>` 内容和根属性。重复应用同一主题时比较 CSS 指纹，相同内容直接返回。菜单里的“原生”清空主题样式但保留切换入口；调用 `set_skin("native")` 才会删除样式、顶部工具和根属性。

“创建皮肤”只在空输入框中插入 Codex 原生的 `codex-skin-switcher:skin-creator` Skill mention 和可编辑的“风格：”，不会覆盖已有输入，也不会自动发送。

## 三文件主题

普通主题只需编辑：

```text
theme.json   # 名称、顺序、颜色、字体、背景位置与透明度
extra.css    # 当前主题独有的补充样式
art.png      # 本地背景图
```

`theme.json` 的主题变量必须以 `--skin-*` 开头。`extra.css` 的每个选择器必须以 `html[data-codex-skin="<id>"]` 开头，并禁止远程资源、`@import` 与其他 `@` 规则。背景通过 Codex 本地 `app://fs/@fs` 地址读取，不会把图片编码进 CSS，也不会发起远程请求。

角色主题可以额外提供 `profile-art.png`、`help-art.png` 和 `home-card-a.png` 到 `home-card-d.png`。四张主页卡片是一对一关系，不循环复用；缺失的可选图片会回退到主背景。头像保持 Codex 原生内容，字体只使用本机已安装字体。

## 文件职责

- `server.mjs`：MCP、主题发现、偏好与一次性 CDP 调用。
- `skin.mjs`：主题校验、CSS 生成、CDP 注入与清理。
- `base.css`：当前 Codex 版本的按钮、消息、输入区、菜单、终端、文件、Diff 与设置页映射。
- 主题三个核心文件：用户修改配色、字体、背景和局部风格的集中入口。
- `skills/skin-creator/SKILL.md`：把提示词和参考图转成主题文件与可选插图。

宿主目标固定为 Codex macOS `26.820.60940`。升级 Codex 后如果 DOM 变化，应直接更新 `base.css` 的当前映射，不新增旧版兼容分支。

## 校验边界

`skin.mjs validate` 是创建皮肤时的一次性格式检查：读取主题并检查核心文件、必填变量、变量值与 CSS 作用域。它不连接 Codex。项目不包含测试目录、截图工具、FPS 检测或常驻诊断进程。

历史故障和恢复方式见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
