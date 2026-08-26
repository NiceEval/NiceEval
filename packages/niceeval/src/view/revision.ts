import { createHash, type Hash } from "node:crypto";

const viewRevisionTypeId: unique symbol = Symbol.for("niceeval.view.revision/v1");

export interface ViewFile {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface ViewRevisionIdentity {
  readonly format: "niceeval.view-revision/v1";
  readonly renderer: "niceeval.first-party-insight/v1";
  /** Private refresh identity for the pinned sealed Record cutoff. */
  readonly sourceCutoffIdentity: string;
  readonly sourceRunCount: number;
  readonly contentHash: string;
}

export interface ViewRevision {
  readonly [viewRevisionTypeId]: true;
}

export interface ViewRevisionData extends ViewRevision {
  readonly identity: ViewRevisionIdentity;
  readonly files: readonly ViewFile[];
}

export function makeViewRevision(input: {
  readonly sourceCutoffIdentity: string;
  readonly sourceRunCount: number;
  readonly files: readonly ViewFile[];
}): ViewRevision {
  if (input.sourceCutoffIdentity.length === 0 || !Number.isSafeInteger(input.sourceRunCount) || input.sourceRunCount < 0) {
    throw new TypeError("ViewRevision requires one valid pinned Record cutoff");
  }
  const paths = new Set<string>();
  const files = input.files.map((file) => {
    if (!isPortablePath(file.path) || file.mediaType.length === 0 || !(file.bytes instanceof Uint8Array)) {
      throw new TypeError("ViewRevision files require a portable path, media type, and bytes");
    }
    if (paths.has(file.path)) throw new TypeError(`ViewRevision repeats ${JSON.stringify(file.path)}`);
    paths.add(file.path);
    const bytes = new Uint8Array(file.bytes);
    return Object.freeze({
      path: file.path,
      mediaType: file.mediaType,
      get bytes(): Uint8Array { return new Uint8Array(bytes); },
    });
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!files.some(({ path }) => path === "index.html")) {
    throw new TypeError("ViewRevision requires index.html in its complete file closure");
  }
  const revision: Omit<ViewRevisionData, typeof viewRevisionTypeId> = {
    identity: Object.freeze({
      format: "niceeval.view-revision/v1" as const,
      renderer: "niceeval.first-party-insight/v1" as const,
      sourceCutoffIdentity: input.sourceCutoffIdentity,
      sourceRunCount: input.sourceRunCount,
      contentHash: contentHash(files),
    }),
    files: Object.freeze(files),
  };
  Object.defineProperty(revision, viewRevisionTypeId, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(revision) as unknown as ViewRevision;
}

export function viewRevisionData(value: ViewRevision): ViewRevisionData {
  if (!isViewRevision(value)) throw new TypeError("value is not a ViewRevision");
  return value;
}

function isViewRevision(value: unknown): value is ViewRevisionData {
  if (typeof value !== "object" || value === null) return false;
  const brand = Object.getOwnPropertyDescriptor(value, viewRevisionTypeId);
  return brand?.value === true && Array.isArray((value as Partial<ViewRevisionData>).files) &&
    typeof (value as Partial<ViewRevisionData>).identity?.sourceCutoffIdentity === "string" &&
    typeof (value as Partial<ViewRevisionData>).identity?.sourceRunCount === "number" &&
    typeof (value as Partial<ViewRevisionData>).identity?.contentHash === "string";
}

function isPortablePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.endsWith("/") &&
    !value.includes("\\") && !value.includes("\u0000") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Hash the ordered, framed path + media type + byte closure without concatenation ambiguity. */
function contentHash(files: readonly ViewFile[]): string {
  const hash = createHash("sha256");
  hash.update("niceeval.view-revision/v1\0", "utf8");
  for (const file of files) {
    updateFrame(hash, Buffer.from(file.path, "utf8"));
    updateFrame(hash, Buffer.from(file.mediaType, "utf8"));
    updateFrame(hash, file.bytes);
  }
  return hash.digest("hex");
}

function updateFrame(hash: Hash, bytes: Uint8Array): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}
