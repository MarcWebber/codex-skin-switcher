import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverFile = path.join(root, "plugins", "codex-skin-switcher", "server.mjs");

test("market API expands the minimal manifest with theme metadata", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-market-test-"));
  const originalFetch = globalThis.fetch;
  const theme = {
    label: "远端皮肤",
    description: "测试市场皮肤",
    vars: Object.fromEntries([
      "--skin-canvas", "--skin-surface", "--skin-sidebar", "--skin-control",
      "--skin-text", "--skin-muted", "--skin-accent", "--skin-border",
      "--skin-font", "--skin-code-font", "--skin-art-position", "--skin-art-opacity",
    ].map((key) => [key, key === "--skin-art-opacity" ? ".2" : "test"])),
  };
  const files = {
    "/manifest.json": ["remote-skin"],
    "/skins/remote-skin/theme.json": theme,
    "/skins/remote-skin/meta.json": { version: "1.2.3", author: "Tester" },
    "/skins/remote-skin/extra.css": "",
    "/skins/remote-skin/art.png": "image",
    "/skins/remote-skin/preview.png": "preview",
  };
  globalThis.fetch = async (url) => {
    const value = files[new URL(url).pathname];
    const body = typeof value === "object" ? JSON.stringify(value) : value;
    return new Response(body || "", { status: value === undefined ? 404 : 200 });
  };
  process.env.CODEX_SKIN_STATE_ROOT = state;
  process.env.CODEX_SKIN_MARKET_URL = "https://market.test";

  try {
    const { installMarketSkin, marketSkins, prepare } = await import(`${serverFile}?test=${Date.now()}`);
    await prepare();
    assert.deepEqual(await marketSkins(), [{
        id: "remote-skin",
        label: "远端皮肤",
        description: "测试市场皮肤",
        author: "Tester",
        version: "1.2.3",
        preview: "https://market.test/skins/remote-skin/preview.png",
        installed: false,
    }]);
    assert.deepEqual(await installMarketSkin("remote-skin"), { id: "remote-skin", installed: true });
    assert.equal(await fs.readFile(path.join(state, "themes", "remote-skin", "meta.json"), "utf8"), JSON.stringify(files["/skins/remote-skin/meta.json"]));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CODEX_SKIN_STATE_ROOT;
    delete process.env.CODEX_SKIN_MARKET_URL;
    await fs.rm(state, { recursive: true, force: true });
  }
});
