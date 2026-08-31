---
name: skin-switcher
description: Open, inspect, switch, restore, or customize local macOS Codex skins.
---

# Codex Skin Switcher

This plugin supports macOS only. It targets the current Codex page structure, carries no old-version selector branches, and never edits the Codex application bundle or `~/.codex/config.toml`.

## Actions

- Read status: call `get_skin_status`.
- Apply a named theme: call `set_skin` with its discovered folder ID.
- Restore Codex: call `set_skin` with `native`.
- The floating Skin button inside Codex is the only visual switcher. Its local list stays compact, scrolls after five entries, and offers confirmed deletion for non-bundled themes without adding a preview pane. Its market icon replaces that list with an on-demand preview view in the same panel; the back arrow restores the local list. Market search only filters the loaded Manifest. Download validates and installs the fixed theme files, then asks whether to apply them; applying uses a short fade transition. Market and local deletion share one confirmation view, while the bundled demo stays installed. Its Create skin action inserts the native `codex-skin-switcher:skin-creator` Skill mention followed by an editable `风格：` field in an empty composer; it never sends automatically or overwrites existing input. Its minus control collapses the toolbar to a palette icon; clicking that icon restores it.
- The plugin registers and starts its minimal Watcher when the MCP server starts. It keeps the floating Skin button available across launches, including while the native preset is selected.
- Report the returned message. When `cdpReady` is false, ask the user to quit Codex normally once; the Watcher will reopen it with the local CDP parameter. Never restart or kill Codex from the agent turn.
- If applying or removing a theme fails, report the error and keep the current UI. Troubleshooting lives in `docs/TROUBLESHOOTING.md` under the plugin root.

When the user asks to create a new skin from a prompt or reference image, use the sibling `skin-creator` skill.

## Theme editing

User themes live under `~/Library/Application Support/CodexSkinSwitcher/themes/<id>/`. Copy an existing kebab-case directory and edit these three core files:

1. `theme.json`
2. `extra.css`
3. `art.png`

Character themes may optionally add `profile-art.png` and `help-art.png` as visible backgrounds for the two menus, plus `home-card-a.png` through `home-card-d.png` as four unique home-card backgrounds. Missing optional art falls back to `art.png`. The shared runtime locates profile and help menus from the sidebar structure; theme CSS must not depend on visible text, usernames, localized `aria-label` values, or dynamic Radix IDs. Keep avatars native. Character-led home cards should use four different recognizable prop icons, accents, and backgrounds while preserving native actions and text; never repeat an A/B sequence. Choose only installed system fonts through theme variables. Do not add remote CSS, fonts, analytics, arbitrary images, or nested asset folders. Every selector in `extra.css` must begin with `html[data-codex-skin="<id>"]`. The panel discovers new directories automatically.
