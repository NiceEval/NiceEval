import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { PrFileFailure, PrGitFailure, PrGitHubFailure } from "./errors.js";
import { decodeGitHubPullRequest } from "./schema.js";
import {
  PrFileSystem,
  PrGit,
  PrGitHub,
  type PrFileSystemService,
  type PrGitService,
  type PrGitHubService,
} from "./services.js";

function fileFailure(
  operation: PrFileFailure["operation"],
  path: string,
  cause: unknown,
): PrFileFailure {
  return new PrFileFailure({ operation, path, cause });
}

const nodeFileSystem: PrFileSystemService = {
  exists: (path) => Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) => cause,
  }).pipe(
    Effect.as(true),
    Effect.catch((cause) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
        return Effect.succeed(false);
      }
      return Effect.fail(fileFailure("inspect", path, cause));
    }),
  ),
  readText: (path) => Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => fileFailure("read", path, cause),
  }),
  ensureDirectory: (path) => Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) => fileFailure("create-directory", path, cause),
  }).pipe(Effect.asVoid),
  writeText: (path, text) => Effect.tryPromise({
    try: () => writeFile(path, text, "utf8"),
    catch: (cause) => fileFailure("write", path, cause),
  }),
  deleteFile: (path) => Effect.tryPromise({
    try: () => rm(path),
    catch: (cause) => fileFailure("delete", path, cause),
  }),
};

function commandAt(root: string, executable: string, args: readonly string[]) {
  return Effect.scoped(Effect.gen(function*() {
    const child = yield* ChildProcess.make(executable, args, { cwd: root });
    const [stdout, stderr, exitCode] = yield* Effect.all([
      Stream.runCollect(child.stdout),
      Stream.runCollect(child.stderr),
      child.exitCode,
    ], { concurrency: "unbounded" });
    const output = Buffer.concat(stdout.map((chunk) => Buffer.from(chunk))).toString("utf8");
    const error = Buffer.concat(stderr.map((chunk) => Buffer.from(chunk))).toString("utf8");
    if (Number(exitCode) !== 0) return yield* Effect.fail(new Error(error.trim() || output.trim() || `${executable} failed`));
    return output;
  }));
}

function makeGit(root: string): Effect.Effect<PrGitService, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner): PrGitService => ({
    run: (args, options) => commandAt(root, "git", args).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.map((output) => output.trim()),
      options?.allowFailure === true
        ? Effect.catch(() => Effect.succeed(""))
        : Effect.mapError((cause) => new PrGitFailure({ args, cause })),
    ),
    readBlob: (revision, path) => commandAt(root, "git", ["show", `${revision}:${path}`]).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.mapError((cause) => new PrGitFailure({ args: ["show", `${revision}:${path}`], cause })),
    ),
  }));
}

function parseJson(operation: "view" | "repository", pr: number | undefined, source: string): Effect.Effect<unknown, PrGitHubFailure> {
  return Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (cause) => new PrGitHubFailure({ operation: `decode-${operation}`, ...(pr === undefined ? {} : { pr }), cause }),
  });
}

function makeGitHub(root: string): Effect.Effect<PrGitHubService, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner): PrGitHubService => {
    const run = (
      operation: "repository" | "view" | "edit" | "create",
      args: readonly string[],
      pr?: number,
    ) => commandAt(root, "gh", args).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.map((output) => output.trim()),
      Effect.mapError((cause) => new PrGitHubFailure({ operation, cause, ...(pr === undefined ? {} : { pr }) })),
    );
    return {
      repository: () => run("repository", ["repo", "view", "--json", "nameWithOwner"]).pipe(
        Effect.flatMap((source) => parseJson("repository", undefined, source)),
        Effect.flatMap((value) => Effect.try({
          try: () => {
            if (typeof value !== "object" || value === null || typeof (value as { nameWithOwner?: unknown }).nameWithOwner !== "string") throw new Error("missing nameWithOwner");
            return (value as { nameWithOwner: string }).nameWithOwner;
          },
          catch: (cause) => new PrGitHubFailure({ operation: "decode-repository", cause }),
        })),
      ),
      view: (pr, repository) => run("view", ["pr", "view", String(pr), "--json", "body,headRefOid,headRepository,baseRefOid,baseRefName,url", ...(repository === undefined ? [] : ["--repo", repository])], pr).pipe(
        Effect.flatMap((source) => parseJson("view", pr, source)),
        Effect.flatMap((value) => decodeGitHubPullRequest(pr, value)),
      ),
      edit: (pr, bodyFile, repository) => run("edit", ["pr", "edit", String(pr), "--body-file", bodyFile, "--repo", repository], pr).pipe(
        Effect.asVoid,
      ),
      create: ({ base, head, title, bodyFile, repository }) => run("create", [
        "pr",
        "create",
        "--base",
        base,
        "--head",
        head,
        "--repo",
        repository,
        "--title",
        title,
        "--body-file",
        bodyFile,
      ]),
    };
  });
}

export const NodePrFileSystemLive = Layer.succeed(PrFileSystem, nodeFileSystem);

export function makeNodePrGitLive(root: string) {
  return Layer.effect(PrGit, makeGit(root));
}

export function makeNodePrGitHubLive(root: string) {
  return Layer.effect(PrGitHub, makeGitHub(root));
}

export function makeNodePrLive(root: string) {
  return Layer.mergeAll(
    NodePrFileSystemLive,
    makeNodePrGitLive(root),
    makeNodePrGitHubLive(root),
  );
}
