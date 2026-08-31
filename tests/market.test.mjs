import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverFile = path.join(root, "plugins", "codex-skin-switcher", "server.mjs");

test("market accepts the minimal manifest and rejects invalid formats", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-market-test-"));
  const originalFetch = globalThis.fetch;
  const files = {
    "/manifest.json": ["remote-skin"],
    "/skins/remote-skin/theme.json": {
      label: "远端皮肤",
      description: "测试皮肤",
      vars: Object.fromEntries([
        "--skin-canvas", "--skin-surface", "--skin-sidebar", "--skin-control",
        "--skin-text", "--skin-muted", "--skin-accent", "--skin-border",
        "--skin-font", "--skin-code-font", "--skin-art-position", "--skin-art-opacity",
      ].map((key) => [key, key === "--skin-art-opacity" ? ".2" : "test"])),
    },
    "/skins/remote-skin/meta.json": { version: "1.2.3", author: "Tester" },
    "/skins/remote-skin/extra.css": "",
    "/skins/remote-skin/art.png": "image",
    "/skins/remote-skin/preview.png": "preview",
  };
  process.env.CODEX_SKIN_STATE_ROOT = state;
  process.env.CODEX_SKIN_MARKET_URL = "https://market.test";
  try {
    let fetchCount = 0;
    globalThis.fetch = async (url) => {
      fetchCount += 1;
      const value = files[new URL(url).pathname];
      const body = typeof value === "object" ? JSON.stringify(value) : value;
      return new Response(body || "", { status: value === undefined ? 404 : 200 });
    };
    const market = await import(`${serverFile}?valid=${Date.now()}`);
    await market.prepare();
    assert.deepEqual(await market.marketSkins(), [{
      id: "remote-skin",
      label: "远端皮肤",
      description: "测试皮肤",
      author: "Tester",
      version: "1.2.3",
      preview: "https://market.test/skins/remote-skin/preview.png",
      installed: false,
      removable: false,
    }]);
    const catalogFetches = fetchCount;
    await market.marketSkins();
    assert.equal(fetchCount, catalogFetches);
    assert.deepEqual(await market.installMarketSkin("remote-skin"), { id: "remote-skin", installed: true });
    assert.equal((await market.localThemes()).find((theme) => theme.id === "remote-skin").removable, true);
    assert.deepEqual(await market.removeMarketSkin("remote-skin"), { id: "remote-skin", removed: true });

    globalThis.fetch = async () => new Response("{}", { status: 200 });
    const invalid = await import(`${serverFile}?invalid=${Date.now()}`);
    await assert.rejects(invalid.marketSkins(), /市场 Manifest 格式错误/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CODEX_SKIN_STATE_ROOT;
    delete process.env.CODEX_SKIN_MARKET_URL;
    await fs.rm(state, { recursive: true, force: true });
  }
});
