import { createE2EContext } from "@niceeval/testkit";
import { join, resolve } from "node:path";

export const localProtocolE2E = createE2EContext({
  repoId: "local-protocol",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-local-protocol-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

export const localProtocolRecordArtifacts = {
  artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }],
} as const;
