import { createHash } from "node:crypto";
import { Client, type ClientChannel } from "ssh2";
import { ManagedProcessOutput } from "../managed-process.ts";
import type { ManagedProcess, ManagedProcessExit, ManagedProcessStart } from "../types.ts";
import { shellQuote } from "../shell.ts";
import type { SSHToken } from "./api.ts";

// The supervisor owns only the foreground command. Deliberately independent
// background services live until the Machine is deleted. Closing inherited output
// pipes on foreground exit prevents those services from holding the command open.
const supervisor = String.raw`
const { spawn } = require('node:child_process');
const c = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
if (Number(process.versions.node.split('.')[0]) < 22) process.exit(126);
const env = { ...process.env, ...c.env };
if (c.pathPrepend.length) env.PATH = c.pathPrepend.join(':') + ':' + env.PATH;
const child = spawn(c.argv[0], c.argv.slice(1), { cwd: c.cwd, env, detached: true, stdio: ['pipe','pipe','pipe'] });
process.stdin.pipe(child.stdin);
child.stdin.on('error', () => {});
child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
let ended = false;
const finish = (code) => {
  if (ended) return;
  ended = true;
  process.stdin.unpipe(child.stdin);
  process.stdin.pause();
  child.stdout.unpipe(process.stdout);
  child.stderr.unpipe(process.stderr);
  child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); child.unref();
  let pending = 2;
  const flushed = () => { if (--pending === 0) process.exit(code); };
  process.stdout.write('', flushed); process.stderr.write('', flushed);
};
child.once('error', (error) => { process.stderr.write(error.message + '\n'); finish(error.code === 'ENOENT' ? 127 : 126); });
child.once('exit', (code, signal) => {
  // Let already-readable foreground output drain before closing inherited pipes.
  setImmediate(() => finish(code === null ? 128 + (require('node:os').constants.signals[signal] || 0) : code));
});
`;

export async function startInstaboxProcess(input: {
  readonly token: SSHToken;
  readonly process: ManagedProcessStart;
  readonly pathPrepend: readonly string[];
  readonly root: boolean;
  readonly retire: () => Promise<void>;
  readonly register: (client: Client) => () => void;
}): Promise<ManagedProcess> {
  const client = new Client();
  const unregister = input.register(client);
  const output = new ManagedProcessOutput();
  let terminal = false;
  let exit: ManagedProcessExit | undefined;
  let resolveDone!: (exit: ManagedProcessExit) => void;
  let rejectDone!: (cause: unknown) => void;
  const done = new Promise<ManagedProcessExit>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  void done.catch(() => undefined);
  let rejectReady!: (cause: unknown) => void;
  let failure: Promise<void> | undefined;
  const fail = (): Promise<void> => failure ??= (async () => {
    if (terminal) return;
    terminal = true;
    let cause: Error = new Error("Instabox SSH process lost its confirmed exit; retiring the Machine");
    try { await input.retire(); }
    catch (cleanup) { cause = new AggregateError([cause, cleanup], "Instabox process and Machine cleanup failed"); }
    client.destroy(); unregister(); output.end();
    rejectReady(cause); rejectDone(cause);
  })();
  const ready = new Promise<ClientChannel>((resolve, reject) => {
    rejectReady = reject;
    client.once("ready", () => {
      const config = Buffer.from(JSON.stringify({ ...input.process, pathPrepend: input.pathPrepend })).toString("base64");
      const command = `${input.root ? "sudo -n -- " : ""}node -e ${shellQuote(supervisor)} ${shellQuote(config)}`;
      client.exec(command, { pty: false }, (error, channel) => {
        if (error) { void fail(); return; }
        channel.on("data", (bytes: Buffer) => output.push({ _tag: "Stdout", bytes }));
        channel.stderr.on("data", (bytes: Buffer) => output.push({ _tag: "Stderr", bytes }));
        channel.on("error", () => { void fail(); });
        channel.once("exit", (code: number | null, signal?: string) => {
          exit = { exitCode: typeof code === "number" ? code : null, ...(signal ? { signal } : {}) };
        });
        channel.once("close", () => {
          if (terminal) return;
          setImmediate(() => {
            if (terminal) return;
            if (exit === undefined) { void fail(); return; }
            terminal = true;
            output.end(); resolveDone(exit); client.end(); unregister();
          });
        });
        resolve(channel);
      });
    });
    client.on("error", () => { void fail(); });
    client.once("close", () => { if (!terminal) void fail(); });
    client.connect({
      host: input.token.host, port: input.token.port, username: input.token.token,
      authHandler: ["none"], readyTimeout: 30_000, keepaliveInterval: 10_000, keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}` === input.token.hostKeyFingerprint.replace(/=+$/, ""),
    });
  });
  const channel = await ready;
  let stdinClosed = false;
  let termination: Promise<void> | undefined;
  return {
    output,
    writeStdin: (bytes) => new Promise((resolve, reject) => {
      if (stdinClosed || terminal) { reject(new Error("Instabox process stdin is closed")); return; }
      channel.write(Buffer.from(bytes), (error?: Error | null) => {
        if (error) void fail().then(() => reject(new Error("Instabox process stdin write failed")));
        else resolve();
      });
    }),
    closeStdin: () => new Promise((resolve) => {
      if (stdinClosed || terminal) { resolve(); return; }
      stdinClosed = true;
      channel.end(resolve);
    }),
    wait: () => done,
    terminate: () => termination ??= (async () => {
      if (terminal) { await done; return; }
      // A channel signal cannot prove descendant termination. Retire the VM.
      terminal = true;
      try { await input.retire(); resolveDone({ exitCode: null, signal: "SIGKILL" }); }
      catch (cause) { rejectDone(cause); throw cause; }
      finally { output.end(); client.destroy(); unregister(); }
    })(),
  };
}
