import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineExperiment } from "niceeval";
import { slowFixtureAgent } from "../agents/fixture.ts";

// owned backend 的信息文件路径：experiments/slow.ts 与 test/sigint-teardown-orphan.test.ts
// 共同约定的仓库根相对位置（不是 .niceeval 的私有布局）。
export const BACKEND_INFO_PATH = join(process.cwd(), "backend.info");

interface BackendInfo {
  pid: number;
  port: number;
}

let backend: BackendInfo | undefined;
let backendProcess: ChildProcess | undefined;

function waitForInfoFile(deadlineMs: number): Promise<BackendInfo> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const poll = (): void => {
      if (Date.now() > deadline) {
        reject(new Error(`backend.info 在 ${deadlineMs}ms 内没有就绪`));
        return;
      }
      try {
        const info = JSON.parse(readFileSync(BACKEND_INFO_PATH, "utf8")) as BackendInfo;
        if (typeof info.pid === "number" && typeof info.port === "number") {
          resolve(info);
          return;
        }
      } catch {
        /* backend 还没写出来 */
      }
      setTimeout(poll, 100);
    };
    poll();
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
    const child = spawn(process.execPath, ["fixtures/backend.mjs", BACKEND_INFO_PATH], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    if (child.exitCode !== null) {
      throw new Error("owned backend 提前退出");
    }
    backendProcess = child;
    const info = await waitForInfoFile(10_000);
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
