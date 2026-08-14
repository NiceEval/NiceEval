import { Either } from "effect";

const reportRouteTypeId: unique symbol = Symbol("@niceeval/report/ReportRoute");
const reportDownloadPathTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportDownloadPath",
);

/** A semantic page route, deliberately separate from a filesystem path. */
export type ReportRoute = string & { readonly [reportRouteTypeId]: true };

/** A relative author-owned download path. */
export type ReportDownloadPath = string & {
  readonly [reportDownloadPathTypeId]: true;
};

export interface ReportPathIssue {
  readonly code: "report-path-invalid";
  readonly kind: "route" | "download";
  readonly reason: string;
}

/** A normalized static-output description; hosts use it for collision checks. */
export interface ReportStaticPath {
  readonly kind: "route" | "download";
  readonly segments: readonly [string, ...string[]];
  readonly posix: string;
  readonly caseFoldedPosix: string;
  readonly windowsComparablePosix: string;
}

export interface ReportStaticPathConflict {
  readonly kind:
    | "exact"
    | "case-fold"
    | "windows-equivalent"
    | "file-directory-prefix";
  readonly left: ReportStaticPath;
  readonly right: ReportStaticPath;
}

const ROUTE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;
const WINDOWS_DEVICE_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_ID_BYTES = 128;
const MAX_ROUTE_SEGMENTS = 32;
const MAX_ROUTE_BYTES = 1_024;
const encoder = new TextEncoder();
export function reportRoute(input: string): Either.Either<ReportRoute, ReportPathIssue> {
  const issue = routeIssue(input, "route");
  return issue === undefined ? Either.right(mintReportRoute(input)) : Either.left(issue);
}

export function reportDownloadPath(
  input: string,
): Either.Either<ReportDownloadPath, ReportPathIssue> {
  const issue = routeIssue(input, "download");
  if (issue !== undefined) {
    return Either.left(issue);
  }
  if (input === "/") {
    return Either.left(pathIssue("download", "a download path must have a segment"));
  }
  if (input.startsWith("/")) {
    return Either.left(pathIssue("download", "a download path must be relative"));
  }
  return Either.right(mintReportDownloadPath(input));
}

export function isReportRoute(value: unknown): value is ReportRoute {
  return routeIssue(value, "route") === undefined;
}

export function isReportDownloadPath(value: unknown): value is ReportDownloadPath {
  return typeof value === "string" &&
    routeIssue(value, "download") === undefined &&
    value !== "/" &&
    !value.startsWith("/");
}

/** Central static mapping; callers never hand-compose output paths. */
export function staticPathForReportRoute(value: ReportRoute): ReportStaticPath {
  const routeSegments = value === "/" ? [] : value.slice(1).split("/");
  return makeStaticPath("route", [...routeSegments, "index.html"]);
}

/** Central static mapping; callers never hand-compose output paths. */
export function staticPathForReportDownload(
  value: ReportDownloadPath,
): ReportStaticPath {
  return makeStaticPath("download", ["downloads", ...value.split("/")]);
}

/**
 * Gives a host all author-side collision facts before it combines these paths
 * with its reserved files. The function is pure and does not touch a root.
 */
export function reportStaticPathConflict(
  left: ReportStaticPath,
  right: ReportStaticPath,
): ReportStaticPathConflict | undefined {
  if (left.posix === right.posix) {
    return Object.freeze({ kind: "exact", left, right });
  }
  if (left.caseFoldedPosix === right.caseFoldedPosix) {
    return Object.freeze({ kind: "case-fold", left, right });
  }
  if (left.windowsComparablePosix === right.windowsComparablePosix) {
    return Object.freeze({ kind: "windows-equivalent", left, right });
  }
  if (isSegmentPrefix(left.segments, right.segments) || isSegmentPrefix(right.segments, left.segments)) {
    return Object.freeze({ kind: "file-directory-prefix", left, right });
  }
  return undefined;
}

function routeIssue(
  input: unknown,
  kind: "route" | "download",
): ReportPathIssue | undefined {
  if (typeof input !== "string") {
    return pathIssue(kind, "a path must be a string");
  }
  if (utf8Bytes(input) > MAX_ROUTE_BYTES) {
    return pathIssue(kind, "a path may contain at most 1,024 UTF-8 bytes");
  }
  if (input.includes("%") || input.includes("?") || input.includes("#") || input.includes("\\")) {
    return pathIssue(kind, "a path cannot contain percent encoding, query, fragment, or backslash syntax");
  }

  const segments = kind === "route"
    ? input === "/"
      ? []
      : input.startsWith("/")
        ? input.slice(1).split("/")
        : undefined
    : input.startsWith("/")
      ? undefined
      : input.split("/");

  if (segments === undefined) {
    return pathIssue(kind, kind === "route" ? "a route must start with /" : "a download path must be relative");
  }
  if (segments.length > MAX_ROUTE_SEGMENTS) {
    return pathIssue(kind, "a path may contain at most 32 segments");
  }
  if (kind === "download" && segments.length === 0) {
    return pathIssue(kind, "a download path must have a segment");
  }
  for (const segment of segments) {
    if (segment.length === 0) {
      return pathIssue(kind, "a path cannot contain an empty segment");
    }
    if (segment === "." || segment === "..") {
      return pathIssue(kind, "a path cannot contain dot segments");
    }
    if (utf8Bytes(segment) > MAX_ID_BYTES) {
      return pathIssue(kind, "a path segment may contain at most 128 UTF-8 bytes");
    }
    if (!ROUTE_SEGMENT_PATTERN.test(segment)) {
      return pathIssue(kind, "a path segment must use lowercase ASCII route grammar");
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      return pathIssue(kind, "a path segment cannot end with a dot or space");
    }
    if (WINDOWS_DEVICE_PATTERN.test(segment)) {
      return pathIssue(kind, "a path segment cannot be a Windows device name");
    }
  }
  return undefined;
}

function makeStaticPath(
  kind: ReportStaticPath["kind"],
  segments: readonly string[],
): ReportStaticPath {
  if (segments.length === 0) {
    throw new TypeError("a static Report path must contain a file segment");
  }
  const canonicalSegments = Object.freeze([...segments]) as readonly [
    string,
    ...string[],
  ];
  const posix = canonicalSegments.join("/");
  return Object.freeze({
    kind,
    segments: canonicalSegments,
    posix,
    caseFoldedPosix: asciiCaseFold(posix),
    windowsComparablePosix: canonicalSegments
      .map((segment) => asciiCaseFold(segment.replace(/[. ]+$/u, "")))
      .join("/"),
  });
}

function isSegmentPrefix(
  prefix: readonly string[],
  value: readonly string[],
): boolean {
  if (prefix.length >= value.length) {
    return false;
  }
  return prefix.every((segment, index) => segment === value[index]);
}

function asciiCaseFold(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function pathIssue(
  kind: ReportPathIssue["kind"],
  reason: string,
): ReportPathIssue {
  return Object.freeze({ code: "report-path-invalid", kind, reason });
}

function mintReportRoute(value: string): ReportRoute {
  return value as ReportRoute;
}

function mintReportDownloadPath(value: string): ReportDownloadPath {
  return value as ReportDownloadPath;
}
