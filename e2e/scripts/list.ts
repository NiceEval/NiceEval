#!/usr/bin/env -S npx tsx
// Discover and print every e2e/repos/*/e2e.json (docs/engineering/e2e-ci/README.md §2.3).
//
// Exit codes:
//   0   discovery clean (including the zero-repos case — that's expected,
//       not an error, before the matrix repos land)
//   1   at least one e2e.json is malformed, or an id collides
//
// `--json` (docs/engineering/e2e-ci/README.md §6.1): prints a compact JSON
// array of `{ id, group, requires }` for every discovered repo, and nothing
// else on stdout — this is what CI's `discover` job feeds to `fromJson(...)`
// to build the GitHub Actions matrix. Errors still go to stderr and the exit
// code contract is unchanged; only the success-path stdout shape differs
// from the default human-readable text mode.

import { discoverRepos, reposRootDir, type DiscoveredRepo, type RepoRequires } from "./discovery.ts";

function formatRequires(requires: RepoRequires | undefined): string {
  if (!requires) return "(none declared — default: Node runtime + outbound network)";
  const parts: string[] = [];
  if (requires.runtimes) parts.push(`runtimes=${requires.runtimes.join(",")}`);
  if (requires.docker !== undefined) parts.push(`docker=${requires.docker}`);
  if (requires.arch) parts.push(`arch=${requires.arch}`);
  if (requires.memoryGB !== undefined) parts.push(`memoryGB=${requires.memoryGB}`);
  return parts.length > 0 ? parts.join(", ") : "(empty object)";
}

function printRepo(repo: DiscoveredRepo): void {
  const { manifest } = repo;
  console.log(`- ${manifest.id}  [${manifest.group}]`);
  console.log(`    command:  ${manifest.command.join(" ")}`);
  console.log(`    requires: ${formatRequires(manifest.requires)}`);
}

interface MatrixEntry {
  id: string;
  group: DiscoveredRepo["manifest"]["group"];
  requires?: RepoRequires;
}

function toMatrixEntry(repo: DiscoveredRepo): MatrixEntry {
  return { id: repo.manifest.id, group: repo.manifest.group, requires: repo.manifest.requires };
}

function main(): void {
  const jsonMode = process.argv.includes("--json");
  const root = reposRootDir();
  const { repos, errors } = discoverRepos(root);

  if (errors.length > 0) {
    console.error(`e2e repo discovery found ${errors.length} problem(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const sorted = [...repos].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

  if (jsonMode) {
    // Stdout carries only the JSON array — no banner, no trailing blank
    // lines — so a CI step can pipe it straight into `fromJson(...)`.
    console.log(JSON.stringify(sorted.map(toMatrixEntry)));
    return;
  }

  if (sorted.length === 0) {
    console.log("No e2e test repos found under e2e/repos/ yet.");
    console.log("This is expected before the matrix repos land — not an error.");
    return;
  }

  console.log(`${sorted.length} e2e repo(s) discovered under e2e/repos/:\n`);
  for (const repo of sorted) {
    printRepo(repo);
    console.log("");
  }
}

main();
