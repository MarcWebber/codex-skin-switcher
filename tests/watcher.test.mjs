import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "codex-skin-switcher");

test("watcher is started on plugin launch and remains available for native", async () => {
  const [server, watcher] = await Promise.all([
    fs.readFile(path.join(plugin, "server.mjs"), "utf8"),
    fs.readFile(path.join(plugin, "runtime", "watch.sh"), "utf8"),
  ]);
  const ensureWatcher = server.match(/async function ensureWatcher[\s\S]*?\n}\n\nasync function disableWatcher/)?.[0] || "";
  const setSkin = server.match(/async function setSkin[\s\S]*?\n}\n\nconst statusSchema/)?.[0] || "";

  assert.match(ensureWatcher, /\["print", target\]/);
  assert.match(ensureWatcher, /\["kickstart", target\]/);
  assert.doesNotMatch(ensureWatcher, /=== plist\) return/);
  assert.match(server, /if \(!process\.env\.CODEX_SKIN_STATE_ROOT\)[\s\S]*await ensureWatcher\(app\)/);
  assert.match(setSkin, /已恢复 Codex 原生界面，皮肤入口保持可用/);
  assert.doesNotMatch(setSkin, /已恢复 Codex 原生界面，Watcher 已关闭/);
  assert.doesNotMatch(watcher, /\[ "\$THEME" = "native" \] && exit 0/);
});
