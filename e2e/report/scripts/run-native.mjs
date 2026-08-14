#!/usr/bin/env node
// Native entry point for the report owner suite.
//
// One invocation owns one frozen classic World. Vitest and Playwright receive
// only private byte copies of that seed. The retained legacy profile has its
// own historical Evidence producer and is deliberately still run by the
// default lane, so Record/openRecord/JSON/JUnit/readback/usage-error/custom
// report coverage is not silently replaced by the new classic acceptance suite.
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `pnpm e2e -- --run …` forwards its separator to Node. It is transport
// syntax, not a Vitest/Playwright argument, so remove only that leading copy.
const forwardedArgs = process.argv.slice(2);
const nativeArgs = forwardedArgs[0] === "--" ? forwardedArgs.slice(1) : forwardedArgs;
if (nativeArgs.length === 1 && nativeArgs[0] === "--run") {
  console.error("[report-e2e] --run requires one test path");
  process.exit(2);
}
const targeted = nativeArgs.length > 0;
const selectedArgs = nativeArgs.filter((arg) => arg !== "--run");
const isBrowserTarget = selectedArgs.some((arg) => /\.browser\.spec\.[cm]?[jt]sx?$/.test(arg));
const playwrightArgs = selectedArgs.flatMap((arg) => (arg === "-t" ? ["--grep"] : [arg]));
const worldParent = mkdtempSync(join(tmpdir(), "niceeval-report-native-world-"));
const world = join(worldParent, "world");
let exitCode = 0;

function makeTreeRemovable(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) {
    return;
  }
  if (info.isDirectory()) {
    chmodSync(path, 0o755);
    for (const entry of readdirSync(path)) {
      makeTreeRemovable(join(path, entry));
    }
    return;
  }
  chmodSync(path, 0o644);
}

function run(label, command, args, env) {
  console.log(`\n[report-e2e] ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error !== undefined) {
    console.error(`[report-e2e] ${label} could not start: ${result.error.message}`);
    exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    console.error(`[report-e2e] ${label} exited ${result.status ?? "by signal"}`);
    exitCode = exitCode || result.status || 1;
  }
}

try {
  // classic is one producer profile: prepare executes exactly the fixed full
  // classic run plus the one allowed memory-a local rerun, then freezes it.
  run("profile classic: prepare frozen World once", "pnpm", ["exec", "tsx", "scripts/prepare.ts", "--out", world], process.env);
  const nativeEnv = { ...process.env, NICEEVAL_REPORT_WORLD: world };

  if (targeted) {
    if (isBrowserTarget) {
      run("profile classic: targeted Playwright", "pnpm", ["exec", "playwright", "test", ...playwrightArgs], nativeEnv);
    } else {
      run("profile classic: targeted Vitest", "pnpm", ["exec", "vitest", "run", ...selectedArgs], nativeEnv);
    }
  } else {
    run("profile classic: Vitest", "pnpm", ["exec", "vitest", "run"], nativeEnv);
    run("profile classic: Playwright", "pnpm", ["exec", "playwright", "test"], nativeEnv);
    // legacy intentionally remains a second profile. It produces its existing
    // Evidence once and executes all legacy verification domains even when a
    // classic lane failed above; it is never selected for a no-secret target.
    run("profile legacy: preserved Record/readback/JSON/JUnit coverage", "pnpm", ["e2e:legacy"], nativeEnv);
  }
} finally {
  // `worldParent` is a mkdtemp-owned path created above, never a repo path.
  // `prepare` freezes the World read-only; only its temporary owner restores
  // deletion permissions after every native lane has stopped consuming it.
  makeTreeRemovable(worldParent);
  rmSync(worldParent, { recursive: true, force: true });
}

process.exitCode = exitCode;
