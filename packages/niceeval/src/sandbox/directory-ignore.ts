import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";

export interface DirectoryIgnoreRule {
  readonly prefix: string;
  readonly matcher: Ignore;
}

/** Each directory owns its rules; a later nested negation can override an ancestor rule. */
export function directoryIgnoreRules(
  directory: string,
  prefix: string,
  inherited: readonly DirectoryIgnoreRule[],
): readonly DirectoryIgnoreRule[] {
  const path = join(directory, ".gitignore");
  try {
    if (!lstatSync(path).isFile()) return inherited;
    return [...inherited, { prefix, matcher: ignore().add(readFileSync(path, "utf8")) }];
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return inherited;
    throw cause;
  }
}

export function directoryEntryIgnored(
  path: string,
  directory: boolean,
  rules: readonly DirectoryIgnoreRule[],
  extra: ReadonlySet<string> = new Set(),
): boolean {
  if (path.split("/").some((part) => part === ".git" || extra.has(part))) return true;
  let ignored = false;
  for (const rule of rules) {
    const relative = path.slice(rule.prefix.length);
    const match = rule.matcher.test(relative + (directory ? "/" : ""));
    if (match.ignored) ignored = true;
    else if (match.unignored) ignored = false;
  }
  return ignored;
}
