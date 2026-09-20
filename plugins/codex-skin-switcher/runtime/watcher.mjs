import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function appProcess(appPath) {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,etime=,comm="]);
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
    if (match?.[3] !== `${appPath}/Contents/MacOS/ChatGPT`) continue;
    const pid = Number(match[1]);
    const age = match[2].split(/[-:]/).reverse().reduce((sum, part, index) => sum + Number(part) * [1, 60, 3600, 86400][index], 0);
    const args = await exec("/bin/ps", ["-p", String(pid), "-o", "args="]).catch(() => null);
    return args ? { pid, age, args: args.stdout.trim() } : null;
  }
  return null;
}

// Each observed app process is handled once, even if the watcher itself restarts.
export async function checkStartup(state, { process: currentProcess, remember, preset, ready, quit, open, wait }) {
  const app = await currentProcess();
  if (!app || app.pid === state.pid) return;
  state.pid = app.pid;
  await remember(app.pid);
  if (app.age > 30 || /(?:^|\s)--remote-debugging-port(?:=|\s)/.test(app.args) || await preset() === "native" || await ready()) return;
  await wait(3000);
  if ((await currentProcess())?.pid !== app.pid || await ready() || await preset() === "native") return;

  await quit(app.pid);
  for (let attempt = 0; attempt < 10; attempt++) {
    const running = await currentProcess();
    if (!running) break;
    if (running.pid !== app.pid) return; // The user already opened another instance.
    await wait(500);
  }
  if (await currentProcess()) throw new Error("Codex 未正常退出，本次皮肤恢复已停止；不会强制结束或重复重启。");
  await open();
  for (let attempt = 0; attempt < 20; attempt++) {
    const launched = await currentProcess();
    if (launched) {
      state.pid = launched.pid;
      await remember(launched.pid);
      return;
    }
    await wait(500);
  }
  throw new Error("未等到 Codex 启动，本次皮肤恢复已停止；不会再次拉起应用。");
}

export async function watchApp(appPath, stateRoot, port) {
  const pidFile = path.join(stateRoot, "watcher-pid");
  const state = { pid: Number(await fs.readFile(pidFile, "utf8").catch(() => 0)) };
  const dependencies = {
    process: () => appProcess(appPath),
    remember: (pid) => fs.writeFile(pidFile, String(pid)),
    preset: () => fs.readFile(path.join(stateRoot, "preference.json"), "utf8").then((text) => JSON.parse(text).preset || "native").catch(() => "native"),
    ready: () => fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(900) }).then((response) => response.ok).catch(() => false),
    quit: async (pid) => {
      if ((await appProcess(appPath))?.pid !== pid) throw new Error("Codex 进程已变化，本次恢复取消。");
      const app = `application ${JSON.stringify(appPath)}`;
      await exec("/usr/bin/osascript", ["-e", `if ${app} is running then tell ${app} to quit`], { timeout: 5000 });
    },
    open: () => exec("/usr/bin/open", ["-n", appPath, "--args", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], { timeout: 5000 }),
    wait: sleep,
  };
  for (;;) {
    try { await checkStartup(state, dependencies); }
    catch (error) { console.error(error.message); }
    await sleep(2000);
  }
}
