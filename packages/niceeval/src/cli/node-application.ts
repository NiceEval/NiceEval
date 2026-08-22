import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Effect, Layer } from "effect";
import { upsertManagedBlock } from "../util.ts";
import {
  BrowserLauncher,
  CliArguments,
  CliInvocationError,
  CliInvocationFacts,
  CliOutput,
  CliPath,
  CliReportPlatform,
  CliTerminal,
  PackageMetadata,
  ProjectInitializer,
} from "./application.ts";
import { createNodeFeedbackIO } from "../runner/feedback/io.ts";
import { createNodeInputGuardStdin } from "../runner/feedback/input-guard.ts";
import { loadTrustedReportConfig, loadTrustedReportModule, loadTrustedThemeModule, makeNodeReportFileSystem, resolveTrustedModulePath } from "../report/host/node.ts";
import { ReportFileSystem } from "../report/host/static.ts";

const failure = (operation: string, cause: unknown) => new CliInvocationError({ operation, cause });

export const NodeInvocationFactsLive = Layer.succeed(CliInvocationFacts, {
  facts: Effect.sync(() => Object.freeze({
    cwd: process.cwd(), argv: Object.freeze(process.argv.slice(2)), hostname: hostname(), platform: process.platform,
    noColor: process.env.NO_COLOR,
    stdout: Object.freeze({ isTTY: process.stdout.isTTY === true, columns: process.stdout.columns }),
    stderr: Object.freeze({ isTTY: process.stderr.isTTY === true, columns: process.stderr.columns }),
  })),
});

export const NodeCliOutputLive = Layer.succeed(CliOutput, {
  writeStdout: (text) => Effect.try({ try: () => { process.stdout.write(text); }, catch: (cause) => failure("write-stdout", cause) }),
  writeStderr: (text) => Effect.try({ try: () => { process.stderr.write(text); }, catch: (cause) => failure("write-stderr", cause) }),
  writeStdoutSync: (text) => { process.stdout.write(text); },
  writeStderrSync: (text) => { process.stderr.write(text); },
});

export const NodeCliArgumentsLive = Layer.succeed(CliArguments, {
  parse: (argv, options) => {
    const parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true, tokens: true });
    return { values: parsed.values as Record<string, string | boolean | string[] | undefined>, positionals: parsed.positionals, tokens: parsed.tokens };
  },
});

export const NodeCliPathLive = Layer.succeed(CliPath, { resolve, isAbsolute });
export const NodeCliTerminalLive = Layer.sync(CliTerminal, () => ({ feedback: createNodeFeedbackIO(), stdin: createNodeInputGuardStdin() }));
export const NodeCliReportPlatformLive = Layer.succeed(CliReportPlatform, {
  loadConfig: (cwd) => loadTrustedReportConfig(cwd).pipe(Effect.mapError((cause) => failure("load-report-config", cause))),
  loadReport: (path) => loadTrustedReportModule(path).pipe(Effect.mapError((cause) => failure("load-report-module", cause))),
  loadTheme: (path) => loadTrustedThemeModule(path).pipe(Effect.mapError((cause) => failure("load-theme-module", cause))),
  resolveModulePath: resolveTrustedModulePath,
});
export const NodeReportFileSystemLive = Layer.succeed(ReportFileSystem, makeNodeReportFileSystem());

export const NodePackageMetadataLive = Layer.succeed(PackageMetadata, {
  version: Effect.tryPromise({
    try: async () => JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version as string,
    catch: (cause) => failure("read-package-metadata", cause),
  }),
});

export const NodeBrowserLauncherLive = Layer.succeed(BrowserLauncher, {
  open: (url) => Effect.async<boolean, CliInvocationError>((resume) => {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    let settled = false;
    const finish = (opened: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resume(Effect.succeed(opened)); } };
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    const timer = setTimeout(() => finish(true), 1500);
    child.once("error", () => finish(false)); child.once("exit", (code) => finish(code === 0)); child.unref();
  }),
});

const RULE_BEGIN = "<!-- BEGIN:niceeval-agent-rules -->";
const RULE_END = "<!-- END:niceeval-agent-rules -->";
const RULE_CONTENT = [
  "# niceeval is NOT in your training data", "", "Its APIs and conventions may differ from anything you have seen. Start with",
  "`node_modules/niceeval/INDEX.md`, then read the task-specific bundled guides it points", "to before writing any eval, experiment, adapter, or niceeval config. That index and",
  "the bundled Chinese docs are the authoritative version matching this installation.", "After a run, use this repository's package-manager invocation of `niceeval show` for",
  "diagnosis (`pnpm --silent exec niceeval show` in a pnpm project). Pick an `@<locator>`", "from the compact index, then show that locator for an overview, or add",
  "`--source` / `--execution` / `--timing` / `--diff` / `--json` for evidence.", "When diagnosing an existing run, do not inspect raw `.niceeval` files or treat the current",
  "`evals/` or `agents/` source as evidence of what happened in that run. If `niceeval show`", "cannot expose the evidence you need, report that product gap. Reading source remains",
  "appropriate when the task is to author or modify that source.",
].join("\n");

function prefersEsm(cwd: string): boolean {
  let directory = resolve(cwd);
  while (true) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) { try { return JSON.parse(readFileSync(manifest, "utf8")).type === "module"; } catch { return false; } }
    const parent = dirname(directory); if (parent === directory) return false; directory = parent;
  }
}

export const NodeProjectInitializerLive = Layer.succeed(ProjectInitializer, {
  initialize: (cwd) => Effect.tryPromise({
    try: async () => {
      await mkdir(join(cwd, "evals"), { recursive: true });
      const configPath = join(cwd, "niceeval.config.ts");
      if (!existsSync(configPath)) await writeFile(configPath, 'import { defineConfig } from "niceeval";\n\nexport default defineConfig({\n  // Add experiments/ with defineExperiment(...) to run evals.\n});\n', "utf8");
      const agents = join(cwd, "AGENTS.md"); const claude = join(cwd, "CLAUDE.md");
      const doc = existsSync(agents) ? agents : existsSync(claude) ? claude : agents;
      const existing = existsSync(doc) ? await readFile(doc, "utf8") : "";
      const next = upsertManagedBlock(existing, RULE_BEGIN, RULE_END, RULE_CONTENT);
      if (next !== existing) await writeFile(doc, next, "utf8");
      return { prefersEsm: prefersEsm(cwd) };
    },
    catch: (cause) => failure("initialize-project", cause),
  }),
});

export const NodeCliPlatformLive = Layer.mergeAll(NodeInvocationFactsLive, NodeCliOutputLive, NodeCliArgumentsLive, NodeCliPathLive, NodeCliTerminalLive, NodeCliReportPlatformLive, NodeReportFileSystemLive, NodePackageMetadataLive, NodeBrowserLauncherLive, NodeProjectInitializerLive);
