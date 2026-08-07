// External artifact collection for isolated e2e repo runs.
//
// Declared patterns are copied from the isolated copy into an independent
// artifactRoot/<repo-id>/ — never into the source repo, and never into the
// ephemeral scratchRoot that holds working copies (those are deleted).
// A declared `.niceeval` path is diagnostic evidence only: this module
// never parses those files or feeds them into a pass/fail decision.

import { basename, join, relative } from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";

/** Per-repo directory under the durable artifactRoot (not under scratchRoot). */
export function repoArtifactDir(artifactRoot: string, repoId: string): string {
  return join(artifactRoot, repoId);
}

/** Absolute path of the structured receipt JSON for one repo. */
export function repoReceiptPath(artifactRoot: string, repoId: string): string {
  return join(artifactRoot, repoId, "receipt.json");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`);
}

export interface CollectResult {
  /** Paths relative to destDir that were written. */
  collected: string[];
  warnings: string[];
}

/**
 * Copy e2e.json `artifacts` patterns out of the isolated copy into destDir.
 * Supports `dir/**` and a single top-level filename glob; other shapes warn and skip.
 */
export async function collectArtifacts(
  copyDir: string,
  destDir: string,
  patterns: readonly string[],
): Promise<CollectResult> {
  const collected: string[] = [];
  const warnings: string[] = [];
  await mkdir(destDir, { recursive: true });

  for (const pattern of patterns) {
    if (pattern.endsWith("/**")) {
      const dirName = pattern.slice(0, -3);
      const src = join(copyDir, dirName);
      if (existsSync(src)) {
        const dest = join(destDir, dirName);
        await cp(src, dest, { recursive: true, force: true });
        collected.push(dirName);
      }
      continue;
    }
    if (pattern.includes("/")) {
      warnings.push(
        `artifacts pattern "${pattern}" has an unsupported shape (only "dir/**" or a top-level filename glob are supported) — skipping`,
      );
      continue;
    }
    const regex = globToRegExp(pattern);
    let entries: string[];
    try {
      entries = await readdir(copyDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!regex.test(name)) continue;
      await cp(join(copyDir, name), join(destDir, name), { recursive: true, force: true });
      collected.push(name);
    }
  }

  return { collected, warnings };
}

/** Relative path helper for logs — never used for verdict. */
export function describeCollected(destDir: string, relativePath: string): string {
  return relative(destDir, join(destDir, relativePath)) || relativePath;
}

export function isDiagnosticNiceevalPattern(pattern: string): boolean {
  const base = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  return base === ".niceeval" || basename(base) === ".niceeval";
}
