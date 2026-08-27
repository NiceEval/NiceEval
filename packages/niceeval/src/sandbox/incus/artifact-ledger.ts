import { incusError } from "./errors.ts";
import type { ArtifactIntent, IncusRepository } from "./repository.ts";

export type { ArtifactIntent, ArtifactState } from "./repository.ts";

export function reserveArtifactIntent(
  repository: IncusRepository,
  intent: ArtifactIntent,
  maximumActive: number,
): Promise<ArtifactIntent> {
  return repository.reserveArtifact(intent, maximumActive);
}

export function transitionArtifactIntent(
  repository: IncusRepository,
  current: ArtifactIntent,
  next: ArtifactIntent,
): Promise<ArtifactIntent> {
  return repository.transitionArtifact(current, next);
}

export function readArtifactIntent(
  repository: IncusRepository,
  artifactId: string,
): Promise<ArtifactIntent | undefined> {
  return repository.getArtifact(artifactId);
}

export function listArtifactIntents(repository: IncusRepository): Promise<readonly ArtifactIntent[]> {
  return repository.listArtifacts();
}

export async function requireCommittedArtifact(
  repository: IncusRepository,
  artifactId: string,
  generation: number,
): Promise<ArtifactIntent> {
  const intent = await readArtifactIntent(repository, artifactId);
  if (intent === undefined || intent.generation !== generation || intent.state !== "committed") {
    throw incusError(
      "sandbox-artifact-unverified",
      `Artifact ${JSON.stringify(artifactId)} is not a committed generation ${generation}.`,
      ["Only a committed IncusRepository artifact intent is consumable."],
    );
  }
  return intent;
}
