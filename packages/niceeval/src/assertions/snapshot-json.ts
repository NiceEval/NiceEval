interface JsonFrame {
  readonly value: object;
  readonly keys: readonly PropertyKey[];
  readonly array: boolean;
  readonly length: number;
  index: number;
}

/** @internal Encodes data-only evidence without recursion or a framing budget. */
export function encodeAssertionSnapshotJson(value: unknown, canonical = false): string {
  const parts: string[] = [];
  const ancestors = new WeakSet<object>();
  const frames: JsonFrame[] = [];
  const reject = (message: string): never => {
    throw Object.assign(new TypeError(message), { code: "assertion-full-content-invalid-value" });
  };
  const appendValue = (item: unknown): void => {
    if (item === undefined) {
      if (canonical) reject("Canonical JSON cannot contain undefined");
      parts.push('{"$niceeval":"undefined"}');
      return;
    }
    if (
      item === null ||
      typeof item === "boolean" ||
      typeof item === "string" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      parts.push(JSON.stringify(item));
      return;
    }
    if (typeof item !== "object") reject("Assertion full content requires finite ordinary data");
    const object = item as object;
    if (ancestors.has(object)) reject("Assertion full content cannot contain cycles");
    const array = Array.isArray(object);
    const prototype = Reflect.getPrototypeOf(object);
    if (!array && prototype !== Object.prototype && prototype !== null)
      reject("Assertion full content requires plain objects");
    const keys = !array && canonical ? Object.keys(object).sort() : Reflect.ownKeys(object);
    if (
      array &&
      (keys.length !== object.length + 1 ||
        keys.some(
          (key) =>
            key !== "length" &&
            !(typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < object.length),
        ))
    ) {
      reject("Assertion full content requires dense arrays without custom properties");
    }
    ancestors.add(object);
    frames.push({ value: object, keys, array, length: array ? object.length : keys.length, index: 0 });
    parts.push(array ? "[" : "{");
  };
  appendValue(value);
  while (frames.length > 0) {
    const frame = frames.at(-1)!;
    if (frame.index === frame.length) {
      parts.push(frame.array ? "]" : "}");
      ancestors.delete(frame.value);
      frames.pop();
      continue;
    }
    if (frame.index > 0) parts.push(",");
    const index = frame.index++;
    const key = frame.array ? String(index) : frame.keys[index]!;
    const descriptor = typeof key === "string" ? Reflect.getOwnPropertyDescriptor(frame.value, key) : undefined;
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      reject("Assertion full content requires own string data properties and dense arrays");
      continue;
    }
    if (!frame.array) parts.push(JSON.stringify(key), ":");
    appendValue(descriptor.value);
  }
  return parts.join("");
}
