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
    await run("/bin/bash", [watcher, root, fakeNode, path.join(root, "Missing.app"), "9335", "", plist], { timeout: 2000 });
    assert.equal(await fs.readFile(plist, "utf8"), "registered\n");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("watcher applies once and exits when CDP is ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-watcher-ready-"));
  const runtime = path.join(root, "runtime");
  const fakeNode = path.join(root, "node");
  const log = path.join(root, "calls.log");
  const plist = path.join(root, "watcher.plist");
  await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime, "skin.mjs"), "");
  await fs.writeFile(path.join(root, "preference.json"), '{"preset":"layla-starlight"}\n');
  await fs.writeFile(path.join(root, "pending-relaunch"), "");
  await fs.writeFile(fakeNode, '#!/bin/sh\nif [ "$1" = "-e" ]; then printf layla-starlight; exit 0; fi\nif [ "$2" = "probe" ]; then exit 0; fi\nif [ "$2" = "apply" ]; then printf "apply\\n" >> "$WATCH_LOG"; exit 0; fi\nexit 1\n');
  await fs.chmod(fakeNode, 0o755);

  try {
    await run("/bin/bash", [watcher, root, fakeNode, path.join(root, "Missing.app"), "9335", "", plist], {
      env: { ...process.env, WATCH_LOG: log },
      timeout: 2000,
    });
    assert.equal(await fs.readFile(log, "utf8"), "apply\n");
    assert.equal(await fs.stat(path.join(root, "pending-relaunch")).catch(() => null), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
