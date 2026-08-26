# 实现说明

## 文件结构

插件只保留三部分：MCP 服务、macOS 运行时和主题目录。

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

`server.mjs` 只提供 `get_skin_status` 和 `set_skin`。MCP 以插件根目录为 `cwd`，通过 PATH 中的 `node` 启动，不包含开发者机器的绝对路径。服务把运行时复制到 `~/Library/Application Support/CodexSkinSwitcher/`，只在主题不存在时写入预制主题，因此用户编辑不会被插件更新覆盖。`skin-creator` Skill 接收一段提示词和可选参考图，生成三个核心文件；需要时再增加菜单或主页卡片子图，然后调用现有切换工具。交互入口只有 Codex 顶部一次性注入的“皮肤”按钮，不再维护网页控制卡。

## 切换过程

选中主题后，服务写入一个 `preference.json`，启动 macOS LaunchAgent，并调用 `skin.mjs`。运行时通过本机 CDP 找到 `app://-/index.html`，创建一个主题 `<style>` 和一个顶部工具宿主，再设置 `data-codex-skin`。

渲染端写入一个 `<style>` 和一个带 Shadow DOM 的顶部工具。工具放在 macOS 标题栏下方，显式使用 `no-drag` 点击区，避免窗口拖拽层截获鼠标。工具在首次应用时创建，不使用 MutationObserver、ResizeObserver 或页面轮询。主题 CSS 预先放进菜单，点击后只替换 `<style>` 内容和根属性。重复应用同一主题时会比较 CSS 指纹，相同内容直接返回。菜单中的原生选项清空主题样式但保留切换入口；通过服务恢复原生时才会删除样式、顶部工具和根属性，并停用 LaunchAgent。顶部工具可以折叠成调色板图标。“创建皮肤”只在空输入框中插入 Codex 原生的 `codex-skin-switcher:skin-creator` Skill mention 和可编辑的“风格：”，不覆盖已有输入，也不自动发送。

Codex 必须带本机调试端口启动。服务先校验 bundle id `com.openai.codex`，只检查 `CODEX_APP_PATH`、当前标准路径 `/Applications/ChatGPT.app` 和 Spotlight 返回的位置，并从 `Info.plist` 读取实际可执行文件名。

`watch.sh` 不会强制退出用户正在使用的 Codex。选择皮肤时若调试端口尚未开启，它等待用户正常退出，再通过 LaunchServices 安全重开一次，启动参数固定为：

```text
--remote-debugging-port=9335
--remote-debugging-address=127.0.0.1
```

旧版曾直接执行应用包内二进制并出现前台约 10 FPS。当前版本只通过 LaunchServices 启动。安全启动、CDP 或注入失败时，watcher 立即停止自动重试，保留原生界面，并把原因写到 `recovery.json`。`get_skin_status` 会返回 `degraded` 与恢复信息，避免静默失败或循环重启。

Windows 不运行常驻 watcher。仓库入口 `scripts/start-codex-with-skin.ps1` 动态定位仓库与 Codex、准备 `%LOCALAPPDATA%\CodexSkinSwitcher`、用回环 CDP 参数启动应用、等待 12 秒再注入，然后退出。等待用于避免 CDP target 已出现但页面 DOM 尚未就绪的竞态。关闭 Codex 后不会自动重开；下次需要皮肤时再次运行启动器即可。

宿主目标固定为 Codex macOS `26.820.60940`。`base.css` 只保留该版本当前使用的主内容区、输入区、按钮、文件、终端和设置变量；不叠加旧版选择器。升级 Codex 时先重新对照 DOM，再用当前结构重写失效位置。

## 三文件核心主题

### theme.json

数据只有四个字段：

```json
{
  "label": "纸灯",
  "description": "米白纸张工作台",
  "order": 20,
  "vars": {
    "--skin-canvas": "#e9dfca"
  }
}
```

运行时要求 `vars` 至少包含画布、表面、侧栏、控件、正文、弱化文字、强调色、边框、界面字体、代码字体、背景位置和背景透明度。变量名只能使用 `--skin-*`。

### extra.css

所有选择器必须以当前主题作用域开头：

```css
html[data-codex-skin="paper-lantern"] aside.app-shell-left-panel {
  border-radius: 0 18px 18px 0;
}
```

主题 CSS 不接受 `@import`、远程资源或 `@` 规则。公共颜色映射和宿主选择器放在 `base.css`。它统一处理按钮、用户消息、输入框、菜单、终端、文件与 Diff 查看器、设置表单。终端组件会在自己的容器上写入一组内联颜色变量，公共样式直接覆盖该容器的终端变量，正文、ANSI 色、光标与选区才会一起更新。普通换色通常只改 `theme.json`。

### art.png

背景固定使用本地 PNG。运行时通过 Codex 的本地 `app://fs/@fs` 地址加载，没有远程请求，也不会把大图塞进 CSS 声明。

### 可选菜单插图

角色主题可以增加 `profile-art.png` 和 `help-art.png`，分别给个人菜单和帮助菜单提供独立背景；也可以增加 `home-card-a.png` 到 `home-card-d.png`，一对一用作四个主页建议按钮的背景。主页按钮不循环复用素材；每个按钮同时拥有独立道具图标和主色。缺少子图时回退到前一张或 `art.png`，因此普通主题仍只需三个文件。运行时会把可选图片一起纳入 CSS 指纹，更换图片后能正常刷新。

主页按钮保留 Codex 的动作和文案，但替换为四张独立背景、四个人物道具图标和四种强调色。背景使用从左到右逐渐变透明的白色表层保证文字可读。界面字体和标题字体分别通过 `--skin-ui-font` 与 `--skin-display-font` 选择已安装的 macOS 字体栈，不下载字体。头像保持 Codex 原生内容。

## 文件职责

- `server.mjs`：MCP、主题发现、偏好、LaunchAgent。
- `skin.mjs`：主题校验、CSS 生成、CDP 写入和清理。
- `watch.sh`：macOS 普通启动转换为带本机 CDP 的 LaunchServices 启动。
- `scripts/start-codex-with-skin.ps1`：Windows 运行时准备、Codex 动态定位、一次性安全启动与注入入口。
- `base.css`：共享宿主映射。
- 主题三个核心文件：用户修改配色、字体、背景和局部图标的集中入口。
- 可选子图：菜单背景和四张完全不同的主页按钮背景，只在角色主题确实需要时生成。
- `skills/skin-creator/SKILL.md`：把提示词转成核心主题与可选插图，并检查背景可读性、按钮、消息框、终端、文件查看器与设置页。

## 主题格式检查

项目不包含独立测试目录、截图工具、FPS 检测或常驻诊断进程。`skin.mjs validate` 是创建皮肤时的一次性格式检查：它读取指定主题，检查三个核心文件、必填变量、变量值和 CSS 作用域；它不连接 Codex。可选菜单图片不存在时会回退，不增加新的强制检查项。

历史故障、手动恢复和宿主兼容问题统一记录在 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
