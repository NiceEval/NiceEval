// @concord-file
// @concord-implements docs/feature/judge/architecture.md

import {
  conversationMaterialOf,
  copyConversationProjection,
  trimConversationMaterial,
} from "./conversation-material.ts";
import type { JsonValue } from "../shared/types.ts";
import { isJudgeImage, readJudgeImage, type JudgeImage, type JudgeMaterial } from "../judge/image.ts";

const UTF8 = new TextEncoder();
function utf8Bytes(value: string): number {
  return UTF8.encode(value).byteLength;
}
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export interface CapturedImageReference {
  readonly image: JudgeImage;
  readonly imageId: string;
  readonly evidenceIndex: number;
  readonly mediaType: "image/png" | "image/jpeg";
  readonly byteLength: number;
  readonly sha256: string;
  readonly paths: readonly string[];
}
interface MaterialPath {
  readonly parent: MaterialPath | undefined;
  readonly key: string;
}

function jsonPointer(path: MaterialPath | undefined): string {
  const segments: string[] = [];
  for (let current = path; current !== undefined; current = current.parent) {
    segments.push(current.key.replace(/~/gu, "~0").replace(/\//gu, "~1"));
  }
  return segments.length === 0 ? "" : "/" + segments.reverse().join("/");
}

type Assign = (value: unknown) => void;
type MaterialFrame = {
  readonly source: object;
  readonly path: MaterialPath | undefined;
  readonly assign: Assign;
  index: number;
} & (
  | { readonly kind: "array"; readonly length: number; readonly entries: unknown[] }
  | {
      readonly kind: "object";
      readonly keys: readonly PropertyKey[];
      readonly entries: Array<readonly [string, unknown]>;
    }
);

function snapshotMaterial(
  value: unknown,
  handleImage?: (image: JudgeImage, path: MaterialPath | undefined) => unknown,
): unknown {
  const ancestors = new WeakSet<object>();
  const frames: MaterialFrame[] = [];
  let result: unknown;
  const append = (input: unknown, path: MaterialPath | undefined, assign: Assign): void => {
    const item = conversationMaterialOf(input) ?? input;
    if (isJudgeImage(item)) {
      if (handleImage === undefined) throw new TypeError("Judge image is only valid in material");
      assign(handleImage(item, path));
      return;
    }
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      assign(item);
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Judge material numbers must be finite");
      assign(Object.is(item, -0) ? 0 : item);
      return;
    }
    if (typeof item !== "object" || item === null || item instanceof Date || item instanceof RegExp)
      throw new TypeError(`Judge material cannot contain ${typeof item}`);
    if (ancestors.has(item)) throw new TypeError("Judge material cannot contain an ancestor cycle");
    const keys = Reflect.ownKeys(item);
    const frame = { source: item, index: 0, path, assign };
    if (Array.isArray(item)) {
      const length = item.length;
      for (const key of keys) {
        if (key === "length" || (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < length))
          continue;
        if (Reflect.getOwnPropertyDescriptor(item, key)?.enumerable)
          throw new TypeError("Judge material arrays cannot contain extra enumerable properties or toJSON");
      }
      frames.push({ ...frame, kind: "array", length, entries: [] });
    } else {
      const prototype = Reflect.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError("Judge material objects must be plain or null-prototype objects");
      frames.push({ ...frame, kind: "object", keys, entries: [] });
    }
    ancestors.add(item);
  };

  append(value, undefined, (captured) => {
    result = captured;
  });
  while (frames.length > 0) {
    const frame = frames.at(-1)!;
    if (frame.index === (frame.kind === "array" ? frame.length : frame.keys.length)) {
      frames.pop();
      ancestors.delete(frame.source);
      if (frame.kind === "array") frame.assign(Object.freeze(frame.entries));
      else {
        const captured = Object.freeze(
          Object.fromEntries(frame.entries.sort(([left], [right]) => compareCodeUnits(left, right))),
        );
        copyConversationProjection(frame.source, captured);
        frame.assign(captured);
      }
      continue;
    }
    const index = frame.index++;
    const key = frame.kind === "array" ? String(index) : frame.keys[index]!;
    const descriptor = Reflect.getOwnPropertyDescriptor(frame.source, key);
    if (frame.kind === "array") {
      if (descriptor === undefined || !("value" in descriptor) || descriptor.value === undefined)
        throw new TypeError("Judge material arrays cannot contain holes, accessors, or undefined");
      append(descriptor.value, { parent: frame.path, key: String(index) }, (captured) => {
        frame.entries.push(captured);
      });
    } else {
      if (descriptor === undefined || !descriptor.enumerable) continue;
      if (typeof key !== "string" || !("value" in descriptor))
        throw new TypeError("Judge material enumerable properties must be string data properties");
      if (descriptor.value !== undefined) {
        append(descriptor.value, { parent: frame.path, key }, (captured) => {
          frame.entries.push([key, captured]);
        });
      }
    }
  }
  return result;
}
/** @internal Shared strict call-time capture for all managed Match material. */
export function snapshotScoreMatchMaterial(value: unknown): JsonValue {
  return snapshotMaterial(value) as JsonValue;
}

export function snapshotJudgeMaterial(
  value: JudgeMaterial,
  maximumBytes = Infinity,
): {
  readonly material: JudgeMaterial;
  readonly images: readonly CapturedImageReference[];
  readonly imageByValue: ReadonlyMap<JudgeImage, CapturedImageReference>;
} {
  const references = new Map<JudgeImage, { imageId: string; evidenceIndex: number; paths: string[] }>();
  let imageReferences = 0;
  let imageBytes = 0;
  const untrimmed = snapshotMaterial(value, (value, path) => {
    const image = readJudgeImage(value);
    imageReferences++;
    imageBytes += image.byteLength;
    if (imageReferences > 4 || imageBytes > 8 * 1024 * 1024)
      throw new TypeError("Judge material exceeds the Judge Provider input limit of 4 image references or 8 MiB");
    const pointer = jsonPointer(path);
    const existing = references.get(value);
    if (existing === undefined) {
      references.set(value, {
        imageId: `image-${references.size}`,
        evidenceIndex: references.size,
        paths: [pointer],
      });
    } else existing.paths.push(pointer);
    return value;
  }) as JudgeMaterial;
  const images = [...references.entries()].map(
    ([image, identity]): CapturedImageReference => ({
      image,
      ...identity,
      ...(({ mediaType, byteLength, sha256 }) => ({ mediaType, byteLength, sha256 }))(readJudgeImage(image)),
      paths: identity.paths,
    }),
  );
  const imageByValue = new Map(images.map((item) => [item.image, item]));
  const material = trimConversationMaterial(untrimmed, maximumBytes, (item) =>
    JSON.stringify(projectJudgeMaterial(item, imageByValue).json),
  );
  return { material, images: images, imageByValue };
}

export function projectJudgeMaterial(
  value: JudgeMaterial,
  images: ReadonlyMap<JudgeImage, CapturedImageReference>,
): { readonly json: JsonValue; readonly parts: readonly CapturedImageReference[] } {
  const parts: CapturedImageReference[] = [];
  const json = snapshotMaterial(value, (item) => {
    const image = images.get(item);
    if (image === undefined) throw new TypeError("LLM material contains an image not captured by this Assertion");
    parts.push(image);
    return `niceeval-image:${image.imageId}`;
  }) as JsonValue;
  if (parts.length > 4 || parts.reduce((sum, image) => sum + image.byteLength, 0) > 8 * 1024 * 1024)
    throw new TypeError("LLM step exceeds the Judge Provider input limit of 4 image references or 8 MiB");
  return { json, parts };
}

export function chunkUtf8(value: string): readonly string[] {
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const point of value) {
    const size = utf8Bytes(point);
    if (bytes + size > 4 * 1024) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += point;
    bytes += size;
  }
  if (current !== "" || value === "") chunks.push(current);
  return chunks;
}
