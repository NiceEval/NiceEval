import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { defineExperiment } from "niceeval";
import { slowFixtureAgent } from "../agents/fixture.ts";

const BACKEND_INFO_PATH_ENV = "NICEEVAL_BACKEND_INFO_PATH";

interface BackendInfo {
  pid: number;
  port: number;
}

let backend: BackendInfo | undefined;
let backendProcess: ChildProcess | undefined;

function backendInfoPath(): string {
  const path = process.env[BACKEND_INFO_PATH_ENV]?.trim();
  if (!path) throw new Error(`${BACKEND_INFO_PATH_ENV} 必须指向本测试的私有控制文件`);
  return path;
}

function waitForInfoFile(path: string, deadlineMs: number): Promise<BackendInfo> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const poll = async (): Promise<void> => {
      if (Date.now() > deadline) {
        reject(new Error(`backend 信息文件在 ${deadlineMs}ms 内没有就绪`));
        return;
      }
      try {
        const info = JSON.parse(await readFile(path, "utf8")) as BackendInfo;
        if (typeof info.pid === "number" && typeof info.port === "number") {
          resolve(info);
          return;
        }
      } catch {
        /* backend 还没写出来 */
      }
      setTimeout(() => void poll(), 100);
    };
    void poll();
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    child.once("close", onClose);
  });
}

export default defineExperiment({
  description: "慢速评测：实验级 setup 起 owned backend，teardown 收掉",
  agent: slowFixtureAgent,
  evals: ["suite/slow"],
  timeoutMs: 120_000,
  setup: async (ctx) => {
    const infoPath = backendInfoPath();
    const child = spawn(process.execPath, ["fixtures/backend.mjs", infoPath], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    if (child.exitCode !== null) {
      throw new Error("owned backend 提前退出");
    }
    backendProcess = child;
    const info = await waitForInfoFile(infoPath, 10_000);
    backend = info;
    ctx.fact("backend", `http://127.0.0.1:${info.port}`);
  },
  teardown: async () => {
    const current = backend;
    const child = backendProcess;
    backend = undefined;
    backendProcess = undefined;
    if (!current || !child) return;

    child.kill("SIGTERM");
    if (await waitForExit(child, 2_000)) return;

    child.kill("SIGKILL");
    if (!await waitForExit(child, 2_000)) {
      throw new Error(`owned backend ${current.pid} 在 SIGKILL 后仍未退出`);
    }
  },
});
