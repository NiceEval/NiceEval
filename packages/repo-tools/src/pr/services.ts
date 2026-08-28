import { Context, type Effect } from "effect";

import type { GitHubPullRequest } from "./model.js";
import type { PrFileFailure, PrGitFailure, PrGitHubFailure } from "./errors.js";

export interface PrFileSystemService {
  readonly exists: (path: string) => Effect.Effect<boolean, PrFileFailure>;
  readonly readText: (path: string) => Effect.Effect<string, PrFileFailure>;
  readonly ensureDirectory: (path: string) => Effect.Effect<void, PrFileFailure>;
  readonly writeText: (path: string, text: string) => Effect.Effect<void, PrFileFailure>;
  readonly deleteFile: (path: string) => Effect.Effect<void, PrFileFailure>;
}

export class PrFileSystem extends Context.Service<PrFileSystem, PrFileSystemService>()(
  "@niceeval/repo-tools/pr/FileSystem",
) {}

export interface PrGitService {
  readonly run: (
    args: readonly string[],
    options?: Readonly<{ readonly allowFailure?: boolean }>,
  ) => Effect.Effect<string, PrGitFailure>;
}

export class PrGit extends Context.Service<PrGit, PrGitService>()("@niceeval/repo-tools/pr/Git") {}

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

export class PrGitHub extends Context.Service<PrGitHub, PrGitHubService>()(
  "@niceeval/repo-tools/pr/GitHub",
) {}

export type PrBodyRequirements = PrFileSystem | PrGit | PrGitHub;
