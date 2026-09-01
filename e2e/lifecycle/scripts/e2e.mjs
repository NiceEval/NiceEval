import { spawnSync } from "node:child_process";

const PREFIX_DAG_CASE = "necase_APN2MNBEXSN1G18T";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["exec", "tsc", "--noEmit"]);

const rawArgs = process.argv.slice(2);
const nativeArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
if (nativeArgs.length > 0) {
  run("python3", ["fixtures/subreaper-runner.py", "pnpm", "exec", "vitest", "run", ...nativeArgs]);
} else {
  // Run the scheduling-sensitive case against a fresh lifecycle state domain.
  // The remaining Docker lifecycle cases are intentionally second: several of
  // them exercise interruption and long-running cleanup, which can leave host
  // capacity recovery in flight even after their assertions have completed.
  run("python3", [
    "fixtures/subreaper-runner.py",
    "pnpm",
    "exec",
    "vitest",
    "run",
    "test/sandbox-setup-prefix-cache.test.ts",
    "-t",
    PREFIX_DAG_CASE,
  ]);
  run("python3", [
    "fixtures/subreaper-runner.py",
    "pnpm",
    "exec",
    "vitest",
    "run",
    "-t",
    `^(?!.*${PREFIX_DAG_CASE}).*$`,
  ]);
}
