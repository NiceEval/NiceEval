import { spawnSync } from "node:child_process";

const PREFIX_DAG_CASE = "necase_APN2MNBEXSN1G18T";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["exec", "tsc", "--noEmit"]);

const nativeArgs = process.argv.slice(2);
if (nativeArgs.length > 0) {
  run("python3", ["fixtures/subreaper-runner.py", "pnpm", "exec", "vitest", "run", ...nativeArgs]);
} else {
  run("python3", [
    "fixtures/subreaper-runner.py",
    "pnpm",
    "exec",
    "vitest",
    "run",
    "-t",
    `^(?!.*${PREFIX_DAG_CASE}).*$`,
  ]);
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
}
