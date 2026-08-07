const DIND_SUPERVISOR_REVISION = "niceeval-dind-supervisor-v1";
const DIND_LOG_PATH = "/tmp/dockerd.log";
const DIND_LOG_LIMIT_BYTES = 256 * 1024;
export const DIND_SHUTDOWN_GRACE_SECONDS = 3;

/**
 * Provider-owned DinD supervisor. It is a constant program passed to `node -e`;
 * author-controlled values are supplied only as argv and never interpolated into shell source.
 */
export const DIND_SUPERVISOR_SOURCE = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const LOG_PATH = ${JSON.stringify(DIND_LOG_PATH)};
const LOG_LIMIT = ${DIND_LOG_LIMIT_BYTES};
const GRACE_MS = ${DIND_SHUTDOWN_GRACE_SECONDS * 1000};
const keeperArgv = process.argv.slice(1);
let daemon;
let keeper;
let daemonExited = false;
let keeperExited = false;
let shuttingDown = false;
let shutdownCode = 1;
let daemonLog = Buffer.alloc(0);

function recordDaemonLog(chunk) {
  daemonLog = Buffer.concat([daemonLog, Buffer.from(chunk)]);
  if (daemonLog.length > LOG_LIMIT) daemonLog = daemonLog.subarray(daemonLog.length - LOG_LIMIT);
  fs.writeFileSync(LOG_PATH, daemonLog);
}

function terminate(child, exited) {
  if (child && !exited) {
    try { child.kill("SIGTERM"); } catch {}
  }
}

function finishWhenStopped() {
  if (shuttingDown && daemonExited && keeperExited) process.exit(shutdownCode);
}

function shutdown(code, printDaemonLog = false) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownCode = code;
  if (printDaemonLog && daemonLog.length > 0) {
    process.stderr.write("--- dockerd.log (tail) ---\n");
    process.stderr.write(daemonLog);
    if (daemonLog[daemonLog.length - 1] !== 10) process.stderr.write("\n");
  }
  terminate(daemon, daemonExited);
  terminate(keeper, keeperExited);
  setTimeout(() => process.exit(shutdownCode), GRACE_MS);
  finishWhenStopped();
}

function spawnFailure(name, error) {
  process.stderr.write("dind-supervisor: failed to spawn " + name + ": " + error.message + "\n");
  shutdown(1, name === "dockerd");
}

daemon = spawn("dockerd-entrypoint.sh", [
  "dockerd",
  "--host=unix:///var/run/docker.sock",
  "--shutdown-timeout=2",
], { stdio: ["ignore", "pipe", "pipe"] });
daemon.stdout.on("data", recordDaemonLog);
daemon.stderr.on("data", recordDaemonLog);
daemon.on("error", (error) => spawnFailure("dockerd", error));
daemon.on("exit", (code, signal) => {
  daemonExited = true;
  if (!shuttingDown) {
    process.stderr.write("dind-supervisor: dockerd exited unexpectedly (code=" + (code ?? "null") + ", signal=" + (signal ?? "null") + ")\n");
    shutdown(code && code > 0 ? code : 1, true);
  }
  finishWhenStopped();
});

if (keeperArgv.length === 0) {
  process.stderr.write("dind-supervisor: missing keeper argv\n");
  shutdown(1);
} else {
  keeper = spawn(keeperArgv[0], keeperArgv.slice(1), { stdio: "inherit" });
  keeper.on("error", (error) => spawnFailure("keeper", error));
  keeper.on("exit", (code) => {
    keeperExited = true;
    if (!shuttingDown) shutdown(code && code > 0 ? code : 0);
    finishWhenStopped();
  });
}

process.on("SIGTERM", () => shutdown(0, true));
process.on("SIGINT", () => shutdown(0));
`;

export const DIND_BOOTSTRAP_SOURCE = String.raw`set -eu
for tool in docker-init node docker dockerd-entrypoint.sh timeout tail; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "dind-image-incompatible: missing $tool" >&2
    exit 2
  fi
done
touch "$3"
chmod 666 "$3"
exec docker-init -- node -e "$1" timeout "$2" tail -n +1 -F "$3"`;

export function dindContainerCommand(
  ttlSeconds: number,
  logPath: string,
): { readonly Entrypoint: readonly string[]; readonly Cmd: readonly string[] } {
  const keeperSeconds = Math.max(1, ttlSeconds - DIND_SHUTDOWN_GRACE_SECONDS);
  return Object.freeze({
    Entrypoint: Object.freeze(["sh", "-c"]),
    Cmd: Object.freeze([
      DIND_BOOTSTRAP_SOURCE,
      DIND_SUPERVISOR_REVISION,
      DIND_SUPERVISOR_SOURCE,
      String(keeperSeconds),
      logPath,
    ]),
  });
}

export function dindSupervisorRevision(): string {
  return DIND_SUPERVISOR_REVISION;
}
