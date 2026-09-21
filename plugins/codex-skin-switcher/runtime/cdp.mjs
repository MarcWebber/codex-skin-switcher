export async function connectPage(port, timeout = 5000) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`CDP 连接失败：${response.status}`);
  const target = (await response.json()).find((item) => item.type === "page" && item.url === "app://-/index.html");
  if (!target) throw new Error(`端口 ${port} 没有 Codex 主页面`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let requestId = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("CDP 连接已断开"));
    }
    pending.clear();
  });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("CDP 连接超时")), timeout);
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP 连接失败")), { once: true });
      socket.addEventListener("close", () => reject(new Error("CDP 连接已断开")), { once: true });
    });
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    socket,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) return reject(new Error("CDP 连接已断开"));
        const id = ++requestId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP 调用超时：${method}`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    },
  };
}
