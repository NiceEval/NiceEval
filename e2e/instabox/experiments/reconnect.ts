import { defineExperiment } from "niceeval";
import { acquireManagedProcess, defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";
export default defineExperiment({
  adapter: defineSandboxAgent({ ensure: { identity: { agent: "transport-fixture", version: "1", revision: "1" }, probe: shell("true") }, name: "transport-fixture", evidenceCoverage: completeEvidenceCoverage, send: async (_input, ctx) => {
    // Keep a second channel's stdin open across the shared connection loss.
    const echo = await acquireManagedProcess(ctx, "transport-fixture-stdin", { argv: ["node", "-e", "process.stdin.pipe(process.stdout)"] });
    const input = Buffer.from([0, 255, 10, 195, 169]);
    const echoed: Buffer[] = [];
    const collectEcho = (async () => {
      for await (const chunk of echo.output) if (chunk._tag === "Stdout") echoed.push(Buffer.from(chunk.bytes));
    })();
    await echo.writeStdin(input);
    // A deterministic app-server-shaped peer: no model or paid API is used.
    const rpc = await acquireManagedProcess(ctx, "transport-fixture-rpc", { argv: ["node", "-e", `
      let input = '', pending = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => {
        input += chunk; pending += chunk;
        let index;
        while ((index = pending.indexOf('\\n')) !== -1) {
          const request = JSON.parse(pending.slice(0, index)); pending = pending.slice(index + 1);
          if (request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { method: request.method } }) + '\\n');
        }
      });
      process.stdin.on('end', () => process.stdout.write(JSON.stringify({ received: Buffer.from(input).toString('base64'), eof: 1 }) + '\\n'));
    `] });
    const initialize = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"fixture","version":"1"}}}\n';
    let rpcOutput = "";
    let initialized!: () => void;
    const ready = new Promise<void>(resolve => { initialized = resolve; });
    const collectRpc = (async () => {
      for await (const chunk of rpc.output) if (chunk._tag === "Stdout") {
        rpcOutput += Buffer.from(chunk.bytes).toString("utf8");
        if (rpcOutput.includes("\n")) initialized();
      }
    })();
    await rpc.writeStdin(Buffer.from(initialize));
    await ready;
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
    const tail = Buffer.alloc(128 * 1024, 255);
    await echo.writeStdin(tail);
    await echo.closeStdin();
    await collectEcho;
    if ((await echo.wait()).exitCode !== 0 || !Buffer.concat(echoed).equals(Buffer.concat([input, tail]))) throw new Error("Raw stdin or EOF acknowledgement changed across reconnect");
    const followup = '{"jsonrpc":"2.0","method":"initialized"}\n{"jsonrpc":"2.0","id":2,"method":"thread/start"}\n{"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"input":"中文 ☃"}}\n';
    await rpc.writeStdin(Buffer.from(followup));
    await Promise.all([rpc.closeStdin(), rpc.closeStdin()]);
    await collectRpc;
    const expected = [
      { jsonrpc: "2.0", id: 1, result: { method: "initialize" } },
      { jsonrpc: "2.0", id: 2, result: { method: "thread/start" } },
      { jsonrpc: "2.0", id: 3, result: { method: "turn/start" } },
      { received: Buffer.from(initialize + followup).toString("base64"), eof: 1 },
    ].map(value => JSON.stringify(value) + "\n").join("");
    if ((await rpc.wait()).exitCode !== 0 || rpcOutput !== expected) throw new Error(`JSON-RPC input, responses or EOF changed across reconnect: ${rpcOutput}`);
    return { status: "completed", events: [] };
  } }),
  sandbox: instaboxSandbox({ templateId: "universal", lifetimeMs: 600_000 }),
  evals: ["reconnect"],
});
