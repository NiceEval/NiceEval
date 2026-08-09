import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run `body` with a unique directory under the system temp root.
 * The directory is always removed after success or body failure.
 * Body + cleanup failure becomes AggregateError([body, cleanup]) with body as cause.
 */
export async function withTempDir<T>(
  prefix: string,
  body: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  let bodyError: unknown;
  let result!: T;
  let bodyFailed = false;

  try {
    result = await body(root);
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }

  try {
    await rm(root, { recursive: true, force: true });
  } catch (cleanupError) {
    if (bodyFailed) {
      throw new AggregateError([bodyError, cleanupError], "body and cleanup failed", {
        cause: bodyError,
      });
    }
    throw cleanupError;
  }

  if (bodyFailed) {
    throw bodyError;
  }
  return result;
}
