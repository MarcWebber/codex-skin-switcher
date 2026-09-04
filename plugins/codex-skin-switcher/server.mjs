#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const sourceFile = fileURLToPath(import.meta.url);
const root = path.dirname(sourceFile);
const stateRoot = process.env.CODEX_SKIN_STATE_ROOT || path.join(os.homedir(), "Library", "Application Support", "CodexSkinSwitcher");
const runtime = path.join(stateRoot, "runtime");
const themesRoot = path.join(stateRoot, "themes");
const preferenceFile = path.join(stateRoot, "preference.json");
const pendingRelaunchFile = path.join(stateRoot, "pending-relaunch");
const plistFile = path.join(os.homedir(), "Library", "LaunchAgents", "com.codex-skin-switcher.plist");
const defaultAppPath = "/Applications/ChatGPT.app";
const watcherLabel = "com.codex-skin-switcher";
const port = 9335;
const marketRoot = (process.env.CODEX_SKIN_MARKET_URL || "https://raw.githubusercontent.com/MarcWebber/codex-skins/refs/heads/main").replace(/\/$/, "");
const uiBinding = "__codexSkinRequest";
const node = process.execPath;
const creatorSkillPath = path.join(root, "skills", "skin-creator", "SKILL.md");
const themePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const marketRequired = ["meta.json", "theme.json", "extra.css", "art.png", "preview.png"];
const marketOptional = ["profile-art.png", "help-art.png", "home-card-a.png", "home-card-b.png", "home-card-c.png", "home-card-d.png"];
let marketCatalogPromise = null;

function assertMacOS() {
  if (process.platform !== "darwin") throw new Error("Codex Skin Switcher 当前仅支持 macOS。");
}

async function run(file, args, timeout = 20000) {
  try {
    const result = await execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.stdout || error.message).trim() };
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next = `${file}.next-${process.pid}`;
  await fs.writeFile(next, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(next, file);
}

async function findCodexApp() {
  for (const candidate of [process.env.CODEX_APP_PATH, defaultAppPath]) {
    if (!candidate) continue;
    if (await fs.stat(candidate).catch(() => null)) return candidate;
  }
  return null;
}

async function prepare() {
  await fs.mkdir(runtime, { recursive: true });
  await fs.mkdir(themesRoot, { recursive: true });
  for (const file of ["skin.mjs", "watch.sh", "base.css"]) {
    await fs.copyFile(path.join(root, "runtime", file), path.join(runtime, file));
  }
  await fs.chmod(path.join(runtime, "watch.sh"), 0o755);
  const builtins = path.join(root, "runtime", "themes");
  for (const entry of await fs.readdir(builtins, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const destination = path.join(themesRoot, entry.name);
    if (!await fs.stat(destination).catch(() => null)) {
      await fs.cp(path.join(builtins, entry.name), destination, { recursive: true });
    }
  }
}

async function callRuntime(command, args = [], timeout = 5000) {
  return run(node, [path.join(runtime, "skin.mjs"), command, "--root", stateRoot, "--port", String(port), ...args], timeout);
}

async function themes() {
  const result = await callRuntime("themes");
  if (!result.ok) throw new Error(result.error);
  return JSON.parse(result.stdout);
}

async function bundledThemes() {
  const entries = await fs.readdir(path.join(root, "runtime", "themes"), { withFileTypes: true });
  return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

async function localThemes() {
  const [list, bundled] = await Promise.all([themes(), bundledThemes()]);
  return list.map((theme) => ({ ...theme, removable: !bundled.has(theme.id) }));
}

async function liveSkin() {
  const result = await callRuntime("inspect");
  if (!result.ok) return null;
  return JSON.parse(result.stdout).id || "native";
}

async function download(file, optional = false) {
  const response = await fetch(file, { signal: AbortSignal.timeout(10000) });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`市场下载失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function marketCatalog() {
  if (!marketCatalogPromise) marketCatalogPromise = (async () => {
    const manifest = JSON.parse((await download(`${marketRoot}/manifest.json?${Date.now()}`)).toString("utf8"));
    if (!Array.isArray(manifest) || !manifest.every((id) => typeof id === "string" && themePattern.test(id))) {
      throw new Error("市场 Manifest 格式错误");
    }
    return Promise.all(manifest.map(async (id) => {
      const base = `${marketRoot}/skins/${id}`;
      const [theme, meta] = await Promise.all([
        download(`${base}/theme.json`).then((value) => JSON.parse(value.toString("utf8"))),
        download(`${base}/meta.json`).then((value) => JSON.parse(value.toString("utf8"))),
      ]);
      if (typeof theme.label !== "string" || typeof theme.description !== "string" || typeof meta.version !== "string") {
        throw new Error(`${id} 元信息不完整`);
      }
      return {
        id,
        label: theme.label,
        description: theme.description,
        author: typeof meta.author === "string" ? meta.author : "",
        version: meta.version,
        preview: `${base}/preview.png`,
      };
    }));
  })().catch((error) => {
    marketCatalogPromise = null;
    throw error;
  });
  return marketCatalogPromise;
}

async function marketSkins() {
  const [catalog, installed, bundled] = await Promise.all([
    marketCatalog(),
    themes().then((items) => new Set(items.map((theme) => theme.id))),
    bundledThemes(),
  ]);
  return catalog.map((skin) => ({
    ...skin,
    installed: installed.has(skin.id),
    removable: installed.has(skin.id) && !bundled.has(skin.id),
  }));
}

async function installMarketSkin(id) {
  if (!themePattern.test(id)) throw new Error("非法皮肤 ID");
  const destination = path.join(themesRoot, id);
  if (await fs.stat(destination).catch(() => null)) return { id, installed: true };
  const staging = path.join(themesRoot, `.market-${id}-${process.pid}`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  try {
    const base = `${marketRoot}/skins/${id}`;
    await Promise.all(marketRequired.map(async (file) => {
      await fs.writeFile(path.join(staging, file), await download(`${base}/${file}`));
    }));
    await Promise.all(marketOptional.map(async (file) => {
      const data = await download(`${base}/${file}`, true);
      if (data) await fs.writeFile(path.join(staging, file), data);
    }));
    const checked = await callRuntime("validate", ["--theme", id, "--folder", staging], 12000);
    if (!checked.ok) throw new Error(checked.error);
    await fs.rename(staging, destination);
    return { id, installed: true };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function removeMarketSkin(id) {
  if (!themePattern.test(id)) throw new Error("非法皮肤 ID");
  if ((await bundledThemes()).has(id)) throw new Error("内置皮肤不能删除");
  const destination = path.join(themesRoot, id);
  if (!await fs.stat(destination).catch(() => null)) return { id, removed: true };
  const preferred = await fs.readFile(preferenceFile, "utf8")
    .then((value) => JSON.parse(value).preset)
    .catch(() => "native");
  if (preferred === id || await liveSkin() === id) await setSkin("native");
  await fs.rm(destination, { recursive: true, force: true });
  return { id, removed: true };
}

async function uiAction(action, id = "") {
  if (action === "local") return { themes: await localThemes() };
  if (action === "market") return { skins: await marketSkins() };
  if (action === "select") return setSkin(id);
  if (action === "install") return installMarketSkin(id);
  if (action === "remove") return removeMarketSkin(id);
  throw new Error("未知市场操作");
}

function startUiBridge() {
  let stopped = false;
  let timer = null;
  let socket = null;
  const retry = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, 1000);
    timer.unref();
  };
  const connect = async () => {
    if (stopped) return;
    try {
      const items = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) }).then((response) => response.json());
      const target = items.find((item) => item.type === "page" && item.url === "app://-/index.html");
      if (!target) return retry();
      const connection = new WebSocket(target.webSocketDebuggerUrl);
      socket = connection;
      await new Promise((resolve, reject) => {
        connection.addEventListener("open", resolve, { once: true });
        connection.addEventListener("error", reject, { once: true });
      });
      if (stopped) return connection.close();
      let requestId = 0;
      const send = (method, params = {}) => {
        if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ id: ++requestId, method, params }));
      };
      connection.addEventListener("close", () => {
        if (socket === connection) socket = null;
        retry();
      }, { once: true });
      connection.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.method !== "Runtime.bindingCalled" || message.params.name !== uiBinding) return;
        void (async () => {
          let request = {};
          let response;
          try {
            request = JSON.parse(message.params.payload);
            send("Runtime.evaluate", { expression: `window.postMessage(${JSON.stringify({ type: "codex-skin-accepted", requestId: request.requestId })}, "*")` });
            response = { type: "codex-skin-response", requestId: request.requestId, ok: true, ...await uiAction(request.action, request.id) };
          } catch (error) {
            response = { type: "codex-skin-response", requestId: request.requestId, ok: false, error: error.message };
          }
          send("Runtime.evaluate", { expression: `window.postMessage(${JSON.stringify(response)}, "*")` });
        })();
      });
      send("Runtime.enable");
      send("Runtime.addBinding", { name: uiBinding });
    } catch {
      socket = null;
      retry();
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (socket?.readyState === WebSocket.OPEN) socket.close();
  };
}

function xml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function ensureWatcher(app) {
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${watcherLabel}</string>
<key>ProgramArguments</key><array>
<string>${xml(path.join(runtime, "watch.sh"))}</string>
<string>${xml(stateRoot)}</string><string>${xml(node)}</string><string>${xml(app)}</string><string>${port}</string><string>${xml(creatorSkillPath)}</string><string>${xml(plistFile)}</string>
</array>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${watcherLabel}`;
  const loaded = (await run("/bin/launchctl", ["print", target], 5000)).ok;
  if (await fs.readFile(plistFile, "utf8").catch(() => null) !== plist || !loaded) {
    if (loaded) await run("/bin/launchctl", ["bootout", target], 5000);
    await fs.writeFile(plistFile, plist);
    const registered = await run("/bin/launchctl", ["bootstrap", domain, plistFile], 5000);
    if (!registered.ok) throw new Error(`Watcher 注册失败：${registered.error}`);
  }
  const started = await run("/bin/launchctl", ["kickstart", target], 5000);
  if (!started.ok) throw new Error(`Watcher 启动失败：${started.error}`);
}

function statusPayload(list, activePreset, ready, message) {
  return {
    activePreset,
    cdpReady: ready,
    presets: [
      { id: "native", label: "原生", description: "Codex 原生界面" },
      ...list,
    ],
    message: message || (!ready
      ? "当前 Codex 未开启皮肤端口。"
      : activePreset !== "native"
      ? `当前皮肤：${list.find((item) => item.id === activePreset)?.label || activePreset}。`
      : "当前为 Codex 原生界面。"),
  };
}

async function status() {
  const list = await themes();
  const activePreset = await liveSkin();
  return statusPayload(list, activePreset || "native", activePreset !== null);
}

async function setSkin(preset) {
  const list = await themes();
  const selected = preset === "native"
    ? { id: "native", label: "Codex 原生界面" }
    : list.find((item) => item.id === preset);
  if (!selected) throw new Error(`未知皮肤：${preset}`);
  await writeJson(preferenceFile, { preset });
  await fs.rm(pendingRelaunchFile, { force: true });

  const ready = await liveSkin() !== null;
  if (ready) {
    const applied = await callRuntime("apply", ["--theme", preset, "--creator-skill-path", creatorSkillPath], 12000);
    if (!applied.ok) throw new Error(`皮肤注入失败：${applied.error}`);
    return statusPayload(list, preset, true, preset === "native" ? "已恢复 Codex 原生界面，皮肤入口保持可用。" : `已切换到 ${selected.label}。`);
  }

  if (preset === "native") {
    return statusPayload(list, "native", false, "已保存原生界面；当前 Codex 未开启皮肤端口。");
  }

  const app = await findCodexApp();
  if (!app) return statusPayload(list, "native", false, `已保存 ${selected.label}，但未找到 ${defaultAppPath}；如安装在其他位置，请设置 CODEX_APP_PATH。`);
  await fs.writeFile(pendingRelaunchFile, "");
  try {
    await ensureWatcher(app);
  } catch (error) {
    await fs.rm(pendingRelaunchFile, { force: true });
    throw error;
  }

  return statusPayload(list, "native", false, `已保存 ${selected.label}；正常退出 Codex 后，Watcher 会带本机调试参数重开并恢复皮肤。`);
}

const statusSchema = {
  type: "object",
  properties: {
    activePreset: { type: "string" },
    cdpReady: { type: "boolean" },
    presets: { type: "array", items: { type: "object" } },
  },
  required: ["activePreset", "cdpReady", "presets"],
  additionalProperties: false,
};

const tools = [
  {
    name: "get_skin_status", title: "Get Codex skin status", description: "Read the active skin and available local themes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema: statusSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "set_skin", title: "Set Codex skin", description: "Apply a local theme or restore preset native.",
    inputSchema: { type: "object", properties: { preset: { type: "string", minLength: 1 } }, required: ["preset"], additionalProperties: false },
    outputSchema: statusSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function toolResult(value) {
  const { message, ...structuredContent } = value;
  return { structuredContent, content: [{ type: "text", text: message }] };
}

async function handle(method, params = {}) {
  if (method === "initialize") return {
    protocolVersion: params.protocolVersion || "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "codex-skin-switcher", version: "0.1.2" },
  };
  if (method === "ping") return {};
  if (method === "tools/list") return { tools };
  if (method === "tools/call") {
    try {
      assertMacOS();
      if (params.name === "get_skin_status") return toolResult(await status());
      if (params.name === "set_skin") return toolResult(await setSkin(String(params.arguments?.preset || "").trim()));
      throw new Error(`未知工具：${params.name}`);
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  }
  throw Object.assign(new Error(`未知方法：${method}`), { code: -32601 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === sourceFile) {
  let stopBridge = () => {};
  if (process.platform === "darwin") {
    await prepare();
    stopBridge = startUiBridge();
    if (!process.env.CODEX_SKIN_STATE_ROOT) {
      const app = await findCodexApp();
      if (app) await ensureWatcher(app);
    }
  }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      continue;
    }
    if (request.id === undefined) continue;
    try {
      const result = await handle(request.method, request.params);
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: error.code || -32603, message: error.message } })}\n`);
    }
  }
  stopBridge();
}

export { installMarketSkin, localThemes, marketSkins, prepare, removeMarketSkin };
