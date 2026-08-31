import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareMarketSkin, nextVersion } from "../plugins/codex-skin-switcher/skills/skin-creator/scripts/publish.mjs";

test("publisher copies only fixed theme files and bumps an existing patch version", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-publisher-test-"));
  try {
    const sourceDir = path.join(root, "source");
    const repoDir = path.join(root, "market");
    const targetDir = path.join(repoDir, "skins", "moon-skin");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(sourceDir, "theme.json"), "{}"),
      fs.writeFile(path.join(sourceDir, "extra.css"), ""),
      fs.writeFile(path.join(sourceDir, "art.png"), "art"),
      fs.writeFile(path.join(sourceDir, "home-card-a.png"), "card"),
      fs.writeFile(path.join(sourceDir, "ignored.js"), "ignored"),
      fs.writeFile(path.join(targetDir, "meta.json"), JSON.stringify({ version: "1.2.3", author: "Original" })),
      fs.writeFile(path.join(targetDir, "help-art.png"), "stale"),
    ]);

    const result = await prepareMarketSkin({ sourceDir, repoDir, id: "moon-skin", fallbackAuthor: "Fallback" });
    assert.deepEqual(result, { id: "moon-skin", version: "1.2.4", author: "Original", preview: "art.png" });
    assert.deepEqual((await fs.readdir(targetDir)).sort(), [
      "art.png", "extra.css", "home-card-a.png", "meta.json", "preview.png", "theme.json",
    ]);
    assert.equal(await fs.readFile(path.join(targetDir, "preview.png"), "utf8"), "art");
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetDir, "meta.json"), "utf8")), {
      version: "1.2.4",
      author: "Original",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("publisher starts at 1.0.0 and rejects non-semver versions", () => {
  assert.equal(nextVersion(), "1.0.0");
  assert.equal(nextVersion("2.4.9"), "2.4.10");
  assert.throws(() => nextVersion("v2"), /非法版本号/);
});
