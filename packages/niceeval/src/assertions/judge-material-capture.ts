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
  return left < right ? -1 : left > right ? 1 : 0;
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
interface SnapshotState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
  readonly images?: Map<JudgeImage, { imageId: string; evidenceIndex: number; paths: string[] }>;
  imageBytes?: number;
  imageReferences?: number;
}
function snapshotMaterial(value: unknown, state: SnapshotState, depth = 0, path = ""): unknown {
  const conversation = conversationMaterialOf(value);
  if (conversation !== undefined) return snapshotMaterial(conversation, state, depth, path);
  state.nodes += 1;
  if (state.nodes > 2_097_152) throw new TypeError("Judge material exceeds 2,097,152 traversal nodes");
  if (depth > 72) throw new TypeError("Judge material exceeds depth 72");
  if (isJudgeImage(value)) {
    if (state.images === undefined) throw new TypeError("Judge image is only valid in material");
    const image = readJudgeImage(value);
    state.imageReferences = (state.imageReferences ?? 0) + 1;
    state.imageBytes = (state.imageBytes ?? 0) + image.byteLength;
    if (state.imageReferences > 4 || state.imageBytes > 8 * 1024 * 1024)
      throw new TypeError("Judge material image budget exceeded");
    const existing = state.images.get(value);
    if (existing === undefined)
      state.images.set(value, {
        imageId: `image-${state.images.size}`,
        evidenceIndex: state.images.size,
        paths: [path],
      });
    else existing.paths.push(path);
    return value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Judge material numbers must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || value === null || value instanceof Date || value instanceof RegExp)
    throw new TypeError(`Judge material cannot contain ${typeof value}`);
  if (state.ancestors.has(value)) throw new TypeError("Judge material cannot contain an ancestor cycle");
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let keys: readonly PropertyKey[];
      try {
        keys = Reflect.ownKeys(value);
      } catch {
        throw new TypeError("Judge material array reflection failed");
      }
      for (const key of keys) {
        if (
          key === "length" ||
          (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length)
        )
          continue;
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        } catch {
          throw new TypeError("Judge material array reflection failed");
        }
        if (descriptor?.enumerable)
          throw new TypeError("Judge material arrays cannot contain extra enumerable properties or toJSON");
      }
      const entries: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        } catch {
          throw new TypeError("Judge material array reflection failed");
        }
        if (descriptor === undefined || !("value" in descriptor) || descriptor.value === undefined)
          throw new TypeError("Judge material arrays cannot contain holes, accessors, or undefined");
        entries.push(snapshotMaterial(descriptor.value, state, depth + 1, `${path}/${index}`));
      }
      return Object.freeze(entries);
    }
    let prototype: object | null;
    try {
      prototype = Reflect.getPrototypeOf(value);
    } catch {
      throw new TypeError("Judge material prototype reflection failed");
    }
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Judge material objects must be plain or null-prototype objects");
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      throw new TypeError("Judge material key reflection failed");
    }
    const entries: Array<readonly [string, unknown]> = [];
    for (const key of keys) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      } catch {
        throw new TypeError("Judge material property reflection failed");
      }
      if (descriptor === undefined || !descriptor.enumerable) continue;
      if (typeof key !== "string" || !("value" in descriptor))
        throw new TypeError("Judge material enumerable properties must be string data properties");
      if (descriptor.value !== undefined)
        entries.push([
          key,
          snapshotMaterial(
            descriptor.value,
            state,
            depth + 1,
            `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`,
          ),
        ]);
    }
    const captured = Object.freeze(
      Object.fromEntries(entries.sort(([left], [right]) => compareCodeUnits(left, right))),
    );
    copyConversationProjection(value, captured);
    return captured;
  } finally {
    state.ancestors.delete(value);
  }
}
/** @internal Shared strict call-time capture for all managed Match material. */
export function snapshotScoreMatchMaterial(value: unknown): JsonValue {
  return snapshotMaterial(value, { nodes: 0, ancestors: new WeakSet() }) as JsonValue;
}

export function snapshotJudgeMaterial(
  value: JudgeMaterial,
  maximumBytes = Infinity,
): {
  readonly material: JudgeMaterial;
  readonly images: readonly CapturedImageReference[];
  readonly imageByValue: ReadonlyMap<JudgeImage, CapturedImageReference>;
} {
  const state: SnapshotState = {
    nodes: 0,
    ancestors: new WeakSet(),
    images: new Map(),
    imageBytes: 0,
    imageReferences: 0,
  };
  const untrimmed = snapshotMaterial(value, state) as JudgeMaterial;
  const images = [...state.images!.entries()].map(
    ([image, identity]): CapturedImageReference =>
      Object.freeze({
        image,
        ...identity,
        ...(({ mediaType, byteLength, sha256 }) => ({ mediaType, byteLength, sha256 }))(readJudgeImage(image)),
        paths: Object.freeze([...identity.paths]),
      }),
  );
  const imageByValue = new Map(images.map((item) => [item.image, item]));
  const material = trimConversationMaterial(untrimmed, maximumBytes, (item) =>
    JSON.stringify(projectJudgeMaterial(item, imageByValue).json),
  );
  return Object.freeze({ material, images: Object.freeze(images), imageByValue });
}

export function projectJudgeMaterial(
  value: JudgeMaterial,
  images: ReadonlyMap<JudgeImage, CapturedImageReference>,
): { readonly json: JsonValue; readonly parts: readonly CapturedImageReference[] } {
  const parts: CapturedImageReference[] = [];
  const visit = (item: JudgeMaterial): JsonValue => {
    if (isJudgeImage(item)) {
      const image = images.get(item);
      if (image === undefined) throw new TypeError("LLM material contains an image not captured by this Assertion");
      parts.push(image);
      return `niceeval-image:${image.imageId}`;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item !== null && typeof item === "object")
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    return item as JsonValue;
  };
  const json = visit(value);
  if (parts.length > 4 || parts.reduce((sum, image) => sum + image.byteLength, 0) > 8 * 1024 * 1024)
    throw new TypeError("LLM step image budget exceeded");
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
  return Object.freeze(chunks);
}
