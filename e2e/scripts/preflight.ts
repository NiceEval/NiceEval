// Host capability checks for a selected E2E repo.
//
// These checks are deliberately runner-local and structured: a missing
// declared prerequisite is a configuration result before a scenario test can
// be mistaken for a product regression.

import type { Browser, E2ERepoManifest } from "./manifest.ts";
import {
  hasConfirmedOwnedGroupCleanup,
  isExecutionCancelled,
  type E2EExecutionControl,
  type OwnedProcessResult,
} from "./owned-process.ts";
import type { CapabilityCheck, CommandCapture } from "./receipt.ts";

export interface CapabilityPreflightResult {
  ok: boolean;
  cancelled: boolean;
  checks: CapabilityCheck[];
  failureCategory?: "configuration" | "infra";
}

function toCapture(result: OwnedProcessResult): CommandCapture {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error === undefined ? {} : { error: result.error }),
    processGroupOwned: result.processGroupOwned,
    groupCleanup: result.groupCleanup,
  };
}

function commandSucceeded(result: OwnedProcessResult): boolean {
  return (
    result.exitCode === 0 &&
    result.signal === null &&
    result.error === undefined &&
    !result.timedOut &&
    !result.cancelled &&
    hasConfirmedOwnedGroupCleanup(result)
  );
}

function commandFailureCategory(result: OwnedProcessResult): "configuration" | "infra" {
  return hasConfirmedOwnedGroupCleanup(result) ? "configuration" : "infra";
}

function hostPlatform(): string {
  return process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform;
}

interface RuntimeRequirement {
  source: string;
  executable: string;
  minimum?: readonly number[];
}

function parseRuntimeRequirement(source: string): RuntimeRequirement | undefined {
  const match = /^([A-Za-z][A-Za-z0-9._-]*)(?:>=(\d+(?:\.\d+){0,2}))?$/.exec(source);
  if (match === null) return undefined;
  const runtime = match[1]!;
  // `python>=3.11` is the documented manifest spelling while many hosts only
  // expose the executable as python3.
  const executable = runtime === "python" ? "python3" : runtime;
  return {
    source,
    executable,
    ...(match[2] === undefined ? {} : { minimum: match[2].split(".").map(Number) }),
  };
}

function parseVersion(output: string): readonly number[] | undefined {
  const match = /(?:^|\s|v)(\d+(?:\.\d+){0,2})(?:\s|$)/m.exec(output);
  return match === null ? undefined : match[1]!.split(".").map(Number);
}

function meetsMinimum(actual: readonly number[], minimum: readonly number[]): boolean {
  const length = Math.max(actual.length, minimum.length);
  for (let index = 0; index < length; index += 1) {
    const left = actual[index] ?? 0;
    const right = minimum[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

function unavailableDetail(result: OwnedProcessResult): string {
  if (!hasConfirmedOwnedGroupCleanup(result)) {
    return `owned process-group cleanup was not confirmed: ${result.groupCleanup.detail}`;
  }
  if (result.timedOut) return "timed out";
  if (result.error !== undefined) return "could not start";
  if (result.signal !== null) return `stopped by ${result.signal}`;
  return `exit ${result.exitCode}`;
}

async function checkRuntime(
  source: string,
  env: NodeJS.ProcessEnv,
  control: E2EExecutionControl,
): Promise<{ check?: CapabilityCheck; cancelled: boolean }> {
  const requirement = parseRuntimeRequirement(source);
  if (requirement === undefined) {
    return {
      cancelled: false,
      check: {
        kind: "runtime",
        subject: source,
        ok: false,
        detail: `unsupported runtime requirement ${JSON.stringify(source)}; use name or name>=major.minor`,
      },
    };
  }

  const command = [requirement.executable, "--version"];
  const result = await control.supervisor.run(command, {
    cwd: process.cwd(),
    env,
    output: "capture",
    stream: false,
    timeoutMs: 10_000,
    abortSignal: control.abortSignal,
  });
  const capture = toCapture(result);
  if (result.cancelled || isExecutionCancelled(control)) return { cancelled: true };
  if (!commandSucceeded(result)) {
    return {
      cancelled: false,
      check: {
        kind: "runtime",
        subject: source,
        ok: false,
        failureCategory: commandFailureCategory(result),
        detail: `${source} is unavailable (${unavailableDetail(result)})`,
        command,
        capture,
      },
    };
  }

  if (requirement.minimum !== undefined) {
    const actual = parseVersion(`${result.stdout}\n${result.stderr}`);
    if (actual === undefined || !meetsMinimum(actual, requirement.minimum)) {
      return {
        cancelled: false,
        check: {
          kind: "runtime",
          subject: source,
          ok: false,
          detail: `${source} requires at least ${requirement.minimum.join(".")}, found ${actual?.join(".") ?? "an unreadable version"}`,
          command,
          capture,
        },
      };
    }
  }

  return {
    cancelled: false,
    check: {
      kind: "runtime",
      subject: source,
      ok: true,
      detail: `${source} available`,
      command,
      capture,
    },
  };
}

async function checkDocker(
  env: NodeJS.ProcessEnv,
  control: E2EExecutionControl,
): Promise<{ check?: CapabilityCheck; cancelled: boolean }> {
  const command = ["docker", "info", "--format", "{{.ServerVersion}}"];
  const result = await control.supervisor.run(command, {
    cwd: process.cwd(),
    env,
    output: "capture",
    stream: false,
    timeoutMs: 10_000,
    abortSignal: control.abortSignal,
  });
  const capture = toCapture(result);
  if (result.cancelled || isExecutionCancelled(control)) return { cancelled: true };
  return {
    cancelled: false,
    check: {
      kind: "docker",
      subject: "daemon",
      ok: commandSucceeded(result),
      failureCategory: commandFailureCategory(result),
      detail:
        commandSucceeded(result)
          ? "Docker daemon available"
          : `Docker daemon is unavailable (${unavailableDetail(result)})`,
      command,
      capture,
    },
  };
}

/** Preflight prerequisites that do not require the isolated repo's dependencies. */
export async function preflightHostCapabilities(
  manifest: E2ERepoManifest,
  env: NodeJS.ProcessEnv,
  control: E2EExecutionControl,
): Promise<CapabilityPreflightResult> {
  const checks: CapabilityCheck[] = [];
  const requires = manifest.requires;

  if (requires?.platforms !== undefined) {
    const actual = hostPlatform();
    checks.push({
      kind: "platform",
      subject: actual,
      ok: requires.platforms.includes(actual as "linux" | "darwin"),
      detail: requires.platforms.includes(actual as "linux" | "darwin")
        ? `host platform ${actual} available`
        : `host platform ${actual} is not one of ${requires.platforms.join(", ")}`,
    });
  }

  for (const secret of manifest.secrets) {
    const available = typeof env[secret] === "string" && env[secret]!.length > 0;
    checks.push({
      kind: "secret",
      subject: secret,
      ok: available,
      detail: available ? `declared secret ${secret} available` : `declared secret ${secret} is missing or empty`,
    });
  }

  if (requires?.externalNetwork === true) {
    // A synthetic request would test an arbitrary endpoint rather than the
    // adapter/provider this repo owns, and could create cost or auth effects.
    // Keep the boundary visible instead of silently treating it as checked.
    checks.push({
      kind: "externalNetwork",
      subject: "outbound-network",
      ok: true,
      verification: "declared-unverified",
      detail: "external network declared; runner does not make a synthetic network request before test (declared but unverified)",
    });
  }

  for (const runtime of requires?.runtimes ?? []) {
    if (isExecutionCancelled(control)) return { ok: false, cancelled: true, checks };
    const checked = await checkRuntime(runtime, env, control);
    if (checked.cancelled) return { ok: false, cancelled: true, checks };
    if (checked.check !== undefined) checks.push(checked.check);
  }

  if (requires?.docker === true) {
    if (isExecutionCancelled(control)) return { ok: false, cancelled: true, checks };
    const checked = await checkDocker(env, control);
    if (checked.cancelled) return { ok: false, cancelled: true, checks };
    if (checked.check !== undefined) checks.push(checked.check);
  }

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    cancelled: false,
    checks,
    ...(!ok && checks.some((check) => !check.ok && check.failureCategory === "infra")
      ? { failureCategory: "infra" as const }
      : !ok
        ? { failureCategory: "configuration" as const }
        : {}),
  };
}

const browserPreflightProgram = String.raw`
const fs = require("node:fs");
const browsers = JSON.parse(process.argv[1]);
(async () => {
  let playwright;
  try {
    playwright = require("@playwright/test");
  } catch (error) {
    console.error("Playwright Test is not installed for this browser requirement:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  for (const browser of browsers) {
    const launcher = playwright[browser];
    if (!launcher || typeof launcher.executablePath !== "function" || typeof launcher.launch !== "function") {
      console.error("Unsupported Playwright browser:", browser);
      process.exit(1);
    }
    const override = process.env[browser.toUpperCase() + "_EXECUTABLE_PATH"];
    const executable = override || launcher.executablePath();
    if (!executable || !fs.existsSync(executable)) {
      console.error("Browser " + browser + " is unavailable at " + (executable || "(no executable path)"));
      process.exit(1);
    }
    let instance;
    try {
      instance = await launcher.launch({ headless: true, ...(override ? { executablePath: override } : {}) });
    } catch (error) {
      console.error("Browser " + browser + " cannot launch:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      if (instance) await instance.close();
    }
  }
})().catch((error) => {
  console.error("Browser preflight failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`;

/** Browser binaries are checked only after the isolated repo has installed its Playwright dependency. */
export async function preflightBrowsers(
  browsers: readonly Browser[] | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv,
  control: E2EExecutionControl,
): Promise<CapabilityPreflightResult> {
  const checks: CapabilityCheck[] = [];
  for (const browser of browsers ?? []) {
    if (isExecutionCancelled(control)) return { ok: false, cancelled: true, checks };
    const command = [process.execPath, "-e", browserPreflightProgram, JSON.stringify([browser])];
    const result = await control.supervisor.run(command, {
      cwd,
      env,
      output: "capture",
      stream: false,
      timeoutMs: 10_000,
      abortSignal: control.abortSignal,
    });
    const capture = toCapture(result);
    if (result.cancelled || isExecutionCancelled(control)) return { ok: false, cancelled: true, checks };
    const ok = commandSucceeded(result);
    checks.push({
      kind: "browser",
      subject: browser,
      ok,
      ...(!ok ? { failureCategory: commandFailureCategory(result) } : {}),
      detail: ok
        ? `Playwright browser ${browser} available`
        : `Playwright browser ${browser} is unavailable (${unavailableDetail(result)})`,
      command,
      capture,
    });
  }
  const ok = checks.every((check) => check.ok);
  return {
    ok,
    cancelled: false,
    checks,
    ...(!ok && checks.some((check) => !check.ok && check.failureCategory === "infra")
      ? { failureCategory: "infra" as const }
      : !ok
        ? { failureCategory: "configuration" as const }
        : {}),
  };
}
