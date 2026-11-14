import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { parseConcordCliJson, requestConcordCli } from "../concord-cli.js";
import {
  ConcordComparisonSchema,
  NICEEVAL_REPOSITORY_URL,
  PreviewHttpError,
  PreviewInputError,
  PreviewIoError,
  PreviewVerificationError,
  type ConcordComparison,
  type PreviewPlatform,
} from "./model.js";
import { requirePreviewSuccess } from "./process.js";

export type { ConcordComparison } from "./model.js";
const PREVIEW_DATA_LIMIT = 8 * 1024 * 1024;

const snapshotPreview = Effect.fn("preview.snapshotConcord")(function* (directory: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      const files = new Map<string, string>();
      let total = 0;
      const visit = async (path: string, depth: number): Promise<void> => {
        if (depth > 64) throw new Error("Concord directory exceeds depth 64");
        const absolute = join(directory, path);
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) throw new Error("Concord output contains a symlink");
        if (info.isDirectory()) {
          files.set(`${path}/`, "directory");
          if (files.size > 1024) throw new Error("Concord output exceeds its directory budget");
          for (const child of (await readdir(absolute)).sort()) await visit(join(path, child), depth + 1);
        } else if (info.isFile()) {
          const limit = path === "changes.json" ? PREVIEW_DATA_LIMIT : 10 * 1024 * 1024;
          if (info.size > limit) throw new Error("Concord output file exceeds its budget");
          const bytes = await readFile(absolute);
          total += bytes.byteLength;
          if (bytes.byteLength > limit || total > 72 * 1024 * 1024)
            throw new Error("Concord output exceeds its byte budget");
          files.set(path, createHash("sha256").update(bytes).digest("hex"));
          if ([...files.keys()].filter((key) => !key.endsWith("/")).length > 256)
            throw new Error("Concord output exceeds 256 files");
        } else throw new Error("Concord output contains a special file");
      };
      await visit("", 0);
      return files;
    },
    catch: (error) => new PreviewVerificationError({ subject: "Concord output", message: String(error) }),
  });
});

/** Concord validates the complete directory; all captured input bytes must remain unchanged. */
export const validateConcordChanges = Effect.fn("preview.validateConcordChanges")(function* (
  root: string,
  output: string,
  capturedBytes?: Uint8Array,
) {
  const directory = resolve(output);
  const before = yield* snapshotPreview(directory);
  const bytes = yield* Effect.tryPromise({
    try: () => readFile(join(directory, "changes.json")),
    catch: (error) => new PreviewInputError({ message: String(error) }),
  });
  const value = yield* Effect.try({
    try: () => {
      if (bytes.byteLength > PREVIEW_DATA_LIMIT) throw new Error("Concord data exceeds 8 MiB");
      if (capturedBytes !== undefined && !bytes.equals(capturedBytes))
        throw new Error("Concord data differs from captured bytes");
      if (createHash("sha256").update(bytes).digest("hex") !== before.get("changes.json"))
        throw new Error("Concord data changed during capture");
      return parseConcordCliJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    },
    catch: (error) => new PreviewInputError({ message: `Invalid Concord data: ${String(error)}` }),
  });
  const validated = yield* requestConcordCli(root, ["view", "verify", directory]).pipe(
    Effect.mapError((error) => new PreviewVerificationError({ subject: "Concord output", message: String(error) })),
  );
  const response = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      operation: Schema.Literal("view-verify"),
      directory: Schema.String,
      comparison: ConcordComparisonSchema,
      files: Schema.Natural,
    }),
    { onExcessProperty: "ignore" },
  )(validated).pipe(Effect.mapError(() => new PreviewInputError({ message: "Invalid Concord view verify response" })));
  const projected = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ comparison: ConcordComparisonSchema, entries: Schema.Array(Schema.Unknown) }),
    { onExcessProperty: "ignore" },
  )(value).pipe(Effect.mapError(() => new PreviewInputError({ message: "Concord data has an invalid comparison" })));
  const after = yield* snapshotPreview(directory);
  if (JSON.stringify([...before]) !== JSON.stringify([...after]))
    return yield* new PreviewVerificationError({
      subject: "Concord output",
      message: "Concord output changed during verification",
    });
  if (response.directory !== directory || response.files !== projected.entries.length) {
    return yield* new PreviewVerificationError({
      subject: "Concord output",
      message: "Concord verification identifies a different directory or change-entry count",
    });
  }
  yield* Effect.try({
    try: () => assertConcordComparison(response.comparison, projected.comparison),
    catch: (error) => new PreviewVerificationError({ subject: "Concord comparison", message: String(error) }),
  });
  return response.comparison;
});

/** Verify exactly the downloaded Concord closure, without synthesizing missing reader assets. */
export const validateCapturedConcordPreview = Effect.fn("preview.validateCapturedConcordPreview")(function* (
  root: string,
  files: readonly { readonly path: string; readonly bytes: Uint8Array }[],
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), "niceeval-concord-preview-")),
          catch: (error) => new PreviewInputError({ message: String(error) }),
        }),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      yield* Effect.tryPromise({
        try: async () => {
          for (const file of files) {
            if (
              !file.path.startsWith("concord/") ||
              file.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
              file.path.includes("\\")
            )
              throw new Error("Invalid captured Concord path");
            const target = join(directory, file.path.slice("concord/".length));
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, file.bytes, { flag: "wx" });
          }
        },
        catch: (error) => new PreviewInputError({ message: String(error) }),
      }).pipe(Effect.uninterruptible);
      return yield* validateConcordChanges(root, directory);
    }),
  );
});

const Oid = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u));
const PullRequestProjection = Schema.Struct({
  number: Schema.Int,
  state: Schema.Literal("open"),
  base: Schema.Struct({
    ref: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    sha: Oid,
    repo: Schema.Struct({ full_name: Schema.Literal("NiceEval/NiceEval") }),
  }),
  head: Schema.Struct({ sha: Oid }),
});
export interface PullRequestComparison {
  readonly reviewId: string;
  readonly base: string;
  readonly head: string;
  readonly baseLabel: string;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) if (name.startsWith("GIT_")) delete environment[name];
  return {
    ...environment,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_GRAFT_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}
const git = (root: string, args: readonly string[]) =>
  requirePreviewSuccess("git", ["--no-optional-locks", ...args], root, gitEnvironment()).pipe(
    Effect.map((result) => result.stdout.trim()),
  );

/** Public GitHub response is projected to only the fields that authorize this build. */
export const readPullRequestComparison = Effect.fn("preview.readPullRequestComparison")(function* (
  platform: Extract<PreviewPlatform, { kind: "pull-request" }>,
) {
  const url = `https://api.github.com/repos/NiceEval/NiceEval/pulls/${platform.reviewId}`;
  const value = yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "NiceEval-Preview",
        },
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("GitHub returned an empty body");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > 1024 * 1024) throw new Error("GitHub PR response exceeds 1 MiB");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
    },
    catch: (error) => new PreviewHttpError({ url, message: error instanceof Error ? error.message : String(error) }),
  });
  const pr = yield* Schema.decodeUnknownEffect(PullRequestProjection, { onExcessProperty: "ignore" })(value).pipe(
    Effect.mapError((error) => new PreviewInputError({ message: `Invalid GitHub PR identity: ${String(error)}` })),
  );
  if (String(pr.number) !== platform.reviewId || pr.head.sha !== platform.commitRef)
    return yield* new PreviewVerificationError({
      subject: "PR candidate",
      message: "PR head, COMMIT_REF and checkout HEAD must agree; merge checkouts are not accepted",
    });
  return {
    reviewId: platform.reviewId,
    base: pr.base.sha,
    head: pr.head.sha,
    baseLabel: pr.base.ref,
  } satisfies PullRequestComparison;
});

export const preparePullRequestHistory = Effect.fn("preview.preparePullRequestHistory")(function* (
  root: string,
  comparison: PullRequestComparison,
) {
  const shallow = yield* git(root, ["rev-parse", "--is-shallow-repository"]);
  yield* git(root, [
    "fetch",
    "--no-tags",
    ...(shallow === "true" ? ["--unshallow"] : []),
    NICEEVAL_REPOSITORY_URL,
    `refs/heads/${comparison.baseLabel}`,
    `refs/pull/${comparison.reviewId}/head`,
  ]);
  for (const oid of [comparison.base, comparison.head]) yield* git(root, ["cat-file", "-e", `${oid}^{commit}`]);
});

export const exportConcordChanges = Effect.fn("preview.exportConcordChanges")(function* (options: {
  root: string;
  base: string;
  head: string;
  baseLabel?: string;
  out: string;
}) {
  options = { ...options, root: resolve(options.root), out: resolve(options.out) };
  const base = yield* git(options.root, ["rev-parse", "--verify", "--end-of-options", `${options.base}^{commit}`]);
  const head = yield* git(options.root, ["rev-parse", "--verify", "--end-of-options", `${options.head}^{commit}`]);
  const mergeBase = yield* git(options.root, ["merge-base", "--all", base, head]);
  yield* Schema.decodeUnknownEffect(Oid)(mergeBase).pipe(
    Effect.mapError(
      () =>
        new PreviewVerificationError({ subject: "PR merge-base", message: "expected one unique best common ancestor" }),
    ),
  );
  const comparison: ConcordComparison = { base, head, mergeBase, baseLabel: options.baseLabel ?? options.base };
  yield* requirePreviewSuccess(
    "concord",
    [
      "--root",
      options.root,
      "--json",
      "view",
      "export",
      "--base",
      base,
      "--head",
      head,
      "--base-label",
      comparison.baseLabel,
      "--out",
      options.out,
    ],
    options.root,
    gitEnvironment(),
  );
  const file = join(options.out, "changes.json");
  const bytes = yield* Effect.tryPromise({
    try: async () => {
      if ((await stat(file)).size > PREVIEW_DATA_LIMIT) throw new Error("Concord data exceeds 8 MiB");
      return await readFile(file);
    },
    catch: (error) => new PreviewIoError({ operation: "verify-concord-export", path: file, message: String(error) }),
  });
  const validated = yield* validateConcordChanges(options.root, options.out, bytes);
  yield* Effect.try({
    try: () => assertConcordComparison(validated, comparison),
    catch: (error) => new PreviewVerificationError({ subject: "Concord comparison", message: String(error) }),
  });
  const current = yield* Effect.tryPromise({
    try: () => readFile(file),
    catch: (error) => new PreviewIoError({ operation: "recheck-concord-export", path: file, message: String(error) }),
  });
  if (!bytes.equals(current))
    return yield* new PreviewVerificationError({
      subject: "Concord changes",
      message: "Concord changes changed during CLI verification",
    });
  return { operation: "preview-changes" as const, output: options.out, comparison };
});

export function assertConcordComparison(data: ConcordComparison, expected: ConcordComparison): void {
  for (const key of ["base", "head", "mergeBase", "baseLabel"] as const) {
    if (data[key] !== expected[key]) throw new Error(`Concord ${key} does not match the admitted PR comparison`);
  }
}
