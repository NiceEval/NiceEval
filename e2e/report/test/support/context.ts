import { createE2EContext, type ArtifactStageEntry } from "./testkit.ts";
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
    tsc: [join(process.cwd(), "node_modules", ".bin", "tsc")],
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
