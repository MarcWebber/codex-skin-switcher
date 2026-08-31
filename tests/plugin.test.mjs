import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("plugin manifests resolve and the MCP server lists its tools", async () => {
  const marketplace = JSON.parse(await fs.readFile(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
  assert.equal(marketplace.name, "marcwebber");
  assert.equal(marketplace.plugins.length, 1);

  const entry = marketplace.plugins[0];
  const pluginRoot = path.resolve(root, entry.source.path);
  const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(entry.name, manifest.name);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/);
  for (const target of [manifest.skills, manifest.mcpServers, ...manifest.interface.screenshots]) {
    assert.ok(await fs.stat(path.resolve(pluginRoot, target)).catch(() => null), `missing manifest path: ${target}`);
  }

  const state = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-plugin-test-"));
  try {
    const input = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ].map(JSON.stringify).join("\n") + "\n";
    const result = spawnSync(process.execPath, [path.join(pluginRoot, "server.mjs")], {
      env: { ...process.env, CODEX_SKIN_MARKET_PORT: "0", CODEX_SKIN_STATE_ROOT: state },
      input,
      encoding: "utf8",
      timeout: 3000,
    });
    assert.equal(result.status, 0, result.stderr);
    const replies = result.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(replies[0].result.serverInfo.name, "codex-skin-switcher");
    assert.deepEqual(replies[1].result.tools.map((tool) => tool.name).sort(), ["get_skin_status", "set_skin"]);
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});
