import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { applyCss, attachSession, matchesPage, parsePort, startService, themeCss } from "../plugins/codex-skin-switcher/runtime/antigravity.mjs";

test("Antigravity uses its own dynamic port and local main page", () => {
  assert.equal(parsePort("53327\n/devtools/browser/abc"), 53327);
  for (const value of ["0", "65536", "invalid", ""]) assert.throws(() => parsePort(value), /端口无效/);
  assert.equal(matchesPage({ title: "Antigravity", url: "https://127.0.0.1:53329/" }), true);
  assert.equal(matchesPage({ title: "Codex", url: "app://-/index.html" }), false);
  assert.equal(matchesPage({ title: "Antigravity", url: "https://example.com/" }), false);
});

test("reinstall restarts only the existing skin service without racing bootout against bootstrap", async () => {
  for (const loaded of [false, true]) {
    const calls = [];
    await startService(async (file, args) => {
      assert.equal(file, "/bin/launchctl");
      calls.push(args);
      if (args[0] === "print" && !loaded) throw new Error("not loaded");
    }, "gui/501", "/test/skin.plist");
    assert.deepEqual(calls, [
      ["print", "gui/501/com.antigravity-skin-switcher"],
      loaded ? ["kickstart", "-k", "gui/501/com.antigravity-skin-switcher"] : ["bootstrap", "gui/501", "/test/skin.plist"],
    ]);
  }
});

test("shared theme vars and art produce Antigravity CSS; native removes only adapter styles", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-skin-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const theme = JSON.parse(await fs.readFile(new URL("../plugins/codex-skin-switcher/runtime/themes/layla-starlight/theme.json", import.meta.url), "utf8"));
  await fs.writeFile(path.join(folder, "theme.json"), JSON.stringify(theme));
  await fs.writeFile(path.join(folder, "art.png"), Buffer.from("PNG fixture"));
  const css = await themeCss("layla-starlight", folder);
  assert.ok(css.includes("data-antigravity-skin"));
  assert.ok(css.includes("--skin-text:#283052"));
  assert.ok(css.includes(`data:image/png;base64,${Buffer.from("PNG fixture").toString("base64")}`));
  assert.ok(css.includes('body::before{background-image:url("data:image/png;base64,'));
  assert.ok(!css.includes("--skin-art:url("));
  assert.ok(!css.includes("data-codex-skin"));
  assert.equal(await themeCss("native"), "");
  await assert.rejects(themeCss("../escape", folder), /非法皮肤/);
  theme.vars["--skin-text"] = "red;}body{display:none";
  await fs.writeFile(path.join(folder, "theme.json"), JSON.stringify(theme));
  await assert.rejects(themeCss("layla-starlight", folder), /非法 CSS 变量/);

  const styles = new Map([["native-app-style", {}]]);
  const document = {
    documentElement: { dataset: {} },
    getElementById: (id) => styles.get(id),
    createElement: () => ({ remove() { styles.delete(this.id); } }),
    head: { append(style) { styles.set(style.id, style); } },
  };
  const window = {};
  const run = (id, css) => runInNewContext(`(${applyCss})(${JSON.stringify(id)},${JSON.stringify(css)})`, { document, window });
  run("layla-starlight", css);
  assert.equal(styles.get("antigravity-skin-style").textContent, css);
  assert.equal(document.documentElement.dataset.antigravitySkin, "layla-starlight");
  run("native", "");
  assert.equal(document.documentElement.dataset.antigravitySkin, undefined);
  assert.equal(styles.has("antigravity-skin-style"), false);
  assert.equal(styles.has("native-app-style"), true);
});

test("passive session restores on reload, switches from its binding and ends when the app closes", { timeout: 1000 }, async () => {
  const socket = new EventTarget();
  const commands = [];
  const applied = [];
  let current = "layla-starlight";
  const first = Promise.withResolvers();
  const reloaded = Promise.withResolvers();
  const switched = Promise.withResolvers();
  const session = attachSession({ socket, send: async (method, params) => {
    commands.push({ method, params });
    if (method === "Runtime.evaluate") return { result: { value: true } };
    return {};
  } }, {
    themes: async () => [{ id: "layla-starlight", label: "莱依拉星梦" }],
    preset: async () => current,
    select: async (id) => {
      applied.push(id); current = id;
      if (applied.length === 1) first.resolve();
      else if (applied.length === 2) reloaded.resolve();
      else switched.resolve();
    },
  });
  await first.promise;
  socket.dispatchEvent(new MessageEvent("message", { data: '{"method":"Page.loadEventFired"}' }));
  await reloaded.promise;
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ method: "Runtime.bindingCalled", params: { name: "__antigravitySkinRequest", payload: '{"preset":"native"}' } }) }));
  await switched.promise;
  socket.dispatchEvent(new Event("close"));
  await session;
  assert.deepEqual(applied, ["layla-starlight", "layla-starlight", "native"]);
  assert.deepEqual(commands.slice(0, 3).map((item) => item.method), ["Runtime.enable", "Runtime.addBinding", "Page.enable"]);
  assert.ok(!commands.some((item) => /close|crash|reload/i.test(item.method)));
});
