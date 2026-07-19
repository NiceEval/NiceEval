// Single entry point (docs/engineering/e2e-ci/README.md §3.1): install, start the
// HTTP app under test (only ui-message-stream needs it; in-process and zero-mapping
// call generateText directly), run verify.ts, classify the outcome into 0 / 75 / other.
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { runVerify } from "./verify.ts";

const PORT = Number(process.env.PORT ?? 34101);
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
    env: { ...process.env, PORT: String(PORT) },
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
    const infra =
      err instanceof InfraError ||
      /errored .*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/.test(ciLog);
    // Judged by structured evidence only (own readiness timeout, or a provider-attributable
    // errored line in the ci log) — anything else is a regression, per the classification
    // rule in README §3.1: rather over-report regression than under-report infra.
    exitCode = infra ? 75 : 1;
  } finally {
    writeFileSync("logs/server.log", serverLog, "utf8");
    server.kill("SIGTERM");
  }
  process.exit(exitCode);
}

main();
