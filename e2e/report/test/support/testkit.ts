// Prefer the injected @niceeval/testkit. Until that package lands in this
// isolated repo, fall back to the owner-local adapter with the same surface.
import type * as TestkitSurface from "./local-testkit.ts";

type TestkitModule = typeof TestkitSurface;

async function loadTestkit(): Promise<TestkitModule> {
  try {
    const name = "@niceeval/testkit";
    return (await import(name)) as TestkitModule;
  } catch {
    return await import("./local-testkit.ts");
  }
}

const testkit = await loadTestkit();

export const createE2EContext = testkit.createE2EContext;
export const runProcess = testkit.runProcess;
export const runPty = testkit.runPty;
export const only = testkit.only;
export const defined = testkit.defined;
export const waitForOutput = testkit.waitForOutput;
export const pollUntil = testkit.pollUntil;
export const ProcessReceipt = testkit.ProcessReceipt;
export type { ArtifactStageEntry, ProcessReceipt as ProcessReceiptType } from "./local-testkit.ts";
