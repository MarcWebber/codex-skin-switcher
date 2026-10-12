import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { markSidebarMenu } from "../plugins/codex-skin-switcher/runtime/skin.mjs";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "codex-skin-switcher");
const runtime = path.join(plugin, "runtime", "skin.mjs");

test("sidebar menu art follows the native trigger, independent of avatar, language and placement", () => {
  for (const kind of ["profile", "help", "unrelated", "outside", "missing"]) {
    const menu = {
      dataset: { side: "right" },
      getAttribute(name) {
        assert.equal(name, "aria-labelledby");
        return "native-trigger-42";
      },
    };
    const footer = {
      closest(selector) {
        assert.equal(selector, ".app-shell-left-panel, [data-app-navigation-rail]");
        return kind === "outside" ? null : {};
      },
      querySelector(selector) {
        assert.equal(selector, "div.sidebar-item");
        return kind === "unrelated" ? null : {};
      },
    };
    const trigger = {
      // The new ButtonInner/avatar wrappers need no inspection or modification.
      closest(selector) {
        if (selector === ".relative.shrink-0") return footer;
        if (selector === "div.sidebar-item") return kind === "profile" ? {} : null;
        if (selector === ".empty\\:hidden") return kind === "help" ? {} : null;
        assert.fail(`unexpected selector: ${selector}`);
      },
    };
    markSidebarMenu(menu, {
      getElementById(id) {
        assert.equal(id, "native-trigger-42");
        return kind === "missing" ? null : trigger;
      },
    });
    assert.equal(menu.dataset.codexSkinMenu, ["profile", "help"].includes(kind) ? kind : undefined);
  }
});

test("runtime validates and builds native and selected themes", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-runtime-test-"));
  try {
    await fs.mkdir(path.join(state, "runtime"));
    await fs.cp(path.join(plugin, "runtime", "base.css"), path.join(state, "runtime", "base.css"));
    await fs.cp(path.join(plugin, "runtime", "themes"), path.join(state, "themes"), { recursive: true });
    const incomplete = path.join(state, "themes", "inactive-theme");
    await fs.mkdir(incomplete);
    await fs.writeFile(path.join(incomplete, "theme.json"), JSON.stringify({ label: "未启用", description: "缺少资源的主题" }));

    const run = async (...args) => JSON.parse((await exec(process.execPath, [runtime, ...args, "--root", state])).stdout);
    const themes = await run("themes");
    assert.ok(themes.some((theme) => theme.id === "layla-starlight"));
    const validated = await run("validate", "--theme", "layla-starlight");
    assert.match(validated.fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(await run("apply", "--dry-run", "--theme", "native"), { ok: true, dryRun: true });
    assert.deepEqual(await run("apply", "--dry-run", "--theme", "layla-starlight"), { ok: true, dryRun: true });

    const source = await fs.readFile(runtime, "utf8");
    const bundleFingerprint = crypto.createHash("sha256").update(JSON.stringify({
      themes: themes.map((theme) => [theme.id, theme.label, theme.id === "layla-starlight" ? validated.fingerprint : undefined]),
      active: validated.fingerprint,
      runtimeFingerprint: crypto.createHash("sha256").update(source).digest("hex"),
      creatorSkillPath: "",
    })).digest("hex");
    await fs.writeFile(path.join(state, "runtime", "skin.mjs"), source);
    // Evaluate the actual injected script against an already-applied page.
    await fs.writeFile(path.join(state, "runtime", "cdp.mjs"), `
      import { runInNewContext } from 'node:vm';
      export async function connectPage() {
        return { socket: { close() {} }, async send(method, { expression }) {
          const value = runInNewContext(expression, {
            window: { __CODEX_SKIN__: {
              id: 'layla-starlight', bundleFingerprint: ${JSON.stringify(bundleFingerprint)},
              activate() { throw new Error('Duplicate restoration rewrote the active skin'); },
              cleanup() { throw new Error('Duplicate restoration rebuilt the toolbar'); },
            } },
            document: { getElementById() { return {}; } },
          });
          return { result: { value } };
        } };
      }
    `);
    const restored = JSON.parse((await exec(process.execPath, [path.join(state, "runtime", "skin.mjs"),
      "apply", "--theme", "layla-starlight", "--root", state])).stdout);
    assert.deepEqual(restored, { ok: true, id: "layla-starlight", unchanged: true });
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("installed themes and native remain switchable when the background service is unavailable", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-offline-test-"));
  try {
    await fs.cp(path.join(plugin, "runtime"), path.join(state, "runtime"), { recursive: true });
    await fs.cp(path.join(plugin, "runtime", "themes"), path.join(state, "themes"), { recursive: true });
    await fs.writeFile(path.join(state, "runtime", "cdp.mjs"), `
      import assert from 'node:assert/strict';
      import { runInNewContext } from 'node:vm';
      export async function connectPage() {
        return { socket: { close() {} }, async send(method, { expression }) {
          const ids = new Map();
          class Element {
            children = []; dataset = {}; style = {}; attributes = new Map();
            textContent = ''; hidden = false;
            append(...children) { children.forEach(child => this.appendChild(child)); }
            appendChild(child) { this.children.push(child); if (child.id) ids.set(child.id, child); return child; }
            replaceChildren(...children) { this.children = []; this.append(...children); }
            attachShadow() { this.shadowRoot = new Element(); return this.shadowRoot; }
            getElementById(id) {
              if (!ids.has(id)) ids.set(id, Object.assign(new Element(), { id }));
              return ids.get(id);
            }
            setAttribute(name, value) { this.attributes.set(name, value); }
            hasAttribute(name) { return this.attributes.has(name); }
            toggleAttribute(name, enabled) { enabled ? this.attributes.set(name, '') : this.attributes.delete(name); }
            querySelectorAll() { return this.children.map(row => row.children[0]); }
            addEventListener() {}
            remove() { ids.delete(this.id); }
            set innerHTML(value) { this.firstElementChild = new Element(); }
          }
          const listeners = new Set();
          const window = {
            addEventListener(type, listener) { listeners.add(listener); },
            removeEventListener(type, listener) { listeners.delete(listener); },
          };
          const document = {
            head: new Element(), body: new Element(), documentElement: new Element(), activeElement: {},
            createElement() { return new Element(); },
            getElementById(id) { return ids.get(id); },
            querySelectorAll() { return []; },
            addEventListener() {}, removeEventListener() {},
          };
          const value = runInNewContext(expression, {
            window, document, localStorage: { getItem() { return null; }, setItem() {} },
            setTimeout, clearTimeout, requestAnimationFrame: callback => callback(),
            getComputedStyle: () => ({ getPropertyValue: () => '' }),
          });
          const choose = id => ids.get('themes').children.find(row => row.children[0].dataset.id === id).children[0].onclick();
          const assertSkin = id => {
            assert.equal(window.__CODEX_SKIN__.id, id);
            assert.equal(document.documentElement.dataset.codexSkin, id === 'native' ? undefined : id);
            assert.equal(Boolean(ids.get('codex-skin-style').textContent), id !== 'native');
          };
          for (const service of ['missing', 'failed', 'unresponsive']) {
            if (service === 'failed') window.__codexSkinRequest = payload => {
              const { requestId } = JSON.parse(payload);
              queueMicrotask(() => {
                for (const listener of [...listeners]) listener({ source: window, data: {
                  type: 'codex-skin-response', requestId, ok: false, error: '皮肤服务未就绪',
                } });
              });
            };
            if (service === 'unresponsive') window.__codexSkinRequest = () => {};
            ids.get('toggle').onclick();
            await new Promise(resolve => setTimeout(resolve, service === 'unresponsive' ? 1600 : 0));
            assert.equal(ids.get('title').textContent, '本地皮肤');
            await choose('layla-starlight');
            assertSkin('layla-starlight');
            assert.match(ids.get('codex-skin-style').textContent, /--skin-art:url/);
            await choose('native');
            assertSkin('native');
          }
          let savedPreset;
          window.__codexSkinRequest = payload => {
            const { requestId, id } = JSON.parse(payload);
            savedPreset = id;
            queueMicrotask(() => {
              for (const listener of [...listeners]) listener({ source: window, data: {
                type: 'codex-skin-response', requestId, ok: true,
              } });
            });
          };
          await choose('native');
          assert.equal(savedPreset, 'native');
          return { result: { value } };
        } };
      }
    `);
    await exec(process.execPath, [path.join(state, "runtime", "skin.mjs"), "apply", "--theme", "native", "--root", state], { timeout: 8000 });
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});
