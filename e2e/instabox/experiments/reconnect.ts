import { defineExperiment } from "niceeval";
import { acquireManagedProcess, defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";
import { Effect } from "effect";
export default defineExperiment({
  adapter: defineSandboxAgent({ ensure: { identity: { agent: "transport-fixture", version: "1", revision: "1" }, probe: shell("true") }, name: "transport-fixture", evidenceCoverage: completeEvidenceCoverage, send: async (_input, ctx) => {
    const process = await acquireManagedProcess(ctx, "transport-fixture", { argv: ["node", "-e", `
      process.stdout.write('transport-resume-ready');
      process.stderr.write('stderr-before');
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
    if (!Buffer.concat(stdout).equals(Buffer.concat([Buffer.from("transport-resume-ready"), Buffer.from([0,255,65,10])]))) throw new Error("Lost or duplicated stdout bytes");
    if (Buffer.concat(stderr).toString() !== "stderr-beforestderr-after") throw new Error("Lost or duplicated stderr bytes");
    return { status: "completed", events: [] };
  } }),
  sandbox: instaboxSandbox({ templateId: "universal", lifetimeMs: 600_000 }),
  evals: ["reconnect"],
});
