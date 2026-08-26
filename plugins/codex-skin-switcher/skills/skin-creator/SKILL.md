---
name: skin-creator
description: Create a new local macOS Codex skin from one prompt or attached visual references, validate it, and apply it through Codex Skin Switcher. Use when the user asks to create, generate, design, or imitate a Codex skin or theme. Do not use for switching an existing skin.
---

# Codex Skin Creator

Turn the user's prompt and optional reference images into one theme under:

`~/Library/Application Support/CodexSkinSwitcher/themes/<theme-id>/`

Use a short kebab-case ID and copy the nearest existing theme as a starting point. Every theme keeps three hand-editable core files:

1. `theme.json` contains the label, description, order, and `--skin-*` variables.
2. `extra.css` contains small theme-specific adjustments. Every selector must begin with `html[data-codex-skin="<theme-id>"]`. Do not use `@` rules or remote resources.
3. `art.png` is the local background. When the prompt calls for new artwork, use the available image-generation skill. Treat attachments as references unless the user asks to edit one. For Codex layouts, prefer a wide image with low detail behind the main reading area.

Character-led skins may additionally contain optional supporting illustrations:

- `profile-art.png` for the profile menu.
- `help-art.png` for the help menu.
- `home-card-a.png` through `home-card-d.png` for four distinct home suggestion card backgrounds.

The runtime falls back to `art.png` when optional art is absent, so ordinary themes stay at three files. Do not add JavaScript, font files, metadata files, screenshots, or nested asset folders to a theme. Keep shared host selectors in the existing runtime.

## Visual direction

- Preserve Codex's native structure. Prefer palette, typography, quiet backgrounds, and small semantic icon changes over decorative frames or a redesigned dashboard.
- Never replace conversation or account avatars unless the user explicitly asks for avatar replacement.
- For a character-led skin, treat the four home suggestion cards as four individually designed buttons. Give every card a different generated background, accent color, and recognizable character-prop icon. Never use repeated A/B/A/B artwork or four generic symbols. Preserve the native card actions and text.
- Keep profile and help menu icons and layout native, but make their optional background artwork visibly present behind readable text. Inspect the actual opened Radix menu and anchor selectors to its expanded trigger and menu role; do not guess from width utility classes.
- For the main task artwork, start `--skin-art-opacity` around `.20` to `.25`. Text surfaces must stay nearly opaque.
- Avoid neon, high saturation, ornamental borders, dense particles, and invented narrative objects unless the prompt explicitly requests them.
- Use `--skin-font` for the interface and optional `--skin-display-font` for restrained heading contrast. Use installed system font stacks only; never download or bundle fonts.

If a distinctive character or prop language matters and the supplied references do not show enough detail, ask once for up to three reference images. If the user declines, already supplied usable references, or asks you to decide, infer a restrained direction and continue. Generate and display raster previews before applying them; pause only when the preview reveals a real unresolved choice.

Keep the artwork behind the interface quiet enough for long-form reading. Do not rely on a translucent card alone to rescue text contrast.

After writing the core files and any optional supporting illustrations, validate the theme:

```bash
node "$HOME/Library/Application Support/CodexSkinSwitcher/runtime/skin.mjs" validate \
  --root "$HOME/Library/Application Support/CodexSkinSwitcher" \
  --theme <theme-id>
```

If validation passes, call `set_skin` with the new theme ID. Report the final prompt, theme ID, three core files, any optional supporting illustrations, and the returned switch result. Never restart or kill Codex.

Use the following as the creation contract. Do not add or run browser tests, screenshot utilities, persistent diagnostics, or FPS checks:

- The artwork is deliberately faint on the current `main[class*="MainContentSurface"]` surface. Assistant text must remain readable where the image is busiest.
- Primary, secondary, icon-only, hover, focus, disabled, and stop buttons remain recognizable and keep their labels or icons readable.
  - The user's message bubble, assistant reading area, composer, menus, and dialogs use intentional surfaces instead of inherited transparent gray. Do not replace avatars as a side effect.
- Generated-image previews, changed-file cards, the file viewer, and diff rows use the theme's surface, text, and border colors.
- The built-in terminal uses the theme's terminal background, foreground, ANSI colors, selection, cursor, tab bar, and border variables. Confirm the live terminal text after opening it; the terminal container carries its own inline theme tokens and shared runtime selectors must override them.
- The settings view uses the theme's menu, input, dropdown, selected-row, hover, foreground, and border variables.
- All four home suggestion cards use different artwork, recognizable prop icons, and different accents while preserving their actions and readable labels. Repeated background sequences such as A/B/A/B are not allowed. Profile and help menus receive visible, readable optional backgrounds. The built-in terminal, file viewer, diff view, settings, and shared top skin toolbar use the same visual system. The toolbar keeps a recognizable palette control, active skin name, creator action, and collapsed state.

Use shared selectors and semantic variables in `runtime/base.css`; do not navigate away from or mutate unrelated user work to expose views. Compare generated artwork previews against the user's references and make a focused correction when the preview itself fails the requested direction.
