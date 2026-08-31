import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "codex-skin-switcher");
const runtime = path.join(plugin, "runtime", "skin.mjs");

test("runtime validates and builds native and selected themes", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-runtime-test-"));
  try {
    await fs.mkdir(path.join(state, "runtime"));
    await fs.cp(path.join(plugin, "runtime", "base.css"), path.join(state, "runtime", "base.css"));
    await fs.cp(path.join(plugin, "runtime", "themes"), path.join(state, "themes"), { recursive: true });
    const incomplete = path.join(state, "themes", "inactive-theme");
    await fs.mkdir(incomplete);
    await fs.writeFile(path.join(incomplete, "theme.json"), JSON.stringify({ label: "未启用", description: "不应读取资源" }));

    const run = async (...args) => JSON.parse((await exec(process.execPath, [runtime, ...args, "--root", state])).stdout);
    const themes = await run("themes");
    assert.ok(themes.some((theme) => theme.id === "layla-starlight"));
    assert.match((await run("validate", "--theme", "layla-starlight")).fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(await run("apply", "--dry-run", "--theme", "native"), { ok: true, dryRun: true });
    assert.deepEqual(await run("apply", "--dry-run", "--theme", "layla-starlight"), { ok: true, dryRun: true });
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});
