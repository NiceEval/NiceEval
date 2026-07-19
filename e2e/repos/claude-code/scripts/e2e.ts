#!/usr/bin/env -S npx tsx
// scripts/e2e.ts — 唯一执行入口(docs/engineering/e2e-ci/README.md §3.1)。
//
// 1. 检查所需 secrets(fail-fast)。
// 2. 启动本仓库自带的远程 HTTP MCP server fixture(src/mcp-http-server.ts),等它
//    /healthz 就绪——claude-code Docker 沙箱经 host.docker.internal 回连到这里
//    (docker.ts 对每个容器都加了 ExtraHosts: host.docker.internal:host-gateway)。
// 3. 跑 scripts/verify.ts 的全部断言(真实跑 5 个 experiments + CLI 读回)。
// 4. 无论成功失败都关掉这个 fixture 进程;按能否确证的外部故障分类退出码:
//    0 契约符合预期,75(EX_TEMPFAIL)基础设施故障,其它非零是回归。

import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { runVerify } from "./verify.ts";

const EX_TEMPFAIL = 75;
const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT ?? "32131";
const READY_TIMEOUT_MS = 20_000;

class InfraError extends Error {}

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "NICEEVAL_JUDGE_KEY", "NICEEVAL_JUDGE_BASE"];

function checkRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `missing required env var(s): ${missing.join(", ")} — see .env.example. This is a repo setup problem, not an infra fault.`,
    );
  }
}

function startMcpHttpServer(): ChildProcess {
  mkdirSync("logs", { recursive: true });
  const out = openSync("logs/mcp-http-server.log", "w");
  const child = spawn("npx", ["tsx", "src/mcp-http-server.ts"], {
    env: { ...process.env, MCP_HTTP_PORT },
    stdio: ["ignore", out, out],
  });
  child.on("error", (err) => {
    console.error(`[e2e] mcp http server process failed to start: ${err.message}`);
  });
  return child;
}

async function waitForReady(deadline: number): Promise<void> {
  const url = `http://127.0.0.1:${MCP_HTTP_PORT}/healthz`;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 连不上就继续轮询,直到超时。
    }
    if (Date.now() >= deadline) {
      throw new InfraError(`mcp http server did not become ready at ${url} within ${READY_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    // 保底:SIGTERM 无效时强杀,不让进程挂着拖死下一次运行。
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5_000);
  });
}

/** 能确证的外部故障依据:自己的 InfraError,或 --output ci 日志中 errored 行明确指向 provider。 */
function isInfraFailure(err: unknown): boolean {
  if (err instanceof InfraError) return true;
  try {
    const ciLog = readFileSync("logs/exp-ci.log", "utf8");
    return /errored[^\n]*(429|5\d\d|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)/i.test(ciLog);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  mkdirSync("logs", { recursive: true });
  checkRequiredEnv();

  const server = startMcpHttpServer();
  try {
    await waitForReady(Date.now() + READY_TIMEOUT_MS);
    await runVerify();
    process.exitCode = 0;
  } catch (err) {
    console.error(err);
    process.exitCode = isInfraFailure(err) ? EX_TEMPFAIL : 1;
  } finally {
    await stopServer(server);
  }
}

main();
