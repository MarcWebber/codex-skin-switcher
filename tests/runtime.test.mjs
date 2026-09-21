import assert from "node:assert/strict";
import crypto from "node:crypto";
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
    const validated = await run("validate", "--theme", "layla-starlight");
    assert.match(validated.fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(await run("apply", "--dry-run", "--theme", "native"), { ok: true, dryRun: true });
    assert.deepEqual(await run("apply", "--dry-run", "--theme", "layla-starlight"), { ok: true, dryRun: true });

    const source = await fs.readFile(runtime, "utf8");
    const bundleFingerprint = crypto.createHash("sha256").update(JSON.stringify({
      themes: themes.map((theme) => [theme.id, theme.label]),
      active: validated.fingerprint,
      runtimeFingerprint: crypto.createHash("sha256").update(source).digest("hex"),
      creatorSkillPath: "",
    })).digest("hex");
    await fs.writeFile(path.join(state, "runtime", "skin.mjs"), source);
    // Evaluate the actual injected script against an already-applied page.
    await fs.writeFile(path.join(state, "runtime", "cdp.mjs"), `
      import { runInNewContext } from 'node:vm';
      export async function connectPage() {
        return { socket: { close() {} }, async send(method, { expression }) {
          const value = runInNewContext(expression, {
            window: { __CODEX_SKIN__: {
              id: 'layla-starlight', bundleFingerprint: ${JSON.stringify(bundleFingerprint)},
              activate() { throw new Error('Duplicate restoration rewrote the active skin'); },
              cleanup() { throw new Error('Duplicate restoration rebuilt the toolbar'); },
            } },
            document: { getElementById() { return {}; } },
          });
          return { result: { value } };
        } };
      }
    `);
    const restored = JSON.parse((await exec(process.execPath, [path.join(state, "runtime", "skin.mjs"),
      "apply", "--theme", "layla-starlight", "--root", state])).stdout);
    assert.deepEqual(restored, { ok: true, id: "layla-starlight", unchanged: true });
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});
