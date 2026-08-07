import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { defineExperiment } from "niceeval";
import { hangingAgent } from "../agents/deterministic.ts";

interface BackendInfo { pid: number; port: number }

let backend: BackendInfo | undefined;
let backendProcess: ChildProcess | undefined;

function infoPath(): string {
  const path = process.env.NICEEVAL_LIFECYCLE_INFO_PATH?.trim();
  if (!path) throw new Error("NICEEVAL_LIFECYCLE_INFO_PATH is required");
  return path;
}

async function waitForInfo(path: string): Promise<BackendInfo> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as BackendInfo;
      if (typeof value.pid === "number" && typeof value.port === "number") return value;
    } catch {
      // backend is still starting
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("owned backend did not publish readiness");
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const onClose = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off("close", onClose); resolve(false); }, timeoutMs);
    child.once("close", onClose);
  });
}

export default defineExperiment({
  description: "SIGINT drains experiment teardown",
  agent: hangingAgent,
  evals: ["interrupt"],
  setup: async (ctx) => {
    const child = spawn(process.execPath, ["fixtures/backend.mjs", infoPath()], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    backendProcess = child;
    backend = await waitForInfo(infoPath());
    ctx.fact("backend", `http://127.0.0.1:${backend.port}`);
  },
  teardown: async () => {
    const child = backendProcess;
    backend = undefined;
    backendProcess = undefined;
    if (!child) return;
    child.kill("SIGTERM");
    if (await waitForExit(child, 2_000)) return;
    child.kill("SIGKILL");
    if (!(await waitForExit(child, 2_000))) throw new Error("owned backend survived SIGKILL");
  },
});
