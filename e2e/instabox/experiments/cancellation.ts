import { defineExperiment } from "niceeval";
import { acquireManagedProcess, completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";

export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "command-lifetime-fixture",
    ensure: { identity: { agent: "node", version: "22", revision: "1" }, probe: shell("node --version") },
    evidenceCoverage: completeEvidenceCoverage,
    async send(_input, ctx) {
      const sibling = await acquireManagedProcess(ctx, "command-lifetime-fixture", {
        argv: ["node", "-e", "process.stdin.pipe(process.stdout)"],
      });
      let echoed = "";
      const output = (async () => {
        for await (const chunk of sibling.output)
          if (chunk._tag === "Stdout") echoed += Buffer.from(chunk.bytes).toString("utf8");
      })();
      await sibling.writeStdin(Buffer.from("before-cancel\n"));
      for (const mode of ["cancel", "timeout"] as const) {
        const cancellation = new AbortController();
        let stdout = "";
        let failure: unknown;
        try {
          await ctx.sandbox.runCommand(
            "node",
            [
              "-e",
              `
            const { spawn } = require('node:child_process');
            const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)']);
            child.stdout.once('data', () => process.stdout.write('cancel-ready:' + process.pid + ':' + child.pid + '\\n'));
            setInterval(() => {}, 1000);
          `,
            ],
            {
              signal: cancellation.signal,
              timeoutMs: 5_000,
              onStdout(text) {
                stdout += text;
                if (mode === "cancel" && /^cancel-ready:\d+:\d+\n/m.test(stdout)) cancellation.abort();
              },
            },
          );
        } catch (cause) {
          failure = cause;
        }
        const expectedFailure =
          mode === "cancel"
            ? failure instanceof DOMException && failure.name === "AbortError" && failure === cancellation.signal.reason
            : failure instanceof Error && failure.name === "SandboxCommandTimeoutError";
        if (!expectedFailure) throw new Error(`Missing ${mode} outcome: ${String(failure)}`);
        const match = stdout.match(/cancel-ready:(\d+):(\d+)/);
        if (!match) throw new Error(`Command never reached its owned child: ${stdout}`);
        await ctx.sandbox.runCommandOrThrow("node", [
          "-e",
          `
          const fs = require('node:fs');
          for (const pid of ${JSON.stringify(["PID", "CHILD"])}) {
            try {
              const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
              if (!['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]))
                throw Error('Cancelled command left a live process: ' + pid);
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
        `
            .replace('"PID"', match[1]!)
            .replace('"CHILD"', match[2]!),
        ]);
        await sibling.writeStdin(Buffer.from(`after-${mode}\n`));
      }
      await sibling.closeStdin();
      await output;
      if ((await sibling.wait()).exitCode !== 0 || echoed !== "before-cancel\nafter-cancel\nafter-timeout\n")
        throw new Error(`Cancellation disturbed another managed process: ${echoed}`);
      return { status: "completed", events: [] };
    },
  }),
  sandbox: instaboxSandbox({ templateId: "agent-browser", lifetimeMs: 600_000 }),
  evals: ["cancellation"],
});
