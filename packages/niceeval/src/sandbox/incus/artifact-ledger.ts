import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { incusError } from "./errors.ts";
import type { IncusArtifactLocator } from "./artifact.ts";

export type ArtifactState = "reserved" | "preparing" | "publishing" | "committed" | "invalid" | "quarantined" | "released";

export interface ArtifactIntent extends IncusArtifactLocator {
  readonly state: ArtifactState;
  readonly executionDomainId: string;
  readonly runtimeProject: string;
  readonly pool: string;
  readonly baseFingerprint: string;
  readonly providerRevision: string;
  readonly guestInitRevision: string;
  readonly captureRevision: string;
  readonly coverage: string;
  readonly resourcesDigest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function artifactsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "niceeval", "incus-artifacts");
}
function pathFor(id: string, env: NodeJS.ProcessEnv): string { return join(artifactsDir(env), `${id}.json`); }
export async function writeArtifactIntent(intent: ArtifactIntent, env: NodeJS.ProcessEnv = process.env): Promise<ArtifactIntent> {
  const dir = artifactsDir(env); await mkdir(dir, { recursive: true, mode: 0o700 });
  const next = Object.freeze({ ...intent, updatedAt: new Date().toISOString() });
  const target = pathFor(intent.artifactId, env); const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next)}\n`, { mode: 0o600 }); await rename(temp, target); return next;
}
export async function readArtifactIntent(id: string, env: NodeJS.ProcessEnv = process.env): Promise<ArtifactIntent | undefined> {
  try { return Object.freeze(JSON.parse(await readFile(pathFor(id, env), "utf8")) as ArtifactIntent); }
  catch (cause) { if ((cause as { code?: unknown }).code === "ENOENT") return undefined; throw cause; }
}
export async function listArtifactIntents(env: NodeJS.ProcessEnv = process.env): Promise<readonly ArtifactIntent[]> {
  try {
    const names = await readdir(artifactsDir(env));
    return Object.freeze(await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) =>
      Object.freeze(JSON.parse(await readFile(join(artifactsDir(env), name), "utf8")) as ArtifactIntent))));
  } catch (cause) { if ((cause as { code?: unknown }).code === "ENOENT") return Object.freeze([]); throw cause; }
}
export async function requireCommittedArtifact(id: string, generation: number, env: NodeJS.ProcessEnv = process.env): Promise<ArtifactIntent> {
  const intent = await readArtifactIntent(id, env);
  if (intent === undefined || intent.generation !== generation || intent.state !== "committed") {
    throw incusError("sandbox-artifact-unverified", `Artifact ${JSON.stringify(id)} is not a committed generation ${generation}.`, ["Only a committed artifact ledger record is consumable."]);
  }
  return intent;
}
