// Structured capability receipts. Missing prerequisites are results, not faults.

import { Data, Effect, Scope } from "effect";
import type { Browser, E2ERepoManifest } from "./manifest.ts";
import { hasConfirmedOwnedGroupCleanup, runOwnedProcess, type OwnedProcessResult } from "./owned-process.ts";
import type { CapabilityCheck, CommandCapture } from "./receipt.ts";

export interface CapabilityPreflightResult { readonly ok: boolean; readonly cancelled: boolean; readonly checks: readonly CapabilityCheck[]; readonly failureCategory?: "configuration" | "infra"; }
export class CapabilityPreflightError extends Data.TaggedError("CapabilityPreflightError")<{ readonly operation: "host" | "browser"; readonly detail: string; }> {}

function capture(result: OwnedProcessResult): CommandCapture { return { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled, stdout: result.stdout, stderr: result.stderr, ...(result.error === undefined ? {} : { error: result.error }), processGroupOwned: result.processGroupOwned, groupCleanup: result.groupCleanup }; }
function successful(result: OwnedProcessResult): boolean { return result.exitCode === 0 && result.signal === null && !result.timedOut && !result.cancelled && result.error === undefined && hasConfirmedOwnedGroupCleanup(result); }
function category(result: OwnedProcessResult): "configuration" | "infra" { return hasConfirmedOwnedGroupCleanup(result) ? "configuration" : "infra"; }
function unavailable(result: OwnedProcessResult): string { return !hasConfirmedOwnedGroupCleanup(result) ? result.groupCleanup.detail : result.timedOut ? "timed out" : result.error !== undefined ? "could not start" : result.signal !== null ? `stopped by ${result.signal}` : `exit ${result.exitCode}`; }
function result(checks: readonly CapabilityCheck[], cancelled = false): CapabilityPreflightResult { const ok = !cancelled && checks.every((check) => check.ok); return { ok, cancelled, checks, ...(!ok && !cancelled ? { failureCategory: checks.some((check) => !check.ok && check.failureCategory === "infra") ? "infra" as const : "configuration" as const } : {}) }; }
function hostPlatform(): string { return process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform; }

interface RuntimeRequirement { readonly source: string; readonly executable: string; readonly minimum?: readonly number[]; }
function runtime(source: string): RuntimeRequirement | undefined { const match = /^([A-Za-z][A-Za-z0-9._-]*)(?:>=(\d+(?:\.\d+){0,2}))?$/.exec(source); return match === null ? undefined : { source, executable: match[1] === "python" ? "python3" : match[1]!, ...(match[2] === undefined ? {} : { minimum: match[2].split(".").map(Number) }) }; }
function version(output: string): readonly number[] | undefined { const match = /(?:^|\s|v)(\d+(?:\.\d+){0,2})(?:\s|$)/m.exec(output); return match === null ? undefined : match[1]!.split(".").map(Number); }
function atLeast(actual: readonly number[], minimum: readonly number[]): boolean { for (let index = 0; index < Math.max(actual.length, minimum.length); index += 1) { const left = actual[index] ?? 0; const right = minimum[index] ?? 0; if (left !== right) return left > right; } return true; }

function checkRuntime(source: string, env: NodeJS.ProcessEnv): Effect.Effect<CapabilityCheck, CapabilityPreflightError, Scope.Scope | import("./owned-process.ts").OwnedProcess> {
  const requirement = runtime(source);
  if (requirement === undefined) return Effect.succeed({ kind: "runtime", subject: source, ok: false, detail: `unsupported runtime requirement ${JSON.stringify(source)}; use name or name>=major.minor` });
  const command = [requirement.executable, "--version"];
  return runOwnedProcess(command, { cwd: process.cwd(), env, output: "capture", stream: false, timeoutMs: 10_000 }).pipe(Effect.mapError((error) => new CapabilityPreflightError({ operation: "host", detail: error.detail })), Effect.map((executed): CapabilityCheck => {
    if (!successful(executed)) return { kind: "runtime", subject: source, ok: false, failureCategory: category(executed), detail: `${source} is unavailable (${unavailable(executed)})`, command, capture: capture(executed) };
    const actual = version(`${executed.stdout}\n${executed.stderr}`);
    return requirement.minimum !== undefined && (actual === undefined || !atLeast(actual, requirement.minimum)) ? { kind: "runtime", subject: source, ok: false, detail: `${source} requires at least ${requirement.minimum.join(".")}, found ${actual?.join(".") ?? "an unreadable version"}`, command, capture: capture(executed) } : { kind: "runtime", subject: source, ok: true, detail: `${source} available`, command, capture: capture(executed) };
  }));
}

function checkDocker(env: NodeJS.ProcessEnv): Effect.Effect<CapabilityCheck, CapabilityPreflightError, Scope.Scope | import("./owned-process.ts").OwnedProcess> {
  const command = ["docker", "info", "--format", "{{.ServerVersion}}"];
  return runOwnedProcess(command, { cwd: process.cwd(), env, output: "capture", stream: false, timeoutMs: 30_000 }).pipe(Effect.mapError((error) => new CapabilityPreflightError({ operation: "host", detail: error.detail })), Effect.map((executed): CapabilityCheck => ({ kind: "docker", subject: "daemon", ok: successful(executed), ...(!successful(executed) ? { failureCategory: category(executed) } : {}), detail: successful(executed) ? "Docker daemon available" : `Docker daemon is unavailable (${unavailable(executed)})`, command, capture: capture(executed) })));
}

/** Runs every declared host capability; one failed check never hides later checks. */
export function preflightHostCapabilities(manifest: E2ERepoManifest, env: NodeJS.ProcessEnv): Effect.Effect<CapabilityPreflightResult, CapabilityPreflightError, Scope.Scope | import("./owned-process.ts").OwnedProcess> {
  const requires = manifest.requires; const staticChecks: CapabilityCheck[] = [];
  if (requires?.platforms !== undefined) { const actual = hostPlatform(); staticChecks.push({ kind: "platform", subject: actual, ok: requires.platforms.includes(actual as "linux" | "darwin"), detail: requires.platforms.includes(actual as "linux" | "darwin") ? `host platform ${actual} available` : `host platform ${actual} is not one of ${requires.platforms.join(", ")}` }); }
  for (const secret of manifest.secrets) { const available = typeof env[secret] === "string" && env[secret]!.length > 0; staticChecks.push({ kind: "secret", subject: secret, ok: available, detail: available ? `declared secret ${secret} available` : `declared secret ${secret} is missing or empty` }); }
  if (requires?.externalNetwork === true) staticChecks.push({ kind: "externalNetwork", subject: "outbound-network", ok: true, verification: "declared-unverified", detail: "external network declared; runner does not make a synthetic network request before test (declared but unverified)" });
  return Effect.forEach(requires?.runtimes ?? [], (name) => checkRuntime(name, env)).pipe(Effect.flatMap((runtimeChecks) => requires?.docker === true ? checkDocker(env).pipe(Effect.map((docker) => result([...staticChecks, ...runtimeChecks, docker]))) : Effect.succeed(result([...staticChecks, ...runtimeChecks]))));
}

const browserProgram = "const fs=require('node:fs');const p=require('playwright');const b=process.argv[1];const l=p[b];if(!l||typeof l.executablePath!=='function')process.exit(2);const x=process.env[b.toUpperCase()+'_EXECUTABLE_PATH']||l.executablePath();if(!x||!fs.existsSync(x))process.exit(3);";
/** Browser preflight is intentionally after the isolated repo installs Playwright. */
export function preflightBrowsers(browsers: readonly Browser[] | undefined, cwd: string, env: NodeJS.ProcessEnv): Effect.Effect<CapabilityPreflightResult, CapabilityPreflightError, Scope.Scope | import("./owned-process.ts").OwnedProcess> {
  return Effect.forEach(browsers ?? [], (browser) => { const command = [process.execPath, "-e", browserProgram, browser]; return runOwnedProcess(command, { cwd, env, output: "capture", stream: false, timeoutMs: 10_000 }).pipe(Effect.mapError((error) => new CapabilityPreflightError({ operation: "browser", detail: error.detail })), Effect.map((executed): CapabilityCheck => ({ kind: "browser", subject: browser, ok: successful(executed), ...(!successful(executed) ? { failureCategory: category(executed) } : {}), detail: successful(executed) ? `Playwright browser ${browser} available` : `Playwright browser ${browser} is unavailable (${unavailable(executed)})`, command, capture: capture(executed) }))); }).pipe(Effect.map((checks) => result(checks)));
}
