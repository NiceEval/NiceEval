import { mkdir, open as openFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { Context, Effect } from "effect";
import type * as Scope from "effect/Scope";
import {
  openReportViewSession,
  type OpenReportViewSessionInput,
  type ReportViewOpenError,
  type ReportViewSession,
} from "./view-session.ts";
import type {
  ReportFileSystemError,
  ReportFileSystemFailure,
  ReportHostOutputPath,
  ReportFileSystemService,
  ReportExportTargetExists,
} from "./static.ts";
import {
  openViewServer,
  type NodeViewServerError,
  type ReportViewServer,
  type ViewOptions,
} from "../../view/server.ts";

export {
  basalt,
  chalk,
  defineTheme,
  isThemeDefinition,
  themeStylesheet,
} from "../theme.ts";
export type {
  ReportTheme,
  ThemeColor,
  ThemeDefinition,
  ThemeHex,
  ThemeSeries,
} from "../theme.ts";

export {
  loadTrustedReportConfig,
  loadTrustedReportModule,
  loadTrustedThemeModule,
  resolveTrustedModulePath,
  ReportModuleLoadError,
} from "./node/loader.ts";
export type {
  LoadedTrustedConfig,
  LoadedTrustedReport,
  LoadedTrustedTheme,
  ReportModuleLoadCode,
  ReportModuleLoadStage,
} from "./node/loader.ts";

export type {
  NodeViewServerError,
  ReportViewServer,
  ViewOptions,
} from "../../view/server.ts";
export type {
  OpenReportViewSessionInput,
  ReportViewRebuild,
} from "./view-session.ts";

/** Node host request after its loader/watcher has closed over all live inputs. */
export type ReportViewRequest = OpenReportViewSessionInput;

export interface NodeReportViewHostService {
  readonly open: (
    request: ReportViewRequest,
  ) => Effect.Effect<ReportViewSession, ReportViewOpenError, Scope.Scope>;
  /** The live Node transport/watch composition, when this host provides it. */
  readonly serve?: (
    options: ViewOptions,
  ) => Effect.Effect<ReportViewServer, NodeViewServerError | ReportViewOpenError, Scope.Scope>;
}

/**
 * Node-only orchestration seam. The live implementation can add a watcher,
 * module loader, and HTTP server without changing the fixed-execution session
 * contract or accepting Record service objects from callers.
 */
export class NodeReportViewHost extends Context.Tag("@niceeval/report/NodeReportViewHost")<
  NodeReportViewHost,
  NodeReportViewHostService
>() {}

export const NodeReportViewHostLive: NodeReportViewHostService = Object.freeze({
  open: openReportViewSession,
  serve: openViewServer,
});

export function openNodeReportView(
  request: ReportViewRequest,
): Effect.Effect<ReportViewSession, ReportViewOpenError, Scope.Scope | NodeReportViewHost> {
  return Effect.flatMap(NodeReportViewHost, (host) => host.open(request));
}

/** Opens the HTTP and watcher host around caller-supplied fixed rebuilds; host defaults to loopback. */
export function openNodeReportViewServer(
  options: ViewOptions,
): Effect.Effect<ReportViewServer, NodeViewServerError | ReportViewOpenError, Scope.Scope | NodeReportViewHost> {
  return Effect.flatMap(NodeReportViewHost, (host) => host.serve === undefined
    ? Effect.fail(Object.freeze({
      code: "report-view-server-failed" as const,
      operation: "open" as const,
      reason: "the configured Node Report host does not provide an HTTP server",
    }))
    : host.serve(options));
}

/**
 * Concrete Node filesystem boundary for static exports. The exporter itself
 * remains platform-neutral and sees only this Effect service.
 */
export function makeNodeReportFileSystem(): ReportFileSystemService {
  return Object.freeze({
    // This deliberately has no success cache. Every export invocation must
    // re-check its target so a completed or incomplete prior directory is
    // consistently reported as target-exists before its first file write.
    prepareOutput: (out: string) => Effect.tryPromise({
      try: async () => {
        const root = resolve(out);
        await mkdir(dirname(root), { recursive: true });
        try {
          await mkdir(root);
        } catch (error) {
          if (isAlreadyExists(error)) throw new OutputTargetExistsError();
          throw error;
        }
      },
      catch: (error): ReportFileSystemFailure => fileSystemFailure("prepare-output", error),
    }),
    writeFile: (input: {
      readonly out: string;
      readonly path: ReportHostOutputPath;
      readonly bytes: Uint8Array;
    }) => Effect.tryPromise({
      try: async () => {
        const root = await preparedOutputRoot(input.out);
        const target = resolve(root, input.path.value);
        if (!isOutputChild(root, target)) {
          throw new Error(`Report host output escapes its root: ${input.path.value}`);
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, input.bytes, { flag: "wx" });
      },
      catch: (error): ReportFileSystemFailure => fileSystemFailure("write", error),
    }),
    writeCompleteMarker: (out: string) => Effect.tryPromise({
      try: async () => {
        const root = await preparedOutputRoot(out);
        const marker = resolve(root, "_niceeval/complete");
        await mkdir(dirname(marker), { recursive: true });
        await writeFile(marker, new Uint8Array(), { flag: "wx" });
      },
      catch: (error): ReportFileSystemFailure => fileSystemFailure("complete-marker", error),
    }),
    syncDirectory: (out: string) => {
      const root = resolve(out);
      const acquire = Effect.tryPromise({
        try: () => openFile(root, "r"),
        catch: (error): ReportFileSystemFailure => fileSystemFailure("sync-directory", error),
      });
      return Effect.scoped(
        Effect.acquireRelease(
          acquire,
          (handle) => Effect.tryPromise({
            try: () => handle.close(),
            // A close failure cannot produce a second public filesystem error
            // after the primary operation; the handle is nevertheless scoped.
            catch: () => undefined,
          }).pipe(Effect.ignore),
        ).pipe(
          Effect.flatMap((handle) => Effect.tryPromise({
            try: () => handle.sync(),
            catch: (error): ReportFileSystemFailure => fileSystemFailure("sync-directory", error),
          })),
        ),
      );
    },
  });
}

export const NodeReportFileSystemLive: ReportFileSystemService = makeNodeReportFileSystem();

/**
 * `writeFile` and the completion marker are valid only after the exporter has
 * prepared this invocation's root. They may make nested directories, but can
 * never recreate a missing root and silently bypass `prepareOutput`.
 */
async function preparedOutputRoot(out: string): Promise<string> {
  const root = resolve(out);
  const metadata = await stat(root);
  if (!metadata.isDirectory()) {
    throw new Error("the prepared report output root is not a directory");
  }
  return root;
}

function isOutputChild(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

class OutputTargetExistsError extends Error {}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as { readonly code?: unknown }).code === "EEXIST";
}

function fileSystemFailure(
  operation: string,
  error: unknown,
): ReportFileSystemError | ReportExportTargetExists {
  if (error instanceof OutputTargetExistsError) {
    return Object.freeze({ code: "report-export-target-exists" });
  }
  return Object.freeze({
    code: "report-export-write-failed",
    // The public error is intentionally stable and never includes a Node
    // errno message, absolute target path, or caller-provided filesystem text.
    operation,
  });
}
