import {
  compareObservabilityText,
  jsonUtf8ByteLength,
  limitationTarget,
  type Collection,
} from "../../../record/family/source-receipt/model.ts";

export function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

export function payloadFits(value: object, maximumBytes: number): boolean {
  const length = jsonUtf8ByteLength(value);
  return length !== undefined && length <= maximumBytes;
}

export function isStrictlyOrderedById<Item>(
  values: readonly Item[],
  idOf: (value: Item) => string,
): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const id = idOf(value);
    if (seen.has(id) || (previous !== undefined && compareObservabilityText(previous, id) >= 0)) {
      return false;
    }
    seen.add(id);
    previous = id;
  }
  return true;
}

export function isAllowedCollection(
  collection: Collection,
  targets: readonly string[],
): boolean {
  return collection.limitations.every((limitation) =>
    targets.some((target) => limitationTarget(limitation) === target),
  );
}
