#!/usr/bin/env -S npx tsx
// report's single entry point (docs/engineering/testing/e2e/README.md §3.1):
// fail-fast checks → clean previous evidence → produce this run's shared evidence
// (scripts/evidence.ts) → run every verification domain against it → classify the exit
// code. No service to start — this repo's Agent is a remote HTTP call, not a coding-agent
// process this repo owns.
//
// Convention for adding a new verification domain (docs/engineering/testing/e2e/report.md
// §4/§5, e.g. B2 read-back / B3 render structure / B4 render visual / B5 custom reports):
// add your own scripts/verify-<domain>.ts exporting an async function that takes the
// `Evidence` object and throws on the first broken contract (see scripts/verify-format.ts
// for the reference shape). Then wire it in here with exactly ONE import line and ONE call
// line at the marked spots below — never re-call `produceEvidence()`, never re-run an
// Experiment. Use the Edit tool (not a full-file rewrite) to add your two lines: if another
// agent is editing this file at the same time, Edit fails on a stale match instead of
// silently clobbering their line — just re-Read the file and Edit again.

import "dotenv/config";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { InfraError, produceEvidence } from "./evidence.ts";
import { verifyFormat } from "./verify-format.ts";
// ── new verify-<domain>.ts imports go here (one line each) ──

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
  rmSync(join(REPO_ROOT, "site-export"), { recursive: true, force: true });
  for (const relPath of ["main.json", "main.xml", "fail.xml", "error.xml"]) {
    rmSync(join(REPO_ROOT, relPath), { force: true });
  }

  // 3. No service to start/stop — the Agent is a remote HTTP call (docs/engineering/testing/e2e/README.md §2.2).

  // 4-6. Produce this run's shared evidence once, run every verification domain against it,
  // then classify the outcome.
  try {
    const evidence = await produceEvidence();
    await verifyFormat(evidence);
    // ── new verify-<domain>.ts calls go here (one line each, in any order) ──
    console.log("[e2e] report: all assertions passed");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(err instanceof InfraError ? EX_TEMPFAIL : 1);
  }
}

main();
