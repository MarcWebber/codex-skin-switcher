import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watcher = path.join(repository, "plugins", "codex-skin-switcher", "runtime", "watch.sh");

test("watcher exits without reopening Codex after a normal quit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-watcher-"));
  const runtime = path.join(root, "runtime");
  const fakeNode = path.join(root, "node");
  const plist = path.join(root, "watcher.plist");
  await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime, "skin.mjs"), "");
  await fs.writeFile(path.join(root, "preference.json"), '{"preset":"native"}\n');
  await fs.writeFile(fakeNode, '#!/bin/sh\n[ "$1" = "-e" ] && { printf native; exit 0; }\nexit 1\n');
  await fs.chmod(fakeNode, 0o755);
  await fs.writeFile(plist, "registered\n");

  try {
    await run("/bin/bash", [watcher, root, fakeNode, path.join(root, "Missing.app"), "9335", "9336", "", plist], { timeout: 2000 });
    assert.equal(await fs.readFile(plist, "utf8"), "registered\n");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the local skin menu waits for the UI bridge during startup", async () => {
  const source = await fs.readFile(path.join(repository, "plugins", "codex-skin-switcher", "runtime", "skin.mjs"), "utf8");
  const server = await fs.readFile(path.join(repository, "plugins", "codex-skin-switcher", "server.mjs"), "utf8");
  const startup = server.slice(server.indexOf("if (process.argv[1]"));
  assert.match(source, /const waitForBridge = async \(\) =>/);
  assert.match(source, /title\.textContent = typeof window\[bridgeName\].+"正在连接…"/);
  assert.ok(startup.indexOf("startUiApi()") < startup.indexOf("ensureWatcher(app)"));
});
