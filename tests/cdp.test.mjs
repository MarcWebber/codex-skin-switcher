import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connectPage } from "../plugins/codex-skin-switcher/runtime/cdp.mjs";

function transport(t, { open = true } = {}) {
  const previous = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const sockets = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    requests = [];
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
      if (open) queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
    }
    send(text) { this.requests.push(JSON.parse(text)); }
    reply(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  globalThis.WebSocket = Socket;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { type: "page", url: "app://-/index.html?initialRoute=avatar-overlay", webSocketDebuggerUrl: "ws://overlay" },
    { type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" },
  ]));
  t.after(() => {
    for (const socket of sockets) socket.close();
    Object.assign(globalThis, previous);
  });
  return sockets;
}

test("CDP selects the main page, correlates replies and surfaces protocol errors", async (t) => {
  transport(t);
  const connection = await connectPage(9335);
  assert.equal(connection.socket.url, "ws://main");
  const first = connection.send("Runtime.enable");
  const second = connection.send("Page.enable");
  connection.socket.reply({ id: 2, result: { enabled: true } });
  connection.socket.reply({ id: 1, result: {} });
  assert.deepEqual(await first, {});
  assert.deepEqual(await second, { enabled: true });
  const failed = connection.send("Unknown.command");
  connection.socket.reply({ id: 3, error: { message: "unsupported" } });
  await assert.rejects(failed, /unsupported/);
});

test("CDP handshake and command timeouts never wait indefinitely", async (t) => {
  const sockets = transport(t, { open: false });
  await assert.rejects(connectPage(9335, 20), /连接超时/);
  assert.equal(sockets[0].readyState, 3);
  const connecting = connectPage(9335, 20);
  await new Promise((resolve) => setImmediate(resolve));
  sockets[1].readyState = 1;
  sockets[1].dispatchEvent(new Event("open"));
  const connection = await connecting;
  await assert.rejects(connection.send("Runtime.evaluate"), /调用超时/);
});

test("CDP disconnection rejects pending and future commands", async (t) => {
  transport(t);
  const connection = await connectPage(9335);
  const pending = connection.send("Runtime.evaluate");
  connection.socket.close();
  await assert.rejects(pending, /连接已断开/);
  await assert.rejects(connection.send("Runtime.enable"), /连接已断开/);
  globalThis.fetch = async () => new Response("[]");
  await assert.rejects(connectPage(9335), /没有 Codex 主页面/);
});

test("background bridge restores at startup and preserves a reload during injection", { timeout: 2000 }, async (t) => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "skin-bridge-test-"));
  const previous = process.env.CODEX_SKIN_STATE_ROOT;
  process.env.CODEX_SKIN_STATE_ROOT = state;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODEX_SKIN_STATE_ROOT;
    else process.env.CODEX_SKIN_STATE_ROOT = previous;
    await fs.rm(state, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(state, "preference.json"), '{"preset":"layla-starlight"}');
  const { startUiBridge } = await import("../plugins/codex-skin-switcher/server.mjs?bridge-test");
  const socket = new EventTarget();
  socket.readyState = WebSocket.OPEN;
  const commands = [];
  const applied = [];
  const first = Promise.withResolvers();
  const release = Promise.withResolvers();
  const reloaded = Promise.withResolvers();
  await startUiBridge({
    connect: async () => ({ socket, send: async (command) => { commands.push(command); } }),
    apply: async (preset) => {
      applied.push(preset);
      if (applied.length === 1) { first.resolve(); await release.promise; }
      else reloaded.resolve();
      return { ok: true };
    },
  });
  await first.promise;
  assert.deepEqual(commands, ["Runtime.enable", "Runtime.addBinding", "Page.enable"]);
  await fs.writeFile(path.join(state, "preference.json"), '{"preset":"paper-lantern"}');
  socket.dispatchEvent(new MessageEvent("message", { data: '{"method":"Page.loadEventFired"}' }));
  release.resolve();
  await reloaded.promise;
  assert.deepEqual(applied, ["layla-starlight", "paper-lantern"]);
});
