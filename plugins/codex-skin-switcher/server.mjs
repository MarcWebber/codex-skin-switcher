#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
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
const plistFile = path.join(os.homedir(), "Library", "LaunchAgents", "com.codex-skin-switcher.plist");
const defaultAppPath = "/Applications/ChatGPT.app";
const watcherLabel = "com.codex-skin-switcher";
const port = 9335;
const marketPort = Number(process.env.CODEX_SKIN_MARKET_PORT || 9336);
const marketRoot = (process.env.CODEX_SKIN_MARKET_URL || "https://raw.githubusercontent.com/MarcWebber/codex-skins/main").replace(/\/$/, "");
const node = process.execPath;
const creatorSkillPath = path.join(root, "skills", "skin-creator", "SKILL.md");
const themePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const marketRequired = ["meta.json", "theme.json", "extra.css", "art.png", "preview.png"];
const marketOptional = ["profile-art.png", "help-art.png", "home-card-a.png", "home-card-b.png", "home-card-c.png", "home-card-d.png"];

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
  const candidates = [process.env.CODEX_APP_PATH, defaultAppPath].filter(Boolean);
  for (const candidate of new Set(candidates)) {
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
  return run(node, [path.join(runtime, "skin.mjs"), command, "--root", stateRoot, "--port", String(port), "--market-port", String(marketPort), ...args], timeout);
}

async function themes() {
  const result = await callRuntime("themes");
  if (!result.ok) throw new Error(result.error);
  return JSON.parse(result.stdout);
}

async function cdpReady() {
  return (await callRuntime("probe", [], 3000)).ok;
}

async function liveSkin(ready) {
  if (!ready) return "native";
  const result = await callRuntime("inspect");
  if (!result.ok) return "native";
  return JSON.parse(result.stdout).id || "native";
}

async function download(file, optional = false) {
  const response = await fetch(file, { signal: AbortSignal.timeout(10000) });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`市场下载失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function marketSkins() {
  const manifest = JSON.parse((await download(`${marketRoot}/manifest.json?${Date.now()}`)).toString("utf8"));
  if (!Array.isArray(manifest) || !manifest.every((id) => typeof id === "string" && themePattern.test(id))) {
    throw new Error("市场 Manifest 格式错误");
  }
  const installed = new Set((await themes()).map((theme) => theme.id));
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
      installed: installed.has(id),
    };
  }));
}

async function installMarketSkin(id, activate = true) {
  if (!themePattern.test(id)) throw new Error("非法皮肤 ID");
  const destination = path.join(themesRoot, id);
  if (await fs.stat(destination).catch(() => null)) return activate ? setSkin(id) : { id, installed: true };
  const staging = path.join(themesRoot, `.market-${id}-${process.pid}`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  try {
    const base = `${marketRoot}/skins/${id}`;
    for (const file of marketRequired) await fs.writeFile(path.join(staging, file), await download(`${base}/${file}`));
    for (const file of marketOptional) {
      const data = await download(`${base}/${file}`, true);
      if (data) await fs.writeFile(path.join(staging, file), data);
    }
    const checked = await callRuntime("validate", ["--theme", id, "--folder", staging], 12000);
    if (!checked.ok) throw new Error(checked.error);
    await fs.rename(staging, destination);
    return activate ? setSkin(id) : { id, installed: true };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function startMarketApi() {
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    try {
      const url = new URL(request.url, `http://127.0.0.1:${marketPort}`);
      if (request.method === "GET" && url.pathname === "/market") {
        return sendJson(response, 200, { skins: await marketSkins() });
      }
      const match = request.method === "POST" && url.pathname.match(/^\/install\/([a-z0-9-]+)$/);
      if (match) return sendJson(response, 200, await installMarketSkin(match[1]));
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: error.message });
    }
  });
  server.on("error", (error) => {
    if (error.code !== "EADDRINUSE") process.stderr.write(`皮肤市场启动失败：${error.message}\n`);
  });
  server.listen(marketPort, "127.0.0.1");
}

function xml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function enableWatcher(app) {
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${watcherLabel}</string>
<key>ProgramArguments</key><array>
<string>${xml(path.join(runtime, "watch.sh"))}</string>
<string>${xml(stateRoot)}</string><string>${xml(node)}</string><string>${xml(app)}</string><string>${port}</string><string>${marketPort}</string><string>${xml(creatorSkillPath)}</string><string>${xml(plistFile)}</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
  await fs.writeFile(plistFile, plist);
  const domain = `gui/${process.getuid()}`;
  await run("/bin/launchctl", ["bootout", `${domain}/${watcherLabel}`], 5000);
  const started = await run("/bin/launchctl", ["bootstrap", domain, plistFile], 5000);
  if (!started.ok) throw new Error(`Watcher 启动失败：${started.error}`);
}

async function disableWatcher() {
  await run("/bin/launchctl", ["bootout", `gui/${process.getuid()}/${watcherLabel}`], 5000);
  await fs.rm(plistFile, { force: true });
}

async function status(message = null) {
  const list = await themes();
  const ready = await cdpReady();
  const activePreset = await liveSkin(ready);
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

async function setSkin(preset) {
  if (preset === "native") {
    await writeJson(preferenceFile, { preset });
    if (await cdpReady()) {
      const removed = await callRuntime("remove");
      if (!removed.ok) throw new Error(removed.error);
    }
    await disableWatcher();
    return status("已恢复 Codex 原生界面，Watcher 已关闭。");
  }

  const selected = (await themes()).find((item) => item.id === preset);
  if (!selected) throw new Error(`未知皮肤：${preset}`);
  await writeJson(preferenceFile, { preset });

  const app = await findCodexApp();
  if (!app) return status(`已保存 ${selected.label}，但未找到 ${defaultAppPath}；如安装在其他位置，请设置 CODEX_APP_PATH。`);
  await enableWatcher(app);

  if (!await cdpReady()) {
    return status(`已保存 ${selected.label}；正常退出 Codex 后，Watcher 会带本机调试参数重开一次并恢复主题。`);
  }

  const applied = await callRuntime("apply", ["--theme", preset, "--creator-skill-path", creatorSkillPath], 12000);
  if (!applied.ok) {
    await disableWatcher();
    throw new Error(`皮肤注入失败，Watcher 已关闭；下次请正常打开 Codex：${applied.error}`);
  }
  return status(`已切换到 ${selected.label}。`);
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
    serverInfo: { name: "codex-skin-switcher", version: "0.1.1" },
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
  if (process.platform === "darwin") {
    await prepare();
    startMarketApi();
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
}

export { installMarketSkin, marketSkins, prepare };
