import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { E2ECaseContext } from "@niceeval/testkit";
import { copyTreePrivately, makeTreeWritable, readPreparedWorld, treeDigest } from "../../scripts/world.ts";
import type { PreparedClassicHistoryAttempt } from "../../scripts/world.ts";
import { reportCaseArtifacts, reportE2E } from "./context.ts";

type ReportCommands = { readonly niceeval: readonly [string, string] };
type BaseCase = E2ECaseContext<ReportCommands>;

export interface ClassicWorld {
  /** Immutable coordinator output. Tests may inspect it but must never write it. */
  readonly root: string;
  readonly recordSeed: string;
  readonly staticSiteSeed: string;
  readonly seedDigest: string;
  readonly historyAttempts: readonly PreparedClassicHistoryAttempt[];
  /** Locator facts captured by the producer's public `exp --json` output. */
  attemptLocator(experimentId: string, evalId: string): string;
}

export type ClassicWorldCase = BaseCase & {
  readonly world: ClassicWorld;
  /** Private mutable copy of the classic Record for this one test case. */
  readonly recordDir: string;
  /** Private byte-copy of the static export, when the case needs a static site. */
  readonly staticSiteDir: string;
};

const preparedWorldRoot = (): string => {
  const value = process.env.NICEEVAL_REPORT_WORLD;
  if (value === undefined || value.length === 0) {
    throw new Error("NICEEVAL_REPORT_WORLD is required; run through scripts/run-native.mjs or scripts/prepare.ts");
  }
  return resolve(value);
};

/**
 * Installs separate ordinary-byte copies for every native case.  The seed stays
 * read-only and its digest is checked both before and after the consumer runs.
 */
export async function withClassicWorld<T>(
  caseId: string,
  body: (context: ClassicWorldCase) => Promise<T>,
): Promise<T> {
  const root = preparedWorldRoot();
  const prepared = readPreparedWorld(root);
  if (prepared.classic.status !== "ready") {
    throw new Error(`classic World is unavailable: ${prepared.classic.reason}`);
  }
  if (prepared.classic.exportDir === undefined) {
    throw new Error("classic World is missing the required static export");
  }
  const recordSeed = resolve(root, prepared.classic.recordDir);
  const staticSiteSeed = resolve(root, prepared.classic.exportDir);
  const seedDigest = prepared.classic.seedDigest;
  if (!existsSync(recordSeed) || treeDigest(recordSeed) !== seedDigest) {
    throw new Error("classic Record seed failed its pre-consumer digest check");
  }

  return reportE2E.case(caseId, { artifacts: reportCaseArtifacts(["site-export"]) }, async (context) => {
    const recordDir = join(context.paths.projectRoot, ".niceeval");
    const staticSiteDir = join(context.paths.projectRoot, "site-export");
    copyTreePrivately(recordSeed, recordDir, seedDigest);
    copyTreePrivately(staticSiteSeed, staticSiteDir);
    makeTreeWritable(recordDir);
    makeTreeWritable(staticSiteDir);
    try {
      return await body({
        ...context,
        world: {
          root,
          recordSeed,
          staticSiteSeed,
          seedDigest,
          historyAttempts: prepared.classicHistoryAttempts,
          attemptLocator(experimentId: string, evalId: string): string {
            const matches = prepared.classicAttempts.filter(
              (attempt) => attempt.experimentId === experimentId && attempt.evalId === evalId,
            );
            if (matches.length !== 1) {
              throw new Error(`prepared classic World has no unique locator for ${experimentId} ${evalId}`);
            }
            return matches[0]!.locator;
          },
        },
        recordDir,
        staticSiteDir,
      });
    } finally {
      if (treeDigest(recordSeed) !== seedDigest) {
        throw new Error("a native consumer modified the frozen classic Record seed");
      }
    }
  });
}
