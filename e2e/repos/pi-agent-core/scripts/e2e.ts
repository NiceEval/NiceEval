#!/usr/bin/env -S npx tsx
// 唯一执行入口(docs/engineering/e2e-ci/README.md §3.1)。运行时的先决条件——安装依赖、
// 候选包注入、secrets 授权——由调用方保证(根编排器 e2e/scripts/run.ts 的隔离 install,或
// crabbox 独立 checkout 场景下 `pnpm install && pnpm e2e` 的显式链)。本脚本自己负责:
//
//   1. 打印实际解析到的 niceeval 版本/路径(诊断用,核验义务在编排器,见 README §3.2)。
//   2. 清理上一次运行的 .niceeval/ 与 logs/。
//   3. 起被测应用(src/server.ts 的真实 HTTP+SSE 服务),等 /healthz 就绪。
//   4. 以 --force 跑 experiments/ci.ts,写 JUnit。
//   5. 跑 scripts/verify.ts 做 CLI 黑盒读回。
//   6. 无论成败都停服务;按 verification.md 的规则把失败分类成 75(EX_TEMPFAIL,可确证的
//      外部故障)或其它非零(回归)。
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EX_TEMPFAIL = 75;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 33101;
const HEALTHZ_URL = `http://127.0.0.1:${PORT}/healthz`;
const READY_TIMEOUT_MS = 20_000;

function printResolvedNiceeval(): void {
  const pkgPath = join(ROOT, "node_modules", "niceeval", "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name: string; version: string };
    console.log(`[e2e] resolved niceeval: ${pkg.name}@${pkg.version} (${pkgPath})`);
  } catch (err) {
    console.log(`[e2e] could not resolve ${pkgPath}: ${(err as Error).message}`);
  }
}

function cleanPreviousResults(): void {
  rmSync(join(ROOT, ".niceeval"), { recursive: true, force: true });
  rmSync(join(ROOT, "logs"), { recursive: true, force: true });
  mkdirSync(join(ROOT, "logs"), { recursive: true });
}

async function waitForReady(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTHZ_URL);
      if (res.ok) return;
    } catch {
      // 服务还没起来,继续轮询
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`readiness timeout: ${HEALTHZ_URL} 在 ${READY_TIMEOUT_MS}ms 内没有返回 200`);
}

class InfraError extends Error {}

async function main(): Promise<void> {
  printResolvedNiceeval();
  cleanPreviousResults();

  console.log(`[e2e] starting app: pnpm start (PORT=${PORT})`);
  const serverLog = join(ROOT, "logs", "server.log");
  const serverOutFd = openSync(serverLog, "w");
  const server = spawn("pnpm", ["start"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", serverOutFd, serverOutFd],
  });
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });

  const stopServer = () => {
    if (!serverExited && !server.killed) server.kill("SIGTERM");
  };

  try {
    try {
      if (serverExited) throw new InfraError("app exited before becoming ready — see logs/server.log");
      await waitForReady(Date.now() + READY_TIMEOUT_MS);
    } catch (err) {
      throw new InfraError((err as Error).message);
    }
    console.log(`[e2e] app ready at http://127.0.0.1:${PORT}`);

    console.log("[e2e] running: pnpm exec niceeval exp ci --force --output ci --junit junit.xml");
    const expLog = join(ROOT, "logs", "exp-ci.log");
    const exp = spawnSync(
      "pnpm",
      ["exec", "niceeval", "exp", "ci", "--force", "--output", "ci", "--junit", "junit.xml"],
      { cwd: ROOT, encoding: "utf8" },
    );
    writeFileSync(expLog, `${exp.stdout ?? ""}\n${exp.stderr ?? ""}`, "utf8");
    process.stdout.write(exp.stdout ?? "");
    process.stderr.write(exp.stderr ?? "");

    const expExit = exp.status ?? -1;
    if (expExit !== 0) {
      const ciLog = readFileSync(expLog, "utf8");
      // 每行独立判断,`.` 不跨行——避免把无关行(如快照目录名里的时间戳 "...-565Z")
      // 误判成 5xx 状态码。只有 errored 计数非零、且同一行能看到 429/5xx/连接类错误码时才算
      // 可确证的外部故障;单纯的断言失败(failed>0, errored=0)一律按回归处理。
      const infra = ciLog
        .split("\n")
        .some((line) => /errored/i.test(line) && !/errored=0\b/.test(line) && /(429|5\d\d|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)/.test(line));
      throw infra
        ? new InfraError(`niceeval exp ci exited ${expExit} with a confirmed provider/network error — see ${expLog}`)
        : new Error(`niceeval exp ci exited ${expExit} — see ${expLog}`);
    }

    console.log("[e2e] running: tsx scripts/verify.ts");
    const verify = spawnSync("tsx", ["scripts/verify.ts"], { cwd: ROOT, stdio: "inherit" });
    if ((verify.status ?? -1) !== 0) {
      throw new Error(`scripts/verify.ts exited ${verify.status ?? -1} — CLI read-back assertions failed`);
    }

    console.log("[e2e] PASS");
    process.exitCode = 0;
  } catch (err) {
    console.error(`[e2e] FAIL: ${(err as Error).message}`);
    process.exitCode = err instanceof InfraError ? EX_TEMPFAIL : 1;
  } finally {
    stopServer();
  }
}

main();
