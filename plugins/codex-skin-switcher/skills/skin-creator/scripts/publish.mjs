#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const upstream = "MarcWebber/codex-skins";
const upstreamOwner = "MarcWebber";
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const coreFiles = ["theme.json", "extra.css", "art.png"];
const optionalFiles = [
  "profile-art.png", "help-art.png",
  "home-card-a.png", "home-card-b.png", "home-card-c.png", "home-card-d.png",
];
const scriptFile = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptFile), "../../..");
const runtimeFile = path.join(pluginRoot, "runtime", "skin.mjs");

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function validVersion(value) {
  if (!versionPattern.test(value || "")) throw new Error(`非法版本号：${value || "空"}，只支持 x.y.z`);
  return value;
}

export function nextVersion(value = null) {
  if (!value) return "1.0.0";
  const match = versionPattern.exec(value);
  if (!match) throw new Error(`非法版本号：${value}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function run(command, args, cwd = undefined) {
  try {
    const result = await exec(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || error).trim();
    throw new Error(`${path.basename(command)} ${args.join(" ")} 失败${detail ? `：${detail}` : ""}`);
  }
}

export async function prepareMarketSkin({ sourceDir, repoDir, id, author, fallbackAuthor, version, previewPath }) {
  if (!idPattern.test(id)) throw new Error(`非法主题名：${id}`);
  await Promise.all(coreFiles.map((file) => fs.access(path.join(sourceDir, file))));

  const targetDir = path.join(repoDir, "skins", id);
  const currentMeta = await readJson(path.join(targetDir, "meta.json"), {});
  const next = version ? validVersion(version) : nextVersion(currentMeta.version);
  const by = String(author || currentMeta.author || fallbackAuthor || "").trim();
  if (!by) throw new Error("无法确定作者，请传入 --author");

  const localPreview = path.join(sourceDir, "preview.png");
  const preview = previewPath
    ? path.resolve(previewPath)
    : await exists(localPreview) ? localPreview : path.join(sourceDir, "art.png");
  await fs.access(preview);

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  await Promise.all(coreFiles.map((file) => fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file))));
  for (const file of optionalFiles) {
    const source = path.join(sourceDir, file);
    if (await exists(source)) await fs.copyFile(source, path.join(targetDir, file));
  }
  await fs.copyFile(preview, path.join(targetDir, "preview.png"));
  await fs.writeFile(path.join(targetDir, "meta.json"), `${JSON.stringify({ version: next, author: by }, null, 2)}\n`);
  return { id, version: next, author: by, preview: path.basename(preview) };
}

async function contributorRemote(login) {
  const fork = `${login}/codex-skins`;
  let data = await run("gh", ["api", `repos/${fork}`]).then(JSON.parse, () => null);
  if (!data) {
    await run("gh", ["repo", "fork", upstream, "--clone=false"]);
    data = JSON.parse(await run("gh", ["api", `repos/${fork}`]));
  }
  if (!data.fork || data.parent?.full_name?.toLowerCase() !== upstream.toLowerCase()) {
    throw new Error(`${fork} 已存在，但不是 ${upstream} 的 fork`);
  }
  const protocol = await run("gh", ["config", "get", "git_protocol"]).catch(() => "https");
  return protocol === "ssh" ? data.ssh_url : data.clone_url;
}

export async function publishSkin({
  id,
  sourceDir,
  stateRoot,
  author = null,
  version = null,
  previewPath = null,
  dryRun = false,
  confirmed = false,
}) {
  if (!idPattern.test(id || "")) throw new Error(`非法主题名：${id || "空"}`);
  if (!dryRun && !confirmed) throw new Error("投稿会公开主题文件；确认后请添加 --confirm-publication");

  await run(process.execPath, [runtimeFile, "validate", "--root", stateRoot, "--theme", id, "--folder", sourceDir]);
  await run("gh", ["auth", "status"]);
  const user = JSON.parse(await run("gh", ["api", "user"]));
  const login = user.login;
  const fallbackAuthor = String(user.name || login).trim();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skin-publish-"));
  const repoDir = path.join(workspace, "market");
  const branch = `codex/skin-${id}-${Date.now()}`;

  try {
    await run("gh", ["repo", "clone", upstream, repoDir]);
    await run("git", ["switch", "-c", branch], repoDir);
    const prepared = await prepareMarketSkin({ sourceDir, repoDir, id, author, fallbackAuthor, version, previewPath });
    const targetDir = path.join(repoDir, "skins", id);
    await run(process.execPath, [runtimeFile, "validate", "--root", stateRoot, "--theme", id, "--folder", targetDir]);
    await run(process.execPath, [path.join(repoDir, "scripts", "build-manifest.mjs")], repoDir);
    await run(process.execPath, ["--test"], repoDir);
    await run("git", ["diff", "--check"], repoDir);
    const changedFiles = (await run("git", ["status", "--short"], repoDir)).split("\n").filter(Boolean);
    if (!changedFiles.length) throw new Error("本地主题与市场版本完全一致，无需投稿");
    if (dryRun) return { ok: true, dryRun: true, repository: upstream, branch, changedFiles, ...prepared };

    let remote = "origin";
    let head = branch;
    if (login.toLowerCase() !== upstreamOwner.toLowerCase()) {
      const sshUrl = await contributorRemote(login);
      remote = "contributor";
      head = `${login}:${branch}`;
      await run("git", ["remote", "add", remote, sshUrl], repoDir);
    }
    await run("git", ["config", "user.name", user.name || login], repoDir);
    await run("git", ["config", "user.email", `${user.id}+${login}@users.noreply.github.com`], repoDir);
    await run("git", ["add", "--", `skins/${id}`, "manifest.json"], repoDir);
    await run("git", ["commit", "-m", `feat: publish ${id} ${prepared.version}`], repoDir);
    await run("git", ["push", "-u", remote, branch], repoDir);
    const body = [
      `Publish \`${id}\` ${prepared.version}.`,
      "",
      "Generated by Codex Skin Creator.",
      "Validation: theme validator, manifest build, market tests, and git diff check passed.",
    ].join("\n");
    const output = await run("gh", [
      "pr", "create", "--repo", upstream, "--base", "main", "--head", head,
      "--title", `feat: publish ${id} ${prepared.version}`, "--body", body,
    ], repoDir);
    const url = output.split("\n").at(-1);
    return { ok: true, dryRun: false, repository: upstream, branch, url, ...prepared };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  const args = process.argv.slice(2);
  const id = option(args, "--theme");
  const stateRoot = path.resolve(option(args, "--root", path.join(os.homedir(), "Library", "Application Support", "CodexSkinSwitcher")));
  const sourceDir = path.resolve(option(args, "--folder", path.join(stateRoot, "themes", id || "")));
  publishSkin({
    id,
    sourceDir,
    stateRoot,
    author: option(args, "--author"),
    version: option(args, "--version"),
    previewPath: option(args, "--preview"),
    dryRun: args.includes("--dry-run"),
    confirmed: args.includes("--confirm-publication"),
  }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}
