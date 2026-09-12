import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function backendBuildId(): string {
  try {
    return readFileSync(join(process.cwd(), ".next/BUILD_ID"), "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "unbuilt";
    throw error;
  }
}

export async function startBackend(options: {
  env: Record<string, string>;
  signal: AbortSignal;
  requestTimeoutMs?: number;
  onCleanup: (cleanup: () => Promise<void>) => void;
}) {
  options.signal.throwIfAborted();
  await access(join(process.cwd(), ".next/BUILD_ID")).catch(() => {
    throw new Error("Build LLM X with pnpm build before running niceeval exp, or use pnpm eval.");
  });
  const directory = await mkdtemp(join(tmpdir(), "llm-x-eval-"));
  const child = fork(join(process.cwd(), "evaluation/server.mjs"), [], {
    execArgv: [],
    env: { ...process.env, ...options.env, NODE_ENV: "production", LLM_X_DB_PATH: join(directory, "world.sqlite") },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let failure: Error | undefined;
  child.on("error", (error) => { failure = error; });
  // Drain stderr without copying provider diagnostics or credentials into eval results.
  child.stderr?.resume();
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let cleanup: Promise<void> | undefined;
  function stop() {
    return cleanup ??= (async () => {
      options.signal.removeEventListener("abort", abort);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), 6_000);
      try {
        await exited;
        await rm(directory, { recursive: true, force: true });
      } finally {
        clearTimeout(kill);
      }
    })();
  }
  function abort() { child.kill("SIGTERM"); }
  options.onCleanup(stop);
  options.signal.addEventListener("abort", abort, { once: true });
  let port: number | undefined;
  child.on("message", (message: unknown) => {
    if (typeof message === "object" && message !== null && "port" in message
      && typeof message.port === "number" && Number.isInteger(message.port)
      && message.port > 0 && message.port <= 65535) port = message.port;
  });
  function assertRunning() {
    options.signal.throwIfAborted();
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`LLM X backend exited (${child.exitCode ?? child.signalCode}). Check pnpm build and backend configuration.`);
    }
  }
  try {
    const deadline = Date.now() + 30_000;
    while (port === undefined) {
      assertRunning();
      if (Date.now() >= deadline) throw new Error("LLM X backend did not start within 30 seconds.");
      await delay(50, undefined, { signal: options.signal });
    }
    const baseUrl = `http://127.0.0.1:${port}`;
    async function request(path: string, body?: unknown): Promise<unknown> {
      assertRunning();
      const response = await fetch(`${baseUrl}/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.requestTimeoutMs ?? 60_000)]),
      });
      if (!response.ok) throw new Error(`LLM X ${body === undefined ? "GET" : "POST"} ${path} failed: HTTP ${response.status}`);
      return response.json();
    }
    if (await request("/state") !== null) throw new Error("LLM X evaluation requires an empty isolated database.");
    return { request };
  } catch (error) {
    await stop();
    throw error;
  }
}
