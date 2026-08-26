#!/bin/bash
set -uo pipefail

STATE_ROOT="$1"
NODE_BIN="$2"
APP_BUNDLE="$3"
PORT="${4:-9335}"
CREATOR_SKILL_PATH="${5:-}"
ENGINE="$STATE_ROOT/runtime/skin.mjs"
PREFERENCE="$STATE_ROOT/preference.json"
RECOVERY="$STATE_ROOT/recovery.json"
APP_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_BUNDLE/Contents/Info.plist" 2>/dev/null || true)"

record_failure() {
  "$NODE_BIN" -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({code:"safe-launch-failed",message:process.argv[2],at:new Date().toISOString()},null,2)+"\n")' "$RECOVERY" "$1"
}

clear_failure() {
  /bin/rm -f "$RECOVERY"
}

theme() {
  "$NODE_BIN" -e 'const fs=require("fs");try{const x=JSON.parse(fs.readFileSync(process.argv[1]));process.stdout.write(x.preset||"native")}catch{process.stdout.write("native")}' "$PREFERENCE"
}

while :; do
  THEME="$(theme)"
  if [ "$THEME" = "native" ]; then sleep 3; continue; fi

  if [ -z "$APP_NAME" ]; then
    record_failure "Codex 应用结构无法识别；自动换肤已停止，应用不会被重启。"
    exit 0
  fi

  if "$NODE_BIN" "$ENGINE" probe --root "$STATE_ROOT" --port "$PORT" >/dev/null 2>&1; then
    INSPECT="$($NODE_BIN "$ENGINE" inspect --root "$STATE_ROOT" --port "$PORT" 2>/dev/null || true)"
    if [ -z "$INSPECT" ] || [[ "$INSPECT" == *'"fingerprint":null'* ]]; then
      if "$NODE_BIN" "$ENGINE" apply --resume --root "$STATE_ROOT" --port "$PORT" --theme "$THEME" --creator-skill-path "$CREATOR_SKILL_PATH" >/dev/null 2>&1; then
        clear_failure
      else
        record_failure "皮肤恢复失败；已保留当前界面并停止自动重试。"
        exit 0
      fi
    fi
    sleep 3
    continue
  fi

  PIDS="$(/usr/bin/pgrep -x "$APP_NAME" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then sleep 3; continue; fi

  if ! /usr/bin/open -n "$APP_BUNDLE" --args "--remote-debugging-port=$PORT" "--remote-debugging-address=127.0.0.1"; then
    record_failure "Codex 安全启动失败；已停止自动重试，请正常打开 Codex 并恢复原生皮肤。"
    exit 0
  fi
  sleep 12
  if ! "$NODE_BIN" "$ENGINE" probe --root "$STATE_ROOT" --port "$PORT" >/dev/null 2>&1; then
    record_failure "Codex 已打开，但本机皮肤端口不可用；已停止自动重试，应用保持原生界面。"
    exit 0
  fi
done
