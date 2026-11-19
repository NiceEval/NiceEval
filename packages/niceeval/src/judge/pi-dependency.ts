import { PiFailure } from "./pi-failure.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import { findPackageJSON } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Resolves the optional runtime at registration, without executing an SDK provider. */
function resolveInstalledPi(projectRoot: string): {
  readonly coding: string;
  readonly ai: string;
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
      manifest = findPackageJSON("@earendil-works/pi-coding-agent", pathToFileURL(`${projectRoot}/package.json`));
    } catch {
      /* Public install action below. */
    }
  }
  if (manifest === undefined)
    throw new PiFailure({
      kind: "dependency",
      message:
        "judge.agent-dependency-missing: install the review runtime with pnpm add @earendil-works/pi-coding-agent@1.5.2",
      cause: undefined,
    });
  const ai = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(manifest));
  if (ai === undefined)
    throw new PiFailure({
      kind: "dependency",
      message: "judge.agent-dependency-missing: reinstall @earendil-works/pi-coding-agent@1.5.2 and its dependencies",
      cause: undefined,
    });
  return {
    coding: join(dirname(manifest), "dist/index.js"),
    ai: join(dirname(ai), "dist/index.js"),
    codingVersion: JSON.parse(readFileSync(manifest, "utf8")).version,
    aiVersion: JSON.parse(readFileSync(ai, "utf8")).version,
  };
}

export function resolvePiCodingAgent(projectRoot = process.cwd()): ReturnType<typeof resolveInstalledPi> {
  try {
    return resolveInstalledPi(projectRoot);
  } catch (cause) {
    if (cause instanceof PiFailure) throw cause;
    throw new PiFailure({
      kind: "dependency",
      message: "pi dependency could not be resolved",
      cause: normalizeExternalCause(cause),
    });
  }
}
