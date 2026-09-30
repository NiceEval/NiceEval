import { createHash } from "node:crypto";

declare const judgeImageBrand: unique symbol;
/** An immutable image snapshot created by judgeImage, not an ordinary JSON object. */
export interface JudgeImage { readonly [judgeImageBrand]: true }
export type JudgeMaterial = null | boolean | number | string | JudgeImage | readonly JudgeMaterial[] | { readonly [key: string]: JudgeMaterial };
export interface JudgeImageInput {
  /** Original encoded image bytes; copied synchronously, at most 4 MiB. */
  readonly body: Uint8Array;
  /** Must match the encoded image. Paths, URLs and SVG are not accepted. */
  readonly mediaType: "image/png" | "image/jpeg";
}

export interface CapturedJudgeImage {
  readonly mediaType: JudgeImageInput["mediaType"];
  readonly body: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
}
const images = new WeakMap<object, CapturedJudgeImage>();
const maxImageBytes = 4 * 1024 * 1024;
const maxPixels = 16_777_216;
const dimensions = (body: Uint8Array, mediaType: JudgeImageInput["mediaType"]): readonly [number, number] => {
  if (mediaType === "image/png") {
    // Signature, IHDR length/type, all 13 IHDR bytes, and its four CRC bytes.
    if (body.length < 33 || ![137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((byte, index) => body[index] === byte)) throw new TypeError("Invalid PNG IHDR header");
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) throw new TypeError("Invalid JPEG header");
  let offset = 2;
  while (offset + 4 <= body.length) {
    if (body[offset] !== 0xff) throw new TypeError("Invalid JPEG marker");
    while (body[offset] === 0xff) offset++;
    const marker = body[offset++];
    if (marker === undefined || marker === 0x00 || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
    if (offset + 2 > body.length) break;
    const length = body[offset]! * 256 + body[offset + 1]!;
    if (length < 2 || offset + length > body.length) throw new TypeError("Invalid JPEG segment length");
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      // SOF length includes two length bytes, six fixed frame bytes, and
      // three bytes for every declared component.
      const components = body[offset + 7];
      if (length < 11 || components === undefined || components < 1 || components > 4 || length !== 8 + 3 * components) throw new TypeError("Invalid JPEG frame");
      return [body[offset + 5]! * 256 + body[offset + 6]!, body[offset + 3]! * 256 + body[offset + 4]!];
    }
    offset += length;
  }
  throw new TypeError("JPEG dimensions are missing");
};

/** Capture PNG or JPEG bytes for an existing Judge call without sending a request. */
export function judgeImage(input: JudgeImageInput): JudgeImage {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError("judgeImage requires an input object");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || keys.some((key) => key !== "body" && key !== "mediaType")) throw new TypeError("judgeImage requires body and mediaType only");
  const bodyProperty = Reflect.getOwnPropertyDescriptor(input, "body");
  const mediaTypeProperty = Reflect.getOwnPropertyDescriptor(input, "mediaType");
  if (bodyProperty === undefined || mediaTypeProperty === undefined || !("value" in bodyProperty) || !("value" in mediaTypeProperty) ||
      !(bodyProperty.value instanceof Uint8Array) || (mediaTypeProperty.value !== "image/png" && mediaTypeProperty.value !== "image/jpeg")) {
    throw new TypeError("judgeImage requires Uint8Array body and PNG or JPEG mediaType data properties");
  }
  const source = bodyProperty.value as Uint8Array;
  const mediaType = mediaTypeProperty.value as JudgeImageInput["mediaType"];
  if (source.byteLength === 0 || source.byteLength > maxImageBytes) throw new TypeError("Judge image exceeds 4 MiB");
  const body = new Uint8Array(source);
  const [width, height] = dimensions(body, mediaType);
  if (width <= 0 || height <= 0 || width * height > maxPixels) throw new TypeError("Judge image dimensions exceed the pixel limit");
  const value = Object.freeze(Object.create(null)) as JudgeImage;
  images.set(value, { body, mediaType, byteLength: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") });
  return value;
}

export function isJudgeImage(value: unknown): value is JudgeImage { return typeof value === "object" && value !== null && images.has(value); }
/** @internal Return only to the owning capture/transport; never expose the mutable bytes to authors. */
export function readJudgeImage(value: JudgeImage): CapturedJudgeImage {
  const image = images.get(value);
  if (image === undefined) throw new TypeError("Unrecognized Judge image");
  return image;
}
