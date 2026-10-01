import type { AssertionMaterial, CapturedAssertionSnapshot } from "./api.ts";
import { captureAssertionSnapshot } from "./runtime.ts";

const maximumBytes = 16 * 1024 * 1024;
const utf8 = new TextEncoder();
const contentByMaterial = new WeakMap<AssertionMaterial, string>();

/** @internal Complete data-only content; the Runtime value remains a display preview. */
export function captureFullAssertionSnapshot(value: unknown): CapturedAssertionSnapshot {
  const parts: string[] = [];
  const ancestors = new WeakSet<object>();
  let byteLength = 0;
  let nodes = 0;
  const reject = (code: string, message: string): never => {
    throw Object.assign(new TypeError(message), { code });
  };
  const append = (part: string): void => {
    const observed = byteLength + utf8.encode(part).byteLength;
    if (observed > maximumBytes) reject("assertion-full-content-byte-limit", "Assertion full content exceeds 16777216 UTF-8 bytes");
    byteLength = observed;
    parts.push(part);
  };
  const quoted = (text: string): void => {
    if (text.length > maximumBytes - byteLength) reject("assertion-full-content-byte-limit", "Assertion full content exceeds 16777216 UTF-8 bytes");
    append(JSON.stringify(text));
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 2_097_152) reject("assertion-full-content-node-limit", "Assertion full content exceeds 2097152 traversal nodes");
    if (depth > 72) reject("assertion-full-content-depth-limit", "Assertion full content exceeds depth 72");
    if (item === undefined) return append('{"$niceeval":"undefined"}');
    if (item === null || typeof item === "boolean") return append(JSON.stringify(item));
    if (typeof item === "string") return quoted(item);
    if (typeof item === "number" && Number.isFinite(item)) return append(JSON.stringify(item));
    if (typeof item !== "object" || item === null) reject("assertion-full-content-invalid-value", "Assertion full content requires finite ordinary data");
    const object = item as object;
    if (ancestors.has(object)) reject("assertion-full-content-invalid-value", "Assertion full content cannot contain cycles");
    const array = Array.isArray(object);
    const prototype = Reflect.getPrototypeOf(object);
    if (!array && prototype !== Object.prototype && prototype !== null) reject("assertion-full-content-invalid-value", "Assertion full content requires plain objects");
    const keys = Reflect.ownKeys(object);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (typeof key !== "string" || descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable || array && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= (object as unknown[]).length)) reject("assertion-full-content-invalid-value", "Assertion full content requires own string data properties and dense arrays");
    }
    ancestors.add(object);
    try {
      append(array ? "[" : "{");
      if (array) {
        const length = (object as unknown[]).length;
        for (let index = 0; index < length; index += 1) {
          const descriptor = Reflect.getOwnPropertyDescriptor(object, String(index));
          if (descriptor === undefined || !("value" in descriptor)) reject("assertion-full-content-invalid-value", "Assertion full content cannot contain array holes or accessors");
          if (index > 0) append(",");
          visit(descriptor!.value, depth + 1);
        }
      } else {
        keys.forEach((key, index) => {
          if (index > 0) append(",");
          quoted(key as string);
          append(":");
          visit(Reflect.getOwnPropertyDescriptor(object, key)!.value, depth + 1);
        });
      }
      append(array ? "]" : "}");
    } finally { ancestors.delete(object); }
  };
  visit(value, 0);
  const content = parts.join("");
  const { material } = captureAssertionSnapshot(JSON.parse(content));
  contentByMaterial.set(material, content);
  return Object.freeze({ material, coverage: Object.freeze({ state: "complete" as const }), limitations: Object.freeze([]) });
}

export function transferFullAssertionContent(from: AssertionMaterial, to: AssertionMaterial): void {
  const content = contentByMaterial.get(from);
  if (content !== undefined) contentByMaterial.set(to, content);
}

export function fullAssertionContentOf(material: AssertionMaterial): string | undefined {
  return contentByMaterial.get(material);
}

export function fullAssertionContentByteLength(material: AssertionMaterial): number | undefined {
  const content = contentByMaterial.get(material);
  return content === undefined ? undefined : utf8.encode(content).byteLength;
}
