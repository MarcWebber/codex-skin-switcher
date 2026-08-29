# Codex Skin Switcher development rules

These rules apply to the whole repository.

## Git workflow

- Never commit or push directly to `main` or `master`.
- Create a short-lived branch such as `codex/<change>` before editing. Push that branch only.
- Do not merge into the default branch unless the user explicitly asks for the merge.
- Preserve unrelated local changes and inspect `git status` before editing.

## Architecture

- `.agents/plugins/marketplace.json` exposes the repository plugin to Codex Marketplace.
- `plugins/codex-skin-switcher/server.mjs` is the small MCP coordinator: market download, theme discovery, preference persistence, local CDP calls, and macOS Watcher registration.
- `plugins/codex-skin-switcher/runtime/skin.mjs` owns theme validation, CSS assembly, live injection, the single-panel switcher/market UI, and native cleanup.
- `plugins/codex-skin-switcher/runtime/base.css` contains shared mappings for the current Codex UI. Do not add old-version selector branches.
- `plugins/codex-skin-switcher/runtime/themes/layla-starlight/` is the only bundled demo. Public themes live in `MarcWebber/codex-skins` and keep the same fixed filenames.
- `plugins/codex-skin-switcher/runtime/watch.sh` is the minimal macOS recovery launcher. It is not a performance monitor or a general process supervisor.
- `plugins/codex-skin-switcher/scripts/start-codex-with-skin.ps1` and its `.cmd` wrapper are the Windows-only standalone launcher.
- `plugins/codex-skin-switcher/skills/` contains the user-facing switcher and creator workflows; `docs/` explains implementation, privacy, and recovery.
- Runtime state belongs under `~/Library/Application Support/CodexSkinSwitcher` on macOS. Never modify the Codex application bundle or `~/.codex/config.toml`.

## Implementation style

- Prefer the smallest data structure and one check at the real boundary. Avoid speculative compatibility layers, path scans, retries, state machines, and fallback branches.
- Do not add abstractions, classes, helpers, configuration, or dependencies for a single use unless they materially reduce complexity.
- Support the current Codex page structure directly. If it changes, replace the mapping instead of keeping parallel old and new implementations.
- Keep theme-specific styling in that theme's `extra.css`; keep shared host mappings in `base.css`; keep orchestration out of CSS.
- Preserve native Codex behavior and provide a clear failure message. Do not kill or restart a user's running Codex instance.

## Platform scope

- A feature implemented and verified only on macOS must be labeled **macOS only** in its user-facing documentation, manifest text, and relevant error or status message.
- A feature implemented and verified only on Windows must be labeled **Windows only** in the same places.
- Do not claim cross-platform support until both platforms have been implemented and regression-tested. Other platforms do not need speculative handling.
- The MCP plugin, Skin Creator, and Watcher are currently **macOS only**. The PowerShell/CMD launcher is currently **Windows only**.

## Tests and regression

- Every production behavior addition or bug fix must add or update at least one focused unit test. A bug fix test must cover the failing condition. Do not add redundant tests merely to increase the count.
- Pure documentation, screenshot, artwork, or metadata edits do not require a new unit test because they add no executable behavior, but they still require the regression checks below.
- Run the relevant focused test while developing, then run this repository regression set before every commit or push:

```bash
node --test tests/*.test.mjs
bash -n plugins/codex-skin-switcher/runtime/watch.sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/validate_plugin.py" plugins/codex-skin-switcher
git diff --check
```

- Also run a platform-specific smoke check for any platform launcher or live UI behavior changed. Report static validation, unit tests, live/CDP checks, and visual acceptance separately; one does not imply another.
