import { join, resolve } from "node:path";
import {
  createE2EContext,
} from "@niceeval/testkit";

/**
 * Tests run concurrently by default. Every case gets a disposable project and
 * the retained record lands in the ctx invocation + case namespace, so no two
 * workers can write the source scenario's .niceeval or JUnit roots.
 */
export const sdkConverterE2E = createE2EContext({
  repoId: "sdk-converters",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-sdk-converters-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

/** 每个 case 保留其 .niceeval 记录到 ctx 的 invocation/case namespace。 */
export const sdkConverterRecordArtifacts = {
  artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }],
} as const;
