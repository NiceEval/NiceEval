import { findPackageJSON } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Resolves the optional runtime at registration, without executing an SDK provider. */
export function resolvePiCodingAgent(): {
  readonly coding: string;
  readonly codingVersion: string;
  readonly aiVersion: string;
} {
  let manifest: string | undefined;
  try {
    manifest = findPackageJSON("@earendil-works/pi-coding-agent", import.meta.url);
  } catch {
    /* Consumer fallback below. */
  }
  if (manifest === undefined) {
    try {
      manifest = findPackageJSON("@earendil-works/pi-coding-agent", pathToFileURL(`${process.cwd()}/package.json`));
    } catch {
      /* Public install action below. */
    }
  }
  if (manifest === undefined)
    throw new TypeError(
      "judge.agent-dependency-missing: install the review runtime with pnpm add @earendil-works/pi-coding-agent@1.5.2",
    );
  const ai = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(manifest));
  if (ai === undefined)
    throw new TypeError(
      "judge.agent-dependency-missing: reinstall @earendil-works/pi-coding-agent@1.5.2 and its dependencies",
    );
  return {
    coding: join(dirname(manifest), "dist/index.js"),
    codingVersion: JSON.parse(readFileSync(manifest, "utf8")).version,
    aiVersion: JSON.parse(readFileSync(ai, "utf8")).version,
  };
}
