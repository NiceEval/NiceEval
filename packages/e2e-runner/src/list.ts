// E2E discovery presentation. Discovery itself remains in Effect.

import { relative } from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { discoverAllRepos, e2eRootDir, type DiscoveryIoError, type DiscoveredRepo } from "./discovery.ts";
import type { E2ERepoManifest, RepoRequires } from "./manifest.ts";

export interface MatrixEntry {
  readonly id: string;
  readonly batch: E2ERepoManifest["batch"];
  readonly dir: string;
  readonly areas: E2ERepoManifest["areas"];
  readonly lanes: E2ERepoManifest["lanes"];
  readonly executor: E2ERepoManifest["executor"];
  readonly requires?: RepoRequires;
}

export interface ListedRepos {
  readonly repos: readonly DiscoveredRepo[];
  readonly errors: readonly string[];
}

export const listRepos = (root = e2eRootDir()): Effect.Effect<ListedRepos, DiscoveryIoError, FileSystem.FileSystem> =>
  Effect.map(discoverAllRepos(root), ({ repos, errors }) => ({
    repos: [...repos].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id)),
    errors,
  }));

const formatRequires = (requires: RepoRequires | undefined): string => {
  if (requires === undefined) return "(none declared)";
  const parts: string[] = [];
  if (requires.docker !== undefined) parts.push(`docker=${requires.docker}`);
  if (requires.externalNetwork !== undefined) parts.push(`externalNetwork=${requires.externalNetwork}`);
  if (requires.platforms !== undefined) parts.push(`platforms=${requires.platforms.join(",")}`);
  if (requires.runtimes !== undefined) parts.push(`runtimes=${requires.runtimes.join(",")}`);
  if (requires.browsers !== undefined) parts.push(`browsers=${requires.browsers.join(",")}`);
  return parts.length === 0 ? "(empty object)" : parts.join(", ");
};

const toMatrixEntry = (repo: DiscoveredRepo, root: string): MatrixEntry => ({
  id: repo.manifest.id,
  batch: repo.manifest.batch,
  dir: relative(root, repo.dir),
  areas: repo.manifest.areas,
  lanes: repo.manifest.lanes,
  executor: repo.manifest.executor,
  ...(repo.manifest.requires === undefined ? {} : { requires: repo.manifest.requires }),
});

/** Rendering is pure; the final CLI handler supplies stdout/stderr. */
export const formatListedRepos = (listed: ListedRepos, json: boolean, root = e2eRootDir()): readonly string[] => {
  if (listed.errors.length > 0) return [
    `e2e repo discovery found ${listed.errors.length} problem(s):`,
    ...listed.errors.map((error) => `  - ${error}`),
  ];
  if (json) return [JSON.stringify(listed.repos.map((repo) => toMatrixEntry(repo, root)))];
  const lines = [`${listed.repos.length} e2e repo(s) discovered under e2e/:`, ""];
  for (const repo of listed.repos) {
    const { manifest } = repo;
    lines.push(`- ${manifest.id}  [${manifest.areas.join(", ")}]`);
    lines.push(`    batch:    ${manifest.batch}`);
    lines.push(`    lanes:    ${manifest.lanes.join(", ")}`);
    lines.push(`    executor: ${manifest.executor.kind}`);
    lines.push(`    command:  ${manifest.command.join(" ")}`);
    lines.push(`    requires: ${formatRequires(manifest.requires)}`, "");
  }
  return lines;
};
