#!/bin/bash
set -u

STATE_ROOT="$1"
NODE_BIN="$2"
APP_BUNDLE="$3"
APP_EXEC="$APP_BUNDLE/Contents/MacOS/ChatGPT"
PORT="${4:-9335}"
MARKET_PORT="${5:-9336}"
CREATOR_SKILL_PATH="${6:-}"
PLIST_FILE="$7"
ENGINE="$STATE_ROOT/runtime/skin.mjs"
PREFERENCE="$STATE_ROOT/preference.json"
PENDING_RELAUNCH="$STATE_ROOT/pending-relaunch"
RELAUNCHED=0

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

while :; do
  THEME="$(theme)"

  if "$NODE_BIN" "$ENGINE" probe --root "$STATE_ROOT" --port "$PORT" >/dev/null 2>&1; then
    /bin/rm -f "$PENDING_RELAUNCH"
    "$NODE_BIN" "$ENGINE" apply --root "$STATE_ROOT" --port "$PORT" --market-port "$MARKET_PORT" --theme "$THEME" --creator-skill-path "$CREATOR_SKILL_PATH" >/dev/null 2>&1 || disable_after_failure
    while "$NODE_BIN" "$ENGINE" probe --root "$STATE_ROOT" --port "$PORT" >/dev/null 2>&1; do sleep 3; done
  elif app_running; then
    if [ -f "$PENDING_RELAUNCH" ] || [ "$RELAUNCHED" -eq 1 ]; then sleep 3; else exit 0; fi
  elif [ -f "$PENDING_RELAUNCH" ]; then
    /usr/bin/open -n "$APP_BUNDLE" --args "--remote-debugging-port=$PORT" "--remote-debugging-address=127.0.0.1" || disable_after_failure
    /bin/rm -f "$PENDING_RELAUNCH"
    RELAUNCHED=1
    sleep 3
  else
    exit 0
  fi
done
