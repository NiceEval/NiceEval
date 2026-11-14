// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Sandbox } from "../sandbox/types.ts";

/** pi's built-in tools with only their I/O operations redirected to Sandbox. */
export function piSandboxTools(sdk: typeof import("@earendil-works/pi-coding-agent"), sandbox: Sandbox, input: {
  readonly signal: AbortSignal;
  readonly admit: () => void;
  readonly failed: (error: unknown) => void;
}): ToolDefinition<any, any>[] {
  const io = async <T>(work: () => Promise<T>): Promise<T> => {
    input.admit();
    try { return await work(); } catch (error) { input.failed(error); throw error; }
  };
  const readFile = (path: string) => io(async () => Buffer.from(await sandbox.readBytes(path)));
  const writeFile = (path: string, content: string) => io(() => sandbox.writeText(path, content));
  const access = (path: string) => io(async () => { if (!await sandbox.pathExists(path)) throw new Error(`File not found: ${path}`); });
  const tools: ToolDefinition<any, any>[] = [
    sdk.createBashToolDefinition(sandbox.workdir, { operations: { exec: (command, cwd, options) => io(async () => {
      const result = await sandbox.runShell(command, { cwd, signal: options.signal ? AbortSignal.any([input.signal, options.signal]) : input.signal,
        ...(options.timeout === undefined ? {} : { timeoutMs: options.timeout * 1000 }) });
      options.onData(Buffer.from(result.stdout)); options.onData(Buffer.from(result.stderr));
      return { exitCode: result.exitCode };
    }) } }),
    sdk.createReadToolDefinition(sandbox.workdir, { operations: { readFile, access } }),
    sdk.createWriteToolDefinition(sandbox.workdir, { operations: { writeFile, mkdir: dir => io(async () => { await sandbox.runCommandOrThrow("mkdir", ["-p", dir], { signal: input.signal }); }) } }),
    sdk.createEditToolDefinition(sandbox.workdir, { operations: { readFile, writeFile, access } }),
  ];
  return tools.map(tool => ({ ...tool, execute: async (...args) => { input.admit(); return tool.execute(...args); } }));
}
