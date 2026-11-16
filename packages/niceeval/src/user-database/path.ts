import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface UserDatabasePaths {
  readonly home: string;
  readonly database: string;
  readonly legacy: string;
}

export function userDatabaseHome(
  input: { readonly env?: NodeJS.ProcessEnv | undefined; readonly homeDirectory?: string | undefined } = {},
): string {
  const configured = input.env?.NICEEVAL_HOME ?? process.env.NICEEVAL_HOME;
  const osHome = input.homeDirectory ?? homedir();
  if (configured === undefined || configured.trim().length === 0) return join(osHome, ".niceeval");
  const candidate = configured.trim();
  if (candidate === "~") return osHome;
  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) return resolve(osHome, candidate.slice(2));
  return isAbsolute(candidate) ? resolve(candidate) : resolve(osHome, candidate);
}

export function userDatabasePaths(
  input: {
    readonly home?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly homeDirectory?: string | undefined;
  } = {},
): UserDatabasePaths {
  const home = input.home === undefined ? userDatabaseHome(input) : resolve(input.home);
  return {
    home,
    database: join(home, "niceeval.sqlite"),
    legacy: join(home, "state.sqlite"),
  };
}
