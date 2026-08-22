#!/usr/bin/env -S npx tsx
// Discover and print every Nx E2E leaf project.

import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";

import {
  discoverAllRepos,
  e2eRootDir,
  type DiscoveredRepo,
  type E2ERepoManifest,
  type RepoRequires,
} from "./discovery.ts";

function formatRequires(requires: RepoRequires | undefined): string {
  if (!requires) return "(none declared)";
  const parts: string[] = [];
  if (requires.docker !== undefined) parts.push(`docker=${requires.docker}`);
  if (requires.externalNetwork !== undefined) parts.push(`externalNetwork=${requires.externalNetwork}`);
  if (requires.platforms !== undefined) parts.push(`platforms=${requires.platforms.join(",")}`);
  if (requires.runtimes !== undefined) parts.push(`runtimes=${requires.runtimes.join(",")}`);
  if (requires.browsers !== undefined) parts.push(`browsers=${requires.browsers.join(",")}`);
  return parts.length > 0 ? parts.join(", ") : "(empty object)";
}

function formatExecutor(executor: E2ERepoManifest["executor"]): string {
  return executor.kind;
}

function printRepo(repo: DiscoveredRepo): void {
  const { manifest } = repo;
  console.log(`- ${manifest.id}  [${manifest.areas.join(", ")}]`);
  console.log(`    batch:    ${manifest.batch}`);
  console.log(`    lanes:    ${manifest.lanes.join(", ")}`);
  console.log(`    executor: ${formatExecutor(manifest.executor)}`);
  console.log(`    command:  ${manifest.command.join(" ")}`);
  console.log(`    requires: ${formatRequires(manifest.requires)}`);
}

interface MatrixEntry {
  id: string;
  batch: E2ERepoManifest["batch"];
  dir: string;
  areas: E2ERepoManifest["areas"];
  lanes: E2ERepoManifest["lanes"];
  executor: E2ERepoManifest["executor"];
  requires?: RepoRequires;
}

function toMatrixEntry(repo: DiscoveredRepo, e2eRoot: string): MatrixEntry {
  return {
    id: repo.manifest.id,
    batch: repo.manifest.batch,
    dir: relative(e2eRoot, repo.dir),
    areas: repo.manifest.areas,
    lanes: repo.manifest.lanes,
    executor: repo.manifest.executor,
    ...(repo.manifest.requires === undefined ? {} : { requires: repo.manifest.requires }),
  };
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const jsonMode = argv.includes("--json");
  const e2eRoot = e2eRootDir();
  const { repos, errors } = discoverAllRepos(e2eRoot);

  if (errors.length > 0) {
    console.error(`e2e repo discovery found ${errors.length} problem(s):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const sorted = [...repos].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  if (jsonMode) {
    console.log(JSON.stringify(sorted.map((repo) => toMatrixEntry(repo, e2eRoot))));
    return;
  }

  console.log(`${sorted.length} e2e repo(s) discovered under e2e/:\n`);
  for (const repo of sorted) {
    printRepo(repo);
    console.log("");
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
