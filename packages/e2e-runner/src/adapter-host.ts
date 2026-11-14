// Invocation host: Concord owns this process group; NiceEval owns isolated copies.
import { loadEnvFile } from "node:process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { repoRootDir, discoverAllRepos, e2eRootDir } from "./discovery.ts";
import { collectNativeCaseInventory, type InventoryExecutor } from "./inventory.ts";
import { nativeEntryForSource } from "./native-files.ts";
import { copyRepoIsolated, pointAtCandidateTarball } from "./run-repo.ts";
import { buildTestkitPackage, injectTestkitDirectory } from "./testkit-snapshot.ts";
import { exactCaseNativeArgs } from "./case-evidence.ts";
import { nativeReporterArgs } from "./native-observation.ts";
import {
  OwnedProcessLive,
  hasSuccessfulOwnedProcessResult,
  ownedProcessLayer,
  runOwnedProcess,
} from "./owned-process.ts";
import { packCandidate } from "./pack.ts";
import { runEffect } from "./run.ts";
import { RepoReceiptSchema } from "./contracts.ts";
import { CollectionSchema, ExecutionSchema, observeExecution } from "./adapter-observation.ts";
import { nativeDeclarationRange } from "./adapter-range.ts";
import { formatCause } from "./format-cause.ts";
import {
  RelativePath,
  SelectionSchema,
  Text,
  decode,
  json,
  nativeId,
  parse,
  type RangeSchema,
  type Selection,
} from "./adapter-wire.ts";

const HostRequestSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal("collect"), files: Schema.NonEmptyArray(RelativePath), report: Text }),
  Schema.Struct({ op: Schema.Literal("test"), selection: SelectionSchema, report: Text }),
]);
const program = Effect.gen(function* () {
  if (process.argv.length !== 3) throw new Error("adapter host requires one JSON argument");
  const request = decode(HostRequestSchema, parse(process.argv[2]!));
  const root = realpathSync(repoRootDir());
  if (realpathSync(process.cwd()) !== root) throw new Error("adapter host cwd mismatch");
  if (!request.report.endsWith("/observation.json") || resolve(request.report) !== request.report)
    throw new Error("invalid adapter report path");
  const fs = yield* FileSystem.FileSystem;
  // Never overwrite an earlier observation if the invocation is replayed.
  if (yield* fs.exists(request.report)) throw new Error("adapter report already exists");
  const env = join(root, ".env");
  if (yield* fs.exists(env)) yield* Effect.sync(() => loadEnvFile(env));
  let document: unknown;
  let exitCode = 0;
  if (request.op === "collect") {
    const discovered = yield* discoverAllRepos(e2eRootDir());
    if (discovered.errors.length > 0) throw new Error(discovered.errors.join("; "));
    const selected = discovered.repos.filter((repo) =>
      request.files.some((file) => file.startsWith(`e2e/${repo.manifest.id}/`)),
    );
    if (
      request.files.some((file) => selected.filter((repo) => file.startsWith(`e2e/${repo.manifest.id}/`)).length !== 1)
    )
      throw new Error("collection file must resolve to exactly one native repo");
    const selections: Selection[] = [];
    const ranges: Record<string, typeof RangeSchema.Type> = {};
    const groups: Record<string, string> = {};
    const sources = new Map<string, string>();
    const gaps: string[] = [];
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-adapter-collect-" });
    const candidate = yield* packCandidate(root, join(scratch, "candidate.tgz"));
    const testkit = selected.some((repo) => repo.manifest.harness?.testkit === true)
      ? yield* buildTestkitPackage(root, scratch)
      : undefined;
    // Keep formal preparation sequential within this Concord-owned invocation.
    for (const repo of selected) {
      const files = request.files.filter((file) => file.startsWith(`e2e/${repo.manifest.id}/`));
      const copy = join(scratch, "repos", repo.manifest.id);
      yield* copyRepoIsolated(repo.dir, copy);
      yield* pointAtCandidateTarball(copy, candidate.path);
      if (repo.manifest.harness?.testkit === true) {
        if (!testkit) throw new Error("Testkit snapshot is missing");
        yield* injectTestkitDirectory(copy, testkit);
      }
      const install = yield* runOwnedProcess(["pnpm", "install", "--no-frozen-lockfile", "--prefer-offline"], {
        cwd: copy,
        env: process.env,
        output: "capture",
        stream: false,
        timeoutMs: 300_000,
      });
      if (!hasSuccessfulOwnedProcessResult(install))
        throw new Error(`${repo.manifest.id} install failed: ${install.stderr || install.stdout}`);
      const pkg = decode(
        Schema.Record(Text, Schema.Unknown),
        parse(yield* fs.readFileString(join(copy, "package.json"))),
      );
      const dependencies = {
        ...decode(Schema.Record(Text, Text), pkg.dependencies ?? {}),
        ...decode(Schema.Record(Text, Text), pkg.devDependencies ?? {}),
      };
      const executors: InventoryExecutor[] = [
        ...(Object.hasOwn(dependencies, "vitest") ? ["vitest" as const] : []),
        ...(Object.hasOwn(dependencies, "@playwright/test") || Object.hasOwn(dependencies, "playwright")
          ? ["playwright" as const]
          : []),
      ];
      if (executors.length === 0) throw new Error(`${repo.manifest.id} has no supported native executor`);
      const prefix = `e2e/${repo.manifest.id}/`;
      const nativeArgs = [
        ...new Set(
          files.map((file) => {
            const native = nativeEntryForSource(file, readFileSync(join(root, file), "utf8"));
            if (!native.startsWith(prefix)) throw new Error(`Native entry is outside ${prefix}`);
            return native.slice(prefix.length);
          }),
        ),
      ];
      const raw = [];
      for (const executor of executors) {
        const inventory = yield* collectNativeCaseInventory({
          executor,
          repo: repo.manifest.id,
          cwd: copy,
          nativeArgs,
        });
        raw.push(
          ...inventory.cases.map((item) => ({
            ...item,
            executor,
            path: `${prefix}${item.file}`,
            ...(item.nativeFile === undefined ? {} : { nativePath: `${prefix}${item.nativeFile}` }),
          })),
        );
      }
      for (const item of raw) {
        if (!files.includes(item.path)) continue;
        const selection = decode(SelectionSchema, {
          executor: item.executor,
          repo: repo.manifest.id,
          file: item.path,
          ...("nativePath" in item && item.nativePath !== undefined ? { nativeFile: item.nativePath } : {}),
          project: item.project ?? "default",
          titlePath: item.titlePath,
          ...(item.declarationTitlePath === undefined ? {} : { declarationTitlePath: item.declarationTitlePath }),
        });
        selections.push(selection);
        if (item.location !== undefined) {
          let source = sources.get(item.path);
          if (source === undefined) {
            source = yield* fs.readFileString(join(root, item.path));
            sources.set(item.path, source);
          }
          const range = nativeDeclarationRange(item.path, source, item.location);
          if (range !== undefined) {
            ranges[nativeId(selection)] = range;
            groups[nativeId(selection)] = `niceeval:${item.path}:${range.startLine}:${range.endLine}`;
          }
        }
      }
    }
    document = decode(CollectionSchema, { format: "niceeval.adapter-collection/v1", selections, ranges, groups, gaps });
  } else {
    const selection = request.selection;
    const prefix = `e2e/${selection.repo}/`;
    if (!selection.file.startsWith(prefix)) throw new Error("native selection is outside its repo");
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-adapter-" });
    const candidate = yield* packCandidate(root, join(scratch, "candidate.tgz"));
    const nativeFile = selection.nativeFile ?? selection.file;
    if (!nativeFile.startsWith(prefix)) throw new Error("native entry is outside its repo");
    const file = nativeFile.slice(prefix.length);
    const nativeArgs = [
      ...exactCaseNativeArgs(selection.executor, file, selection.titlePath),
      ...nativeReporterArgs(selection.executor),
      ...(selection.project === "default" ? [] : ["--project", selection.project]),
    ];
    const summary = yield* runEffect({
      repoIds: [selection.repo],
      candidatePath: candidate.path,
      nativeArgs,
      keepWorkdir: false,
      repoConcurrency: 1,
      artifactRoot: join(scratch, "artifacts"),
      retainNativeReport: true,
    });
    if (summary.results.length !== 1 || summary.runner.category !== "pass")
      throw new Error("native runner did not complete one isolated repo");
    const receipt = decode(RepoReceiptSchema, parse(yield* fs.readFileString(summary.results[0]!.receiptPath)));
    document = decode(ExecutionSchema, { format: "niceeval.adapter-execution/v1", selection, receipt });
    // Preparation failures, missing native data and cleanup failures publish nothing.
    const observation = observeExecution(document, selection, "niceeval:host");
    exitCode = observation.outcome === "passed" ? 0 : 1;
  }
  const report = json(document) + "\n";
  // Concord created the invocation directory; do not create arbitrary parent paths.
  if (!(yield* fs.exists(dirname(request.report)))) throw new Error("Concord report directory is missing");
  return { report: request.report, text: report, exitCode };
});
// Publish observations only after every native Scope finalizer has completed.
const inheritedGroup = Effect.gen(function* () {
  if (process.platform === "win32") throw new Error("adapter host requires a Concord-owned POSIX process group");
  const capture = yield* runOwnedProcess(["ps", "-o", "pgid=", "-p", String(process.pid)], {
    cwd: process.cwd(),
    output: "capture",
    stream: false,
    timeoutMs: 10_000,
    stdoutBytes: 1024,
    stderrBytes: 1024,
  });
  if (!hasSuccessfulOwnedProcessResult(capture)) throw new Error("could not observe inherited POSIX process group");
  return decode(Schema.Int.check(Schema.isGreaterThan(0)), Number(capture.stdout.trim()));
}).pipe(Effect.scoped, Effect.provide(OwnedProcessLive));
NodeRuntime.runMain(
  inheritedGroup.pipe(
    Effect.flatMap((group) =>
      program.pipe(
        Effect.scoped,
        Effect.provide(Layer.mergeAll(NodeServices.layer, ownedProcessLayer({ inheritedGroup: group }))),
      ),
    ),
    Effect.flatMap((result) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(result.report, result.text, { flag: "wx" });
        yield* Effect.sync(() => {
          process.exitCode = result.exitCode;
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        process.stderr.write(formatCause(cause) + "\n");
        process.exitCode = 1;
      }),
    ),
  ),
  { disableErrorReporting: true },
);
