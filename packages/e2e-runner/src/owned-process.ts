// Scope-owned execution of commands used by the E2E runner.
//
// A POSIX command receives a detached process group. The group, rather than
// merely its leader, is the resource this service owns and releases.

import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { Context, Data, Deferred, Effect, Layer, Option, Scope } from "effect";

export type OwnedProcessOutput = "capture" | "inherit";
export type OwnedTermination = "timeout" | "cancelled";

export interface OwnedProcessOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly output: OwnedProcessOutput;
  readonly stream?: boolean;
  readonly timeoutMs?: number;
  readonly streamPrefix?: string;
}

export interface OwnedProcessGroupCleanup {
  readonly owned: boolean;
  readonly checked: boolean;
  readonly aliveAfterLeaderClose: boolean | null;
  readonly groupId?: number;
  readonly signalsSent: readonly NodeJS.Signals[];
  readonly gone: boolean | null;
  readonly detail: string;
}

export interface OwnedProcessResult {
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  readonly processGroupOwned: boolean;
  readonly groupCleanup: OwnedProcessGroupCleanup;
}

export class OwnedProcessError extends Data.TaggedError("OwnedProcessError")<{
  readonly operation: "spawn" | "observe";
  readonly detail: string;
}> {}

export class E2EExecutionCancelledError extends Data.TaggedError("E2EExecutionCancelledError")<{
  readonly detail: string;
}> {}

export interface OwnedProcessService {
  readonly run: (command: readonly string[], options: OwnedProcessOptions) => Effect.Effect<OwnedProcessResult, OwnedProcessError, Scope.Scope>;
  readonly requestStop: (signal: NodeJS.Signals) => Effect.Effect<void>;
  readonly stop: (signal: NodeJS.Signals) => Effect.Effect<void>;
  readonly forceKill: Effect.Effect<void>;
  readonly activeCount: Effect.Effect<number>;
  readonly awaitIdle: Effect.Effect<void>;
}

export class OwnedProcess extends Context.Service<OwnedProcess, OwnedProcessService>()("niceeval/e2e/OwnedProcess") {}

export const runOwnedProcess = (command: readonly string[], options: OwnedProcessOptions) => Effect.flatMap(OwnedProcess, (service) => service.run(command, options));
export const requestStopOwnedProcesses = (signal: NodeJS.Signals) => Effect.flatMap(OwnedProcess, (service) => service.requestStop(signal));
export const stopOwnedProcesses = (signal: NodeJS.Signals) => Effect.flatMap(OwnedProcess, (service) => service.stop(signal));
export const forceKillOwnedProcesses = Effect.flatMap(OwnedProcess, (service) => service.forceKill);
export const observeOwnedProcessActivity = Effect.flatMap(OwnedProcess, (service) => service.activeCount);

function noOwnedGroupCleanup(detail: string): OwnedProcessGroupCleanup {
  return { owned: false, checked: false, aliveAfterLeaderClose: null, signalsSent: [], gone: null, detail };
}

export function hasConfirmedOwnedGroupCleanup(result: Pick<OwnedProcessResult, "processGroupOwned" | "groupCleanup">): boolean {
  return !result.processGroupOwned || result.groupCleanup.gone === true;
}

export function hasSuccessfulOwnedProcessResult(result: Pick<OwnedProcessResult, "exitCode" | "signal" | "timedOut" | "cancelled" | "error" | "processGroupOwned" | "groupCleanup">): boolean {
  return result.exitCode === 0 && result.signal === null && !result.timedOut && !result.cancelled && result.error === undefined && hasConfirmedOwnedGroupCleanup(result);
}

type GroupPresence = "alive" | "zombie-only" | "gone" | "unknown";

function groupPresence(groupId: number): GroupPresence {
  try {
    process.kill(-groupId, 0);
    // `/proc/<pid>/stat` is a Linux-only kernel snapshot needed to distinguish
    // a reaping-only zombie group from a live descendant group. It is kept in
    // this one low-level observation adapter; process ownership never escapes it.
    if (process.platform === "linux") {
      const members = readdirSync("/proc", { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) return [];
        try { const stat = readFileSync(`/proc/${entry.name}/stat`, "utf8"); const fields = stat.slice(stat.lastIndexOf(")") + 1).trimStart().split(/\s+/u); return Number(fields[2]) === groupId ? [fields[0] === "Z" || fields[0] === "X"] : []; } catch { return []; }
      });
      if (members.length > 0 && members.every(Boolean)) return "zombie-only";
    }
    return "alive";
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown";
  }
}

interface Active {
  readonly child: ChildProcess;
  readonly command: readonly string[];
  readonly groupId?: number;
  readonly groupOwned: boolean;
  readonly signals: NodeJS.Signals[];
  stdout: string;
  stderr: string;
  error?: string;
  termination?: OwnedTermination;
  terminationDeadline?: number;
  closed?: readonly [number | null, NodeJS.Signals | null];
  readonly closeListeners: Set<(result: readonly [number | null, NodeJS.Signals | null]) => void>;
  readonly shutdownResult: Deferred.Deferred<OwnedProcessResult>;
}

function signal(active: Active, name: NodeJS.Signals, reason?: OwnedTermination): void {
  if (reason !== undefined && active.termination === undefined) active.termination = reason;
  try {
    if (active.groupOwned && active.groupId !== undefined) { process.kill(-active.groupId, name); active.signals.push(name); }
    else active.child.kill(name);
  } catch { /* an already-gone child still resolves through close */ }
}

function waitForClose(active: Active): Effect.Effect<readonly [number | null, NodeJS.Signals | null]> {
  return Effect.callback((resume) => {
    if (active.closed !== undefined) { resume(Effect.succeed(active.closed)); return Effect.void; }
    const listener = (closed: readonly [number | null, NodeJS.Signals | null]) => resume(Effect.succeed(closed));
    active.closeListeners.add(listener);
    return Effect.sync(() => { active.closeListeners.delete(listener); });
  });
}

function waitForGroup(groupId: number, duration: number): Effect.Effect<GroupPresence> {
  return Effect.suspend(() => {
    const presence = groupPresence(groupId);
    return presence === "alive" && duration > 0 ? Effect.sleep(Math.min(100, duration)).pipe(Effect.andThen(waitForGroup(groupId, duration - 100))) : Effect.succeed(presence);
  });
}

function cleanupGroup(active: Active, graceMs: number): Effect.Effect<OwnedProcessGroupCleanup> {
  if (!active.groupOwned || active.groupId === undefined) return Effect.succeed(noOwnedGroupCleanup("no detached POSIX process group was created on this host"));
  const initial = groupPresence(active.groupId);
  if (initial === "gone" || initial === "zombie-only") return Effect.succeed<OwnedProcessGroupCleanup>({ owned: true, checked: true, aliveAfterLeaderClose: false, groupId: active.groupId, signalsSent: active.signals, gone: true, detail: `owned process group ${active.groupId} has no running members after leader close` });
  if (initial === "unknown") return Effect.succeed<OwnedProcessGroupCleanup>({ owned: true, checked: true, aliveAfterLeaderClose: null, groupId: active.groupId, signalsSent: active.signals, gone: false, detail: `could not verify owned process group ${active.groupId} after leader close` });
  signal(active, "SIGTERM");
  return waitForGroup(active.groupId, graceMs).pipe(Effect.flatMap((afterTerm) => {
    if (afterTerm === "gone" || afterTerm === "zombie-only") return Effect.succeed<OwnedProcessGroupCleanup>({ owned: true, checked: true, aliveAfterLeaderClose: true, groupId: active.groupId!, signalsSent: active.signals, gone: true, detail: `owned process group ${active.groupId} drained after TERM grace` });
    if (afterTerm === "unknown") return Effect.succeed<OwnedProcessGroupCleanup>({ owned: true, checked: true, aliveAfterLeaderClose: true, groupId: active.groupId!, signalsSent: active.signals, gone: false, detail: `could not verify owned process group ${active.groupId} after TERM grace` });
    return Effect.sync(() => signal(active, "SIGKILL")).pipe(Effect.andThen(waitForGroup(active.groupId!, graceMs)), Effect.map((afterKill): OwnedProcessGroupCleanup => ({ owned: true, checked: true, aliveAfterLeaderClose: true, groupId: active.groupId!, signalsSent: active.signals, gone: afterKill === "gone" || afterKill === "zombie-only", detail: afterKill === "gone" || afterKill === "zombie-only" ? `owned process group ${active.groupId} required KILL after leader close` : `owned process group ${active.groupId} remained after TERM/grace/KILL cleanup` })));
  }));
}

function acquireActive(command: readonly string[], options: OwnedProcessOptions, active: Set<Active>): Effect.Effect<Active, OwnedProcessError> {
  return Effect.flatMap(Deferred.make<OwnedProcessResult>(), (shutdownResult) => Effect.try({ try: () => {
    if (command[0] === undefined) throw new Error("owned process command must contain an executable");
    const groupOwned = process.platform !== "win32";
    const child = spawn(command[0], command.slice(1), { cwd: options.cwd, env: options.env, detached: groupOwned, stdio: options.output === "capture" ? ["ignore", "pipe", "pipe"] : "inherit" });
    const entry: Active = { child, command, groupOwned, ...(groupOwned && child.pid !== undefined && child.pid !== process.pid ? { groupId: child.pid } : {}), signals: [], stdout: "", stderr: "", closeListeners: new Set(), shutdownResult };
    if (options.output === "capture") {
      const write = (channel: "stdout" | "stderr", chunk: Buffer | string) => { const text = String(chunk); entry[channel] += text; if (options.stream !== false) process[channel].write(options.streamPrefix === undefined ? text : text.split("\\n").map((line) => `${options.streamPrefix}${line}`).join("\\n")); };
      child.stdout?.on("data", (chunk) => write("stdout", chunk)); child.stderr?.on("data", (chunk) => write("stderr", chunk));
    }
    child.once("error", (error) => { entry.error = error.message; });
    child.once("close", (code, exitSignal) => { entry.closed = [code, exitSignal]; for (const listener of entry.closeListeners) listener(entry.closed); entry.closeListeners.clear(); });
    active.add(entry); return entry;
  }, catch: (cause) => new OwnedProcessError({ operation: "spawn", detail: cause instanceof Error ? cause.message : "could not spawn command" }) }));
}

function complete(active: Active, graceMs: number): Effect.Effect<OwnedProcessResult> {
  return waitForClose(active).pipe(
    Effect.flatMap(([exitCode, exitSignal]) => cleanupGroup(active, graceMs).pipe(
      Effect.map((groupCleanup) => ({ command: active.command, exitCode, signal: exitSignal, timedOut: active.termination === "timeout", cancelled: active.termination === "cancelled", stdout: active.stdout, stderr: active.stderr, ...(active.error === undefined ? {} : { error: active.error }), processGroupOwned: active.groupOwned, groupCleanup })),
    )),
  );
}

function resultFromClose(active: Active, close: readonly [number | null, NodeJS.Signals | null], graceMs: number): Effect.Effect<OwnedProcessResult> {
  return cleanupGroup(active, graceMs).pipe(Effect.map((groupCleanup) => ({ command: active.command, exitCode: close[0], signal: close[1], timedOut: active.termination === "timeout", cancelled: active.termination === "cancelled", stdout: active.stdout, stderr: active.stderr, ...(active.error === undefined ? {} : { error: active.error }), processGroupOwned: active.groupOwned, groupCleanup })));
}

/** TERM and close race against one bounded grace. A TERM-ignoring leader is KILLed before close is awaited. */
function shutdownRaw(active: Active, graceMs: number, reason: OwnedTermination, firstSignal: NodeJS.Signals): Effect.Effect<OwnedProcessResult> {
  const begin = active.termination === undefined
    ? Effect.sync(() => signal(active, firstSignal, reason))
    : Effect.void;
  return begin.pipe(
    Effect.andThen(waitForClose(active).pipe(Effect.timeoutOption(graceMs))),
    Effect.flatMap((close) => Option.isSome(close)
      ? resultFromClose(active, close.value, graceMs)
      : Effect.sync(() => signal(active, "SIGKILL")).pipe(Effect.andThen(waitForClose(active)), Effect.flatMap((afterKill) => resultFromClose(active, afterKill, graceMs)))),
  );
}

/** All owners share one uninterruptible group shutdown, including the close tuple and descendant cleanup. */
function shutdown(active: Active, graceMs: number, reason: OwnedTermination, firstSignal: NodeJS.Signals = "SIGTERM"): Effect.Effect<OwnedProcessResult> {
  return Effect.gen(function* () {
    const completed = yield* Deferred.poll(active.shutdownResult);
    if (Option.isSome(completed)) return yield* completed.value;
    const result = yield* shutdownRaw(active, graceMs, reason, firstSignal);
    yield* Deferred.succeed(active.shutdownResult, result);
    return yield* Deferred.await(active.shutdownResult);
  }).pipe(Effect.uninterruptible);
}

export function ownedProcessLayer(options: { readonly graceMs?: number } = {}): Layer.Layer<OwnedProcess, never, never> {
  const graceMs = options.graceMs ?? 5_000;
  return Layer.effect(OwnedProcess, Effect.gen(function* () {
    const active = new Set<Active>(); let stoppingSignal: NodeJS.Signals | undefined;
    yield* Effect.addFinalizer(() => Effect.forEach(active, (entry) => shutdown(entry, graceMs, "cancelled").pipe(Effect.asVoid), { discard: true, concurrency: "unbounded" }));
    const requestStop = (name: NodeJS.Signals) => Effect.sync(() => {
      stoppingSignal ??= name;
      for (const entry of active) signal(entry, name, "cancelled");
    });
    return {
      run: (command, processOptions) => Effect.suspend(() => {
        if (stoppingSignal !== undefined) return Effect.succeed({ command, exitCode: null, signal: stoppingSignal, timedOut: false, cancelled: true, stdout: "", stderr: "", processGroupOwned: false, groupCleanup: noOwnedGroupCleanup("command did not start because runner cancellation was already requested") });
        return Effect.acquireRelease(acquireActive(command, processOptions, active), (entry) => shutdown(entry, graceMs, "cancelled").pipe(Effect.asVoid, Effect.ensuring(Effect.sync(() => active.delete(entry))))).pipe(Effect.flatMap((entry) => {
          const done = complete(entry, graceMs);
          const timed = processOptions.timeoutMs === undefined ? done : Effect.raceFirst(done, Effect.sleep(processOptions.timeoutMs).pipe(Effect.andThen(shutdown(entry, graceMs, "timeout"))));
          return timed.pipe(Effect.tap(() => Effect.sync(() => active.delete(entry))));
        }));
      }),
      requestStop,
      stop: (name) => requestStop(name).pipe(Effect.andThen(Effect.forEach(active, (entry) => shutdown(entry, graceMs, "cancelled", name), { discard: true, concurrency: "unbounded" }))),
      forceKill: Effect.suspend(() => Effect.forEach(active, (entry) => Effect.sync(() => signal(entry, "SIGKILL")), { discard: true })),
      activeCount: Effect.sync(() => active.size),
      awaitIdle: Effect.suspend(() => active.size === 0 ? Effect.void : Effect.forEach(active, (entry) => shutdown(entry, graceMs, "cancelled"), { discard: true, concurrency: "unbounded" }).pipe(Effect.asVoid)),
    } satisfies OwnedProcessService;
  }));
}

export const OwnedProcessLive = ownedProcessLayer();
