#!/usr/bin/env -S npx tsx
// 唯一执行入口(docs/engineering/testing/e2e/README.md §3.1):检查环境、起被测应用、跑
// Experiment、跑 verify.ts、按能否确证外部故障分类退出码,最后无论成败都收尾服务。
//
// exit 0   契约符合预期
// exit 75  能确证的基础设施故障(python venv 装不上、服务 readiness 超时、provider 429/5xx/网络错误)
// 其它非零 回归——判不准就按回归退出,宁可误报回归,不可把回归漏报成环境问题
import "dotenv/config";

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { runVerify } from "./verify.ts";

const ROOT = process.cwd();
const PORT = process.env.PORT ?? "35100";
const HEALTH_URL = `http://127.0.0.1:${PORT}/healthz`;
const VENV_PY = `${ROOT}/.venv/bin/python`;

/** 能确证的基础设施故障(venv 装不上、readiness 超时)——e2e.ts 捕获后直接判 75,不必再猜。 */
class InfraError extends Error {}

function printNiceevalResolution(): void {
  // README §3.2:仓库在运行开头打印 niceeval 的解析路径与版本,供日志诊断——核验义务在
  // 编排器(比对候选 tarball 指纹),这里只是打印,不代表已核验。
  const pkgPath = `${ROOT}/node_modules/niceeval/package.json`;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name: string; version: string };
    console.log(`[e2e] niceeval resolved: ${pkgPath} (name=${pkg.name} version=${pkg.version})`);
  } catch (err) {
    console.log(`[e2e] could not read niceeval package.json at ${pkgPath}: ${(err as Error).message}`);
  }
}

function ensurePythonVenv(): void {
  if (!existsSync(VENV_PY)) {
    console.log("[e2e] creating python venv ...");
    const create = spawnSync("python3", ["-m", "venv", ".venv"], { cwd: ROOT, stdio: "inherit" });
    if (create.status !== 0) {
      throw new InfraError(`python3 -m venv .venv failed (exit ${create.status}) — is python3 (>=3.11) on PATH?`);
    }
  }
  console.log("[e2e] installing python requirements ...");
  const install = spawnSync(VENV_PY, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (install.status !== 0) {
    throw new InfraError(`pip install -r requirements.txt failed (exit ${install.status})`);
  }
}

function startServer(): ChildProcess {
  mkdirSync(`${ROOT}/logs`, { recursive: true });
  const child = spawn(VENV_PY, ["src/backend/server.py"], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (d) => chunks.push(d));
  child.stderr?.on("data", (d) => chunks.push(d));
  child.on("exit", () => writeFileSync(`${ROOT}/logs/server.log`, Buffer.concat(chunks)));
  return child;
}

async function waitForHealthy(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw new InfraError(
    `server did not become healthy at ${HEALTH_URL} within ${timeoutMs}ms (last error: ${String(lastErr)})`,
  );
}

async function main(): Promise<void> {
  printNiceevalResolution();
  ensurePythonVenv();

  const server = startServer();
  // adapter 的 BASE_URL 默认值恰好和这里的默认 PORT 一致,但不能指望两处硬编码永远同步——
  // 显式导出 LANGGRAPH_URL,runVerify() 里 spawn 的 `niceeval exp` 子进程(继承 process.env)
  // 就总是连到这次真正起服务的那个端口,不依赖两份默认值恰好相等。
  process.env.LANGGRAPH_URL = `http://127.0.0.1:${PORT}`;
  try {
    await waitForHealthy();
    await runVerify();
    process.exitCode = 0;
  } catch (err) {
    console.error(err);
    let ciLog = "";
    try {
      ciLog = readFileSync(`${ROOT}/logs/exp-ci.log`, "utf8");
    } catch {
      // 没跑到写 ci 日志那一步(比如 readiness 就超时了),留空——下面按 InfraError 分类。
    }
    // ciLog 是 `--json` NDJSON 事件流(scripts/verify.ts 落盘),按结构化 `error` 事件的
    // `reason` 字段判定,不再正则抠 `--output ci` 时代的人读 "errored" 文本(那个 flag 已经
    // 从 CLI 整个删除)。
    const infra =
      err instanceof InfraError ||
      ciLog.split("\n").some((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return false;
        let evt: unknown;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          return false;
        }
        if (!evt || typeof evt !== "object" || (evt as { event?: string }).event !== "error") return false;
        const reason = String((evt as { reason?: unknown }).reason ?? "");
        return /429|5\d\d|ECONNREFUSED|ETIMEDOUT/.test(reason);
      });
    process.exitCode = infra ? 75 : 1;
  } finally {
    server.kill();
  }
}

main();
