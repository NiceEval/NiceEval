// NiceEval owns these private reliability artifacts. They are not Concord fix evidence.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Data, Effect, Schema } from "effect";
import { decodeWire, SuiteSchema, SourceSchema, ProjectionSchema } from "./bridge-wire.ts";
import { listConcordCases } from "./concord-cases.ts";

export class RepositoryEvidenceError extends Data.TaggedError("RepositoryEvidenceError")<{ readonly detail: string }> {}
export const engineError = (cause: unknown) =>
  new RepositoryEvidenceError({ detail: cause instanceof Error ? cause.message : String(cause) });
export const bridgeBoundary = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(Effect.catchDefect((cause) => Effect.fail(engineError(cause))));
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined || (typeof value === "number" && !Number.isFinite(value)))
    throw new Error("Private evidence must contain finite JSON values");
  return encoded;
};
export const digestJson = (value: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const rawDigest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const signPrivateArtifact = <S extends Schema.ConstraintDecoder<unknown>>(
  value: unknown,
  key: string,
  schema: S,
) =>
  Effect.try({
    try: () =>
      decodeWire(schema, {
        ...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(value),
        [key]: digestJson(value),
      }),
    catch: engineError,
  });
export const validatePrivateArtifact = <S extends Schema.ConstraintDecoder<unknown>>(
  value: unknown,
  key: string,
  schema: S,
) =>
  Effect.try({
    try: () => {
      const decoded = decodeWire(schema, value);
      const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(decoded);
      const { [key]: expected, ...unsigned } = object;
      if (expected !== digestJson(unsigned))
        throw new Error(`Private reliability artifact ${key} mismatch; generate fresh evidence`);
      return decoded;
    },
    catch: engineError,
  });
export const governanceSuiteForFile = (root: string, file: string) =>
  Effect.try({
    try: () => {
      const document = Schema.decodeUnknownSync(Schema.Struct({ suites: Schema.Array(SuiteSchema) }))(
        JSON.parse(readFileSync(join(root, "concord.repository.json"), "utf8")),
      );
      for (const suite of document.suites)
        if (
          !suite.root.startsWith("e2e/") ||
          suite.root.split("/").some((part) => part === "." || part === ".." || part === "") ||
          /[\\\0\r\n]/u.test(suite.root)
        )
          throw new Error(`Invalid NiceEval suite root: ${suite.root}`);
      const matches = document.suites.filter((suite) => file === suite.root || file.startsWith(`${suite.root}/`));
      if (matches.length !== 1) throw new Error(`Expected one NiceEval suite for ${file}, found ${matches.length}`);
      return matches[0]!;
    },
    catch: engineError,
  });
// Installation mutates package manifests and lockfiles. Their source bytes are
// bound separately below; candidate and Testkit injection have their own checks.
const excluded = new Set([
  "node_modules",
  ".niceeval",
  ".git",
  ".env",
  ".e2e-artifacts",
  ".e2e-diagnostics",
  "test-results",
  "playwright-report",
  "coverage",
]);
const installInputs = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
export const projectExecutionSources = (directory: string, suiteRoot: string) =>
  Effect.try({
    try: () => {
      const files: { path: string; bytes: number; rawSha256: string }[] = [];
      const walk = (dir: string, relative: string): void => {
        for (const entry of readdirSync(dir).sort()) {
          if (excluded.has(entry) || (relative === "" && installInputs.has(entry))) continue;
          const path = join(dir, entry);
          const stat = lstatSync(path);
          if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
            throw new Error(`Reliability snapshot rejects non-regular source: ${path}`);
          const local = relative ? `${relative}/${entry}` : entry;
          if (stat.isDirectory()) walk(path, local);
          else {
            const bytes = readFileSync(path);
            files.push({ path: `${suiteRoot}/${local}`, bytes: bytes.length, rawSha256: rawDigest(bytes) });
          }
        }
      };
      if (lstatSync(directory).isSymbolicLink()) throw new Error("Reliability snapshot root must not be a symlink");
      walk(directory, "");
      return decodeWire(ProjectionSchema, {
        algorithm: "niceeval.execution-source-projection/v1",
        files,
        digest: digestJson(files),
      });
    },
    catch: engineError,
  });
export const managedImplementationDigest = (root: string) =>
  Effect.try({
    try: () => {
      const files: { path: string; sha256: string }[] = [];
      const walk = (dir: string, prefix: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const path = join(dir, entry.name);
          const relative = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) walk(path, relative);
          else if (entry.isFile()) files.push({ path: relative, sha256: rawDigest(readFileSync(path)) });
          else throw new Error(`Runner implementation is not a regular file: ${relative}`);
        }
      };
      walk(join(root, "packages/e2e-runner/src"), "packages/e2e-runner/src");
      walk(join(root, "packages/testkit/src"), "packages/testkit/src");
      for (const path of [
        "packages/e2e-runner/package.json",
        "packages/testkit/package.json",
        "concord.repository.json",
        "pnpm-lock.yaml",
      ])
        files.push({ path, sha256: rawDigest(readFileSync(join(root, path))) });
      return digestJson(files);
    },
    catch: engineError,
  });
export const resolveRepositorySourceIdentity = Effect.fn("resolveNiceEvalReliabilitySource")(function* (
  root: string,
  selector: string,
) {
  const separator = selector.lastIndexOf("#");
  const path = selector.slice(0, separator);
  const caseId = selector.slice(separator + 1);
  const cases = yield* listConcordCases(root);
  const matches = cases.filter((item) => item.id === caseId && item.file === path && item.status === "active");
  if (matches.length !== 1)
    return yield* new RepositoryEvidenceError({
      detail: `Concord test list does not contain one active case ${selector}`,
    });
  const marker = matches[0]!;
  const suite = yield* governanceSuiteForFile(root, path);
  const projection = yield* projectExecutionSources(resolve(root, suite.root), suite.root);
  const implementationDigest = yield* managedImplementationDigest(root);
  return yield* Effect.try({
    try: () =>
      decodeWire(SourceSchema, {
        format: "niceeval.reliability-source/v1",
        projection,
        caseId,
        nativeTestFile: path,
        declarationFile: marker.file,
        binding: {
          kind: "niceeval-reliability",
          suiteId: suite.id,
          contractRef: marker.contract,
          contractSha256: rawDigest(readFileSync(resolve(root, marker.contract.split("#")[0]!))),
          configurationDigest: digestJson([
            rawDigest(readFileSync(join(root, "concord.repository.json"))),
            rawDigest(readFileSync(join(root, "concord.config.ts"))),
            ...readdirSync(join(root, suite.root))
              .filter((file) => installInputs.has(file))
              .sort()
              .map((file) => [file, rawDigest(readFileSync(join(root, suite.root, file)))]),
          ]),
          implementationDigest,
        },
      }),
    catch: engineError,
  });
});
export const decodeReliabilitySourceIdentity = (value: unknown) =>
  Effect.try({
    try: () => {
      const source = decodeWire(SourceSchema, value);
      if (source.projection.digest !== digestJson(source.projection.files))
        throw new Error("Reliability source projection digest mismatch");
      return source;
    },
    catch: engineError,
  });
export const sameRepositorySourceIdentity = (left: unknown, right: unknown) =>
  Effect.gen(function* () {
    const a = yield* decodeReliabilitySourceIdentity(left);
    const b = yield* decodeReliabilitySourceIdentity(right);
    return canonicalJson(a) === canonicalJson(b);
  });
