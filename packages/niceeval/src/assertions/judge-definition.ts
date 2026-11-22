// @concord-file
// @concord-implements docs/feature/judge/architecture.md

import * as Predicate from "effect/Predicate";
import type { JudgeAnchor } from "./judge.ts";

const DEFAULT_ANCHORS = [
  { measurement: 0, description: "Does not satisfy the rubric." },
  { measurement: 1, description: "Fully satisfies the rubric." },
];

export function exactDataObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${label} cannot be reflected`);
  }
  const captured: Array<readonly [string, unknown]> = [];
  for (const key of ownKeys) {
    if (typeof key !== "string" || !keys.includes(key))
      throw new TypeError(`${label} has unknown option ${String(key)}`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`${label}.${key} cannot be reflected`);
    }
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError(`${label}.${key} must be a data property`);
    captured.push([key, descriptor.value]);
  }
  return Object.fromEntries(captured);
}
export function requiredJudgeText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be non-empty`);
  return value;
}
export function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

export function judgeRubricAndAnchors(
  rubricValue: unknown,
  anchorsValue?: unknown,
): {
  readonly rubric: string;
  readonly anchors: readonly JudgeAnchor[];
} {
  const rubric = requiredJudgeText(rubricValue, "Judge rubric");
  const rawAnchors = anchorsValue ?? DEFAULT_ANCHORS;
  if (!Array.isArray(rawAnchors) || rawAnchors.length < 2)
    throw new TypeError("Judge anchors must contain at least 2 entries");
  let previous = -1;
  const anchors: JudgeAnchor[] = [];
  const anchorKeys = Reflect.ownKeys(rawAnchors);
  if (
    anchorKeys.some(
      (key) =>
        key !== "length" &&
        !(typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < rawAnchors.length),
    )
  ) {
    throw new TypeError("Judge anchors cannot contain custom properties");
  }
  for (let index = 0; index < rawAnchors.length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(rawAnchors, String(index));
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError(`Judge anchors[${index}] must be a data property`);
    const raw = descriptor.value;
    const anchor = exactDataObject(raw, `Judge anchors[${index}]`, ["measurement", "description"]);
    const measurement = anchor.measurement;
    if (
      typeof measurement !== "number" ||
      !Number.isFinite(measurement) ||
      measurement < 0 ||
      measurement > 1 ||
      measurement <= previous
    )
      throw new TypeError("Judge anchors must be strictly increasing finite measurements in [0, 1]");
    previous = measurement;
    anchors.push({
      measurement,
      description: requiredJudgeText(anchor.description, `Judge anchors[${index}].description`),
    });
  }
  if (anchors[0]?.measurement !== 0 || anchors.at(-1)?.measurement !== 1)
    throw new TypeError("Judge anchors must include 0 and 1");
  return { rubric, anchors: anchors };
}

export function judgeMaterialBudget(value: unknown): number | undefined {
  return value === undefined ? undefined : positiveInteger(value, "Judge maxMaterialBytes");
}
