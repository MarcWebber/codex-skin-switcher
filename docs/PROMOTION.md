# 1. 中文介绍

## 1.1 简介

Codex Skin Switcher 是 macOS 上的 Codex 皮肤插件。可以在顶部菜单切换主题，从皮肤市场下载，或者用一句提示词和参考图创建自己的皮肤。想换回去时，选择“原生”即可。

## 1.2 发布文案

标题：给 Codex 换一套皮肤，也能用提示词自己做

我做了一个 Codex 皮肤切换器，把平时喜欢的插画放进工作界面。现在有莱依拉、暖暖和桑多涅等示例主题，也能从 Codex 顶部的皮肤市场下载其他主题。

除了背景，字体、按钮和个人菜单的小插图也可以定制。想做自己的主题，点击“创建皮肤”，写下风格或附一张参考图。Codex 会先给你看插图预览，再生成主题文件。

当前支持 macOS，需要 Node.js 22+ 和 Codex CLI。安装只用一行命令：

```bash
codex plugin marketplace add MarcWebber/codex-skin-switcher && codex plugin add codex-skin-switcher@marcwebber
```

安装后新建一个 Codex 任务。如果皮肤没有显示，正常退出后重新打开原来的 Codex App。顶部菜单选择“原生”就能恢复。

项目：https://github.com/MarcWebber/codex-skin-switcher

皮肤市场：https://github.com/MarcWebber/codex-skins

欢迎试用，也欢迎把自己做的主题通过 Pull Request 分享到市场。Windows 适配贡献也欢迎。

# 2. English introduction

## 2.1 Short description

Codex Skin Switcher is a macOS plugin for the Codex desktop app. Switch skins from a small in-app menu, download themes from the market, or describe a style and create your own with Codex. Choose Native whenever you want the original interface back.

## 2.2 Launch post

Title: Custom skins for Codex, with a prompt-based theme creator

I built Codex Skin Switcher to bring illustrations I like into my everyday coding workspace. It includes a Layla demo, an in-app theme market, and examples such as Nikki Danqing and Sandrone Atelier.

Skins can change backgrounds, fonts, buttons, and menu illustrations. To make one, click Create skin and describe the style or attach a reference image. Codex shows the artwork preview before building the theme files. You can restore Native from the same menu.

It currently supports macOS and needs Node.js 22+ plus the Codex CLI. Install it with:

```bash
codex plugin marketplace add MarcWebber/codex-skin-switcher && codex plugin add codex-skin-switcher@marcwebber
```

Start a new Codex task after installation. If the skin has not appeared, quit normally and reopen the original Codex app.

Project: https://github.com/MarcWebber/codex-skin-switcher

Theme market: https://github.com/MarcWebber/codex-skins

Try a theme, report what needs work, or share your own through a market Pull Request. Windows contributions are welcome too.

# 3. 演示素材 / Demo assets

| 素材 / Asset | 用途 / Use |
|---|---|
| [GIF](../plugins/codex-skin-switcher/assets/demo/overview.gif) | README 和支持 GIF 的帖子 / README and posts |
| [中文 MP4](../plugins/codex-skin-switcher/assets/demo/demo-zh.mp4) | 中文发布介绍 / Chinese launch posts |
| [English MP4](../plugins/codex-skin-switcher/assets/demo/demo-en.mp4) | English launch posts |
| [莱依拉大图 / Layla screenshot](../plugins/codex-skin-switcher/assets/screenshots/showcase-layla.png) | 封面 / Cover image |
| [暖暖大图 / Nikki screenshot](../plugins/codex-skin-switcher/assets/screenshots/showcase-nuannuan.png) | 第二套主题示例 / Another theme example |

演示使用仓库已有的真实截图，展示皮肤效果、切换菜单、市场、创建入口和原生恢复。字幕说明操作；它是截图演示，不是实时录屏。角色图片的许可说明见 [NOTICE](../NOTICE.md)。

The walkthrough uses existing UI screenshots from this repository. It shows themes, switching, the market, the creator entry, and restoring Native. Captions explain the steps; this is a screenshot walkthrough rather than a live recording. Artwork terms are in [NOTICE](../NOTICE.md).

# 4. 推广观察 / Measuring exposure

通过 [GitHub Traffic](https://github.com/MarcWebber/codex-skin-switcher/graphs/traffic) 查看浏览量、独立访客、克隆和来源。每次记录观察日期以及图表实际覆盖的日期，方便比较发布前后同一日期的变化。GitHub 只保留最近 14 天的流量，数据使用 UTC；浏览与克隆按小时更新，来源按天更新。[GitHub 文档](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)

重点看外部来源是否出现、独立访客是否增加，以及反馈和投稿是否增加。克隆包含直接命令行拉取；不能把独立克隆者当成实际安装人数。不同渠道发布时保留帖子链接与发布时间。

Use [GitHub Traffic](https://github.com/MarcWebber/codex-skin-switcher/graphs/traffic) to track page views, unique visitors, clones, and referrers. Save the observation date and the chart's date range before comparing results. GitHub retains 14 days of traffic in UTC. Watch for new external referrers, more visitors, and useful feedback; clone counts are not an installation count. Keep the URL and date of each launch post.
