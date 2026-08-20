import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const commonGitDirectory = git(
  "rev-parse",
  "--path-format=absolute",
  "--git-common-dir",
);
const primaryRoot = dirname(commonGitDirectory);
const hooksDirectory = join(primaryRoot, ".husky", "_");

git("config", "core.hooksPath", hooksDirectory);
