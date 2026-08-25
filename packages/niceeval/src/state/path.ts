import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Resolve the OS-user state root without reading project configuration. */
export function userStateHome(input: {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
} = {}): string {
  const configured = input.env?.NICEEVAL_HOME ?? process.env.NICEEVAL_HOME;
  const home = input.homeDirectory ?? homedir();
  if (configured === undefined || configured.trim().length === 0) return join(home, ".niceeval");
  const candidate = configured.trim();
  if (candidate === "~") return home;
  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) return resolve(home, candidate.slice(2));
  return isAbsolute(candidate) ? resolve(candidate) : resolve(home, candidate);
}

export function userStatePath(input: {
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
} = {}): string {
  return join(input.home === undefined ? userStateHome(input) : resolve(input.home), "state.sqlite");
}
