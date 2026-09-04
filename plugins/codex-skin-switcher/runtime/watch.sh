#!/bin/bash
set -u

STATE_ROOT="$1"
NODE_BIN="$2"
APP_BUNDLE="$3"
APP_EXEC="$APP_BUNDLE/Contents/MacOS/ChatGPT"
PORT="${4:-9335}"
CREATOR_SKILL_PATH="${5:-}"
PLIST_FILE="$6"
ENGINE="$STATE_ROOT/runtime/skin.mjs"
PREFERENCE="$STATE_ROOT/preference.json"
PENDING_RELAUNCH="$STATE_ROOT/pending-relaunch"

theme() {
  "$NODE_BIN" -e 'const fs=require("fs");try{const x=JSON.parse(fs.readFileSync(process.argv[1]));process.stdout.write(x.preset||"native")}catch{process.stdout.write("native")}' "$PREFERENCE"
}

app_running() {
  /bin/ps -axo comm= | /usr/bin/grep -Fqx "$APP_EXEC"
}

disable_after_failure() {
  /bin/rm -f "$PENDING_RELAUNCH" "$PLIST_FILE"
  /usr/bin/osascript -e 'display notification "皮肤恢复失败，Watcher 已关闭；下次请正常打开 Codex。" with title "Codex Skin Switcher"' >/dev/null 2>&1 || true
  exit 0
}

apply_theme() {
  THEME="$(theme)"
  "$NODE_BIN" "$ENGINE" apply --root "$STATE_ROOT" --port "$PORT" --theme "$THEME" --creator-skill-path "$CREATOR_SKILL_PATH" >/dev/null 2>&1 || disable_after_failure
  /bin/rm -f "$PENDING_RELAUNCH"
  exit 0
}

if "$NODE_BIN" "$ENGINE" probe --root "$STATE_ROOT" --port "$PORT" >/dev/null 2>&1; then
  apply_theme
fi

[ -f "$PENDING_RELAUNCH" ] || exit 0
while app_running; do
  [ -f "$PENDING_RELAUNCH" ] || exit 0
  sleep 3
done

[ -f "$PENDING_RELAUNCH" ] || exit 0
/usr/bin/open -n "$APP_BUNDLE" --args "--remote-debugging-port=$PORT" "--remote-debugging-address=127.0.0.1" || disable_after_failure

for ((attempt = 0; attempt < 60; attempt++)); do
  if "$NODE_BIN" "$ENGINE" probe --root "$STATE_ROOT" --port "$PORT" >/dev/null 2>&1; then
    apply_theme
  fi
  sleep 1
done

disable_after_failure
