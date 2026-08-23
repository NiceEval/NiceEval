import * as PlatformCommand from "@effect/platform/Command";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { Effect, Layer } from "effect";

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
    Effect.catchAll((cause) => {
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
};

function commandAt(root: string, executable: string, args: readonly string[]) {
  return PlatformCommand.make(executable, ...args).pipe(
    PlatformCommand.workingDirectory(root),
  );
}

function makeGit(root: string): Effect.Effect<PrGitService, never, CommandExecutor> {
  return Effect.map(CommandExecutor, (executor): PrGitService => ({
    run: (args, options) => executor.string(commandAt(root, "git", args)).pipe(
      Effect.map((output) => output.trim()),
      options?.allowFailure === true
        ? Effect.catchAll(() => Effect.succeed(""))
        : Effect.mapError((cause) => new PrGitFailure({ args, cause })),
    ),
  }));
}

function parseJson(operation: "view", pr: number, source: string): Effect.Effect<unknown, PrGitHubFailure> {
  return Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (cause) => new PrGitHubFailure({ operation: `decode-${operation}`, pr, cause }),
  });
}

function makeGitHub(root: string): Effect.Effect<PrGitHubService, never, CommandExecutor> {
  return Effect.map(CommandExecutor, (executor): PrGitHubService => {
    const run = (
      operation: "view" | "edit" | "create",
      args: readonly string[],
      pr?: number,
    ) => executor.string(commandAt(root, "gh", args)).pipe(
      Effect.map((output) => output.trim()),
      Effect.mapError((cause) => new PrGitHubFailure({ operation, cause, ...(pr === undefined ? {} : { pr }) })),
    );
    return {
      view: (pr) => run("view", ["pr", "view", String(pr), "--json", "body,headRefOid"], pr).pipe(
        Effect.flatMap((source) => parseJson("view", pr, source)),
        Effect.flatMap((value) => decodeGitHubPullRequest(pr, value)),
      ),
      edit: (pr, bodyFile) => run("edit", ["pr", "edit", String(pr), "--body-file", bodyFile], pr).pipe(
        Effect.asVoid,
      ),
      create: ({ base, head, title, bodyFile }) => run("create", [
        "pr",
        "create",
        "--base",
        base,
        "--head",
        head,
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
