import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { ArtifactStageEntry } from "./artifact-staging.js";
import type { ProjectCopyOptions, ProjectCopyStagingOptions } from "./project-copy.js";
import { withProjectCopy } from "./project-copy.js";
import type { Argv, ProcessReceipt, RunProcessOptions } from "./process.js";
import { runProcess } from "./process.js";
import type { StartOptions } from "./process-lifecycle.js";
import { ProcessHandle, startProcess } from "./process-lifecycle.js";

const INVOCATION_ID_ENV = "NICEEVAL_E2E_INVOCATION_ID";
const STAGING_ROOT_ENV = "NICEEVAL_E2E_ARTIFACT_STAGING_ROOT";

type BoundRunOptions = Omit<RunProcessOptions, "cwd">;
type BoundStartOptions = Omit<StartOptions, "cwd" | "processGroup">;

export interface E2ECommand {
  run(args: readonly string[], options?: BoundRunOptions): Promise<ProcessReceipt>;
  start(args: readonly string[], options?: BoundStartOptions): ProcessHandle;
}

export interface E2ECaseContext<Commands extends Record<string, Argv>> {
  readonly paths: Readonly<{
    sourceRoot: string;
    projectRoot: string;
    artifactRoot: string;
  }>;
  readonly commands: { readonly [Name in keyof Commands]: E2ECommand };
  run(argv: Argv, options?: BoundRunOptions): Promise<ProcessReceipt>;
  start(argv: Argv, options?: BoundStartOptions): ProcessHandle;
}

export interface E2ECaseOptions {
  /** Generic paths copied from the private case project after all processes stop. */
  artifacts?: readonly ArtifactStageEntry[];
}

export interface E2EContextOptions<Commands extends Record<string, Argv>> {
  repoId: string;
  /** Isolated scenario Repo root that owns the runner-injected staging directory. */
  sourceRoot?: string;
  project: ProjectCopyOptions;
  commands: Commands;
}

export interface E2EContext<Commands extends Record<string, Argv>> {
  readonly identity: Readonly<{
    repoId: string;
    sourceRoot: string;
    invocationId: string;
    artifactStagingRoot: string;
    formalInvocation: boolean;
  }>;
  case<T>(
    caseId: string,
    options: E2ECaseOptions,
    body: (context: E2ECaseContext<Commands>) => Promise<T>,
  ): Promise<T>;
  case<T>(caseId: string, body: (context: E2ECaseContext<Commands>) => Promise<T>): Promise<T>;
}

function safeSegment(value: string, label: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  ) {
    throw new Error(`${label} must be one safe path segment`);
  }
  return value;
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function relativeCaseTarget(value: string): string {
  if (value.length === 0 || isAbsolute(value) || value.includes("\\") || value.includes("\0")) {
    throw new Error("artifact target must be a non-empty canonical relative path");
  }
  const canonical = normalize(value);
  if (
    canonical !== value ||
    canonical === "." ||
    canonical === ".." ||
    canonical.startsWith(`..${sep}`)
  ) {
    throw new Error("artifact target must stay within the case namespace");
  }
  return canonical;
}

function invocationIdentity(sourceRoot: string): {
  invocationId: string;
  stagingRoot: string;
  formal: boolean;
} {
  const invocationId = process.env[INVOCATION_ID_ENV];
  const injectedRoot = process.env[STAGING_ROOT_ENV];
  if ((invocationId === undefined) !== (injectedRoot === undefined)) {
    throw new Error(`${INVOCATION_ID_ENV} and ${STAGING_ROOT_ENV} must be injected together`);
  }

  if (invocationId !== undefined && injectedRoot !== undefined) {
    const stagingRoot = resolve(injectedRoot);
    if (!isAbsolute(injectedRoot) || !isContained(sourceRoot, stagingRoot) || stagingRoot === sourceRoot) {
      throw new Error(`${STAGING_ROOT_ENV} must be an absolute child of the isolated source root`);
    }
    mkdirSync(stagingRoot, { recursive: true });
    return {
      invocationId: safeSegment(invocationId, INVOCATION_ID_ENV),
      stagingRoot,
      formal: true,
    };
  }

  return {
    invocationId: `local-${process.pid}`,
    stagingRoot: mkdtempSync(join(tmpdir(), "niceeval-e2e-artifacts-")),
    formal: false,
  };
}

function flattenErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) {
    return [...error.errors].flatMap(flattenErrors);
  }
  return [error];
}

function throwFlattened(error: unknown): never {
  const errors = flattenErrors(error);
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, "E2E case body, process cleanup, artifact staging, and project cleanup failed", {
    cause: errors[0],
  });
}

function append(prefix: Argv, args: readonly string[]): Argv {
  return [...prefix, ...args] as Argv;
}

export function createE2EContext<const Commands extends Record<string, Argv>>(
  options: E2EContextOptions<Commands>,
): E2EContext<Commands> {
  const repoId = options.repoId.trim();
  if (repoId.length === 0) throw new Error("repoId must be non-empty");
  const sourceRoot = resolve(options.sourceRoot ?? options.project.from);
  const invocation = invocationIdentity(sourceRoot);
  const identity = Object.freeze({
    repoId,
    sourceRoot,
    invocationId: invocation.invocationId,
    artifactStagingRoot: invocation.stagingRoot,
    formalInvocation: invocation.formal,
  });

  async function runCase<T>(
    caseIdValue: string,
    caseOptions: E2ECaseOptions,
    body: (context: E2ECaseContext<Commands>) => Promise<T>,
  ): Promise<T> {
    const caseId = safeSegment(caseIdValue, "caseId");
    const artifactRoot = join(invocation.stagingRoot, invocation.invocationId, caseId);
    const entries = (caseOptions.artifacts ?? []).map((entry) => ({
      ...entry,
      target: join(invocation.invocationId, caseId, relativeCaseTarget(entry.target)),
    }));
    const staging: ProjectCopyStagingOptions | undefined = entries.length === 0
      ? undefined
      : {
          stageArtifacts: {
            destinationRoot: invocation.stagingRoot,
            entries,
            collision: "error",
          },
        };

    try {
      return await withProjectCopy(
        options.project,
        async ({ root: projectRoot }) => {
          const handles: ProcessHandle[] = [];
          const start = (argv: Argv, startOptions: BoundStartOptions = {}): ProcessHandle => {
            const handle = startProcess(argv, {
              ...startOptions,
              cwd: projectRoot,
              processGroup: true,
            });
            void handle.done.catch(() => {});
            handles.push(handle);
            return handle;
          };
          const commands = Object.fromEntries(
            Object.entries(options.commands).map(([name, prefix]) => [
              name,
              {
                run: (args: readonly string[], runOptions?: BoundRunOptions) =>
                  runProcess(append(prefix, args), { ...runOptions, cwd: projectRoot }),
                start: (args: readonly string[], startOptions?: BoundStartOptions) =>
                  start(append(prefix, args), startOptions),
              },
            ]),
          ) as E2ECaseContext<Commands>["commands"];
          const context: E2ECaseContext<Commands> = {
            paths: Object.freeze({ sourceRoot, projectRoot, artifactRoot }),
            commands,
            run: (argv, runOptions) => runProcess(argv, { ...runOptions, cwd: projectRoot }),
            start,
          };

          let result!: T;
          let bodyFailed = false;
          let bodyError: unknown;
          try {
            result = await body(context);
          } catch (error) {
            bodyFailed = true;
            bodyError = error;
          }

          const cleanupErrors: unknown[] = [];
          for (const handle of handles.reverse()) {
            try {
              await handle.dispose();
            } catch (error) {
              cleanupErrors.push(error);
            }
          }
          const errors = bodyFailed ? [bodyError, ...cleanupErrors] : cleanupErrors;
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) {
            throw new AggregateError(errors, "E2E case body and process cleanup failed", {
              cause: errors[0],
            });
          }
          return result;
        },
        staging,
      );
    } catch (error) {
      throwFlattened(error);
    }
  }

  return {
    identity,
    case<T>(
      caseId: string,
      optionsOrBody: E2ECaseOptions | ((context: E2ECaseContext<Commands>) => Promise<T>),
      maybeBody?: (context: E2ECaseContext<Commands>) => Promise<T>,
    ): Promise<T> {
      const caseOptions = typeof optionsOrBody === "function" ? {} : optionsOrBody;
      const body = typeof optionsOrBody === "function" ? optionsOrBody : maybeBody;
      if (body === undefined) throw new Error("E2E case body is required");
      return runCase(caseId, caseOptions, body);
    },
  };
}
