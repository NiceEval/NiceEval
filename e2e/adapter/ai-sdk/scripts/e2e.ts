// Single entry point (docs/engineering/testing/e2e/README.md §3.1): install, start the
// HTTP app under test, run verify.ts, classify the outcome into 0 / 75 / other.
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { runVerify } from "./verify.ts";

const PORT = Number(process.env.PORT ?? 34101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// 固定端口,对应 niceeval.config.ts 的 telemetry.port——niceeval 在这个端口上起 OTLP
// 接收器,应用把官方 @ai-sdk/otel span 发过来。
const OTLP_ENDPOINT = "http://127.0.0.1:4318";

class InfraError extends Error {}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // app not up yet
    }
    if (Date.now() > deadline) {
      throw new InfraError(`ai-sdk app did not become ready at ${url} within ${timeoutMs}ms`);
    }
    await sleep(300);
  }
}

async function main(): Promise<void> {
  rmSync(".niceeval", { recursive: true, force: true });
  mkdirSync("logs", { recursive: true });

  const install = spawnSync("pnpm", ["install"], { stdio: "inherit" });
  if ((install.status ?? 1) !== 0) {
    console.error("pnpm install failed — infra fault (README §3.1 lists dependency install failure as EX_TEMPFAIL)");
    process.exit(75);
  }

  process.env.AI_SDK_URL = BASE_URL;
  const server = spawn("pnpm", ["exec", "tsx", "src/backend/server.ts"], {
    env: { ...process.env, PORT: String(PORT), OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout?.on("data", (d: Buffer) => (serverLog += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (serverLog += d.toString()));

  let exitCode = 0;
  try {
    await waitForHealth(`${BASE_URL}/healthz`, 20_000);
    await runVerify();
  } catch (err) {
    console.error(err);
    const ciLog = existsSync("logs/exp-ci.log") ? readFileSync("logs/exp-ci.log", "utf8") : "";
    // logs/exp-ci.log is the `--json` NDJSON event stream (scripts/verify.ts's runCmd), not
    // `--output ci` human text — classify off the structured `error` event's `reason` field
    // instead of regexing the word "errored" (the `--output` flag it came from is gone).
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
    // Judged by structured evidence only (own readiness timeout, or a provider-attributable
    // `error` event in the ci log) — anything else is a regression, per the classification
    // rule in README §3.1: rather over-report regression than under-report infra.
    exitCode = infra ? 75 : 1;
  } finally {
    writeFileSync("logs/server.log", serverLog, "utf8");
    server.kill("SIGTERM");
  }
  process.exit(exitCode);
}

main();
