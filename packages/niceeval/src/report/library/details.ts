import { createHash } from "node:crypto";
import type {
  ExperimentId,
  JsonValue,
  Sample,
} from "../../analysis/index.ts";
import {
  parseAttemptLocator,
  type AttemptLocator,
} from "../../attempt-locator.ts";
import type { PageParams } from "../definition/report.ts";

const ATTEMPT_DETAIL_PATH = "/attempt";
const EXPERIMENT_DETAIL_PATH = "/experiment";
const ATTEMPT_DETAIL_KEY_PATTERN = /^a1[0-9a-hjkmnp-tv-z]{12}$/;
const EXPERIMENT_DETAIL_KEY_PATTERN = /^e1[a-f0-9]{24}$/;
const CROCKFORD_BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";
const ATTEMPT_KEY_BITS = 60n;
const ATTEMPT_KEY_MASK = (1n << ATTEMPT_KEY_BITS) - 1n;

/*
 * A parameter decoder receives only the route key, not a Sample.  Attempt
 * pages therefore use a reversible address permutation: direct `show` can
 * recover the locator for the Sample-bound evidence check, while the route
 * never serializes the human-facing `@1…` locator itself.  This is address
 * notation, not an authorization capability; the Page loader still proves
 * Sample membership through its public data boundary.
 */
const ATTEMPT_KEY_OFFSET = 0x0d6e8f5a31c9b47n;

/** A closed Attempt identity accepted by the standard Attempt detail Page. */
export type AttemptDetailTarget = Readonly<Record<string, JsonValue>> & Readonly<{
  readonly kind: "attempt";
  readonly locator: AttemptLocator;
}>;

/** A route-safe Experiment identity; its durable ExperimentId never enters the target. */
export type ExperimentDetailTarget = Readonly<Record<string, JsonValue>> & Readonly<{
  readonly kind: "experiment";
  readonly key: string;
}>;

/** The only typed target accepted by the product detail-route helper. */
export type LibraryDetailTarget = AttemptDetailTarget | ExperimentDetailTarget;

/** Creates a canonical Attempt target before it is encoded into a route key. */
export function attemptDetailTarget(locator: AttemptLocator): AttemptDetailTarget {
  const parsed = parseAttemptLocator(locator);
  if (!parsed.valid) throw new TypeError("Attempt detail targets require a canonical Attempt locator");
  return Object.freeze({ kind: "attempt" as const, locator: parsed.locator });
}

/** Creates an opaque Experiment target without retaining its durable identity. */
export function experimentDetailTarget(experimentId: ExperimentId): ExperimentDetailTarget {
  return experimentTargetFromKey(experimentDetailKey(experimentId));
}

/** Returns the sole product route shape for either standard detail target. */
export function libraryDetailRoute(target: LibraryDetailTarget): string {
  if (isDirectObject(target) && target.kind === "attempt") {
    return `${ATTEMPT_DETAIL_PATH}/${attemptDetailKey(target)}`;
  }
  if (isDirectObject(target) && target.kind === "experiment") {
    return `${EXPERIMENT_DETAIL_PATH}/${experimentDetailKeyFromTarget(target)}`;
  }
  throw new TypeError("Library detail routes require an Attempt or Experiment detail target");
}

/** Returns the route for one canonical Attempt locator without exposing it in the path. */
export function attemptDetailRoute(locator: AttemptLocator): string {
  return libraryDetailRoute(attemptDetailTarget(locator));
}

/** Returns the route for one Experiment without exposing its durable identity in the path. */
export function experimentDetailRoute(experimentId: ExperimentId): string {
  return libraryDetailRoute(experimentDetailTarget(experimentId));
}

/** Codec for standard Attempt pages. Enumeration is derived only from the fixed Sample snapshot. */
export const attemptDetailParams: PageParams<AttemptDetailTarget> = Object.freeze({
  encode: attemptDetailKey,
  decode: decodeAttemptDetailTarget,
  enumerate: enumerateAttemptDetailTargets,
});

/** Codec for standard Experiment pages. Enumeration is derived only from the fixed Sample snapshot. */
export const experimentDetailParams: PageParams<ExperimentDetailTarget> = Object.freeze({
  encode: experimentDetailKeyFromTarget,
  decode: decodeExperimentDetailTarget,
  enumerate: enumerateExperimentDetailTargets,
});

function attemptDetailKey(value: AttemptDetailTarget): string {
  const target = attemptTargetFrom(value);
  const locatorBits = decodeCrockford(target.locator.slice(2));
  const routeBits = (locatorBits + ATTEMPT_KEY_OFFSET) & ATTEMPT_KEY_MASK;
  return `a1${encodeCrockford(routeBits)}`;
}

function decodeAttemptDetailTarget(key: string): AttemptDetailTarget {
  if (!ATTEMPT_DETAIL_KEY_PATTERN.test(key)) {
    throw new TypeError("Attempt detail route key is not canonical");
  }
  const routeBits = decodeCrockford(key.slice(2));
  const locatorBits = (routeBits - ATTEMPT_KEY_OFFSET) & ATTEMPT_KEY_MASK;
  const parsed = parseAttemptLocator(`@1${encodeCrockford(locatorBits).toUpperCase()}`);
  if (!parsed.valid) throw new TypeError("Attempt detail route key cannot decode to a canonical locator");
  return attemptDetailTarget(parsed.locator);
}

function enumerateAttemptDetailTargets(sample: Sample): readonly AttemptDetailTarget[] {
  const keys = new Set<string>();
  for (const slot of sample.snapshot.slots) {
    if (slot.state === "included") keys.add(attemptDetailKey(attemptDetailTarget(slot.attempt.locator)));
  }
  return Object.freeze([...keys]
    .sort(compareText)
    .map((key) => decodeAttemptDetailTarget(key)));
}

function experimentDetailKeyFromTarget(value: ExperimentDetailTarget): string {
  if (!isDirectObject(value) || value.kind !== "experiment" || typeof value.key !== "string" ||
    !EXPERIMENT_DETAIL_KEY_PATTERN.test(value.key)) {
    throw new TypeError("Experiment detail params must use a canonical opaque target");
  }
  return value.key;
}

function decodeExperimentDetailTarget(key: string): ExperimentDetailTarget {
  if (!EXPERIMENT_DETAIL_KEY_PATTERN.test(key)) {
    throw new TypeError("Experiment detail route key is not canonical");
  }
  return experimentTargetFromKey(key);
}

function enumerateExperimentDetailTargets(sample: Sample): readonly ExperimentDetailTarget[] {
  const identitiesByKey = new Map<string, ExperimentId>();
  for (const slot of sample.snapshot.slots) {
    if (slot.state === "excluded") continue;
    const key = experimentDetailKey(slot.experimentId);
    const previous = identitiesByKey.get(key);
    if (previous !== undefined && previous !== slot.experimentId) {
      throw new TypeError("two Sample Experiments produced the same detail route key");
    }
    identitiesByKey.set(key, slot.experimentId);
  }
  return Object.freeze([...identitiesByKey.keys()]
    .sort(compareText)
    .map((key) => decodeExperimentDetailTarget(key)));
}

function experimentDetailKey(experimentId: ExperimentId): string {
  const digest = createHash("sha256")
    .update("niceeval.report.experiment-detail/v1\\0", "utf8")
    .update(String(experimentId), "utf8")
    .digest("hex");
  return `e1${digest.slice(0, 24)}`;
}

function attemptTargetFrom(value: unknown): AttemptDetailTarget {
  if (!isDirectObject(value) || value.kind !== "attempt" || typeof value.locator !== "string") {
    throw new TypeError("Attempt detail params must use a canonical target");
  }
  return attemptDetailTarget(value.locator as AttemptLocator);
}

function experimentTargetFromKey(key: string): ExperimentDetailTarget {
  return Object.freeze({ kind: "experiment" as const, key });
}

function decodeCrockford(value: string): bigint {
  let result = 0n;
  for (const character of value) {
    const digit = CROCKFORD_BASE32.indexOf(character.toLowerCase());
    if (digit < 0) throw new TypeError("Attempt detail route key is not canonical");
    result = (result << 5n) | BigInt(digit);
  }
  return result;
}

function encodeCrockford(value: bigint): string {
  let remaining = value;
  let result = "";
  for (let index = 0; index < Number(ATTEMPT_KEY_BITS / 5n); index += 1) {
    result = CROCKFORD_BASE32[Number(remaining & 31n)]! + result;
    remaining >>= 5n;
  }
  return result;
}

function isDirectObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
