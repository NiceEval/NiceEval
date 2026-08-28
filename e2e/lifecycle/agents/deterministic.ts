import { Effect } from "effect";
import { createHash } from "node:crypto";
import { acquireManagedProcess, completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
};

const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const FIRST_REUSE_MARKER = "/tmp/niceeval-lifecycle-first-attempt";
const SECOND_READY_MARKER = "/tmp/niceeval-lifecycle-second-attempt-ready";
const WORKDIR_MARKER = "niceeval-lifecycle-workdir-marker";

export const lifecycleSandbox = dockerSandbox({
  source: { type: "image", image: NODE_IMAGE },
  user: "node",
  lifetimeMs: 5 * 60_000,
  resources: {
    cpus: 1,
    memoryBytes: 512 * 1024 ** 2,
    pidsLimit: 128,
  },
});

export const managedProcessSandbox = dockerSandbox({
  source: { type: "image", image: NODE_IMAGE },
  user: "node",
  resources: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128 },
});

const ensure = {
  identity: { agent: "lifecycle-fixture", version: "24.19.0", revision: "1" },
  probe: shell('test "$(node --version)" = "v24.19.0"'),
};

const managedProcessEnsure = {
  identity: { agent: "lifecycle-managed-process", version: "1.0.0", revision: "1" },
  probe: shell("node --version >/dev/null"),
};

export const quickAgent = defineSandboxAgent({
  name: "lifecycle-docker-quick",
  evidenceCoverage,
  ensure,
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    await ctx.sandbox.runShellOrThrow(
      'test "$(id -u)" != 0 && printf "%s" "lifecycle-fixture-ok"',
      { signal: ctx.signal },
    );
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "lifecycle-fixture-ok" }],
    };

      },
      catch: (cause) => cause,
    }),
});

export const hangingAgent = defineSandboxAgent({
  name: "lifecycle-docker-reuse",
  evidenceCoverage,
  ensure,
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    const attempt = ctx.attempt?.index;
    if (attempt === 0) {
      await ctx.sandbox.runShellOrThrow(
        [
          "set -eu",
          `printf '%s' first > ${FIRST_REUSE_MARKER}`,
          `printf '%s' dirty > ${WORKDIR_MARKER}`,
        ].join("\n"),
        { signal: ctx.signal },
      );
      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: "first reuse attempt completed" }],
      };
    }
    if (attempt === 1) {
      await ctx.sandbox.runShellOrThrow(
        [
          "set -eu",
          `test -f ${FIRST_REUSE_MARKER}`,
          `test ! -e ${WORKDIR_MARKER}`,
          `printf '%s' ready > ${SECOND_READY_MARKER}`,
        ].join("\n"),
        { signal: ctx.signal },
      );
      const owned = await acquireManagedProcess(ctx, "lifecycle-fixture", { argv: ["node", "-e", hangingProgram] });
      for await (const chunk of owned.output) {
        if (chunk._tag === "Stdout" && Buffer.from(chunk.bytes).toString("utf8").includes("ready")) break;
      }
      if (!ctx.signal.aborted) {
        await new Promise<void>((resolve) => {
          const aborted = (): void => {
            ctx.signal.removeEventListener("abort", aborted);
            resolve();
          };
          ctx.signal.addEventListener("abort", aborted, { once: true });
          // Close the check/register window: AbortSignal does not replay an
          // abort that happened immediately before addEventListener.
          if (ctx.signal.aborted) aborted();
        });
      }
      throw new Error("second reuse attempt completed before interruption");
    }
    throw new Error(`unexpected lifecycle attempt index: ${String(attempt)}`);

      },
      catch: (cause) => cause,
    }),
});

const duplexProgram = [
  "const { createHash } = require('node:crypto')",
  "const chunks = []",
  "process.stderr.write('stderr-only')",
  "process.stdin.on('data', chunk => { chunks.push(chunk); process.stdin.pause(); setTimeout(() => process.stdin.resume(), 1) })",
  "process.stdin.on('end', () => { const bytes = Buffer.concat(chunks); process.stdout.write(JSON.stringify({ length: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') })) })",
].join(";");

const hangingProgram = [
  "process.stdout.write('ready\\n')",
  "process.stdin.resume()",
  "setInterval(() => {}, 1000)",
].join(";");

async function collect(process: Awaited<ReturnType<typeof acquireManagedProcess>>): Promise<{ stdout: Buffer; stderr: Buffer }> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  for await (const chunk of process.output) {
    const bytes = Buffer.from(chunk.bytes);
    if (chunk._tag === "Stdout") stdout.push(bytes);
    else stderr.push(bytes);
  }
  return { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

export const managedProcessAgent = defineSandboxAgent({
  name: "lifecycle-managed-process",
  evidenceCoverage,
  ensure: managedProcessEnsure,
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    const payload = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    const natural = await acquireManagedProcess(ctx, "lifecycle-fixture", {
      argv: ["node", "-e", duplexProgram],
      cwd: ".",
      env: { NICEEVAL_MANAGED_PROCESS_FIXTURE: "duplex" },
    });
    const output = collect(natural);
    await natural.writeStdin(payload);
    const close1 = natural.closeStdin();
    const close2 = natural.closeStdin();
    if (close1 !== close2) throw new Error("closeStdin did not share its receipt");
    await close1;
    const wait1 = natural.wait();
    const wait2 = natural.wait();
    if (wait1 !== wait2) throw new Error("wait did not share its receipt");
    const [exit, captured] = await Promise.all([wait1, output]);
    const summary = JSON.parse(captured.stdout.toString("utf8")) as { length: number; hash: string };
    const expectedHash = createHash("sha256").update(payload).digest("hex");
    if (exit.exitCode !== 0 || summary.length !== payload.length || summary.hash !== expectedHash) {
      throw new Error(`managed process duplex mismatch: ${JSON.stringify({ exit, summary, expectedHash })}`);
    }
    if (captured.stderr.toString("utf8") !== "stderr-only") throw new Error("stderr was not kept separate");
    await natural.writeStdin(Buffer.of(1)).then(
      () => { throw new Error("managed process accepted stdin after EOF"); },
      () => undefined,
    );

    const killed = await acquireManagedProcess(ctx, "lifecycle-fixture", { argv: ["node", "-e", hangingProgram] });
    const ready = (async () => {
      for await (const chunk of killed.output) {
        if (chunk._tag === "Stdout" && Buffer.from(chunk.bytes).toString("utf8").includes("ready")) return;
      }
      throw new Error("terminable managed process exited before ready");
    })();
    await ready;
    const terminate1 = killed.terminate();
    const terminate2 = killed.terminate();
    if (terminate1 !== terminate2) throw new Error("terminate did not share its receipt");
    await terminate1;
    const killedExit = await killed.wait();
    if (killedExit.exitCode === 0 && killedExit.signal === undefined) throw new Error("terminate did not stop the process");
    await killed.writeStdin(Buffer.of(1)).then(
      () => { throw new Error("managed process accepted a late write after terminate"); },
      () => undefined,
    );

    // This process deliberately survives EOF. Attempt cleanup must take the bounded
    // terminate fallback before the Sandbox itself is released.
    const cleanup = await acquireManagedProcess(ctx, "lifecycle-fixture", { argv: ["node", "-e", hangingProgram] });
    for await (const chunk of cleanup.output) {
      if (chunk._tag === "Stdout" && Buffer.from(chunk.bytes).toString("utf8").includes("ready")) break;
    }

    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "managed-process-contract-ok" }],
    };

      },
      catch: (cause) => cause,
    }),
});
