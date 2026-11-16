import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

class RepositoryProfileError extends Error {
  constructor(
    readonly code: "RepositoryRootInvalid",
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

/** Resolve only the consumer Git root; repository configuration belongs to Concord. */
export function repositoryRoot(): string {
  const root = realpathSync(process.cwd());
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  let top: string;
  try {
    top = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      env,
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new RepositoryProfileError(
      "RepositoryRootInvalid",
      "Run the repository profile from a consumer Git worktree root.",
    );
  }
  if (realpathSync(top) !== root) {
    throw new RepositoryProfileError(
      "RepositoryRootInvalid",
      "Run the repository profile from the Git worktree top-level directory.",
    );
  }
  return root;
}
