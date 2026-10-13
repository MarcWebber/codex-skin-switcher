#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { connectPage } from "./cdp.mjs";
import { validateThemeVars } from "./skin.mjs";

const exec = promisify(execFile);
const source = fileURLToPath(import.meta.url);
const runtime = path.dirname(source);
const support = path.join(os.homedir(), "Library", "Application Support");
const state = path.join(support, "AntigravitySkinSwitcher");
const themesRoot = path.join(support, "CodexSkinSwitcher", "themes");
const preferenceFile = path.join(state, "preference.json");
const activePortFile = path.join(support, "Antigravity", "DevToolsActivePort");
const label = "com.antigravity-skin-switcher";
const plistFile = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
const binding = "__antigravitySkinRequest";
const themePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function parsePort(text) {
  const port = Number(text.split("\n")[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Antigravity 调试端口无效（macOS only）");
  return port;
}

export function matchesPage(item) {
  const url = new URL(item.url);
  return item.title === "Antigravity" && url.protocol === "https:" && url.hostname === "127.0.0.1";
}

async function connect() {
  const port = parsePort(await fs.readFile(activePortFile, "utf8"));
  return connectPage(port, 5000, matchesPage);
}

async function evaluate(connection, expression) {
  const result = await connection.send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}

async function localThemes() {
  const items = [];
  for (const entry of await fs.readdir(themesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !themePattern.test(entry.name)) continue;
    try {
      const theme = JSON.parse(await fs.readFile(path.join(themesRoot, entry.name, "theme.json"), "utf8"));
      if (typeof theme.label !== "string") continue;
      items.push({ id: entry.name, label: theme.label, order: Number(theme.order) || 100 });
    } catch {}
  }
  return items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export async function themeCss(id, folder = null) {
  if (id === "native") return "";
  if (!themePattern.test(id)) throw new Error("非法皮肤 ID");
  folder ||= path.join(themesRoot, id);
  const data = JSON.parse(await fs.readFile(path.join(folder, "theme.json"), "utf8"));
  validateThemeVars(data, id);
  const art = (await fs.readFile(path.join(folder, "art.png"))).toString("base64");
  const vars = Object.entries(data.vars).map(([key, value]) => `${key}:${value}`).join(";");
  // Chromium limits custom-property value size; backgrounds can exceed it.
  return `${await fs.readFile(path.join(runtime, "antigravity.css"), "utf8")}\nhtml[data-antigravity-skin]{${vars}}\nhtml[data-antigravity-skin] body::before{background-image:url("data:image/png;base64,${art}")}`;
}

export function applyCss(id, css) {
  document.getElementById("antigravity-skin-style")?.remove();
  if (id === "native") delete document.documentElement.dataset.antigravitySkin;
  else {
    const style = document.createElement("style");
    style.id = "antigravity-skin-style";
    style.textContent = css;
    document.head.append(style);
    document.documentElement.dataset.antigravitySkin = id;
  }
  window.__ANTIGRAVITY_SKIN__ = id;
  window.__antigravitySkinMenuResult?.(id);
  return { activePreset: id };
}

function mountMenu(themes, preset) {
  document.getElementById("antigravity-skin-menu")?.remove();
  const host = document.createElement("div");
  host.id = "antigravity-skin-menu";
  host.style.cssText = "position:fixed;top:48px;right:16px;z-index:1000";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host{font:12px -apple-system,BlinkMacSystemFont,sans-serif;color:#283052}
    label{display:flex;align-items:center;gap:6px;padding:5px 9px;background:#fafbff;border:1px solid #cbd4e8;border-radius:18px;box-shadow:0 2px 8px #2830520a}
    svg{width:15px;height:15px;flex-shrink:0;color:#789bdc}
    select{font:inherit;color:inherit;border:0;background:transparent;max-width:150px;cursor:pointer;outline-offset:3px}
    output{display:block;max-width:240px;background:#fafbff;color:#a33142;border-radius:6px;margin-top:4px;padding:4px}
    output:empty{display:none}
  </style><label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 1.8-4.2 1.8 1.8 0 0 1 1.3-3H18a3 3 0 0 0 3-3A8 8 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="11" cy="6.5" r=".8"/><circle cx="15.5" cy="7" r=".8"/></svg><select aria-label="切换皮肤（macOS only）"></select></label><output role="status"></output>`;
  const select = shadow.querySelector("select");
  const output = shadow.querySelector("output");
  for (const theme of [{ id: "native", label: "原生" }, ...themes]) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    select.append(option);
  }
  select.value = preset;
  window.__antigravitySkinMenuResult = (id, error = "") => {
    select.value = id;
    select.disabled = false;
    output.textContent = error;
  };
  select.addEventListener("change", () => {
    output.textContent = "";
    window.__antigravitySkinRequest(JSON.stringify({ preset: select.value }));
  });
  document.body.append(host);
}

async function readPreset() {
  try { return JSON.parse(await fs.readFile(preferenceFile, "utf8")).preset; }
  catch (error) { if (error.code === "ENOENT") return "native"; throw error; }
}

async function selectPreset(connection, id) {
  const css = await themeCss(id);
  const result = await evaluate(connection, `(${applyCss})(${JSON.stringify(id)},${JSON.stringify(css)})`);
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(preferenceFile, JSON.stringify({ preset: id }) + "\n");
  return result;
}

export async function attachSession(connection, { themes, preset, select }) {
  const { socket, send } = connection;
  let work = Promise.resolve();
  const queue = (job) => { work = work.then(job).catch((error) => console.error(`Antigravity 换肤失败：${error.message}`)); return work; };
  const restore = async () => {
    const id = await preset();
    await evaluate(connection, `(${mountMenu})(${JSON.stringify(await themes())},${JSON.stringify(id)})`);
    try { await select(id); }
    catch (error) {
      await evaluate(connection, `window.__antigravitySkinMenuResult?.("native",${JSON.stringify(error.message)})`);
      throw error;
    }
  };
  const closed = new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.method === "Page.loadEventFired") void queue(restore);
    if (message.method !== "Runtime.bindingCalled" || message.params.name !== binding) return;
    void queue(async () => {
      let error = "";
      try { await select(JSON.parse(message.params.payload).preset); }
      catch (failure) { error = failure.message; }
      await evaluate(connection, `window.__antigravitySkinMenuResult?.(${JSON.stringify(await preset())},${JSON.stringify(error)})`);
    });
  });
  await send("Runtime.enable");
  await send("Runtime.addBinding", { name: binding });
  await send("Page.enable");
  await queue(restore);
  await closed;
  await work;
}

async function watch() {
  for (;;) {
    let connection;
    try {
      connection = await connect();
      await attachSession(connection, { themes: localThemes, preset: readPreset, select: (id) => selectPreset(connection, id) });
    } catch {
      connection?.socket.close();
    }
    // Wait for the app's own launch; never launch, quit or restart Antigravity.
    await sleep(1000);
  }
}

export async function startService(run, domain, plist) {
  const target = `${domain}/${label}`;
  const loaded = await run("/bin/launchctl", ["print", target]).then(() => true, () => false);
  if (loaded) await run("/bin/launchctl", ["kickstart", "-k", target]);
  else await run("/bin/launchctl", ["bootstrap", domain, plist]);
}

async function install() {
  const installedRuntime = path.join(state, "runtime");
  await fs.mkdir(installedRuntime, { recursive: true });
  await fs.mkdir(themesRoot, { recursive: true });
  if (!await fs.stat(path.join(themesRoot, "layla-starlight")).catch(() => null)) {
    await fs.cp(path.join(runtime, "themes", "layla-starlight"), path.join(themesRoot, "layla-starlight"), { recursive: true });
  }
  for (const file of ["antigravity.mjs", "antigravity.css", "skin.mjs", "cdp.mjs"]) {
    const destination = path.join(installedRuntime, file);
    if (path.join(runtime, file) !== destination) await fs.copyFile(path.join(runtime, file), destination);
  }
  const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
    <key>Label</key><string>${label}</string>
    <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(installedRuntime, "antigravity.mjs"))}</string><string>watch</string></array>
    <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string>
    <key>StandardErrorPath</key><string>${xml(path.join(state, "watcher.log"))}</string>
  </dict></plist>`;
  const domain = `gui/${process.getuid()}`;
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  await fs.writeFile(plistFile, plist);
  await startService(exec, domain, plistFile);
  return { ok: true, platform: "macOS only", message: "Antigravity 换肤已安装；应用关闭时只等待，不会启动或重启应用。" };
}

async function uninstall() {
  const domain = `gui/${process.getuid()}`;
  const loaded = await exec("/bin/launchctl", ["print", `${domain}/${label}`]).then(() => true, () => false);
  if (loaded) await exec("/bin/launchctl", ["bootout", `${domain}/${label}`]);
  await fs.rm(plistFile, { force: true });
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(preferenceFile, '{"preset":"native"}\n');
  let connection;
  try {
    connection = await connect();
    await selectPreset(connection, "native");
    await evaluate(connection, 'document.getElementById("antigravity-skin-menu")?.remove(); delete window.__antigravitySkinMenuResult');
  } catch (error) { console.error(`应用未连接，后台服务已停用：${error.message}`); }
  finally { connection?.socket.close(); }
  return { ok: true, message: "已移除启动服务，保留本地主题与运行文件。" };
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === source) {
  try {
    if (process.platform !== "darwin") throw new Error("Antigravity 适配当前为 macOS only");
    const [command, id] = process.argv.slice(2);
    if (command === "watch") await watch();
    else if (command === "install") console.log(JSON.stringify(await install()));
    else if (command === "uninstall") console.log(JSON.stringify(await uninstall()));
    else if (command === "themes") console.log(JSON.stringify(await localThemes()));
    else if (command === "apply" || command === "status") {
      const connection = await connect();
      try {
        const result = command === "apply" ? await selectPreset(connection, id)
          : await evaluate(connection, '({activePreset:window.__ANTIGRAVITY_SKIN__ || "native", menu:!!document.getElementById("antigravity-skin-menu")})');
        console.log(JSON.stringify(result));
      } finally { connection.socket.close(); }
    } else throw new Error("用法：antigravity.mjs install|uninstall|watch|themes|status|apply <theme-id|native>（macOS only）");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
