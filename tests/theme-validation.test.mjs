import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, cp, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "codex-skin-switcher");

test("bundled themes pass the runtime validator", async () => {
  const state = await mkdtemp(path.join(os.tmpdir(), "codex-skin-test-"));
  try {
    await mkdir(path.join(state, "runtime"));
    await cp(path.join(plugin, "runtime", "base.css"), path.join(state, "runtime", "base.css"));
    await cp(path.join(plugin, "runtime", "themes"), path.join(state, "themes"), { recursive: true });

    const themes = (await readdir(path.join(state, "themes"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.ok(themes.length > 0);
    for (const theme of themes) {
      const { stdout } = await exec(process.execPath, [
        path.join(plugin, "runtime", "skin.mjs"),
        "validate",
        "--root", state,
        "--theme", theme,
      ]);
      const result = JSON.parse(stdout);
      assert.equal(result.ok, true);
      assert.equal(result.id, theme);
      assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    }
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});

test("validator accepts a staged folder before installation", async () => {
  const state = await mkdtemp(path.join(os.tmpdir(), "codex-skin-stage-test-"));
  try {
    await mkdir(path.join(state, "runtime"));
    await cp(path.join(plugin, "runtime", "base.css"), path.join(state, "runtime", "base.css"));
    const staged = path.join(state, "staged");
    await cp(path.join(plugin, "runtime", "themes", "layla-starlight"), staged, { recursive: true });
    const { stdout } = await exec(process.execPath, [
      path.join(plugin, "runtime", "skin.mjs"),
      "validate",
      "--root", state,
      "--theme", "layla-starlight",
      "--folder", staged,
    ]);
    assert.equal(JSON.parse(stdout).ok, true);
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});

test("injected switcher and market script parses", async () => {
  const state = await mkdtemp(path.join(os.tmpdir(), "codex-skin-ui-test-"));
  try {
    await mkdir(path.join(state, "runtime"));
    await cp(path.join(plugin, "runtime", "base.css"), path.join(state, "runtime", "base.css"));
    await cp(path.join(plugin, "runtime", "themes"), path.join(state, "themes"), { recursive: true });
    const { stdout } = await exec(process.execPath, [
      path.join(plugin, "runtime", "skin.mjs"),
      "apply",
      "--dry-run",
      "--root", state,
      "--theme", "layla-starlight",
    ]);
    assert.deepEqual(JSON.parse(stdout), { ok: true, dryRun: true });
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});
