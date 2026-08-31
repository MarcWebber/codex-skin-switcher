import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverFile = path.join(root, "plugins", "codex-skin-switcher", "server.mjs");
const runtimeFile = path.join(root, "plugins", "codex-skin-switcher", "runtime", "skin.mjs");
const baseCssFile = path.join(root, "plugins", "codex-skin-switcher", "runtime", "base.css");
const laylaCssFile = path.join(root, "plugins", "codex-skin-switcher", "runtime", "themes", "layla-starlight", "extra.css");

test("default market URL uses an explicit GitHub branch ref", async () => {
  const server = await fs.readFile(serverFile, "utf8");
  assert.match(server, /codex-skins\/refs\/heads\/main/);
  assert.doesNotMatch(server, /codex-skins\/main"/);
});

test("profile and help art use sidebar structure instead of localized labels", async () => {
  const css = `${await fs.readFile(baseCssFile, "utf8")}\n${await fs.readFile(laylaCssFile, "utf8")}`;
  assert.match(css, /:has\(\[data-app-action-sidebar-scroll\]\):has\(nav \+ div/);
  assert.match(css, /aria-expanded="true"\] > img/);
  assert.match(css, /aria-expanded="true"\] > svg/);
  assert.doesNotMatch(css, /:has\([^)]*:has\(/);
  assert.doesNotMatch(css, /打开个人资料菜单|打开帮助菜单|Open profile menu|Open help menu/);
});

test("market UI uses the native CDP binding instead of renderer fetch", async () => {
  const [server, runtime] = await Promise.all([
    fs.readFile(serverFile, "utf8"),
    fs.readFile(runtimeFile, "utf8"),
  ]);
  assert.match(server, /Runtime\.addBinding/);
  assert.match(server, /server\.once\("listening", \(\) => \{ stopBridge = startUiBridge\(\); \}\)/);
  assert.match(runtime, /window\[bridgeName\]\(JSON\.stringify/);
  assert.match(runtime, /event\.source !== window/);
  assert.match(runtime, /requestMarket\("market"\)/);
  assert.match(runtime, /requestMarket\("local"\)/);
  assert.match(runtime, /const select = \(nextId\) => requestMarket\("select", nextId\)/);
  assert.match(server, /if \(action === "install"\) return installMarketSkin\(id\)/);
  assert.match(runtime, /item\.removable \? "删除"/);
  assert.match(runtime, /requestMarket\("install", item\.id\)/);
  assert.match(runtime, /heading: "下载成功"/);
  assert.match(runtime, /heading: "删除皮肤？"/);
  assert.match(runtime, /const transitionTo = async/);
  assert.match(runtime, /#themes\{max-height:150px;overflow-y:auto/);
  assert.doesNotMatch(runtime, /localPreview/);
  assert.doesNotMatch(runtime, /const response = await fetch\(marketUrl \+ "\/market/);
});

test("market transport closes when the plugin session ends", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-server-test-"));
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, CODEX_SKIN_MARKET_PORT: "0", CODEX_SKIN_STATE_ROOT: state },
    stdio: ["pipe", "ignore", "pipe"],
  });
  child.stdin.end();
  let timer;
  try {
    const code = await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("plugin server stayed alive after stdin closed")), 3000); }),
    ]);
    assert.equal(code, 0);
  } finally {
    clearTimeout(timer);
    child.kill();
    await fs.rm(state, { recursive: true, force: true });
  }
});

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
    const { installMarketSkin, localThemes, marketSkins, prepare, removeMarketSkin } = await import(`${serverFile}?test=${Date.now()}`);
    await prepare();
    assert.equal((await localThemes()).find((item) => item.id === "layla-starlight").removable, false);
    assert.deepEqual(await marketSkins(), [{
        id: "remote-skin",
        label: "远端皮肤",
        description: "测试市场皮肤",
        author: "Tester",
        version: "1.2.3",
        preview: "https://market.test/skins/remote-skin/preview.png",
        installed: false,
        removable: false,
    }]);
    assert.deepEqual(await installMarketSkin("remote-skin"), { id: "remote-skin", installed: true });
    assert.equal(await fs.readFile(path.join(state, "themes", "remote-skin", "meta.json"), "utf8"), JSON.stringify(files["/skins/remote-skin/meta.json"]));
    assert.equal((await localThemes()).find((item) => item.id === "remote-skin").removable, true);
    assert.equal((await marketSkins())[0].removable, true);
    assert.deepEqual(await removeMarketSkin("remote-skin"), { id: "remote-skin", removed: true });
    assert.equal(await fs.stat(path.join(state, "themes", "remote-skin")).catch(() => null), null);
    await assert.rejects(removeMarketSkin("layla-starlight"), /内置皮肤不能删除/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CODEX_SKIN_STATE_ROOT;
    delete process.env.CODEX_SKIN_MARKET_URL;
    await fs.rm(state, { recursive: true, force: true });
  }
});
