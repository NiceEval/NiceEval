import { Effect } from "effect";
import { defineSandbox, type CustomCaseMaterializeResult, type Sandbox } from "niceeval/sandbox";

// Providers supply primitive I/O. NiceEval derives content upload and throwing
// command helpers when it constructs the Sandbox exposed to an Eval or Agent.
declare const provider: Omit<Sandbox, "upload" | "runCommandOrThrow" | "runShellOrThrow">;

defineSandbox({
  name: "public-custom-provider",
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  create: () => Effect.succeed(provider),
});

const caseSandbox: CustomCaseMaterializeResult["sandbox"] = provider;
void caseSandbox;
