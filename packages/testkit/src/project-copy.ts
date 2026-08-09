import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { stageArtifacts, type ArtifactStageEntry } from "./artifact-staging.js";

export type ProjectLink = {
  from: string;
  to: string;
  type?: "file" | "dir" | "junction";
};

export type ProjectCopyOptions = {
  from: string;
  prefix: string;
  omitTopLevel?: readonly string[];
  links?: readonly ProjectLink[];
};

export type ProjectCopyStagingOptions = {
  stageArtifacts: {
    destinationRoot: string;
    entries: readonly ArtifactStageEntry[];
    collision: "error";
  };
};

function assertLinkInsideRoot(root: string, to: string): string {
  if (to.length === 0) {
    throw new Error("link destination must be a non-empty relative path");
  }
  if (isAbsolute(to)) {
    throw new Error(`link destination must be relative to project root: ${to}`);
  }
  const dest = resolve(root, to);
  const rel = relative(root, dest);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`link destination escapes project root: ${to}`);
  }
  return dest;
}

async function removeCopy(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

async function materializeCopy(options: ProjectCopyOptions): Promise<string> {
  const source = resolve(options.from);
  const root = await mkdtemp(join(tmpdir(), options.prefix));
  const omit = new Set(options.omitTopLevel ?? []);

  try {
    await cp(source, root, {
      recursive: true,
      filter: (src) => {
        const rel = relative(source, src);
        if (rel === "" || rel === ".") {
          return true;
        }
        const top = rel.split(sep)[0] ?? rel;
        return !omit.has(top);
      },
    });

    for (const link of options.links ?? []) {
      const dest = assertLinkInsideRoot(root, link.to);
      await mkdir(dirname(dest), { recursive: true });
      const linkType = link.type ?? "file";
      await symlink(link.from, dest, linkType);
    }

    return root;
  } catch (error) {
    try {
      await removeCopy(root);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "project copy setup and cleanup failed", {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Byte-copy a project tree into a unique temp directory, optionally omitting
 * top-level names and creating in-copy links. Always deletes the copy after
 * the body returns or throws (including setup/link failures).
 */
export async function withProjectCopy<T>(
  options: ProjectCopyOptions,
  body: (project: { root: string }) => Promise<T>,
  staging?: ProjectCopyStagingOptions,
): Promise<T> {
  const root = await materializeCopy(options);

  let bodyError: unknown;
  let result!: T;
  let bodyFailed = false;
  let stagingError: unknown;
  let stagingFailed = false;
  let cleanupError: unknown;
  let cleanupFailed = false;

  try {
    result = await body({ root });
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }

  try {
    if (staging !== undefined) {
      await stageArtifacts({
        sourceRoot: root,
        destinationRoot: staging.stageArtifacts.destinationRoot,
        entries: staging.stageArtifacts.entries,
        collision: staging.stageArtifacts.collision,
      });
    }
  } catch (error) {
    stagingFailed = true;
    stagingError = error;
  }

  try {
    await removeCopy(root);
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }

  const errors: unknown[] = [];
  if (bodyFailed) errors.push(bodyError);
  if (stagingFailed) errors.push(stagingError);
  if (cleanupFailed) errors.push(cleanupError);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "project copy body, artifact staging, and cleanup failed", {
      cause: bodyFailed ? bodyError : errors[0],
    });
  }

  return result;
}
