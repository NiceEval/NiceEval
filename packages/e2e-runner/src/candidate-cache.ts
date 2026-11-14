// Candidate inputs exclude Git identity and generated output. Publication is
// serialized with packing; an immutable build snapshot survives later builds.
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { Effect } from "effect";
import { acquireCandidatePackLock } from "./candidate-pack-lock.ts";
import { CandidatePackError, readCandidateTarball, type CandidateTarball } from "./injection.ts";
import { hasSuccessfulOwnedProcessResult, runOwnedProcess } from "./owned-process.ts";

export type CandidateForm = "source" | "built" | "tarball";
const failure = (cause: unknown) =>
  new CandidatePackError({ operation: "prepare", detail: cause instanceof Error ? cause.message : String(cause) });
const io = <A>(run: () => A) => Effect.try({ try: run, catch: failure });
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const snapshotDigest = (root: string): string => {
  const digest = createHash("sha256");
  const walk = (path: string): void => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (path === "" && name === "node_modules") continue;
        walk(path === "" ? name : `${path}/${name}`);
      }
    } else if (stat.isFile())
      digest
        .update(path)
        .update("\0")
        .update(readFileSync(absolute))
        .update(`\0${stat.mode & 0o777}\0`);
    else throw new Error(`candidate snapshot contains a symlink or special file: ${path}`);
  };
  walk("");
  return digest.digest("hex");
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

interface LockNode {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
interface Lockfile {
  importers: Record<string, Record<string, Record<string, { version: string }>>>;
  snapshots: Record<string, LockNode>;
  packages: Record<string, unknown>;
  settings?: unknown;
  overrides?: unknown;
}

export const candidateInputDigest = (root: string) =>
  io(() => {
    const digest = createHash("sha256").update("niceeval-candidate-inputs/v1\0");
    const visit = (path: string): void => {
      const absolute = join(root, path);
      if (!existsSync(absolute)) {
        digest.update(`${path}\0missing\0`);
        return;
      }
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`candidate input is a symlink: ${path}`);
      if (stat.isDirectory()) {
        for (const name of readdirSync(absolute).sort()) {
          if (
            ["node_modules", "dist", ".niceeval", "docs-site", "INDEX.md"].includes(name) &&
            path.startsWith("packages/niceeval")
          )
            continue;
          if (name.startsWith(".niceeval-package-runtime-")) continue;
          visit(`${path}/${name}`);
        }
      } else if (stat.isFile())
        digest
          .update(path)
          .update("\0")
          .update(readFileSync(absolute))
          .update(`\0${stat.mode & 0o777}\0`);
      else throw new Error(`candidate input is not a file: ${path}`);
    };
    for (const path of [
      "packages/niceeval",
      "package.json",
      "pnpm-workspace.yaml",
      ".npmrc",
      "tsconfig.json",
      "INIT.md",
      "apps/docs-site/zh",
      "apps/docs-site/images",
      "packages/repo-tools/src/docs/generators.ts",
      "packages/repo-tools/src/docs/reference-compiler.ts",
    ])
      visit(path);
    const lock = parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")) as Lockfile;
    const importer = lock.importers["packages/niceeval"];
    if (importer === undefined) throw new Error("lockfile has no NiceEval importer");
    const nodes = new Map<string, unknown>();
    const collect = (name: string, version: string): void => {
      const key = version.startsWith("npm:")
        ? version.slice(4)
        : Object.hasOwn(lock.snapshots, version)
          ? version
          : `${name}@${version}`;
      if (nodes.has(key)) return;
      const snapshot = lock.snapshots[key];
      if (snapshot === undefined) throw new Error(`candidate lock closure is missing ${key}`);
      nodes.set(key, [snapshot, lock.packages[key.split("(")[0]!]]);
      for (const [dependency, resolved] of Object.entries({
        ...snapshot.dependencies,
        ...snapshot.optionalDependencies,
      }))
        collect(dependency, resolved);
    };
    for (const group of Object.values(importer))
      for (const [name, dependency] of Object.entries(group)) collect(name, dependency.version);
    digest.update(
      canonical({ importer, nodes: Object.fromEntries(nodes), settings: lock.settings, overrides: lock.overrides }),
    );
    return digest.digest("hex");
  });

const command = (root: string, argv: readonly [string, ...string[]], quiet = false) =>
  runOwnedProcess(argv, {
    cwd: root,
    env: process.env,
    output: "capture",
    stream: !quiet,
    timeoutMs: 30 * 60_000,
  }).pipe(
    Effect.mapError(failure),
    Effect.flatMap((result) =>
      hasSuccessfulOwnedProcessResult(result)
        ? Effect.void
        : Effect.fail(
            failure(
              `${argv.join(" ")} failed: ${result.error ?? result.signal ?? result.exitCode}\n${result.stderr.slice(-8192)}`,
            ),
          ),
    ),
  );

export const prepareCandidate = Effect.fn("prepareCandidate")(function* (
  repoRoot: string,
  form: CandidateForm,
  options: { readonly quiet?: boolean } = {},
) {
  const root = yield* io(() => realpathSync(repoRoot));
  // Source never acquires a build lease or invokes a build/pack lifecycle.
  if (form === "source") {
    const inputDigest = yield* candidateInputDigest(root);
    const pkg = yield* io(
      () =>
        JSON.parse(readFileSync(join(root, "packages/niceeval/package.json"), "utf8")) as {
          name: string;
          version: string;
        },
    );
    console.error(`[e2e] candidate source input=${inputDigest}; no build or pack`);
    return {
      form,
      inputDigest,
      path: join(root, "packages/niceeval"),
      sha256: inputDigest,
      shortHash: inputDigest.slice(0, 12),
      integrity: `sha256-${Buffer.from(inputDigest, "hex").toString("base64")}`,
      name: pkg.name,
      version: pkg.version,
    } satisfies CandidateTarball;
  }
  return yield* Effect.scoped(
    Effect.gen(function* () {
      yield* acquireCandidatePackLock(root).pipe(Effect.mapError(failure));
      const inputDigest = yield* candidateInputDigest(root);
      const cache = join(tmpdir(), "niceeval-e2e-candidates", hash(root), "v2", inputDigest);
      const built = join(cache, "package");
      const tarball = join(cache, "candidate.tgz");
      const complete = yield* io(() => {
        if (!existsSync(join(cache, "built.json")) || !existsSync(join(built, "dist/index.js"))) return false;
        const record = JSON.parse(readFileSync(join(cache, "built.json"), "utf8")) as {
          inputDigest: string;
          outputDigest: string;
        };
        return record.inputDigest === inputDigest && record.outputDigest === snapshotDigest(built);
      });
      if (!complete) {
        console.error(`[e2e] candidate ${form} cache miss input=${inputDigest}; build:package`);
        yield* command(root, ["pnpm", "run", "build:package"], options.quiet);
        // Built consumers include bundled documentation; these do not rebuild JS.
        yield* command(root, ["pnpm", "run", "build:index"], options.quiet);
        yield* command(join(root, "packages/niceeval"), ["pnpm", "run", "stage:docs"], options.quiet);
        const after = yield* candidateInputDigest(root);
        if (after !== inputDigest)
          return yield* failure("candidate inputs changed during build; retry with stable inputs");
        yield* io(() => {
          mkdirSync(cache, { recursive: true });
          const staging = join(cache, `staging-${randomUUID()}`);
          try {
            mkdirSync(staging);
            for (const path of ["dist", "bin", "package.json", "INDEX.md", "docs-site"])
              cpSync(join(root, "packages/niceeval", path), join(staging, path), { recursive: true });
            const manifest = JSON.parse(readFileSync(join(staging, "package.json"), "utf8"));
            writeFileSync(
              join(staging, "package.json"),
              JSON.stringify({ ...manifest, niceevalCandidateInputDigest: inputDigest }, null, 2) + "\n",
            );
            symlinkSync(join(root, "packages/niceeval/node_modules"), join(staging, "node_modules"), "dir");
            rmSync(built, { recursive: true, force: true });
            renameSync(staging, built);
            writeFileSync(
              join(cache, "built.json"),
              JSON.stringify({ inputDigest, outputDigest: snapshotDigest(built) }),
            );
          } finally {
            rmSync(staging, { recursive: true, force: true });
          }
        });
      } else {
        console.error(`[e2e] candidate ${form} build cache hit input=${inputDigest}; skipping build:package`);
        // Testkit compiles against workspace declarations even when its consumer
        // uses a cached build. Restore those declarations after a fresh checkout.
        yield* io(() => cpSync(join(built, "dist"), join(root, "packages/niceeval/dist"), { recursive: true }));
      }
      const pkg = yield* io(
        () => JSON.parse(readFileSync(join(built, "package.json"), "utf8")) as { name: string; version: string },
      );
      if (form === "built")
        return {
          form,
          inputDigest,
          path: built,
          sha256: inputDigest,
          shortHash: inputDigest.slice(0, 12),
          integrity: `sha256-${Buffer.from(inputDigest, "hex").toString("base64")}`,
          name: pkg.name,
          version: pkg.version,
        } satisfies CandidateTarball;
      if (!(yield* io(() => existsSync(tarball)))) {
        console.error(`[e2e] candidate tarball cache miss input=${inputDigest}; packing cached build`);
        // Pack the immutable snapshot, without re-running prepack/build. pnpm
        // resolves bundled dependencies via its workspace node_modules link.
        const staging = join(cache, `pack-${randomUUID()}`);
        yield* io(() => mkdirSync(staging));
        yield* Effect.addFinalizer(() =>
          io(() => rmSync(staging, { recursive: true, force: true })).pipe(Effect.ignore),
        );
        yield* command(
          built,
          [
            "pnpm",
            "--config.node-linker=hoisted",
            "--config.ignore-scripts=true",
            "pack",
            "--pack-destination",
            staging,
          ],
          options.quiet,
        );
        yield* io(() => {
          const files = readdirSync(staging).filter((name) => name.endsWith(".tgz"));
          if (files.length !== 1) throw new Error("pack did not produce exactly one tarball");
          renameSync(join(staging, files[0]!), tarball);
          rmSync(staging, { recursive: true });
        });
      } else console.error(`[e2e] candidate tarball cache hit input=${inputDigest}; skipping pack`);
      const candidate = yield* readCandidateTarball(tarball);
      if (candidate.inputDigest !== inputDigest)
        return yield* failure("cached tarball input digest does not match the requested candidate");

      return { ...candidate, form, inputDigest, name: pkg.name, version: pkg.version };
    }),
  );
});
