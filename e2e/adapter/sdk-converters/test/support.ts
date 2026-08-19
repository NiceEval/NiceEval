import { join, resolve } from "node:path";
import {
  createE2EContext,
} from "@niceeval/testkit";
import type { Argv, E2ECaseContext } from "@niceeval/testkit";

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

/** Hold one isolated project open while a file's beforeAll/tests/afterAll share frozen evidence. */
export async function openSdkConverterCase(caseId: string) {
  type SdkConverterCase = E2ECaseContext<{ niceeval: Argv }>;
  let release!: () => void;
  const releaseProject = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  let resolveContext!: (value: SdkConverterCase) => void;
  let rejectContext!: (reason: unknown) => void;
  const contextReady = new Promise<SdkConverterCase>((resolve, reject) => {
    resolveContext = resolve;
    rejectContext = reject;
  });

  const heldCase = sdkConverterE2E.case(
    caseId,
    sdkConverterRecordArtifacts,
    async (context) => {
      resolveContext(context);
      await releaseProject;
    },
  );
  void heldCase.catch(rejectContext);

  const context = await contextReady;
  let closed = false;
  return {
    context,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      release();
      await heldCase;
    },
  };
}
