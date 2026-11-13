import { defineExperiment } from "niceeval";
import { acquireManagedProcess, defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";
import { Effect } from "effect";
export default defineExperiment({
  adapter: defineSandboxAgent({ ensure: { identity: { agent: "transport-fixture", version: "1", revision: "1" }, probe: shell("true") }, name: "transport-fixture", evidenceCoverage: completeEvidenceCoverage, send: async (_input, ctx) => {
    const process = await acquireManagedProcess(ctx, "transport-fixture", { argv: ["node", "-e", `
      setTimeout(() => {
        process.stdout.write('transport-resume-ready');
        process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 165));
        process.stderr.write('stderr-before');
      }, 150);
      setTimeout(() => {
        process.stdout.write(Buffer.from([0,255,65,10]));
        process.stderr.write('stderr-after');
        process.exitCode = 23;
      }, 1500);
    `] });
    await process.closeStdin();
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    for await (const chunk of process.output) (chunk._tag === "Stdout" ? stdout : stderr).push(Buffer.from(chunk.bytes));
    const exit = await process.wait();
    if (exit.exitCode !== 23) throw new Error(`Lost exit code: ${exit.exitCode}`);
    if (!Buffer.concat(stdout).equals(Buffer.concat([Buffer.from("transport-resume-ready"), Buffer.alloc(2 * 1024 * 1024, 165), Buffer.from([0,255,65,10])]))) throw new Error("Lost or duplicated stdout bytes");
    if (Buffer.concat(stderr).toString() !== "stderr-beforestderr-after") throw new Error("Lost or duplicated stderr bytes");
    const echo = await acquireManagedProcess(ctx, "transport-fixture-stdin", { argv: ["node", "-e", "process.stdin.pipe(process.stdout)"] });
    const input = Buffer.from([0, 255, 10, 195, 169]);
    await echo.writeStdin(input);
    await echo.closeStdin();
    const echoed: Buffer[] = [];
    for await (const chunk of echo.output) if (chunk._tag === "Stdout") echoed.push(Buffer.from(chunk.bytes));
    if ((await echo.wait()).exitCode !== 0 || !Buffer.concat(echoed).equals(input)) throw new Error("Raw stdin or EOF acknowledgement changed");
    return { status: "completed", events: [] };
  } }),
  sandbox: instaboxSandbox({ templateId: "universal", lifetimeMs: 600_000 }),
  evals: ["reconnect"],
});
