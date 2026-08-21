import { createE2EContext } from "@niceeval/testkit";
import { join, resolve } from "node:path";

export const codexAppServerE2E = createE2EContext({
  repoId: "codex-app-server",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-codex-app-server-",
    omitTopLevel: [".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});
