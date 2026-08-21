import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { expect } from "vitest";

export const RUN_ID = "2ce48d15-5278-46f7-a512-7235a3362c24";
export const ATTEMPT_ID = "ae2047b7-d0ef-4f1d-8a2f-ae2b27e7b4ad";
const installedNiceeval = [process.execPath, join(process.cwd(), "node_modules", "niceeval", "bin", "niceeval.js")] as const;
const legacyNiceeval = [process.execPath, join(process.cwd(), "node_modules", "niceeval-legacy-0-13", "bin", "niceeval.js")] as const;

export const e2e = createE2EContext({
  repoId: "migrate",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-migrate-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { candidate: installedNiceeval, producer: installedNiceeval, legacyProducer: legacyNiceeval },
});

export const LEGACY_PRODUCER_VERSION = "0.13.0";
export const LEGACY_PRODUCER_INTEGRITY = "sha512-aHSNZdzfu6QxkDpsfIS+xRTDRNirvfMOGzexnuZba3H46QdadjewfL5brv5y54UAnynxT2g6gntfPkk180D8+A==";

export function attestLegacyProducer(projectRoot: string): void {
  const metadata = JSON.parse(readFileSync(join(projectRoot, "node_modules", "niceeval-legacy-0-13", "package.json"), "utf8")) as {
    readonly name?: unknown;
    readonly version?: unknown;
  };
  expect(metadata).toMatchObject({ name: "niceeval", version: LEGACY_PRODUCER_VERSION });
  const lockfile = readFileSync(join(projectRoot, "pnpm-lock.yaml"), "utf8");
  expect(lockfile).toContain("niceeval@0.13.0");
  expect(lockfile).toContain(`integrity: ${LEGACY_PRODUCER_INTEGRITY}`);
}

export function copyV1Fixture(sourceRoot: string, recordRoot: string): void {
  cpSync(join(sourceRoot, "fixtures", "observability-v1-record"), recordRoot, { recursive: true });
}

/** Assertions migration starts from the already-published root/Core v2. */
export function copyAssertionsV1Fixture(sourceRoot: string, recordRoot: string): {
  readonly discardedBlobPath: string;
} {
  copyV1Fixture(sourceRoot, recordRoot);
  writeFileSync(
    join(recordRoot, "record.json"),
    '{"format":"niceeval.record","recordId":"6dbcd6bd-f41b-4030-a074-973fb1ecf300","schemaVersion":2}',
  );
  for (const attachment of [
    join(recordRoot, "runs", RUN_ID, "attachments", "niceeval.observability", "attachment.json"),
    join(
      recordRoot,
      "runs", RUN_ID, "attempts", ATTEMPT_ID,
      "attachments", "niceeval.observability", "attachment.json",
    ),
  ]) {
    writeFileSync(attachment, '{"family":"niceeval.observability","schemaVersion":2}');
  }

  const assertions = join(
    recordRoot,
    "runs", RUN_ID, "attempts", ATTEMPT_ID,
    "attachments", "niceeval.assertions",
  );
  const payloadPath = join(assertions, "payload.json");
  const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as {
    "entries-data": { subject: unknown }[];
  };
  const blobKey = "historical-source";
  const blobBytes = Buffer.from('{"answer":42}', "utf8");
  payload["entries-data"][0]!.subject = {
    kind: "blob",
    ref: { "$niceeval.record.blob": blobKey },
    encoding: "utf-8",
    byteLength: blobBytes.byteLength,
    sha256: createHash("sha256").update(blobBytes).digest("hex"),
    preview: "historical source that migration must discard",
  };
  const blobs = join(assertions, "blobs");
  mkdirSync(blobs);
  const discardedBlobPath = join(blobs, blobKey);
  writeFileSync(discardedBlobPath, blobBytes);
  writeFileSync(payloadPath, JSON.stringify(payload));
  return { discardedBlobPath };
}

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function commitRecord(
  run: (command: readonly [string, ...string[]]) => Promise<{
    readonly exitCode: number | null;
    readonly diagnostic: () => string;
  }>,
  message: string,
): Promise<void> {
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "e2e@niceeval.local"],
    ["config", "user.name", "NiceEval E2E"],
    ["add", "-f", ".niceeval/record"],
    ["commit", "-qm", message],
  ] as const) {
    const git = await run(["git", ...args]);
    expect(git.exitCode, git.diagnostic()).toBe(0);
  }
}
