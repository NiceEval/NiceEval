#!/usr/bin/env -S npx tsx
// results-contract's single entry point (docs/engineering/e2e-ci/README.md §3.1):
// fail-fast checks → clean previous evidence → run the real Experiments + assertions
// (scripts/verify.ts) → classify the exit code. No service to start — this repo's Agent
// is a remote HTTP call, not a coding-agent process this repo owns.

import "dotenv/config";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { InfraError, runVerify } from "./verify.ts";

const EX_TEMPFAIL = 75;
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(message: string): never {
  console.error(`[e2e] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // 1. Fail-fast: required secrets, candidate niceeval resolution.
  const requiredSecrets = ["OPENAI_API_KEY", "OPENAI_BASE_URL"];
  const missing = requiredSecrets.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(`missing required secret(s): ${missing.join(", ")} — set them in .env (see .env.example)`);
  }

  try {
    const pkgPath = join(REPO_ROOT, "node_modules", "niceeval", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    console.log(`[e2e] resolved niceeval ${pkg.version ?? "(unknown version)"} from ${pkgPath}`);
  } catch (err) {
    fail(`could not resolve niceeval from node_modules — did \`pnpm install\` run? (${(err as Error).message})`);
  }

  // 2. Clean this repo's previous run's evidence — never an input to the next run.
  rmSync(join(REPO_ROOT, ".niceeval"), { recursive: true, force: true });
  for (const relPath of ["main.json", "main.xml", "fail.xml", "error.xml"]) {
    rmSync(join(REPO_ROOT, relPath), { force: true });
  }

  // 3. No service to start/stop — the Agent is a remote HTTP call (docs/engineering/e2e-ci/README.md §2.2).

  // 4-6. Run the real Experiments + all assertions, then classify the outcome.
  try {
    await runVerify();
    console.log("[e2e] results-contract: all assertions passed");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(err instanceof InfraError ? EX_TEMPFAIL : 1);
  }
}

main();
