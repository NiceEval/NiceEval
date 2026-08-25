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
  readonly contentHash: string;
  readonly files: readonly ViewFile[];
}): ViewRevision {
  if (input.contentHash.length === 0) throw new TypeError("ViewRevision requires a content hash");
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
    return Object.freeze({ ...file, bytes: new Uint8Array(file.bytes) });
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const revision: Omit<ViewRevisionData, typeof viewRevisionTypeId> = {
    identity: Object.freeze({
      format: "niceeval.view-revision/v1" as const,
      renderer: "niceeval.first-party-insight/v1" as const,
      sourceCutoffIdentity: input.sourceCutoffIdentity,
      sourceRunCount: input.sourceRunCount,
      contentHash: input.contentHash,
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
