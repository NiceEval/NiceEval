import { Context, type Effect } from "effect";

import type { GitHubPullRequest } from "./model.js";
import type { PrFileFailure, PrGitFailure, PrGitHubFailure } from "./errors.js";

export interface PrFileSystemService {
  readonly exists: (path: string) => Effect.Effect<boolean, PrFileFailure>;
  readonly readText: (path: string) => Effect.Effect<string, PrFileFailure>;
  readonly ensureDirectory: (path: string) => Effect.Effect<void, PrFileFailure>;
  readonly writeText: (path: string, text: string) => Effect.Effect<void, PrFileFailure>;
}

export class PrFileSystem extends Context.Tag("@niceeval/repo-tools/pr/FileSystem")<
  PrFileSystem,
  PrFileSystemService
>() {}

export interface PrGitService {
  readonly run: (
    args: readonly string[],
    options?: Readonly<{ readonly allowFailure?: boolean }>,
  ) => Effect.Effect<string, PrGitFailure>;
}

export class PrGit extends Context.Tag("@niceeval/repo-tools/pr/Git")<PrGit, PrGitService>() {}

export interface PrGitHubService {
  readonly view: (pr: number) => Effect.Effect<GitHubPullRequest, PrGitHubFailure>;
  readonly edit: (pr: number, bodyFile: string) => Effect.Effect<void, PrGitHubFailure>;
  readonly create: (input: Readonly<{
    readonly base: string;
    readonly head: string;
    readonly title: string;
    readonly bodyFile: string;
  }>) => Effect.Effect<string, PrGitHubFailure>;
}

export class PrGitHub extends Context.Tag("@niceeval/repo-tools/pr/GitHub")<
  PrGitHub,
  PrGitHubService
>() {}

export type PrBodyRequirements = PrFileSystem | PrGit | PrGitHub;
