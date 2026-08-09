#!/usr/bin/env node
// niceeval entrypoint.  The ordinary path registers tsx after loading the
// canonical compiled runtime.  `list --json` has one additional outer process:
// it owns stdout/stderr and delegates config/Eval loading to a fresh worker over
// fd 3, so executable project code cannot corrupt the machine document.

const LIST_WORKER_MARKER = "--__niceeval-list-machine-worker";
const LIST_WORKER_SYMBOL = Symbol.for("niceeval.list-machine-worker");
const MAX_MACHINE_BYTES = 1024 * 1024;
const WORKER_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 2_000;

const invocationArgs = process.argv.slice(2);
const markerIndex = invocationArgs.indexOf(LIST_WORKER_MARKER);

if (markerIndex >= 0) {
  // The marker is private transport state, not a user-visible CLI flag.
  process.argv.splice(markerIndex + 2, 1);
  globalThis[LIST_WORKER_SYMBOL] = true;
  await launchCli();
} else if (isMachineListInvocation(invocationArgs)) {
  try {
    await runMachineList(invocationArgs);
  } catch (error) {
    writeMachineError("eval-root.machine-worker-failed", messageOf(error));
    process.exitCode = 2;
  }
} else {
  await launchCli();
}

async function launchCli() {
  // Register both faces before importing the CLI module.  `src/cli.ts` starts
  // its async main at module evaluation time; registering afterwards leaves a
  // microtask window where a CommonJS consumer config can hit Node's native
  // loader and emit MODULE_TYPELESS_PACKAGE_JSON to stderr (which corrupts the
  // list JSON contract).  The canonical runtime is precompiled `.cjs`, so tsx
  // delegates it and only owns later project TypeScript imports.
  const { register: registerCjs } = await import("tsx/cjs/api");
  const { register: registerEsm } = await import("tsx/esm/api");
  registerCjs();
  registerEsm();
  const cliUrl = new URL("../dist/cli.cjs", import.meta.url);
  await import(cliUrl.href);
}

function isMachineListInvocation(args) {
  // This is only enough parsing to locate the command before loading NiceEval;
  // the real CLI still owns validation.  Skip values of known string flags so
  // `--tag list` cannot be mistaken for the command, while allowing ordinary
  // option-before-command invocation such as `niceeval --json list`.
  const valueFlags = new Set([
    "--agent", "--model", "--attempts", "--max-concurrency", "--max-build-concurrency", "--timeout", "--budget",
    "--tag", "--junit", "--out", "--port", "--host", "--source", "--grep", "--expand", "--window", "--path",
    "--exp", "--record", "--run", "--report", "--page", "--theme", "--accept-transfer",
  ]);
  let command;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      command = args[index + 1];
      break;
    }
    if (arg.startsWith("--")) {
      if (!arg.includes("=") && valueFlags.has(arg)) index += 1;
      continue;
    }
    command = arg;
    break;
  }
  return command === "list" && args.some((arg) => arg === "--json");
}

function hasPreload() {
  const tokens = [
    ...process.execArgv,
    ...(process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean),
  ];
  return tokens.some((token) =>
    token === "--require" || token === "-r" || token.startsWith("--require=") || token.startsWith("-r=") ||
    token === "--import" || token.startsWith("--import=") || token === "--loader" || token.startsWith("--loader=") ||
    token === "--experimental-loader" || token.startsWith("--experimental-loader="),
  );
}

async function runMachineList(args) {
  if (await isYarnPnpProject()) {
    writeMachineError(
      "eval-root.yarn-pnp-unsupported",
      "Yarn Plug'n'Play does not expose the node-modules installation tree required by defineRemoteEval. Use Yarn's node-modules linker.",
    );
    process.exitCode = 1;
    return;
  }
  if (hasPreload()) {
    writeMachineError(
      "eval-root.preloaded-owner-unsupported",
      "A Node preload can write before NiceEval owns the machine protocol. Clear NODE_OPTIONS and Node preload flags before using list --json.",
    );
    process.exitCode = 1;
    return;
  }

  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [process.argv[1], LIST_WORKER_MARKER, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_OPTIONS: "" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });
  const outcome = await awaitMachineWorker(child);
  if (outcome.reason === "output-limit") {
    writeMachineError("eval-root.machine-output-limit", "The list worker wrote more than 1 MiB to a captured stream.");
    process.exitCode = 2;
    return;
  }
  if (outcome.reason === "timeout" || outcome.reason === "exit-fd-held") {
    writeMachineError("eval-root.machine-timeout", "The list worker did not close its protocol streams within the allowed time.");
    process.exitCode = 2;
    return;
  }
  if (outcome.reason === "spawn-error") {
    writeMachineError("eval-root.machine-worker-failed", outcome.error ?? "Unable to start the list worker.");
    process.exitCode = 2;
    return;
  }
  if (outcome.stdoutBytes > 0 || outcome.stderrBytes > 0) {
    writeMachineError(
      "eval-root.machine-output-contaminated",
      "The list worker or loaded project code wrote to captured stdout or stderr.",
    );
    process.exitCode = 2;
    return;
  }

  const document = decodeMachineFrame(outcome.protocol);
  if (document === undefined) {
    writeMachineError("eval-root.machine-protocol-invalid", "The list worker did not return exactly one valid protocol frame.");
    process.exitCode = 2;
    return;
  }
  if (document.format === "niceeval.error") {
    if (outcome.exitCode !== 1) {
      writeMachineError("eval-root.machine-protocol-invalid", "The list worker returned an error frame with an invalid exit status.");
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`${JSON.stringify(document)}\n`);
    process.exitCode = 1;
    return;
  }
  if (outcome.exitCode !== 0) {
    writeMachineError("eval-root.machine-protocol-invalid", "The list worker returned a success frame with a non-zero exit status.");
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(document)}\n`);
}

async function isYarnPnpProject() {
  const { existsSync } = await import("node:fs");
  const { dirname, join, resolve } = await import("node:path");
  let current = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(current, ".pnp.cjs")) || existsSync(join(current, ".pnp.js"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** Drain all pipes continuously; a grandchild holding fd 3 cannot block forever. */
function awaitMachineWorker(child) {
  return new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let protocolBytes = 0;
    const protocolChunks = [];
    let exitCode = null;
    let workerError;
    let settled = false;
    let reason;
    let exitTimer;
    const deadline = setTimeout(() => terminate("timeout"), WORKER_TIMEOUT_MS);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (exitTimer !== undefined) clearTimeout(exitTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdio[3]?.destroy();
      resolve({
        reason,
        stdoutBytes,
        stderrBytes,
        protocol: Buffer.concat(protocolChunks),
        exitCode,
        error: workerError,
      });
    };

    const signalGroup = (signal) => {
      if (child.pid !== undefined && process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process may already have exited; fall through to ChildProcess.
        }
      }
      child.kill(signal);
    };

    function terminate(nextReason) {
      if (settled || reason !== undefined) return;
      reason = nextReason;
      signalGroup("SIGTERM");
      setTimeout(() => {
        signalGroup("SIGKILL");
        // `close` normally follows immediately.  Resolve even if a hostile
        // grandchild somehow retained all descriptors after the group kill.
        setTimeout(finish, 25);
      }, KILL_GRACE_MS).unref();
    }

    const consume = (stream, target) => {
      stream?.on("data", (chunk) => {
        const bytes = Buffer.byteLength(chunk);
        if (target === "stdout") stdoutBytes += bytes;
        else if (target === "stderr") stderrBytes += bytes;
        else {
          protocolBytes += bytes;
          if (protocolBytes <= MAX_MACHINE_BYTES + 4) protocolChunks.push(Buffer.from(chunk));
        }
        if (stdoutBytes > MAX_MACHINE_BYTES || stderrBytes > MAX_MACHINE_BYTES || protocolBytes > MAX_MACHINE_BYTES + 4) {
          terminate("output-limit");
        }
      });
    };
    consume(child.stdout, "stdout");
    consume(child.stderr, "stderr");
    consume(child.stdio[3], "protocol");

    child.once("error", (error) => {
      reason = "spawn-error";
      workerError = messageOf(error);
      finish();
    });
    child.once("exit", (code) => {
      exitCode = code;
      // A child can exit while a descendant retains fd 3.  Give normal pipe
      // close a short grace interval, then kill the whole detached group.
      exitTimer = setTimeout(() => terminate("exit-fd-held"), KILL_GRACE_MS);
    });
    child.once("close", (code) => {
      exitCode = code;
      finish();
    });
  });
}

function decodeMachineFrame(bytes) {
  if (bytes.byteLength < 4) return undefined;
  const length = bytes.readUInt32BE(0);
  if (length === 0 || length > MAX_MACHINE_BYTES || bytes.byteLength !== length + 4) return undefined;
  let document;
  try {
    document = JSON.parse(bytes.subarray(4).toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(document) || document.schemaVersion !== 1) return undefined;
  if (document.format === "niceeval.evals" && Array.isArray(document.evals)) return document;
  if (document.format === "niceeval.eval-roots" && Array.isArray(document.roots)) return document;
  if (document.format === "niceeval.error" && isRecord(document.error) &&
    typeof document.error.code === "string" && typeof document.error.message === "string") return document;
  return undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeMachineError(code, message) {
  process.stderr.write(`${JSON.stringify({
    format: "niceeval.error",
    schemaVersion: 1,
    error: { code, message },
  })}\n`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
