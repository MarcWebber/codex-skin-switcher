#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const command = args.shift();
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const defaultStateRoot = path.join(os.homedir(), "Library", "Application Support", "CodexSkinSwitcher");
const stateRoot = path.resolve(option("--root", defaultStateRoot));
const port = Number(option("--port", 9335));
const marketPort = Number(option("--market-port", 9336));
const creatorSkillPath = option("--creator-skill-path", "");
const themePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const requiredVars = [
  "--skin-canvas", "--skin-surface", "--skin-sidebar", "--skin-control",
  "--skin-text", "--skin-muted", "--skin-accent", "--skin-border",
  "--skin-font", "--skin-code-font", "--skin-art-position", "--skin-art-opacity",
];
const optionalArtFiles = [
  "profile-art.png", "help-art.png",
  "home-card-a.png", "home-card-b.png", "home-card-c.png", "home-card-d.png",
];

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function assetUrl(file) {
  return `app://fs/@fs${encodeURI(file)}`;
}

async function listThemes() {
  const root = path.join(stateRoot, "themes");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const themes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !themePattern.test(entry.name)) continue;
    try {
      const data = await readJson(path.join(root, entry.name, "theme.json"));
      if (typeof data.label !== "string" || typeof data.description !== "string") continue;
      themes.push({ id: entry.name, label: data.label, description: data.description, order: Number(data.order) || 100 });
    } catch {}
  }
  return themes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, "en"));
}

function validateExtraCss(css, id) {
  if (css.includes("@")) throw new Error(`${id}/extra.css 不允许 @ 规则`);
  const scope = `html[data-codex-skin="${id}"]`;
  for (const match of css.matchAll(/(?:^|})\s*([^{}]+)\s*\{/g)) {
    for (const selector of match[1].split(",")) {
      if (!selector.trim().startsWith(scope)) throw new Error(`${id}/extra.css 选择器未以 ${scope} 开头`);
    }
  }
}

async function loadTheme(id, customFolder = null) {
  if (!themePattern.test(id)) throw new Error(`非法主题名：${id}`);
  const folder = customFolder ? path.resolve(customFolder) : path.join(stateRoot, "themes", id);
  const data = await readJson(path.join(folder, "theme.json"));
  if (!data.vars || typeof data.vars !== "object" || Array.isArray(data.vars)) throw new Error(`${id}/theme.json 缺少 vars`);
  for (const key of requiredVars) if (typeof data.vars[key] !== "string") throw new Error(`${id}/theme.json 缺少 ${key}`);
  for (const [key, value] of Object.entries(data.vars)) {
    if (!/^--skin-[a-z0-9-]+$/.test(key) || typeof value !== "string" || /[{};]/.test(value)) {
      throw new Error(`${id}/theme.json 含非法 CSS 变量`);
    }
  }
  const extra = await fs.readFile(path.join(folder, "extra.css"), "utf8");
  validateExtraCss(extra, id);
  const artFile = path.join(folder, "art.png");
  const art = await fs.readFile(artFile);
  const optionalArt = new Map(await Promise.all(optionalArtFiles.map(async (file) => [
    file,
    await fs.readFile(path.join(folder, file)).catch(() => null),
  ])));
  const base = await fs.readFile(path.join(stateRoot, "runtime", "base.css"), "utf8");
  const vars = Object.entries(data.vars).map(([key, value]) => `${key}:${value}`).join(";");
  const artUrl = assetUrl(artFile);
  const optionalUrl = (file, fallback) => optionalArt.get(file) ? assetUrl(path.join(folder, file)) : fallback;
  const profileArtUrl = optionalUrl("profile-art.png", artUrl);
  const helpArtUrl = optionalUrl("help-art.png", artUrl);
  const homeCardAUrl = optionalUrl("home-card-a.png", artUrl);
  const homeCardBUrl = optionalUrl("home-card-b.png", homeCardAUrl);
  const homeCardCUrl = optionalUrl("home-card-c.png", homeCardBUrl);
  const homeCardDUrl = optionalUrl("home-card-d.png", homeCardCUrl);
  const css = `${base}\nhtml[data-codex-skin="${id}"]{${vars};--skin-art:url("${artUrl}");--skin-profile-art:url("${profileArtUrl}");--skin-help-art:url("${helpArtUrl}");--skin-home-card-art-a:url("${homeCardAUrl}");--skin-home-card-art-b:url("${homeCardBUrl}");--skin-home-card-art-c:url("${homeCardCUrl}");--skin-home-card-art-d:url("${homeCardDUrl}")}\n${extra}`;
  const hash = crypto.createHash("sha256").update(css).update(art);
  for (const data of optionalArt.values()) if (data) hash.update(data);
  const fingerprint = hash.digest("hex");
  return { id, label: data.label || id, css, fingerprint };
}

async function validate(id) {
  const theme = await loadTheme(id, option("--folder"));
  return { ok: true, id: theme.id, fingerprint: theme.fingerprint };
}

async function targets() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(900) });
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

function isMain(item) {
  return item.type === "page" && item.url === "app://-/index.html";
}

async function evaluate(expression) {
  if (args.includes("--dry-run")) {
    new Function(expression);
    return { ok: true, dryRun: true };
  }
  const target = (await targets()).find(isMain);
  if (!target) throw new Error(`端口 ${port} 没有 Codex 主页面`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP 调用超时")), 8000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  socket.close();
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}

async function apply(id) {
  const bundled = await Promise.all((await listThemes()).map((theme) => loadTheme(theme.id)));
  if (id !== "native" && !bundled.some((theme) => theme.id === id)) throw new Error(`未知皮肤：${id}`);
  const creatorSkill = {
    name: "codex-skin-switcher:skin-creator",
    displayName: "skin-creator",
    path: creatorSkillPath,
    description: "Create a new local macOS Codex skin from one prompt or attached visual references.",
    iconSmall: "",
  };
  const runtimeFingerprint = crypto.createHash("sha256").update(await fs.readFile(new URL(import.meta.url))).digest("hex");
  const bundleFingerprint = crypto.createHash("sha256").update(JSON.stringify({
    themes: bundled.map((theme) => theme.fingerprint),
    runtimeFingerprint,
    creatorSkillPath,
    marketPort,
  })).digest("hex");
  return evaluate(`(() => {
    const requested = ${JSON.stringify(id)};
    const themes = ${JSON.stringify(bundled)};
    const creatorSkill = ${JSON.stringify(creatorSkill)};
    const marketUrl = ${JSON.stringify(`http://127.0.0.1:${marketPort}`)};
    const bundleFingerprint = ${JSON.stringify(bundleFingerprint)};
    const key = "__CODEX_SKIN__";
    const styleId = "codex-skin-style";
    const toolbarId = "codex-skin-toolbar";
    const collapsedKey = "codex-skin-toolbar-collapsed";
    const current = window[key];
    if (current?.bundleFingerprint === bundleFingerprint && document.getElementById(toolbarId)) {
      current.activate(requested);
      return { ok: true, id: current.id, unchanged: true };
    }
    current?.cleanup?.();
    const style = document.createElement("style");
    style.id = styleId;
    (document.head || document.documentElement).appendChild(style);
    const host = document.createElement("div");
    host.id = toolbarId;
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = \`<style>
      :host{position:fixed;top:52px;left:50%;z-index:2147483646;transform:translateX(-50%);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--skin-text,#283052);pointer-events:auto;-webkit-app-region:no-drag}
      button{font:inherit;cursor:pointer;pointer-events:auto;touch-action:manipulation;-webkit-app-region:no-drag}
      #bar{display:flex;align-items:center;gap:4px}
      #toggle,#collapse{height:28px;border:1px solid color-mix(in srgb,var(--skin-accent,#789bdc) 25%,rgba(103,112,169,.22));color:var(--skin-text,#283052);background:var(--skin-control,rgba(253,253,255,.96));box-shadow:0 5px 16px color-mix(in srgb,var(--skin-accent,#789bdc) 12%,transparent);backdrop-filter:blur(12px)}
      #toggle{display:flex;align-items:center;gap:5px;padding:0 8px;border-radius:999px;font-size:12px}
      #toggle:hover,#collapse:hover{background:color-mix(in srgb,var(--skin-accent,#789bdc) 12%,var(--skin-control,#fdfdff))}
      #palette{width:14px;height:14px;color:var(--skin-accent,#789bdc)}
      #label{max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--skin-muted,#59617f)}
      #chevron{width:10px;height:10px;color:var(--skin-muted,#858ba7)}
      #collapse{width:24px;padding:0;display:grid;place-items:center;border-radius:50%;color:var(--skin-muted,#737a99)}
      #collapse svg{width:12px;height:12px}
      :host([data-collapsed]) #toggle{width:28px;padding:0;justify-content:center}
      :host([data-collapsed]) #label,:host([data-collapsed]) #chevron,:host([data-collapsed]) #collapse{display:none}
      #panel{position:absolute;top:34px;left:50%;width:208px;padding:7px;transform:translateX(-50%);border:1px solid color-mix(in srgb,var(--skin-accent,#789bdc) 22%,rgba(103,112,169,.20));border-radius:13px;background:var(--skin-control,rgba(253,253,255,.98));box-shadow:0 14px 36px color-mix(in srgb,var(--skin-accent,#789bdc) 18%,transparent);backdrop-filter:blur(16px);pointer-events:auto}
      #panel[data-view=market]{width:368px}
      #panel[hidden]{display:none}
      #panel [hidden]{display:none}
      #header,#marketHeader{height:26px;display:flex;align-items:center;padding:0 3px 4px 6px}
      #title,#marketTitle{flex:1;color:var(--skin-muted,#747b9b);font-size:10px;font-weight:700;letter-spacing:.04em}
      #market,#back{width:24px;height:24px;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:7px;color:var(--skin-muted,#737a99);background:transparent}
      #market:hover,#back:hover{border-color:color-mix(in srgb,var(--skin-accent,#789bdc) 22%,transparent);background:color-mix(in srgb,var(--skin-accent,#789bdc) 10%,var(--skin-control,#fdfdff));color:var(--skin-accent,#789bdc)}
      #market svg,#back svg{width:14px;height:14px}
      #marketHeader{gap:4px;padding-left:1px}
      .item{width:100%;display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid transparent;border-radius:8px;color:var(--skin-text,#3a4265);background:transparent;text-align:left;font-size:12px}
      .item:hover,.item[aria-pressed=true]{border-color:color-mix(in srgb,var(--skin-accent,#789bdc) 20%,transparent);background:color-mix(in srgb,var(--skin-accent,#789bdc) 11%,var(--skin-control,#fdfdff))}
      .mark{visibility:hidden;color:var(--skin-accent,#789bdc);font-weight:800}
      .item[aria-pressed=true] .mark{visibility:visible}
      #create{width:auto;height:27px;display:flex;align-items:center;justify-content:center;gap:5px;margin:6px auto 0;padding:0 9px;border:0;border-radius:8px;color:var(--skin-on-accent,var(--skin-text,#283052));background:linear-gradient(135deg,color-mix(in srgb,var(--skin-accent,#789bdc) 48%,white),var(--skin-accent,#a9c3ef));font-size:11px;font-weight:700}
      #create svg{width:12px;height:12px}
      #search{height:30px;display:flex;align-items:center;gap:6px;margin:1px 3px 7px;padding:0 9px;border:1px solid color-mix(in srgb,var(--skin-accent,#789bdc) 22%,var(--skin-border,transparent));border-radius:9px;background:color-mix(in srgb,var(--skin-control,#fdfdff) 92%,var(--skin-accent,#789bdc));color:var(--skin-muted,#747b9b)}
      #search svg{width:13px;height:13px;flex:none}
      #query{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--skin-text,#283052);font:inherit;font-size:11px}
      #query::placeholder{color:var(--skin-muted,#858ba7)}
      #marketList{max-height:326px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--skin-accent,#789bdc) 35%,transparent) transparent}
      .skin{display:grid;grid-template-columns:76px minmax(0,1fr);gap:9px;margin:0 3px 7px;padding:7px;border:1px solid color-mix(in srgb,var(--skin-accent,#789bdc) 18%,var(--skin-border,transparent));border-radius:10px;background:color-mix(in srgb,var(--skin-control,#fdfdff) 94%,var(--skin-accent,#789bdc))}
      .preview{width:76px;height:52px;object-fit:cover;border-radius:7px;background:var(--skin-surface,#f4f5fb)}
      .skinBody{min-width:0;display:flex;flex-direction:column;justify-content:center}
      .skinName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--skin-text,#283052);font-size:12px;font-weight:700}
      .skinDescription{margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--skin-muted,#747b9b);font-size:9px}
      .skinActions{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-top:6px}
      .version{padding:2px 5px;border-radius:999px;background:color-mix(in srgb,var(--skin-accent,#789bdc) 10%,transparent);color:var(--skin-muted,#747b9b);font-size:9px}
      .install{min-width:47px;height:23px;padding:0 8px;border:1px solid color-mix(in srgb,var(--skin-accent,#789bdc) 24%,transparent);border-radius:7px;background:var(--skin-accent,#789bdc);color:white;font-size:10px;font-weight:700}
      .install:disabled{cursor:default;background:color-mix(in srgb,var(--skin-accent,#789bdc) 12%,var(--skin-control,#fdfdff));color:var(--skin-accent,#789bdc)}
      #marketStatus{padding:10px 6px;text-align:center;color:var(--skin-muted,#747b9b);font-size:10px}
      #retry{height:24px;margin-left:5px;padding:0 7px;border:1px solid var(--skin-border,rgba(103,112,169,.2));border-radius:7px;background:var(--skin-control,#fdfdff);color:var(--skin-text,#283052);font-size:10px}
    </style><div id="bar"><button type="button" id="toggle" aria-label="打开皮肤选择"><svg id="palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3a9 9 0 0 0 0 18h1.3a1.7 1.7 0 0 0 1.1-3c-.7-.6-.3-1.8.6-1.8h1A5 5 0 0 0 21 11c0-4.4-4-8-9-8Z"/><circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="6.8" r="1" fill="currentColor" stroke="none"/><circle cx="14.2" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="10.2" r="1" fill="currentColor" stroke="none"/></svg><span id="label">原生</span><svg id="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 6 4 4 4-4"/></svg></button><button type="button" id="collapse" aria-label="收起皮肤工具" title="收起为调色板图标"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.2 8s2.1-3 5.8-3 5.8 3 5.8 3-2.1 3-5.8 3-5.8-3-5.8-3Z"/><path d="m3 3 10 10"/></svg></button></div><div id="panel" hidden><div id="switchView"><div id="header"><div id="title">切换皮肤</div><button type="button" id="market" aria-label="打开皮肤市场" title="皮肤市场"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9h16v11H4zM3 9l2-5h14l2 5"/><path d="M8 20v-6h4v6M3 9c0 1.3 1 2 2.3 2S8 10.3 8 9c0 1.3 1 2 2.7 2S13 10.3 13 9c0 1.3 1 2 2.7 2S19 10.3 19 9"/></svg></button></div><div id="themes"></div><button type="button" id="create" aria-label="用提示词创建皮肤" title="用提示词创建皮肤"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 2v12M2 8h12"/></svg><span>创建皮肤</span></button></div><div id="marketView" hidden><div id="marketHeader"><button type="button" id="back" aria-label="返回本地皮肤"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m10 3-5 5 5 5"/></svg></button><div id="marketTitle">皮肤市场</div></div><label id="search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input id="query" type="search" placeholder="搜索皮肤"></label><div id="marketStatus"></div><div id="marketList"></div></div></div>\`;
    shadow.addEventListener("pointerdown", (event) => event.stopPropagation());
    const toggle = shadow.getElementById("toggle");
    const panel = shadow.getElementById("panel");
    const title = shadow.getElementById("title");
    const label = shadow.getElementById("label");
    const list = shadow.getElementById("themes");
    const collapse = shadow.getElementById("collapse");
    const switchView = shadow.getElementById("switchView");
    const marketView = shadow.getElementById("marketView");
    const marketList = shadow.getElementById("marketList");
    const marketStatus = shadow.getElementById("marketStatus");
    const query = shadow.getElementById("query");
    const options = [{ id: "native", label: "原生" }, ...themes];
    let marketItems = [];
    const activate = (nextId) => {
      const next = themes.find((theme) => theme.id === nextId);
      if (next) {
        style.textContent = next.css;
        document.documentElement.dataset.codexSkin = next.id;
      } else {
        style.textContent = "";
        delete document.documentElement.dataset.codexSkin;
      }
      window[key].id = next?.id || "native";
      window[key].fingerprint = next?.fingerprint || "toolbar-native";
      label.textContent = next?.label || "原生";
      for (const button of list.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.id === (next?.id || "native")));
      panel.hidden = true;
    };
    const select = async (nextId) => {
      const response = await fetch(marketUrl + "/select/" + encodeURIComponent(nextId), { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "切换失败");
    };
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item";
      button.dataset.id = option.id;
      button.innerHTML = "<span></span><span class=mark>✓</span>";
      button.firstElementChild.textContent = option.label;
      button.onclick = async () => {
        title.textContent = "切换中…";
        try {
          await select(option.id);
          title.textContent = "切换皮肤";
        } catch (error) {
          title.textContent = error.message;
        }
      };
      list.appendChild(button);
    }
    const setCollapsed = (collapsed) => {
      host.toggleAttribute("data-collapsed", collapsed);
      localStorage.setItem(collapsedKey, collapsed ? "1" : "0");
      toggle.setAttribute("aria-label", collapsed ? "展开皮肤工具" : "打开皮肤选择");
      toggle.title = collapsed ? "展开皮肤工具" : "";
      if (collapsed) panel.hidden = true;
    };
    const showLocal = () => {
      panel.dataset.view = "local";
      switchView.hidden = false;
      marketView.hidden = true;
    };
    const renderMarket = () => {
      const term = query.value.trim().toLocaleLowerCase();
      const visible = marketItems.filter((item) => [item.id, item.label, item.description, item.author].join(" ").toLocaleLowerCase().includes(term));
      marketList.replaceChildren();
      marketStatus.hidden = visible.length > 0;
      marketStatus.textContent = visible.length ? "" : "没有找到匹配的皮肤";
      for (const item of visible) {
        const card = document.createElement("div");
        card.className = "skin";
        const image = document.createElement("img");
        image.className = "preview";
        image.src = item.preview;
        image.alt = "";
        const body = document.createElement("div");
        body.className = "skinBody";
        const name = document.createElement("div");
        name.className = "skinName";
        name.textContent = item.label;
        const description = document.createElement("div");
        description.className = "skinDescription";
        description.textContent = item.description;
        const actions = document.createElement("div");
        actions.className = "skinActions";
        const version = document.createElement("span");
        version.className = "version";
        version.textContent = "v" + item.version.replace(/^v/i, "");
        const install = document.createElement("button");
        install.type = "button";
        install.className = "install";
        install.textContent = item.installed ? "已安装" : "下载";
        install.disabled = item.installed;
        install.onclick = async () => {
          install.disabled = true;
          install.textContent = "下载中";
          try {
            const response = await fetch(marketUrl + "/install/" + encodeURIComponent(item.id), { method: "POST" });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "下载失败");
            item.installed = true;
            renderMarket();
          } catch (error) {
            install.disabled = false;
            install.textContent = "重试";
            marketStatus.hidden = false;
            marketStatus.textContent = error.message;
          }
        };
        actions.append(version, install);
        body.append(name, description, actions);
        card.append(image, body);
        marketList.appendChild(card);
      }
    };
    const loadMarket = async () => {
      marketList.replaceChildren();
      marketStatus.hidden = false;
      marketStatus.textContent = "正在加载…";
      try {
        const response = await fetch(marketUrl + "/market?" + Date.now(), { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(result.skins)) throw new Error(result.error || "市场加载失败");
        marketItems = result.skins;
        renderMarket();
      } catch (error) {
        marketStatus.replaceChildren(document.createTextNode("市场加载失败"));
        const retry = document.createElement("button");
        retry.id = "retry";
        retry.type = "button";
        retry.textContent = "重试";
        retry.onclick = loadMarket;
        marketStatus.appendChild(retry);
      }
    };
    toggle.onclick = () => {
      if (host.hasAttribute("data-collapsed")) return setCollapsed(false);
      if (panel.hidden) {
        showLocal();
        panel.hidden = false;
      } else panel.hidden = true;
    };
    collapse.onclick = () => setCollapsed(true);
    shadow.getElementById("market").onclick = () => {
      panel.dataset.view = "market";
      switchView.hidden = true;
      marketView.hidden = false;
      query.value = "";
      loadMarket();
    };
    shadow.getElementById("back").onclick = showLocal;
    query.oninput = renderMarket;
    shadow.getElementById("create").onclick = () => {
      panel.hidden = true;
      const editor = document.querySelector('[data-codex-composer="true"]');
      if (!editor || !creatorSkill.path) return;
      if (editor.textContent.trim()) return;
      editor.focus();
      const sendToComposer = (data) => window.dispatchEvent(new MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: window,
      }));
      sendToComposer({ type: "codex-micro-insert-skill-mention", skill: creatorSkill });
      sendToComposer({ type: "codex-micro-insert-composer-text", text: "风格：" });
    };
    const cleanup = () => {
      document.getElementById(styleId)?.remove();
      document.getElementById(toolbarId)?.remove();
      delete document.documentElement.dataset.codexSkin;
      delete window[key];
      return true;
    };
    window[key] = { id: requested, fingerprint: null, bundleFingerprint, activate, cleanup };
    const initial = requested;
    activate(initial);
    setCollapsed(localStorage.getItem(collapsedKey) === "1");
    return { ok: true, id: initial, unchanged: false };
  })()`);
}

async function inspect() {
  return evaluate(`({ id: window.__CODEX_SKIN__?.id || "native", fingerprint: window.__CODEX_SKIN__?.fingerprint || null })`);
}

if (command === "themes") console.log(JSON.stringify(await listThemes(), null, 2));
else if (command === "validate") console.log(JSON.stringify(await validate(option("--theme"))));
else if (command === "probe") process.exit((await targets()).some(isMain) ? 0 : 1);
else if (command === "inspect") console.log(JSON.stringify(await inspect()));
else if (command === "apply") console.log(JSON.stringify(await apply(option("--theme"))));
else throw new Error("用法：skin.mjs themes|validate|probe|inspect|apply");
