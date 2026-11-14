import type { IncusControl } from "./control.ts";
import { IncusProviderError } from "./errors.ts";
import type { ArtifactIntent } from "./repository.ts";

export interface ArtifactStoragePolicy {
  readonly artifactStorageReserveBytes: number;
  readonly artifactEstimatedBytes?: number;
}
interface PoolReservations {
  bytes: number;
  tail: Promise<void>;
}
const reservations = new Map<string, PoolReservations>();
function poolReservations(pool: string): PoolReservations {
  let state = reservations.get(pool);
  if (state === undefined) {
    state = { bytes: 0, tail: Promise.resolve() };
    reservations.set(pool, state);
  }
  return state;
}
async function exclusive<A>(state: PoolReservations, work: () => Promise<A>): Promise<A> {
  const predecessor = state.tail;
  let unlock!: () => void;
  state.tail = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await predecessor;
  try {
    return await work();
  } finally {
    unlock();
  }
}
export function artifactByteEstimate(
  artifacts: readonly ArtifactIntent[],
  fallback: number | undefined,
): number | undefined {
  // A pool delta is an estimate, not an additive size. Preserve the largest
  // observed copy peak when selecting an estimate for a future capture.
  let sample: number | undefined;
  for (const artifact of artifacts) {
    if (artifact.estimatedArtifactBytes !== undefined)
      sample =
        sample === undefined ? artifact.estimatedArtifactBytes : Math.max(sample, artifact.estimatedArtifactBytes);
  }
  return sample ?? fallback;
}
export function unknownArtifactCaptureSample(pool: string): IncusProviderError {
  return capacityError(pool, undefined, undefined, poolReservations(pool).bytes);
}
function capacityError(
  pool: string,
  free: number | undefined,
  required: number | undefined,
  inFlight: number,
  cause?: unknown,
): IncusProviderError {
  return new IncusProviderError({
    code: "sandbox-capacity-unavailable",
    reason: "storage-bytes",
    summary: `Incus artifact storage-bytes admission refused: pool=${pool} free=${free ?? "unknown"} required=${required ?? "unknown"} inFlightReservedBytes=${inFlight}.`,
    actions: [
      "Inspect niceeval sandbox provider inventory incus (add --development for that domain).",
      "Preview niceeval sandbox provider gc incus --unused-for <duration>; apply only a reviewed plan.",
    ],
    ...(cause === undefined ? {} : { cause }),
  });
}
export async function inspectArtifactStorage(
  control: IncusControl,
  project: string,
  pool: string,
  reserve: number,
  estimate: number | undefined,
) {
  const state = poolReservations(pool);
  return exclusive(state, async () => {
    const required = estimate === undefined ? undefined : estimate + reserve;
    let observation;
    try {
      observation = await control.getStoragePoolResources(project, pool);
    } catch (cause) {
      throw capacityError(pool, undefined, required, state.bytes, cause);
    }
    if (
      required === undefined ||
      !Number.isSafeInteger(required) ||
      estimate! < 0 ||
      !Number.isSafeInteger(estimate) ||
      !Number.isSafeInteger(reserve) ||
      reserve < 0 ||
      observation.free - state.bytes < required
    )
      throw capacityError(pool, observation.free, required, state.bytes);
    return { ...observation, required, inFlightReservedBytes: state.bytes, estimatedArtifactBytes: estimate! };
  });
}

/** Process-local admission spans the entire provider copy and its settlement. */
export async function reserveArtifactStorage(
  control: IncusControl,
  project: string,
  pool: string,
  reserve: number,
  estimate: number | undefined,
): Promise<{ readonly usedBefore: number; readonly estimate: number; readonly release: () => Promise<void> }> {
  const state = poolReservations(pool);
  const admitted = await exclusive(state, async () => {
    const required = estimate === undefined ? undefined : estimate + reserve;
    let observation;
    try {
      observation = await control.getStoragePoolResources(project, pool);
    } catch (cause) {
      throw capacityError(pool, undefined, required, state.bytes, cause);
    }
    if (
      required === undefined ||
      !Number.isSafeInteger(required) ||
      !Number.isSafeInteger(estimate) ||
      estimate! < 0 ||
      !Number.isSafeInteger(reserve) ||
      reserve < 0 ||
      observation.free - state.bytes < required
    )
      throw capacityError(pool, observation.free, required, state.bytes);
    state.bytes += estimate!;
    return { usedBefore: observation.used, estimate: estimate! };
  });
  let released = false;
  return {
    ...admitted,
    release: () =>
      exclusive(state, async () => {
        if (!released) {
          state.bytes -= admitted.estimate;
          released = true;
        }
      }),
  };
}
