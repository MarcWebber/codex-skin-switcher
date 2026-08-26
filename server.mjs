#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const stateRoot = path.join(os.homedir(), "Library", "Application Support", "CodexSkinSwitcher");
const runtime = path.join(stateRoot, "runtime");
const themesRoot = path.join(stateRoot, "themes");
const preferenceFile = path.join(stateRoot, "preference.json");
const recoveryFile = path.join(stateRoot, "recovery.json");
const plistFile = path.join(os.homedir(), "Library", "LaunchAgents", "com.codex-skin-switcher.plist");
const label = "com.codex-skin-switcher";
const port = 9335;
const node = process.execPath;
const bundleId = "com.openai.codex";
const testedCodexVersion = "26.820.60940";
const creatorSkillPath = path.join(root, "skills", "skin-creator", "SKILL.md");

async function run(file, args, timeout = 20000) {
  try {
    const result = await execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.stdout || error.message).trim() };
  }
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next = `${file}.next-${process.pid}`;
  await fs.writeFile(next, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(next, file);
}

async function isCodexApp(candidate) {
  if (!candidate || !candidate.endsWith(".app")) return false;
  const plist = path.join(candidate, "Contents", "Info.plist");
  if (!await fs.stat(plist).catch(() => null)) return false;
  const result = await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist], 2000);
  return result.ok && result.stdout === bundleId;
}

async function findCodexApp() {
  const candidates = [
    process.env.CODEX_APP_PATH,
    "/Applications/ChatGPT.app",
  ].filter(Boolean);
  const located = await run("/usr/bin/mdfind", [`kMDItemCFBundleIdentifier == '${bundleId}'`], 3000);
  if (located.ok) candidates.push(...located.stdout.split("\n").map((item) => item.trim()).filter(Boolean));
  for (const candidate of [...new Set(candidates)]) {
    if (await isCodexApp(candidate)) return candidate;
  }
  return null;
}

async function recordRecovery(code, message) {
  await writeJson(recoveryFile, { code, message, at: new Date().toISOString() });
}

async function clearRecovery() {
  await fs.rm(recoveryFile, { force: true });
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

async function themes() {
  const result = await run(node, [path.join(runtime, "skin.mjs"), "themes", "--root", stateRoot]);
  if (!result.ok) throw new Error(result.error);
  return JSON.parse(result.stdout);
}

async function cdpReady() {
  const result = await run(node, [path.join(runtime, "skin.mjs"), "probe", "--root", stateRoot, "--port", String(port)], 3000);
  return result.ok;
}

async function liveSkin() {
  if (!await cdpReady()) return "native";
  const result = await run(node, [path.join(runtime, "skin.mjs"), "inspect", "--root", stateRoot, "--port", String(port)], 5000);
  if (!result.ok) return "native";
  return JSON.parse(result.stdout).id || "native";
}

function xml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function enableWatcher(app) {
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>
<string>${xml(path.join(runtime, "watch.sh"))}</string>
<string>${xml(stateRoot)}</string><string>${xml(node)}</string><string>${xml(app)}</string><string>${port}</string><string>${xml(creatorSkillPath)}</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
  await fs.writeFile(plistFile, plist);
  const domain = `gui/${process.getuid()}`;
  await run("/bin/launchctl", ["bootout", `${domain}/${label}`], 5000);
  const started = await run("/bin/launchctl", ["bootstrap", domain, plistFile], 5000);
  if (!started.ok && !started.error.includes("service already loaded")) throw new Error(started.error);
}

async function disableWatcher() {
  await run("/bin/launchctl", ["bootout", `gui/${process.getuid()}/${label}`], 5000);
  await fs.rm(plistFile, { force: true });
}

async function preference() {
  return (await readJson(preferenceFile, { preset: "native" })).preset || "native";
}

async function status(message = null) {
  const list = await themes();
  const desiredPreset = await preference();
  const ready = await cdpReady();
  const activePreset = ready ? await liveSkin() : "native";
  const appPath = await findCodexApp();
  const recovery = await readJson(recoveryFile, null);
  return {
    ok: true,
    platform: "darwin",
    activePreset,
    desiredPreset,
    port,
    cdpReady: ready,
    runtimeInstalled: true,
    restartRequired: desiredPreset !== "native" && !ready,
    appPath,
    testedCodexVersion,
    degraded: Boolean(recovery),
    recovery,
    presets: [
      { id: "native", label: "原生", description: "Codex 原生界面" },
      ...list,
    ],
    message: message || recovery?.message || (ready && activePreset !== "native" ? `当前皮肤：${list.find((item) => item.id === activePreset)?.label || activePreset}。` : "当前为 Codex 原生界面。"),
  };
}

async function setSkin(preset) {
  if (preset === "native") {
    await writeJson(preferenceFile, { preset: "native" });
    if (await cdpReady()) await run(node, [path.join(runtime, "skin.mjs"), "remove", "--root", stateRoot, "--port", String(port)]);
    await disableWatcher();
    await clearRecovery();
    return status("已恢复 Codex 原生界面；自动换肤也已关闭。");
  }
  const selected = (await themes()).find((item) => item.id === preset);
  if (!selected) throw new Error(`未知皮肤：${preset}`);
  await writeJson(preferenceFile, { preset });
  await clearRecovery();
  const app = await findCodexApp();
  const ready = await cdpReady();
  if (!app) {
    await disableWatcher();
    const recoveryMessage = `未找到 bundle id 为 ${bundleId} 的 Codex 应用；已停止自动启动，当前界面保持不变。可设置 CODEX_APP_PATH 后重试。`;
    await recordRecovery("codex-app-not-found", recoveryMessage);
    if (!ready) return status(recoveryMessage);
  } else {
    try {
      await enableWatcher(app);
    } catch (error) {
      const recoveryMessage = `自动换肤服务启动失败，已降级为本次会话切换：${error.message}`;
      await recordRecovery("watcher-start-failed", recoveryMessage);
    }
  }
  if (!ready) return status(`已保存 ${selected.label}；正常退出 Codex 后，插件会通过 LaunchServices 安全重开一次。失败时保留原生界面，不会循环重启。`);
  const applied = await run(node, [path.join(runtime, "skin.mjs"), "apply", "--root", stateRoot, "--port", String(port), "--theme", preset, "--creator-skill-path", creatorSkillPath], 12000);
  if (!applied.ok) {
    const recoveryMessage = `皮肤注入失败，已保留当前界面：${applied.error}`;
    await recordRecovery("skin-apply-failed", recoveryMessage);
    return status(recoveryMessage);
  }
  return status(`已切换到 ${selected.label}。`);
}

const statusSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" }, activePreset: { type: "string" }, desiredPreset: { type: "string" },
    port: { type: "integer" }, cdpReady: { type: "boolean" }, runtimeInstalled: { type: "boolean" },
    restartRequired: { type: "boolean" }, appPath: { type: ["string", "null"] }, testedCodexVersion: { type: "string" },
    degraded: { type: "boolean" }, recovery: { type: ["object", "null"] },
    presets: { type: "array", items: { type: "object" } }, message: { type: "string" },
  },
  required: ["ok", "activePreset", "desiredPreset", "port", "cdpReady", "runtimeInstalled", "restartRequired", "appPath", "testedCodexVersion", "degraded", "recovery", "presets", "message"],
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
  return {
    structuredContent: value,
    content: [{ type: "text", text: value.message }],
  };
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
      if (params.name === "get_skin_status") return toolResult(await status());
      if (params.name === "set_skin") return toolResult(await setSkin(String(params.arguments?.preset || "").trim()));
      throw new Error(`未知工具：${params.name}`);
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }], structuredContent: { ok: false, message: error.message } };
    }
  }
  if (method === "prompts/list") return { prompts: [] };
  throw Object.assign(new Error(`未知方法：${method}`), { code: -32601 });
}

await prepare();
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
