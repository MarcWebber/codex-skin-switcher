import assert from "node:assert/strict";
import test from "node:test";
import { checkStartup } from "../plugins/codex-skin-switcher/runtime/watcher.mjs";

function fixture(overrides = {}) {
  const app = { pid: 100, age: 1, args: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" };
  const scenario = { app, savedPid: 0, calls: [], ready: false, preset: "layla-starlight" };
  const dependencies = {
    process: async () => scenario.app,
    remember: async (pid) => { scenario.savedPid = pid; },
    preset: async () => scenario.preset,
    ready: async () => scenario.ready,
    quit: async (pid) => { scenario.calls.push(["quit", pid]); scenario.app = null; },
    // Deliberately omit the flag here: the replacement PID must also be consumed.
    open: async () => { scenario.calls.push(["open"]); scenario.app = { ...app, pid: 101 }; },
    wait: async () => {},
    ...overrides,
  };
  return { scenario, dependencies, state: { pid: 0 } };
}

test("a new launch gets one restart; normal quit stays closed; the next manual launch works", async () => {
  const { scenario, dependencies, state } = fixture();
  await checkStartup(state, dependencies);
  await checkStartup(state, dependencies);
  // Simulate the watcher crashing and loading its persisted PID again.
  await checkStartup({ pid: scenario.savedPid }, dependencies);
  assert.deepEqual(scenario.calls, [["quit", 100], ["open"]]);
  scenario.app = null;
  await checkStartup(state, dependencies);
  assert.equal(scenario.calls.length, 2);
  scenario.app = { pid: 102, age: 1, args: "ChatGPT" };
  await checkStartup(state, dependencies);
  assert.deepEqual(scenario.calls, [["quit", 100], ["open"], ["quit", 102], ["open"]]);
});

test("ready, flagged, native, existing and already handled sessions never restart", async () => {
  for (const mode of ["ready", "flagged", "native", "existing", "handled"]) {
    const { scenario, dependencies, state } = fixture();
    if (mode === "ready") scenario.ready = true;
    if (mode === "flagged") scenario.app.args += " --remote-debugging-port=9335";
    if (mode === "native") scenario.preset = "native";
    if (mode === "existing") scenario.app.age = 31;
    if (mode === "handled") state.pid = scenario.app.pid;
    await checkStartup(state, dependencies);
    assert.deepEqual(scenario.calls, [], mode);
  }
});

test("readiness or a user quit during startup cancels the restart", async () => {
  for (const mode of ["ready", "quit", "new-process", "native"]) {
    const { scenario, dependencies, state } = fixture();
    dependencies.wait = async () => {
      if (mode === "ready") scenario.ready = true;
      if (mode === "quit") scenario.app = null;
      if (mode === "new-process") scenario.app = { ...scenario.app, pid: 200 };
      if (mode === "native") scenario.preset = "native";
    };
    await checkStartup(state, dependencies);
    assert.deepEqual(scenario.calls, [], mode);
  }
});

test("failed quit or launch is not retried, including after watcher recovery", async () => {
  for (const mode of ["quit-cancelled", "quit-error", "open-error", "open-timeout"]) {
    const { scenario, dependencies, state } = fixture();
    if (mode === "quit-cancelled") dependencies.quit = async () => { scenario.calls.push(["quit"]); };
    if (mode === "quit-error") dependencies.quit = async () => { scenario.calls.push(["quit"]); throw new Error("denied"); };
    if (mode === "open-error") dependencies.open = async () => { scenario.calls.push(["open"]); throw new Error("failed"); };
    if (mode === "open-timeout") dependencies.open = async () => { scenario.calls.push(["open"]); };
    await assert.rejects(checkStartup(state, dependencies));
    const calls = scenario.calls.slice();
    await checkStartup({ pid: scenario.savedPid }, dependencies);
    assert.deepEqual(scenario.calls, calls, mode);
    if (mode.startsWith("quit")) assert.equal(scenario.calls.some(([name]) => name === "open"), false);
  }
});
