import { execa } from "execa";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const driver = fileURLToPath(import.meta.url);
const spec = (file: string) => join(import.meta.dirname, file);
const output = (cwd: string, args: readonly string[]) => execa(process.execPath, [cli, ...args], { cwd });

async function writeProject(cwd: string, blocking: boolean) {
  await Promise.all(["evals", "experiments"].map((directory) => mkdir(join(cwd, directory))));
  await Promise.all([
    writeFile(
      join(cwd, "niceeval.config.ts"),
      `
      import { defineConfig } from "niceeval";
      export default defineConfig({ maxRetries: 0 });
    `,
    ),
    writeFile(
      join(cwd, "adapter.ts"),
      `
      import { once } from "node:events";
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      import { defineAdapter } from "niceeval/adapter";
      import { equals } from "niceeval/expect";
      export default defineAdapter({
        name: "bombadil-fixture",
        create(context) {
          ${
            blocking
              ? `
            const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              detached: true, stdio: "ignore",
            });
            const closed = once(child, "close");
            context.onCleanup(async () => {
              child.kill("SIGKILL");
              await closed;
            });
            writeFileSync(${JSON.stringify(join(cwd, "child.pid"))}, String(child.pid));
          `
              : ""
          }
          return {};
        },
        assertions: ({ check }) => ({ ready: () => check(1, equals(1)) }),
      });
    `,
    ),
    writeFile(
      join(cwd, "experiments", "pilot.ts"),
      `
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({ adapter, evals: ["pilot"], attempts: 1 });
    `,
    ),
    writeFile(
      join(cwd, "evals", "pilot.eval.ts"),
      `
      import adapter from "../adapter.ts";
      export default adapter.defineEval({
        async test(t) {
          ${
            blocking
              ? `
            await new Promise((done) => {
              if (t.signal.aborted) done(undefined);
              else t.signal.addEventListener("abort", () => done(undefined), { once: true });
            });
          `
              : "t.ready();"
          }
        },
      });
    `,
    ),
  ]);
}

async function childPid(cwd: string): Promise<number | undefined> {
  try {
    const pid = Number(await readFile(join(cwd, "child.pid"), "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid fixture child PID: ${pid}`);
    return pid;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function childAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

async function checkExp(root: string) {
  // In cooked mode the PTY sends SIGINT to the foreground group. Keep the
  // monitor alive to observe the CLI and its child. In raw mode only exp reads Ctrl+C.
  process.on("SIGINT", () => {});
  const cwd = await mkdtemp(join(root, "exp-"));
  try {
    await writeProject(cwd, true);
    const child = execa(process.execPath, [cli, "exp", "pilot", "--rerun", "all"], {
      cwd,
      stdio: "inherit",
      reject: false,
      cleanup: false,
    });
    if (process.env.NICEEVAL_BOMBADIL_INTERRUPT_PHASE === "startup") {
      console.log("test: exp can be interrupted");
    }
    const result = await child;
    const pid = await childPid(cwd);
    if (pid !== undefined && childAlive(pid)) {
      throw new Error(`exp left fixture child ${pid} alive`);
    }
    if (result.exitCode !== 130 && result.signal !== "SIGINT") {
      throw new Error(`Expected exp interruption, got exit ${result.exitCode}, signal ${result.signal}`);
    }
    if (process.env.NICEEVAL_BOMBADIL_INTERRUPT_PHASE !== "startup" && pid === undefined) {
      throw new Error("exp exited before its fixture child began");
    }
    await writeFile(join(root, "verified"), "");
    console.log("test: exp interrupted and children gone");
  } catch (error) {
    await writeFile(join(root, "failed"), String(error));
    throw error;
  } finally {
    const pid = await childPid(cwd);
    if (pid !== undefined && childAlive(pid)) process.kill(pid, "SIGKILL");
    await rm(cwd, { recursive: true, force: true });
  }
}

async function terminal(cwd: string, mode: string, args: readonly string[]) {
  const result = await execa(
    "bombadil",
    [
      "terminal",
      mode,
      "--specification",
      spec("exp-interrupt.ts"),
      ...args,
      "--",
      process.execPath,
      driver,
      "check-exp",
      resolve(cwd),
    ],
    { stdio: "inherit", reject: false },
  );
  if (result.failed) return result;
  const files = await readdir(cwd);
  if (files.includes("failed")) throw new Error(await readFile(join(cwd, "failed"), "utf8"));
  if (!files.includes("verified")) throw new Error("Bombadil did not observe a verified exp interruption");
  return result;
}

async function authorizeFuzzSessions(ready: string) {
  const url = new URL(ready);
  const credential = url.hash.slice(1);
  url.hash = "";
  const response = await fetch(new URL("/_niceeval/session", url), {
    method: "POST",
    headers: { origin: url.origin, "content-type": "application/json" },
    body: JSON.stringify({ credential }),
    signal: AbortSignal.timeout(5_000),
  });
  const cookie = response.headers.get("set-cookie");
  if (response.status !== 204 || cookie === null) {
    throw new Error(`View session exchange failed with HTTP ${response.status}`);
  }
  // Bombadil's --cookie parser still rejects SameSite. Exploration stays on the View origin.
  return { url: url.href, args: ["--cookie", cookie.replace(/;\s*SameSite=[^;]*/i, "")] };
}

async function checkTraces(outputPath: string, mode: "test" | "fuzz") {
  const { dir, base, name, ext } = parse(resolve(outputPath));
  const files = (await readdir(dir)).filter((file) => {
    if (mode === "test") return file === base;
    // For fuzz, the file base run.bin produces numbered siblings run-0.bin, run-1.bin, etc.
    const prefix = `${name}-`;
    return (
      file.startsWith(prefix) &&
      file.endsWith(ext) &&
      /^\d+$/.test(file.slice(prefix.length, file.length - ext.length))
    );
  });
  let sampled = false;
  for (const file of files) {
    const trace = join(dir, file);
    const inspection = execa("bombadil", ["trace", "--json", trace], { buffer: false, stderr: "inherit" });
    const lines = createInterface({ input: inspection.stdout! });
    let violations = false;
    for await (const line of lines) {
      sampled = true;
      const { metadata } = JSON.parse(line) as { metadata: { violations?: readonly unknown[] } };
      violations ||= Boolean(metadata.violations?.length);
    }
    await inspection;
    if (violations) {
      process.stderr.write(`Bombadil found property violations in ${trace}\n`);
      return { sampled, violations };
    }
  }
  return { sampled, violations: false };
}

async function browser(cwd: string, args: readonly string[]) {
  await output(cwd, ["exp", "pilot", "--rerun", "all"]);
  const view = execa(process.execPath, [cli, "view", "--no-open", "--port", "0", "--json"], {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
    reject: false,
    forceKillAfterDelay: 2_000,
  });
  const require = createRequire(cli);
  const { decodeViewLifecycle } =
    require("niceeval/view") as typeof import("../../packages/niceeval/src/view/index.ts");
  const lines = createInterface({ input: view.stdout });
  const mode = args[0]!;
  const bombadilArgs = args.slice(1);
  try {
    const ready = await Promise.race([
      (async () => {
        for await (const line of lines) {
          const event = decodeViewLifecycle(`${line}\n`)[0];
          if (event?.event === "ready") return event.url;
        }
        throw new Error("View did not emit a ready URL");
      })(),
      view.then((result) => {
        throw new Error(`View exited before readiness with status ${result.exitCode}`);
      }),
    ]);
    const target = mode === "fuzz" ? await authorizeFuzzSessions(ready) : { url: ready, args: [] };
    return await execa(
      "bombadil",
      ["browser", mode, ...bombadilArgs, ...target.args, target.url, spec("view-defaults.ts")],
      {
        stdio: "inherit",
        reject: false,
      },
    );
  } finally {
    lines.close();
    view.kill();
    await view;
  }
}

const [surface, mode, ...args] = process.argv.slice(2);
if (surface === "check-exp" && mode !== undefined) {
  await checkExp(mode);
} else {
  if ((surface !== "terminal" && surface !== "browser") || (mode !== "test" && mode !== "fuzz")) {
    throw new Error("Usage: node test/bombadil/driver.ts <terminal|browser> <test|fuzz> [Bombadil options]");
  }
  const cwd = await mkdtemp(join(tmpdir(), "niceeval-bombadil-"));
  try {
    const suppliedOutput = args.findIndex((arg) => arg === "--output-path" || arg.startsWith("--output-path="));
    const outputOption = args[suppliedOutput];
    const outputPath =
      outputOption === "--output-path"
        ? args[suppliedOutput + 1]
        : (outputOption?.slice("--output-path=".length) ?? join(cwd, "trace.bin"));
    if (!outputPath || outputPath.startsWith("--")) throw new Error("Expected a file path for --output-path");
    await mkdir(dirname(outputPath), { recursive: true });
    const commandArgs = suppliedOutput === -1 ? [...args, "--output-path", outputPath] : args;
    const previousTrace =
      surface === "terminal" && mode === "test"
        ? statSync(outputPath, { bigint: true, throwIfNoEntry: false })
        : undefined;
    if (surface === "browser") await writeProject(cwd, false);
    const result =
      surface === "terminal" ? await terminal(cwd, mode, commandArgs) : await browser(cwd, [mode, ...commandArgs]);
    process.exitCode = result.exitCode ?? 1;
    if (process.exitCode === 0) {
      const findings = await checkTraces(outputPath, mode);
      if (findings.violations) process.exitCode = 2;
      if (!findings.sampled) throw new Error("Bombadil did not record any observations");
    } else if (surface === "terminal" && mode === "test" && process.exitCode === 1) {
      // Terminal test uses 1 for both tool errors and property violations.
      const trace = statSync(outputPath, { bigint: true, throwIfNoEntry: false });
      if (trace && (trace.ino !== previousTrace?.ino || trace.ctimeNs !== previousTrace?.ctimeNs)) {
        const findings = await checkTraces(outputPath, mode).catch(() => undefined);
        if (findings?.violations) process.exitCode = 2;
      }
    }
  } finally {
    if (surface === "terminal") {
      for (const entry of await readdir(cwd, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pid = await childPid(join(cwd, entry.name));
        if (pid !== undefined && childAlive(pid)) process.kill(pid, "SIGKILL");
      }
    }
    await rm(cwd, { recursive: true, force: true });
  }
}
