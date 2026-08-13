import { createE2EContext, type ArtifactStageEntry } from "@niceeval/testkit";
import { join, resolve } from "node:path";

export const CLASSIC_EXPERIMENTS = ["classic/baseline", "classic/memory-a", "classic/memory-b"] as const;

export const reportProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-report-",
  omitTopLevel: [
    ".e2e-artifacts",
    ".niceeval",
    "evidence",
    "node_modules",
    "site-export",
    "test",
    "test-results",
    "scripts",
  ],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" as const }],
};

export const reportE2E = createE2EContext({
  repoId: "report",
  project: reportProjectCopy,
  commands: {
    niceeval: ["node", join(process.cwd(), "node_modules", "niceeval", "bin", "niceeval.js")],
  },
});

export function reportCaseArtifacts(extraDirectories: readonly string[] = []): readonly ArtifactStageEntry[] {
  return [
    { source: ".niceeval", target: ".niceeval", optional: true },
    ...extraDirectories.map((directory) => ({
      source: directory,
      target: directory,
      optional: true,
    })),
  ];
}

export const PINNED_ENV = {
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  LANGUAGE: "en",
} as const;

/** Parent often has NO_COLOR=1. Testkit merge drops undefined env keys. */
export const PTY_ENV: NodeJS.ProcessEnv = {
  ...PINNED_ENV,
  TERM: "dumb",
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
};
