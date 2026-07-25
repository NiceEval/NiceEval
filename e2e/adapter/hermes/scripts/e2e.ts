#!/usr/bin/env -S npx tsx
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ensureDockerImage } from "./build-docker-env.ts";
import { runVerify } from "./verify.ts";

const EX_TEMPFAIL = 75;
const REQUIRED_SECRETS = ["BUB_API_KEY", "BUB_API_BASE"] as const;

class InfraError extends Error {}

function runInherited(cmd: string, args: string[]): number {
  return spawnSync(cmd, args, { stdio: "inherit" }).status ?? 1;
}

async function main(): Promise<void> {
  mkdirSync("logs", { recursive: true });
  const missing = REQUIRED_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`[hermes] missing secret(s): ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  try {
    if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
      throw new InfraError("docker info failed");
    }
    if (!existsSync("node_modules")) {
      const code = runInherited("pnpm", ["install", "--no-frozen-lockfile"]);
      if (code !== 0) throw new InfraError(`pnpm install failed (${code})`);
    }
    ensureDockerImage();
    rmSync(".niceeval", { recursive: true, force: true });
    await runVerify();
    console.log("\n[hermes] all assertions passed.");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[hermes] verification failed:");
    console.error(err);
    let ciLog = "";
    try { ciLog = readFileSync("logs/exp-ci.log", "utf8"); } catch {}
    const infra =
      err instanceof InfraError ||
      ciLog.split("\n").some((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return false;
        try {
          const evt = JSON.parse(trimmed);
          if (evt?.event !== "error") return false;
          return /429|5\d\d|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(String(evt.reason ?? "")) ||
            /^sandbox\.(create|setup)$/i.test(String(evt.phase ?? ""));
        } catch { return false; }
      });
    process.exitCode = infra ? EX_TEMPFAIL : 1;
  }
}

main();
